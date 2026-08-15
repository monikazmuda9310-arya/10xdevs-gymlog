# Account deletion — Implementation Plan

## Overview

Let a signed-in account delete itself — its `auth.users` row and every training row hanging off it —
with **no `service_role` key anywhere in this repository**, through a `security definer` Postgres
function granted to `authenticated`. The function deletes in dependency order, because the schema's
one `on delete restrict` edge otherwise blocks an ordinary user from deleting their own account. When
the database refuses anyway, the user is told; never a 500, never a silent success.

## Current State Analysis

Everything below is measured, not assumed — `context/changes/account-deletion/research.md` carries the
probes and the file references.

**The mechanism is feasible.** `postgres` — the role migrations run as, and the owner of this
repository's one existing `security definer` function — holds `DELETE` on `auth.users`;
`authenticated` does not. So a function owned by `postgres`, `security definer`, granted to
`authenticated`, is both possible and the only possible path.

**The self-block does NOT exist — measured 2026-08-15, and this paragraph is the corrected version.**
Planning inferred from the catalogue that a bare `delete from auth.users` would abort for an account
owning a custom exercise with a logged entry. **Step 1.2 measured it and both cases succeeded.** The
OID ordering below is accurate; the inference from it was not. The `RESTRICT` check is **itself an
AFTER trigger**, queued behind the already-queued cascade into `exercise_entries`, so by the time it
runs the referencing rows are gone. "Not deferrable" means "cannot be postponed to COMMIT", not
"checked synchronously inside the cascade".

**The design did not change, but its reason did.** The function still deletes in dependency order —
not because a bare delete fails today, but because whether it fails depends on **AFTER-trigger queue
ordering, which is observed behaviour rather than a documented contract**, and this plan has already
been wrong once about exactly that. Deleting explicitly is immune to it. The cross-account blocker is
unaffected by either choice.

The referential-integrity triggers on `auth.users` fire in OID order:

| Order | Cascades into        |
| ----- | -------------------- |
| 17517 | `profiles`           |
| 17556 | **`exercises`**      |
| 17584 | `workouts`           |
| 17601 | **`exercise_entries`** |
| 17630 | `sets`               |

The account's own exercises are deleted **before** its own entries, and `public.exercises` carries the
schema's only `on delete restrict` (`exercise_entries_exercise_id_fkey`, triggers 17606/17607).
`RESTRICT` is not deferrable — that is exactly what distinguishes it from `NO ACTION` — and no
constraint in this schema is declared `deferrable`. **That is where the wrong inference came from**:
non-deferrable was read as "checked before the sibling cascade", and it is not. See the corrected
paragraph above and step 1.2 in `## Progress`.

**There is no RPC surface in this repository at all.** `Database["public"]["Functions"]` is
`[_ in never]: never` (`src/db/database.types.ts:280-282`), and no `.rpc()` call exists anywhere. This
slice creates the first one.

**All `auth`-side satellites cascade** — `identities`, `sessions`, `mfa_factors`, `one_time_tokens`,
`oauth_authorizations`, `oauth_consents`, `webauthn_credentials`, `webauthn_challenges`.
**`auth.audit_log_entries` carries no foreign key to `auth.users`** and survives the deletion, carrying
the email address in its payload. Provider-managed and outside this repository's control, but a slice
justified by a data-protection duty should not claim otherwise.

## Desired End State

A signed-in account can delete itself from `/settings`, after a dialog naming how much training goes
and stating that it cannot be undone. Every row keyed to that account is gone; the 38 seeded exercises
and every other account's data are untouched; the browser is left holding no session, on the sign-in
screen, told what happened in a neutral sentence rather than an error box. The account that has custom
exercises with logged sets deletes as cleanly as one that has none — proven by a test that fails if
the deletion order regresses.

### Key Discoveries

- **The visibility of the blocked path changed while this was being planned.** With dependency-order
  deletion, the account's own entries are gone before its own exercises are touched, so the self-block
  cannot fire. The only remaining blocker is **another account's** entry pointing at this account's
  private exercise — and the sibling slice `cross-account-isolation` refuses that row at insert for any
  `authenticated` caller. **So the blocked path is not constructible from an integration test**, and the
  plan says so rather than shipping an assertion that appears to cover it.
- **Function grants default to `PUBLIC`, not to `anon`/`authenticated`.** The table template's
  "revoke before granting" rule exists for Supabase's implicit grant; for a function the default
  `EXECUTE` goes to `PUBLIC`, so `revoke … from anon, authenticated` alone leaves it callable by
  anybody. The revoke must name `public`. Different source, same class of trap, and nothing in
  `context/foundation/access-control.md` covers it today.
- **`auth.uid()` returns `null` off the PostgREST path**, so `where id = auth.uid()` would delete zero
  rows and report success — this repository's own documented lie (`AGENTS.md` § "A zero-row UPDATE or
  DELETE is a SUCCESS"). Reachable in practice: an access token stays verifiable for its remaining
  lifetime after the row is gone, so a replayed second call is a real zero-row case.
- **The seeded catalogue is at its most exposed inside this function**, because `security definer`
  bypasses RLS and the 38 shared rows are protected only by three-valued logic in a policy
  (`20260810174840_create_exercises_with_shared_catalogue.sql:69-77`).
  `delete from public.exercises where user_id = <uid>` is correct;
  `where user_id is not distinct from <uid>` — the "null-safe" tidy-up somebody will propose — wipes the
  catalogue for every account and no policy would stop it.
- **`getUser()` is a network round trip, not a local JWT decode** (verified in `@supabase/auth-js`
  2.105.3). So `src/middleware.ts` asks the auth server every request and a deleted account's token
  fails there despite remaining cryptographically valid — the stale-JWT problem is largely
  self-solving here, and would not be if the middleware used `getSession()`.
- **`signOut()` is safe to call after the account is gone** — `GoTrueClient` explicitly tolerates
  404/401/403 with the comment "ignore 404s since user might not exist anymore", then clears the
  session anyway. But the cookie-clearing `Set-Cookie` headers only exist on the response of the
  request that called it, so the delete endpoint must call it itself.
- **No redirect loop is possible.** `PROTECTED_ROUTES` and `AUTH_ROUTES` are disjoint and their
  conditions are mutually exclusive on `locals.user`; deletion makes `user` falsy, whereas the endless
  loop `AGENTS.md` warns about came from a truthy `user` with no session.

## What We're NOT Doing

- **No preflight.** "Can this account be deleted?" cannot be answered honestly by a query the account
  can run: RLS hides the blocking row from both accounts, so a plain-query preflight would answer "not
  blocked" while blocked — the empty-list-as-reassurance failure `…/impact` endpoints exist to prevent.
  A second `security definer` function could see it, and is not worth its own elevated surface for
  information that does not change the user's decision. The attempt is the only source of truth.
- **Not changing `on delete restrict` on `exercise_id`.** Deliberate, recorded at
  `20260811005248_create_workout_log_with_row_ownership.sql:55-58`, and out of scope for the sibling
  slice too. `no action` (deferred) would make the self-block disappear declaratively and is worth
  asking the owner about **some other time** — it is a scope-changing schema decision, not an
  implementation detail, and it does not fix the cross-account case.
- **Not deleting another account, ever, by any path.** The function takes no parameters.
- **Not exporting the user's data before deletion.** The PRD keeps compliance out of scope except
  baseline own-data deletion.
- **No E2E.** Phase 3 of the course owns the browser level.
- **Not merging either PR.** M2 deliverable 5 wants a solo review first.

## Implementation Approach

One migration adding the repository's first RPC; one endpoint that calls it, maps its failures and
signs the caller out in the same request; one island on `/settings`; one integration suite that deletes
its own accounts through the very function it is testing. Then documents, the PR, the shared
deployment, and finally the production account cleanup — which is the feature's first real use and
therefore comes last.

## Critical Implementation Details

**The deletion order is defensive, and the migration header must say so honestly.** `public.workouts`
first (which cascades to `exercise_entries` and `sets`), then `public.exercises where user_id = <uid>`,
then `auth.users`. **A bare delete works today — that is measured, not assumed** (step 1.2) — so the
header must not claim the order is load-bearing. What it IS: independence from AFTER-trigger queue
ordering, which is observed behaviour rather than a documented guarantee, and which this plan
mis-predicted once already. Write both halves into the header: the measurement, and the reason the
order stays anyway. The next person to "simplify this to a single delete" needs to meet a true reason
in the file, not a scary one that a five-minute experiment disproves.

**`security definer` means the opposite thing one migration away, and both headers must say so.** The
sibling slice's `20260815090000` creates a `security invoker` trigger whose header states that
`security definer` would silently disable it. This function needs definer rights for the opposite
reason: `authenticated` has no privilege on `auth.users` and must never be given one. After both merge
the repository holds one function of each kind, each documenting the other as its failure mode.

**The migration timestamp must be later than `20260815120000`, and this is now a hard constraint
rather than a courtesy.** Measured on 2026-08-15: `npm run db:status` from this worktree shows both
hosted projects already carrying `20260815090000` and `20260815120000` **with an empty local column** —
those files live on `feature/cross-account-isolation`, not here. Branch state and database state are
decoupled by design. A new migration timestamped before the last remote entry is rejected as
out-of-order by the CLI, so an earlier timestamp does not merely look odd, it fails.

**Worktree setup, done on 2026-08-15 — recorded so nobody repeats it.** Git worktrees receive no
git-ignored paths, which meant **both `.env`/`.dev.vars` and `node_modules` were missing**; the second
is easy to forget because the first is the one everybody thinks of, and the failure it produces
(`cannot resolve the 'supabase' package`) looks like a broken script rather than a missing install.
`.env` is owner-edited and agent file tools are denied `Read(./.env)`, so the copy is an owner action;
`npm ci` is not. Both are done and `db:status` reaches both projects from here.

---

## Phase 1: The function, and the proof that ordinary deletion works

### Overview

Measure the self-block, then close it by construction, then build the suite that would notice the
closure regressing.

### Changes Required

#### 1. Measurement (no file — a recorded step)

**Intent**: establish, before the migration is written, whether a bare `delete from auth.users`
actually aborts for an account holding a custom exercise with a logged entry. § Current State Analysis
says the catalogue points that way; the plan records the observation rather than the inference.

**Contract**: against `gymlog-test` only. Create a throwaway account, give it a custom exercise, a
workout and an entry logging that exercise, then attempt the bare delete and record the SQLSTATE and
message. Repeat with an account holding only seeded exercises. Record both outcomes in `## Progress`,
including the case where the measurement **contradicts** the inference — dependency-order deletion is
correct either way, so a contradicting result changes the migration header's justification, not the
design.

#### 2. The function

**File**: `supabase/migrations/<timestamp after 20260815120000>_delete_own_account.sql`

**Intent**: let a caller delete their own account and nothing else, in an order that never reaches the
`restrict` edge from their own data.

**Contract**: `public.delete_own_account()`, **no parameters**, `language plpgsql`, **`security
definer`**, `set search_path = ''` with every name schema-qualified. It resolves the uid from
`auth.uid()` and **raises when it is null** rather than deleting zero rows and reporting success. It
deletes `public.workouts`, then `public.exercises where user_id = <uid>` — never
`is not distinct from` — then `auth.users`, and **raises when the `auth.users` delete matches no row**,
so a replayed call on a still-valid JWT cannot answer success. Grants:

```sql
revoke all on function public.delete_own_account() from public, anon, authenticated;
grant execute on function public.delete_own_account() to authenticated;
```

`public` in that revoke is load-bearing and is the whole reason this line differs from the table
template. End with `notify pgrst, 'reload schema';`.

The header carries: the OID-order table and why the order is the design; why `security definer` here is
the opposite of the sibling trigger's `security invoker`; the `is not distinct from` hazard against the
38 seeded rows; and that the function takes no parameters on purpose.

#### 3. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: the RPC must be callable with types. `Database["public"]["Functions"]` is empty today.

**Contract**: `npm run db:types` after `npm run db:push`. Generated from **production**, so the
migration must be applied to both projects first. Never hand-edited.

#### 4. The suite

**File**: `tests/integration/account-deletion.test.ts`

**Intent**: own this slice's evidence, and be the first suite in this repository that leaves nothing
behind.

**Contract**: MARK `s09d-` — not a prefix of, and not prefixed by, any of the eleven marks now in use
(`s01-signup-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`, `s06-`, `s07-`, `s08-`,
`s09i-`). **Throwaway accounts per run, deleted in teardown through `delete_own_account` itself** — the
first suite able to clean up after itself, and the cleanup is itself a use of the subject. The header
must state the cost of that choice plainly: **when the function is broken, teardown is broken too, so a
red run leaks accounts precisely when it fails.** It must also state that this suite may never delete
an account whose address begins `s09i-` or `rls-owner-` — `s09i-a@`, `s09i-b@` and `s09i-signout@` became
permanent on the sibling branch, and nothing here would notice their loss; it would surface as the
sibling suite failing on a later run.

Assertions:

1. an account holding **a custom exercise with logged sets** deletes cleanly — the regression guard for
   the deletion order, and the assertion this phase exists for;
2. an account holding **only seeded exercises** deletes cleanly;
3. after deletion the **seeded catalogue still has its 38 rows**, read as a surviving account;
4. after deletion **another account's data is untouched**, read back as its owner;
5. the `auth.users` row is really gone — proven without an admin key by **signing up the same address
   again**: with confirmation off on `gymlog-test`, `signUp` on a live address errors
   `user_already_exists`, so a successful signup returning a **new** user id is external proof;
6. a call carrying **any argument** fails with PostgREST `PGRST202` — the tripwire for somebody adding
   an aim-able overload later;
7. an **unauthenticated** client calling the function is refused, and a surviving account's rows are
   still there when read back.

### Success Criteria

#### Automated Verification

- `.env` and `.dev.vars` present in this worktree, and `npm run db:status` prints both histories
- Self-block measured on `gymlog-test` and both outcomes recorded, including a contradicting result
- Migration applies to both projects: `npm run db:push`, timestamp later than `20260815120000`
- Types regenerated and committed: `npm run db:types`
- Every suite passes, not only the new one: `npm run test:integration`
- The suite is repeatable: two consecutive runs green
- `npm run typecheck` and `npm run lint` pass
- **Mutation (a)**: delete `public.exercises` before `public.workouts` in the function → assertion 1
  fails and assertion 2 still passes, which is the self-block reproduced through the product's own path
- **Mutation (b)**: grant `execute` to `public` instead of `authenticated` → assertion 7 fails
- **Mutation (c)**: replace the null-uid raise with a bare `where id = auth.uid()` → assertion 7 fails
  on a **success** answer rather than a refusal
- **Mutation (d)**: `where user_id is not distinct from <uid>` on the exercises delete → assertion 3
  fails, with the seeded catalogue gone
- Every mutation's failure is read, not just its colour: `lessons.md` § "A mutation that fails for the
  WRONG REASON has not confirmed the guard". **Restore `gymlog-test` after each and verify the restore
  by re-reading `pg_get_functiondef` and `pg_proc.prosecdef`.**

#### Manual Verification

- The migration header explains the deletion order well enough that a reader who has not seen this plan
  can say why a single `delete from auth.users` would be wrong

**Implementation Note**: pause after this phase for confirmation before proceeding.

---

## Phase 2: The endpoint, the honest failure, and a new message catalogue

### Overview

Give the function an HTTP surface that ends the session in the same request, and map its refusals onto
sentences the user can act on.

### Changes Required

#### 1. The message catalogue

**File**: `src/lib/validation/account.ts`

**Intent**: account deletion is a fifth message surface; nothing in `auth`, `exercise`, `profile` or
`workout` fits, and reusing one would put "your account could not be deleted" in a module that ships to
an unrelated island.

**Contract**: `ACCOUNT_MESSAGES`, `AccountMessageCode`, `accountMessageForCode` — the same shape as its
four siblings, resolving an unrecognised code to the generic message and never to the caller's words.
**It imports nothing**, because the delete panel is a hydrated island. Codes at minimum:
`account_delete_blocked` (the honest failure), `account_delete_failed`, `unauthenticated`,
`not_configured`, `unexpected`.

#### 2. The endpoint

**File**: `src/pages/api/account/index.ts`

**Intent**: call the RPC, translate its failures, and leave the browser holding no session.

**Contract**: `DELETE`, `export const prerender = false`. It follows `src/pages/api/profile/index.ts`
rather than `_shared/mutation-route.ts`, for the reason that file already states at `:13-21` — there is
no `[id]` to validate, and the row is named by `locals.user.id` and nothing else. It reads
`context.locals.{supabase,user}`, answers `500 not_configured` / `401 unauthenticated`, calls the RPC,
and on success **calls `supabase.auth.signOut()` in the same request** so the cookie-clearing headers
ride this response. It answers JSON the island can act on, never a redirect — a `context.redirect()`
from a fetched DELETE is followed by the fetch, not the browser.

Error mapping: `23503` → `account_delete_blocked`, **not** `unexpected`. Everything else →
`console.error` plus `unexpected`, with no provider text reaching the caller. A delete that succeeded
but whose `signOut` failed is logged as its own condition — the account really is gone, so the caller
is still told success, but a browser left holding a cookie for a nonexistent account pays a failing
round trip on every request and nothing else would report it.

#### 3. The hermetic mapping test

**File**: `src/lib/services/accounts.test.ts` (beside the module it tests)

**Intent**: pin `23503 → account_delete_blocked` without a database, so the mapping is guarded in
`npm test` where it cannot rot behind a network dependency.

**Contract**: the mapping must live in a plain, dependency-free function in `src/lib/services/` —
`lessons.md` § "A criterion that demands a unit test must name the module that will hold it". Feed it a
fabricated `{ code: "23503", message: … }` and assert the code; feed it an unrelated error and assert
`unexpected`. Import through `@/`, import `describe`/`it`/`expect` from `"vitest"`.

#### 4. The named gap

**File**: `tests/integration/account-deletion.test.ts` (header prose — **no assertion**)

**Intent**: record that the blocked path has no end-to-end test and why, in the same words this
repository uses to refuse a decorative one.

**Contract**: name the guarantee (a blocked deletion tells the user and leaves every row intact); state
that **no mutation available today breaks it**, because dependency-order deletion makes the self-block
unreachable and the sibling slice's trigger makes the cross-account row unconstructible for an
`authenticated` caller; and name the exact future edits that would make it testable — `RESTRICT`
becoming `NO ACTION`, or a `service_role`-seeded hazard row. Cite the hermetic test as what does guard
the mapping. This is `lessons.md` § "An assertion you keep because it cannot fail YET…" applied in the
refusing direction.

#### 5. Integration coverage of the endpoint

**File**: `tests/integration/account-deletion.test.ts`

**Contract**: call the exported handler with a real session, in the pattern of
`tests/integration/workout-endpoints.test.ts` — never through `astro dev`, whose `.dev.vars` point at
production. Assert the success status and that a re-read as a surviving account shows its rows intact.
Assert the unauthenticated caller gets `401 unauthenticated` and that nothing was deleted.

### Success Criteria

#### Automated Verification

- `npm test` covers the mapping, including the `23503` branch and the fall-through
- **Mutation (e)**: remove the `23503` branch → the hermetic test fails **on the code**, not on a
  status or a thrown error
- `npm run test:integration` green, every suite
- The full six-step gate passes

#### Manual Verification

- None. This phase adds no user-visible behaviour.

---

## Phase 3: The screen

### Overview

Put the action where the user expects it, behind a dialog that names what it costs.

### Changes Required

#### 1. The panel

**File**: `src/components/settings/DeleteAccountPanel.tsx` and a slot in `src/pages/settings.astro`

**Intent**: a destructive action on the settings page that does not disturb the existing "one form, one
Save" arrangement.

**Contract**: its own `client:load` island in a sibling `<section>` **after** the
`{ loadFailed ? … : <PreferencesForm/> }` block — **not inside it**. `settings.astro:90-94` replaces the
whole form when the profile read fails, and a user whose profile could not be read must still be able to
delete their account. It is a button, never a field, and never enters `PreferencesForm`'s `<form>`.

#### 2. The counts

**File**: the panel, plus a service function in `src/lib/services/`

**Intent**: the dialog names how much training goes, because "your whole history" is an abstraction the
user cannot weigh — the same reasoning as S-05's falling-record warning.

**Contract**: three counts — workouts, sets, custom exercises — read under RLS with explicit
`.eq("user_id", …)`. **A failed count must not become a zero**: a zero is a positive claim and would
read as "you have nothing to lose" at the exact moment that matters. On a failed read the dialog drops
the numbers and shows the prose form, and says so.

#### 3. The dialog

**File**: the panel

**Contract**: `ConfirmDialog` from `src/components/ui/confirm-dialog.tsx` used **directly**, as
`RecordImpactDialog` does — not through it, whose props are record-impact specific. Copy its
conventions: `useId()` for `labelledBy`/`describedBy`, **cancel first in the DOM and carrying
`data-initial-focus`** so `showModal()` never lands on the destructive control, the destructive button
second and red, and the `pending`/`error`-inside-the-dialog pattern so a blocked deletion is reported
where the user is looking. Do **not** install shadcn's `alert-dialog`: measured at **+40 KB** against a
~15 KB threshold and removed.

The dialog states the counts and that the deletion cannot be undone. It does not mention audit logs —
that belongs in `README.md`, not in front of somebody making an emotional decision.

#### 4. The destination

**Files**: the panel, `src/pages/auth/signin.astro`, `src/lib/validation/auth.ts`

**Intent**: the user lands somewhere that confirms what happened, without a loop and without a success
rendered in error styling.

**Contract**: on success the panel navigates with `window.location.href` — the established
post-destructive move (`WorkoutHeader.tsx:104-105`, "there is no state to reconcile — leave") — to
`/auth/signin?notice=account_deleted`. `signin.astro` gains a **neutral** notice slot beside its
existing `?error=` handling, resolved through a code lookup exactly as `messageForCode` does, rendering
an unrecognised code as nothing rather than as the visitor's words. A new entry in `AUTH_MESSAGES`;
that module **imports nothing** on purpose, so a string is free and anything else is not.

#### 5. The render check

**File**: `tests/render/settings-delete-panel.test.ts`

**Intent**: the one question neither other project can ask — what the rendered HTML actually contains.

**Contract**: render `/settings` through Astro's container with fake `locals`, and assert the delete
panel is present **both** when the profile loads and when `loadFailed` is true. That second case is the
whole point of the placement decision and nothing else would catch it being moved inside the ternary.

### Success Criteria

#### Automated Verification

- `npm run test:render` covers the panel in both the loaded and `loadFailed` states
- **Mutation (f)**: move the panel inside the `loadFailed` ternary → the render check fails on the
  failed-profile case and passes on the other
- The full six-step gate passes

#### Manual Verification

- On the deployed URL — deferred to Phase 5, where the deployment happens — sign in as a throwaway
  account, open `/settings`, confirm the dialog names real counts, cancel once and confirm nothing
  happened, then delete and confirm the sign-in screen says so in a neutral box rather than a red one
- Keyboard only: Tab reaches the delete button, Enter opens the dialog, focus lands on **Cancel**,
  Escape closes it without deleting

---

## Phase 4: Documents, and the pull request

### Overview

Make the documents true, then open the second PR.

### Changes Required

#### 1. `context/foundation/access-control.md`

**Intent**: the file gained a fifth shape from the sibling slice; this adds a **sixth** — a
`security definer` RPC, the only shape here that deliberately escapes RLS.

**Contract**: a new section carrying the template SQL, and the two things that bite silently: **the
default `EXECUTE` grant goes to `PUBLIC`**, so a revoke naming only `anon`/`authenticated` leaves the
function callable by anybody; and **`auth.uid()` is null off the PostgREST path**, so a bare
`where id = auth.uid()` deletes nothing and reports success. Say plainly when this shape is allowed:
only when the operation is impossible under RLS by construction, and only with no parameters. Update
the file's header count and `AGENTS.md`'s shapes table in the same commit — a document that undercounts
its own contents is how a shape stops being read.

#### 2. `AGENTS.md`

**Contract**: § Known state gains the function, the endpoint and the deletion-order rule; the shapes
table gains its sixth row. Say in the same breath what deletion does **not** remove:
`auth.audit_log_entries`. Expect a conflict with the sibling branch on the second merge — it is
recorded in both `change.md` files as expected, not a surprise.

#### 3. `README.md`

**Contract**: the route table gains `DELETE /api/account`; the routes section gains a short paragraph
on what deletion removes and what survives. One row, one paragraph, no new section.

#### 4. `context/foundation/lessons.md`

**Contract**: one appended entry in the register's Context / Problem / Rule / Applies-to shape — **the
order in which cascades fire is a fact about the catalogue, not about the migration file**, and a
schema that looks fully cascading can still refuse to delete a row because two sibling cascades race
each other through a `restrict` edge. Name `pg_trigger` OID order as the way to check it.

#### 5. Bookkeeping and the PR

**Contract**: `change.md` → `status: implemented`; roadmap item **S-09** stays `in-progress` until both
halves archive. PR from `feature/account-deletion` to `main`, body naming the deletion-order finding,
the measurement, what the function refuses, and the fact that the deployment is shared with
`cross-account-isolation`. **Do not merge** — this is the second of the two PRs M2 deliverable 5 asks
for, and it wants a solo review first.

### Success Criteria

#### Automated Verification

- Full gate green: all six steps
- CI green on the pushed branch
- Every test file, assertion number and function name cited in the amended documents exists

#### Manual Verification

- The PR body is readable by somebody who has not seen this plan
- `access-control.md` and `AGENTS.md` agree on how many shapes there are

---

## Phase 5: Deployment

### Overview

The shared deployment, which this slice owns because this is the half that ends in a screen.

### Changes Required

**Contract**: after **both** PRs have merged to `main`, run `npx wrangler deploy` once, then verify on
the public URL: sign in as a throwaway account, complete Phase 3's manual verification there, and
confirm the sign-in notice renders neutrally. `npm run db:push` is **not** part of this — both
migrations reached both projects in their own Phase 1, by design.

Recorded identically in `context/changes/cross-account-isolation/plan.md` § Post-merge. Between merge
and deploy the documents on `main` are ahead of what the deployed Worker serves; keep the window short.

### Success Criteria

#### Automated Verification

- CI green on `main` after both merges

#### Manual Verification

- A throwaway account created on the deployed URL can delete itself, and the sign-in screen says so
- Signing in again with that address fails, and signing **up** with it succeeds — the account is
  genuinely gone from production, not just from the screen

---

## Phase 6: Production account cleanup — the feature's first real use

### Overview

Eight production accounts have been waiting since F-03 for exactly this feature. This phase is
**owner-executed**; the plan supplies the sequence and the checks, not the clicks.

### Changes Required

**Contract**: work through the list in `C:\10xdev\handoff\STATE.md:496-517`, in this order:

1. **Resolve which account holds the real training rows before deleting anything.** `STATE.md` does not
   record its address; by elimination it is `monika.zmuda9310@gmail.com` or
   `monika.zmuda9310+gymlog1@gmail.com` — the only two that went through a real confirmation link.
   Confirm against the data, not by inference. **Backup retention on the free plan is zero days.**
2. The four F-03 smoke accounts (`smoke-…`, `dash-…`, `dash-a-…`, `dash-b-…@gymlog-test.dev`, all in
   **production**) — no training data, delete first as the low-risk rehearsal.
3. `s01-manual-…@example.com` and `proroknh@gmail.com`.
4. The two confirmed-email accounts last, and the one holding real training rows **only when the owner
   decides** — `CONTRACT.md` §6.6, an irreversible decision about the owner's own data.

**Do not touch** `rls-owner-a/b@gymlog-test.dev` (twelve suites share them) or any `s09i-` address (the
sibling suite's permanent pool). Neither is in the production list; both are worth restating here,
because this is the one phase whose tool can actually destroy them.

Update `STATE.md`'s cleanup block as each account goes, so a half-finished run is legible.

### Success Criteria

#### Manual Verification

- Each deleted account is confirmed gone by attempting a sign-in
- `STATE.md`'s cleanup block reflects what actually happened, including anything deliberately kept
- The account holding real training rows is either deleted with the owner's explicit go-ahead, or
  recorded as deliberately kept with the reason

---

## Testing Strategy

### Unit Tests

`src/lib/services/accounts.test.ts` — the error mapping, both branches, hermetic and network-free.

### Integration Tests

`tests/integration/account-deletion.test.ts`, MARK `s09d-`, throwaway accounts per run deleted through
`delete_own_account` itself, with the cost of that choice written into the header. Never `rls-owner-a/b`,
never an `s09i-` address.

### Render Tests

`tests/render/settings-delete-panel.test.ts` — the panel is present in both the loaded and `loadFailed`
states.

### Manual Testing Steps

1. On the deployed URL, sign up a throwaway account and log a workout with a **custom** exercise.
2. Open `/settings`; confirm the panel is visible and the dialog names the real counts.
3. Cancel; confirm nothing was deleted.
4. Delete; confirm the sign-in screen shows the neutral notice, not an error box.
5. Sign in with that address — it must fail. Sign **up** with it — it must succeed with a new account.

## Performance Considerations

The function runs three deletes on indexed `user_id` columns, in Postgres, at human frequency — once
per account, ever. The Cloudflare 10 ms cap is CPU time and does not count the database round trip. The
dialog's three counts are the only added read on a page load, and they run when the dialog opens rather
than when the page renders.

## Migration Notes

The migration is additive — one function, one grant pair, no table, column, policy or row touched. It
must be timestamped after `20260815120000`. `npm run db:types` runs against **production** and must
follow `db:push`, or the RPC will be missing from the committed types.

## References

- Research, with every probe and file reference: `context/changes/account-deletion/research.md`
- Change identity and the seam: `context/changes/account-deletion/change.md`
- Sibling slice: `context/changes/cross-account-isolation/plan.md` on `feature/cross-account-isolation`
- The shapes this repository already has: `context/foundation/access-control.md`
- The accounts this slice inherits: `C:\10xdev\handoff\STATE.md:496-517`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles.

### Phase 1: The function, and the proof that ordinary deletion works

#### Automated

- [x] 1.1 `.env` and `.dev.vars` present in this worktree; `npm run db:status` prints both histories
      — **also needed `npm ci`**, which the plan did not anticipate: worktrees receive no git-ignored
      paths, so `node_modules` was missing too and `db:status` failed with `cannot resolve the
      'supabase' package` — a message that reads like a broken script rather than a missing install.
      Both projects now reachable from here, and the drift check shows the **remote two migrations
      ahead of this branch** (`20260815090000`, `20260815120000` — the sibling slice's, with an empty
      local column). That is the decoupling `AGENTS.md` describes, not drift, and it is why the new
      migration's timestamp constraint is hard rather than cosmetic.
- [x] 1.2 Self-block measured on `gymlog-test`; both outcomes recorded, including a contradicting result
      — **THE MEASUREMENT CONTRADICTS THE INFERENCE, and this is the step existing for its own
      reason.** Both cases SUCCEEDED: an account owning a custom exercise with a workout, an entry
      logging it and a set (CASE 1) deleted with a bare `delete from auth.users` exactly as cleanly
      as one logging only against the seeded catalogue (CASE 2). No `23503`, no refusal.
      **Why the inference was wrong**: the OID ordering in § Current State Analysis is correct, but
      the `RESTRICT` check is itself an AFTER trigger, queued behind the already-queued cascade into
      `exercise_entries` — so by the time it runs, the referencing rows are gone. "Not deferrable"
      means "cannot be postponed to COMMIT", not "checked synchronously inside the cascade".
      **The self-block does not exist**, so the sole justification for dependency-order deletion is
      gone; the cross-account blocker is unaffected either way. Measured with
      `selfblock-measure.mjs` (untracked, removed after). Both throwaway accounts were deleted by the
      measurement itself, so nothing leaked.
- [x] 1.3 Migration applies to both projects: `npm run db:push`, timestamp later than `20260815120000`
      — `20260815140000_delete_own_account.sql`. **The first attempt failed, and the plan had the
      constraint half right**: a later timestamp is necessary but not sufficient — the CLI also
      requires a LOCAL FILE for every remote version, and this branch had neither of the sibling
      slice's two migrations. `supabase-db.mjs` refused correctly, so production was never touched.
      Fixed by `git checkout feature/cross-account-isolation -- <the two files>`; they are identical
      to the sibling's, so the second merge resolves without conflict. **The CLI's own suggestion,
      `migration repair --status reverted`, was NOT taken** — it would rewrite the shared remote
      history to claim those migrations were reverted, after which the sibling branch would re-apply
      them. On the retry the CLI saw both already remote and pushed only the new one.
- [x] 1.4 Types regenerated and committed: `npm run db:types`
      — `Database["public"]["Functions"]` was `[_ in never]: never` and now carries
      `delete_own_account: { Args: never; Returns: undefined }`. **`Args: never` is worth noticing**:
      it makes an argument-carrying call a compile error as well as a `PGRST202` at runtime, so
      assertion 6 guards the runtime half of a rule the type system now states too.
- [x] 1.5 Every suite passes, not only the new one: `npm run test:integration`
      — 14 files / **118 tests** (13 existing + the new suite's 7; `tonnage-breakdown` is one lighter
      because the sibling retired its assertion 9). **Two suites were red before this, and neither
      was caused by this slice**: `tonnage-breakdown` assertion 9 died in setup, and `workout-log-rls`
      assertion 3 read `expected '23503' to be '42501'` — the exact pair the sibling slice fixed when
      its trigger landed. Cause is the same decoupling as 1.3: the shared `gymlog-test` has carried
      that trigger for hours while this branch still had the pre-fix test files. A migration adding
      only a function cannot affect an `exercise_entries` insert. Resolved the same way as 1.3, by
      taking both files from `feature/cross-account-isolation`; they are identical, so the second
      merge resolves without conflict.
- [x] 1.6 The suite is repeatable: two consecutive runs green — 118/118 twice, back to back
- [x] 1.7 `npm run typecheck` and `npm run lint` pass
      — typecheck 119 files, 0 errors. Lint caught one real thing in assertion 6: casting
      `survivor.client.rpc` detached the method from its object (`@typescript-eslint/unbound-method`).
      Fixed by casting the CLIENT instead, so the call stays bound — the rule was right, not noise.
- [x] 1.8 Mutation (a): exercises deleted before workouts → assertion 1 fails, assertion 2 passes
      — **confirmed exactly as written**: assertion 1 red on `expected { code: '23503', … } to be
      null`, assertion 2 green. So the ORDER inside the function is load-bearing even though a bare
      `delete from auth.users` succeeds (1.2) — reversing it walks straight into the `restrict` edge.
- [x] 1.9 Mutation (b): `execute` granted to `public` → assertion 7 fails
      — **not confirmed on the first pass, then made true by strengthening the assertion.** Widening
      the grant left the suite 7/7 green, because the function then RAN and its own null-uid guard
      raised `insufficient_privilege` — **the same `42501` the missing grant answers**. Assertion 7
      checked only the code, so it could not tell "you may not call this" from "you called it as
      nobody". It now also matches the message, and the mutation goes red on exactly that:
      `expected 'delete_own_account() requires an auth…' to contain 'permission denied for function'`
      — the second layer's words appearing where the first layer's belong.
- [x] 1.10 Mutation (c): null-uid raise removed → assertion 7 fails on a success answer
      — **NOT CONFIRMED, and the criterion describes a test that cannot be written.** Removing the
      raise breaks nothing: reaching it needs `auth.uid()` to be null INSIDE the function, which
      requires a caller with no JWT — refused by the EXECUTE grant first. An `authenticated` caller
      always has a uid. This is `lessons.md` § "When a mutation does not break anything, fix the claim
      — never the test": the guard stays (defence in depth is cheap and the edit that makes it matter
      is one somebody will plausibly make), and the untested guarantee is now named in the closing
      note of `tests/integration/account-deletion.test.ts` rather than left implied.
- [x] 1.11 Mutation (d): `is not distinct from` on the exercises delete → assertion 3 fails
      — **NOT CONFIRMED, and the reason is not the obvious one.** `<uuid> is not distinct from NULL`
      is **FALSE**, so the rewrite matches no seeded row at all while a real uid exists; it is
      dangerous only in the company of a null caller, which 1.10's guard prevents. Recorded in the
      same closing note. **A fourth layer was found while reasoning about the combined mutation and
      is worth more than the mutation would have been**: the zero-row raise makes the call ATOMIC —
      PostgREST runs an RPC in a transaction, so a null-uid caller that deleted the catalogue is
      rolled back by `no_data_found` on `delete from auth.users where id = null`. Destroying the 38
      seeded rows for real needs **all four** removed at once. The three-way combination was
      therefore **deliberately not run**: the only experiment that could prove layer 3 destroys the
      fixture twelve suites depend on, to confirm something four layers already make unreachable.
- [x] 1.12 Every mutation's failure message read; `gymlog-test` restored and the restore verified
      — every failure read rather than counted, which is what turned 1.9 from a false pass into a
      real guard and 1.10/1.11 from "confirmed" into findings. **The first restore check reported
      `RESTORE IS WRONG` and was itself the bug**: it matched the substring `is not distinct from`,
      which appears in the function's own comment warning against that edit. Re-verified by dumping
      `pg_get_functiondef` and reading it, then by a structural predicate keyed on the mutated CODE
      line (`is not distinct from caller;`). Final state: `prosecdef` true, `search_path=""`,
      owner-scoped delete present, null guard present, zero-row guard present, `anon` cannot execute,
      `authenticated` can, and the seeded catalogue still counts **38**.

#### Manual

- [x] 1.13 The migration header explains the deletion order to a reader who has not seen this plan
      — confirmed by the owner, 2026-08-15, against the `WHY THE DELETES ARE EXPLICIT AND ORDERED —
      AND WHAT THAT IS *NOT*` paragraph, which states that a bare delete works, that this was
      measured, and that the order buys independence from AFTER-trigger queue ordering rather than
      preventing a failure that does not occur.

### Phase 2: The endpoint, the honest failure, and a new message catalogue

#### Automated

- [ ] 2.1 `npm test` covers the mapping, both the `23503` branch and the fall-through
- [ ] 2.2 Mutation (e): the `23503` branch removed → the hermetic test fails on the code
- [ ] 2.3 `npm run test:integration` green, every suite
- [ ] 2.4 The full six-step gate passes

### Phase 3: The screen

#### Automated

- [ ] 3.1 `npm run test:render` covers the panel in both the loaded and `loadFailed` states
- [ ] 3.2 Mutation (f): the panel moved inside the `loadFailed` ternary → the render check fails
- [ ] 3.3 The full six-step gate passes

#### Manual

- [ ] 3.4 On the deployed URL: counts are real, cancel does nothing, deletion lands on a neutral notice
- [ ] 3.5 Keyboard only: focus lands on Cancel, Escape closes without deleting

### Phase 4: Documents, and the pull request

#### Automated

- [ ] 4.1 Full gate green: all six steps
- [ ] 4.2 CI green on the pushed branch
- [ ] 4.3 Every test file, assertion number and function name cited in the documents exists

#### Manual

- [ ] 4.4 The PR body is readable by somebody who has not seen this plan
- [ ] 4.5 `access-control.md` and `AGENTS.md` agree on how many shapes there are

### Phase 5: Deployment

#### Automated

- [ ] 5.1 CI green on `main` after both merges

#### Manual

- [ ] 5.2 A throwaway account created on the deployed URL can delete itself
- [ ] 5.3 Signing in with that address fails; signing up with it succeeds

### Phase 6: Production account cleanup

#### Manual

- [ ] 6.1 The account holding real training rows is identified against the data, not by inference
- [ ] 6.2 The four F-03 smoke accounts deleted and confirmed gone
- [ ] 6.3 `s01-manual-…@example.com` and `proroknh@gmail.com` deleted and confirmed gone
- [ ] 6.4 The two confirmed-email accounts resolved — deleted with the owner's go-ahead, or recorded as
      deliberately kept with the reason
- [ ] 6.5 `STATE.md`'s cleanup block updated to reflect what actually happened
