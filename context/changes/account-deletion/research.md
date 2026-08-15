---
date: 2026-08-15T11:42:36+0200
researcher: Claude (Opus 5)
git_commit: bf87670bd303d3c1f813444937872ccebc3a0017
branch: feature/account-deletion
repository: gymlog
topic: "Letting an account delete itself with no service_role key, and failing honestly when the database refuses"
tags: [research, codebase, account-deletion, security-definer, cascade, rls, gdpr]
status: complete
last_updated: 2026-08-15
last_updated_by: Claude (Opus 5)
---

# Research: account deletion

**Date**: 2026-08-15T11:42:36+0200
**Branch**: `feature/account-deletion` @ `bf87670`
**Repository**: gymlog (worktree `C:\10xdev\gymlog-account-deletion`)

## Research Question

What would it take to let a signed-in account delete itself — its `auth.users` row and everything
hanging off it — with **no `service_role` key anywhere in this repository**; and this slice's own
half of the problem, telling the user honestly when the database refuses instead of answering a 500
or a silent success.

## Summary

**The mechanism `change.md` proposed is feasible, and that is now measured rather than assumed.**
`postgres` — the role migrations run as, and the owner of the repository's one existing
`security definer` function — holds `DELETE` on `auth.users`; `authenticated` does not. So a
`security definer` function owned by `postgres`, granted to `authenticated` and taking **no
parameters**, can do the job, and is the only path that can.

**But a bare `delete from auth.users where id = auth.uid()` will fail for a large class of ordinary
accounts, and every document written before today says otherwise.** `change.md` frames the
`on delete restrict` risk as a cross-account problem — somebody else's entry pointing at your
private exercise. The catalogue says the same block fires **inside a single account**, with no
second account involved, because of the order the cascades run in. This is the single most important
finding here and it reshapes the slice: the honest-failure path is not an exotic edge case to be
handled defensively, it is what most custom-exercise users would hit — unless the function deletes in
dependency order itself, in which case they hit nothing and the failure path becomes genuinely rare.

**The blocked-cascade fixture problem has a much better answer than anyone expected**, and it follows
from the same finding: the blocking state does **not** need two accounts and therefore does not need
the hazard row the sibling slice just made unconstructible. One account, its own custom exercise, its
own logged entry — the identical `23503`, already asserted in this repository at
`tests/integration/workout-log-rls.test.ts:330-338`.

**Two practical blockers before any of this can be implemented**, neither of which is about design:

1. **This worktree has no `.env` and no `.dev.vars`.** Git worktrees do not receive ignored files.
   `npm run test:integration`, `npm run db:push`, `npm run db:status` and `npm run db:types` all fail
   here today. `.env` is owner-edited and agent file tools are denied `Read(./.env)`, so **copying it
   into this worktree is an owner action** and nothing can be verified until it happens.
2. **`C:\10xdev\handoff\STATE.md` is materially out of date** — zero occurrences of
   `account-deletion`, `cross-account-isolation`, `worktree` or `s09i`. It still records S-09 as a
   single unsplit slice with status `proposed` and names `/10x-new` as the next step. Anybody
   resuming from `STATE.md` alone would start the slice that is already finished.

## Detailed Findings

### 1. The mechanism is feasible — measured, not inferred

Probed read-only against `gymlog-test` through the Management API query endpoint on 2026-08-15
(`supabase_read_only_user`, so nothing could be written even by accident):

| Question | Answer |
| --- | --- |
| Who owns `auth.users` | `supabase_auth_admin` |
| `has_table_privilege('postgres', 'auth.users', 'DELETE')` | **`true`** |
| `has_table_privilege('authenticated', 'auth.users', 'DELETE')` | **`false`** |
| `security definer` functions in `public`/`auth` today | exactly one — `public.handle_new_user`, owner `postgres`, `search_path=""` |

So the shape works: a function owned by `postgres` (which is what a migration creates), `security
definer`, `set search_path = ''`, granted to `authenticated`. No fallback to
`alter function … owner to supabase_auth_admin` is needed.

**Every `auth`-side satellite cascades**, so the account's authentication state goes with it —
`identities`, `sessions`, `mfa_factors`, `one_time_tokens`, `oauth_authorizations`, `oauth_consents`,
`webauthn_credentials`, `webauthn_challenges`, all `on delete cascade`. **`auth.audit_log_entries`
carries no foreign key to `auth.users` at all** and does not appear in that list, so audit rows —
whose payload includes the email address — outlive the account. Worth naming explicitly in a slice
whose justification is a data-protection duty, even if the answer is "provider-managed, outside our
control".

`storage` exists in the project but holds nothing of ours: its only non-cascade foreign keys point at
`storage.buckets`, and there is no bucket, no `storage.` reference anywhere in `src/`, `supabase/` or
`tests/`, and `wrangler.jsonc` declares no KV, D1 or R2 binding.

### 2. The cascade order, and why a bare delete is the wrong design

Every foreign key targeting `auth.users` from `public` is `on delete cascade` — `profiles.id`
(`20260810063450_create_profiles_with_row_ownership.sql:12`), `exercises.user_id`
(`20260810174840_create_exercises_with_shared_catalogue.sql:21`), `workouts.user_id`
(`20260811005248_create_workout_log_with_row_ownership.sql:28`), `exercise_entries.user_id` (`:53`),
`sets.user_id` (`:80`). **One `on delete restrict` exists in the entire schema**:
`exercise_entries.exercise_id references public.exercises (id)` (`:59`), deliberate and recorded at
`:55-58` — a cascade there would destroy training history sideways through a catalogue screen.

The referential-integrity triggers on `auth.users` fire in trigger-name order, which here is OID
order. Read from `pg_trigger`:

| Order | Trigger | Cascades into |
| --- | --- | --- |
| 17517 | `profiles_id_fkey` | `public.profiles` |
| **17556** | **`exercises_user_id_fkey`** | **`public.exercises`** |
| 17584 | `workouts_user_id_fkey` | `public.workouts` |
| **17601** | **`exercise_entries_user_id_fkey`** | **`public.exercise_entries`** |
| 17630 | `sets_user_id_fkey` | `public.sets` |

And on `public.exercises`, the trigger that fires when one of its rows is deleted:

| Trigger | Constraint | Rule |
| --- | --- | --- |
| 17606 / 17607 | `exercise_entries_exercise_id_fkey` | **`restrict`** |

**So the account's own exercises are deleted (17556) while its own entries still exist (17601), and
the `restrict` on `exercises` fires against them.** `RESTRICT` is not deferrable — that is precisely
what distinguishes it from `NO ACTION` — so it is checked when the `exercises` row goes, not at end
of transaction. No constraint anywhere in the schema is declared `deferrable` (grepped: zero hits).

**Consequence: a bare `delete from auth.users where id = auth.uid()` aborts for any account that
created a custom exercise and logged at least one entry against it.** That is not an edge case —
creating custom exercises is a first-class feature (`POST /api/exercises`, `/exercises`).

- **Verified**: the trigger ordering above, `RESTRICT`'s non-deferrability, the absence of any
  `deferrable` constraint, and that this exact constraint raises `23503` for a single account's own
  data — `tests/integration/workout-log-rls.test.ts:330-338` deletes A's own exercise while A's own
  entry references it and asserts `expect(blocked.error?.code).toBe("23503")`.
- **Not yet verified**: that the queued cascade genuinely aborts rather than being reordered by some
  behaviour not visible in the catalogue. **Measure this first, in Phase 1, before designing
  anything around it** — throwaway account → custom exercise → workout → entry → attempt the
  deletion → observe. Then repeat with seeded exercises only. That one measurement decides whether
  the honest-failure path is the normal path or a rarity, and `lessons.md` § "Write the threshold
  into the plan BEFORE taking the measurement" applies to how it is recorded.

**The design that follows**: the function deletes in dependency order itself —
`public.workouts` (which cascades to entries and sets), then `public.exercises where user_id = uid`,
then `auth.users` — so the `restrict` edge is never reachable from the account's own data, and the
only remaining blocker is genuinely another account's entry.

**The seeded catalogue is at its most exposed inside this function**, because `security definer`
bypasses RLS entirely and the 38 shared rows are protected today only by three-valued logic in a
policy (`20260810174840_create_exercises_with_shared_catalogue.sql:69-77`, and
`context/foundation/access-control.md` § the shared-catalogue variant).
`delete from public.exercises where user_id = <uid>` is correct;
`where user_id is not distinct from <uid>` — the "null-safe" tidy-up somebody will propose — wipes
the catalogue for every account and no policy would stop it. This belongs in the migration header.

### 3. What the function must defend against

- **It takes no parameters.** The uid comes from `auth.uid()` in the body, so there is no argument a
  caller could aim at another account. A parameterised `delete_own_account(p_user_id uuid)` guarded
  by a check is strictly worse: the guard is one line somebody can delete, and PostgREST would
  publish the signature. It also yields an assertion worth writing — a call carrying *any* argument
  must fail with PostgREST's `PGRST202` ("no function matches"), which stays true only while nobody
  adds an overload.
- **`auth.uid()` returns `null` off the PostgREST path**, so `where id = auth.uid()` would delete
  zero rows and report success — the repository's own documented lie (`AGENTS.md` § "A zero-row
  UPDATE or DELETE is a SUCCESS"). The function must `raise` on a null uid **and** report whether it
  deleted anything, so the endpoint can answer honestly rather than 200-ing a no-op. This is not
  hypothetical: an access token stays verifiable for its remaining lifetime after the row is gone, so
  a replayed second call is a real, reachable zero-row case.
- **Revoke before granting — and the mechanism differs from the tables'.** For tables the implicit
  grant comes from Supabase's defaults to `anon`/`authenticated`. For **functions** the default
  `EXECUTE` grant goes to **`PUBLIC`**, so revoking from `anon, authenticated` alone leaves it
  callable. The revoke must name `public`:

  ```sql
  revoke all on function public.delete_own_account() from public, anon, authenticated;
  grant execute on function public.delete_own_account() to authenticated;
  ```

  Same class of trap as the table template's, different source. It deserves its own line in
  `context/foundation/access-control.md`, which has just gained a fifth shape and would gain a sixth
  here — an RPC is a surface this repository has never had.
- **`set search_path = ''` with everything schema-qualified**, matching `handle_new_user`
  (`20260810063450_create_profiles_with_row_ownership.sql:61-67`). With `security definer` the
  function runs as `postgres`; an unpinned `search_path` is the standard definer-hijack.

**The two definer/invoker functions will document each other as failure modes**, and the plan must
say which side it is on. The sibling slice's trigger is `security invoker` with a header paragraph
saying `security definer` would silently disable it; this function needs definer rights for the
opposite reason — `authenticated` has no privilege on `auth.users` and must never be given one.
Neither is a licence for a third case.

### 4. There is no RPC surface today, and no code has ever deleted an account

Swept `supabase/`, `src/`, `tests/`, `scripts/`, `.github/` for `auth.admin`, `deleteUser`,
`delete from auth`, `service_role`, `.rpc(`. **Nothing.** `Database["public"]["Functions"]` is
`[_ in never]: never` (`src/db/database.types.ts:280-282`), so an RPC added by migration needs
`npm run db:types` — which runs against **production** — before it is callable with types.

What exists is prose explaining why it could not be done:
`context/archive/2026-08-09-owned-persistence-baseline/plan.md:60-62`,
`context/deployment/deploy-plan.md:198-199` ("clean it up when S-09 lands account deletion"),
`20260810063450_create_profiles_with_row_ownership.sql:57-59` ("Account deletion is S-09 and removes
the `auth.users` row, which cascades"), and — freshly — the sibling slice's implementation review,
which reversed its fixture design *because* nothing here can delete an `auth.users` row.

### 5. The endpoint, the screen and the session

**The endpoint pattern is `/api/profile`, not the `[id]` routes.** `src/pages/api/profile/index.ts:13-21`
documents exactly why it does not use `_shared/mutation-route.ts`: that helper exists to validate a
`[id]` parameter before it reaches a uuid column, and this route has none — "the row it writes is
named by `locals.user.id` and by nothing else, which is the whole of its access control: there is no
parameter a caller could aim at somebody else's row." That reasoning transfers verbatim. It also
means the new route **cannot** reuse that module's `fail()`, which is typed `WorkoutMessageCode`.

**A new message catalogue is needed.** There are four, one per surface —
`src/lib/validation/{auth,exercise,profile,workout}.ts` — each exporting `*_MESSAGES`, a code union
and a `*MessageForCode` that resolves an unknown code to the generic message rather than to the
caller's words. Account deletion is a fifth surface; nothing in the existing four fits. **Nothing in
the repository currently maps a `restrict` violation to a message** — `23503` is mapped only in the
entry-insert path (`src/pages/api/exercise-entries/index.ts:42-61`), so a blocked deletion would land
on `fail(500, "unexpected")` today. That 500 is exactly what this slice exists to prevent.

The line the repository draws is stated at `src/lib/validation/workout.ts:41-43`: *"what is
deliberately NOT collapsed into `unexpected`: everything the user can act on."*

**The screen is `/settings`, and the placement has one trap.** `src/pages/settings.astro:90-94` hides
the whole form behind a `loadFailed` ternary, so a destructive action placed inside it would be
unreachable for a user whose profile read failed. It belongs in a sibling `<section>` after that
block, as its own `client:load` island. `PreferencesForm.tsx:189-198` already argues the boundary in
prose: a reversible preference change deliberately gets a sentence rather than a dialog, "because
cheapening that dialog is how people learn to click through the one that matters".

**The confirmation primitive is `src/components/ui/confirm-dialog.tsx`** — `ConfirmDialog`, props
`{ open, labelledBy, describedBy, onCancel, children }`. It supplies **no confirm button**: the
caller renders every control in `children`, and the control marked `data-initial-focus` gets focus on
open — aimed at *cancel*, so `showModal()` never lands on the destructive one. Backdrop clicks do
nothing, `role="alertdialog"` is set explicitly, and it imports only `react`. Its docblock records
the measurement that put it there: shadcn's `alert-dialog` took a built island from 10 689 B to
50 720 B — **+40 KB** — against a ~15 KB threshold written down beforehand.

Its only current consumer is `RecordImpactDialog.tsx`, whose props are record-impact specific and do
not fit here. Use `ConfirmDialog` directly and copy its conventions — cancel first in the DOM, the
`pending`/`error`-inside-the-dialog pattern (`:118-123`, `:142`, `:149`) so a blocked deletion is
reported where the user is looking.

**The session afterwards is the subtle part, and it is largely self-solving here.** Verified in the
pinned library sources: `getUser()` is a **network round trip**, not a local JWT decode
(`GoTrueClient.js:2467-2504`), so `src/middleware.ts:24-27` asks the auth server on every request and
a deleted account's token fails there despite remaining cryptographically valid. On failure it
returns `{ user: null, error }`, so the middleware sets `locals.user = null` — no throw, no 500.
`signOut()` is safe to call afterwards: `GoTrueClient.js:3192-3200` explicitly tolerates 404/401/403
with the comment *"ignore 404s since user might not exist anymore"*, then clears the session anyway.

The cookie-clearing `Set-Cookie` headers only exist on the response of the request that called
`signOut()`, so **the delete endpoint must call it itself**, after the delete succeeds. And the panel
should navigate regardless of what `signOut` reported, because the account really is gone.

**No redirect loop is possible.** `PROTECTED_ROUTES` and `AUTH_ROUTES` (`src/middleware.ts:7,15`) are
disjoint and their conditions are mutually exclusive on `locals.user`; deletion makes `user` falsy,
whereas the endless-loop failure `AGENTS.md` warns about came from a truthy `user` with no session.
A destination of `/auth/signin?notice=account_deleted` is loop-free — but note that reusing the
existing `?error=` parameter would render a successful deletion in error styling
(`SignInForm.tsx:87`), so it needs a sibling `notice` code in `AUTH_MESSAGES`
(`src/lib/validation/auth.ts:53-70`, the module that **imports nothing** on purpose).

### 6. How the blocked state can actually be tested

Three harness facts eliminate whole classes of answer: `vitest.integration.config.ts:19-24` strips
every `SUPABASE_*`/`GYMLOG_*` variable except the three test ones — **no `service_role` key and no
database URL**, so no psql, no DDL, no `set role`; the sibling's trigger migration is **already
applied to both hosted projects**, so checking out this branch does not un-apply it; and suites call
exported route handlers directly with a real session.

| Option | Verdict |
| --- | --- |
| Insert the cross-account row before the sibling migration is applied | **Impossible** — the migration is on the shared hosted database already; branch state and database state are decoupled |
| A migration that seeds the hazard row | **Disqualifying** — `db:push` reaches **production**, permanently blocking a real account's deletion, and contradicts the sibling migration's own "no data step" measurement |
| `service_role` | **Forbidden and unavailable** |
| **One account's own custom exercise + its own entry** | **The live option** — same constraint, same `23503`, no hazard row, already proven at `workout-log-rls.test.ts:330-338`. Depends on § 2's measurement |
| Unit-test the error mapping with a fabricated `{ code: "23503" }` | **Always available, not a substitute** — it pins "23503 → the specific honest code, not `unexpected`", but cannot prove Postgres raises it on this path |

If § 2's measurement shows the self-block does **not** occur, the cross-account blocker is genuinely
unconstructible and the honest answer is a named gap in the shape the sibling slice used twice —
what it would assert, why it cannot be written, that the guarantee is still load-bearing, and the
exact future edit that would make it testable.

**A preflight has a problem worth deciding early.** The cross-account half is *unreadable* by the
deleting account: RLS on `exercise_entries` is `(select auth.uid()) = user_id`, so a plain query
cannot see the blocking row at all. A preflight that checks only the readable half would answer "not
blocked" while the deletion is blocked — an empty-list-as-reassurance failure in a new costume,
which is precisely the rule `…/impact` endpoints follow (`src/lib/validation/workout.ts:67-71`:
answer a non-2xx, never a falsely reassuring empty result). So either the preflight is itself
`security definer`, or the product ships no preflight and relies on the honest failure after the
attempt.

### 7. The account cleanup this slice inherits

`STATE.md:496-517` lists them. **Eight in production**, including four F-03 smoke accounts, and —
flagged in session 7 — the production account used for S-03's manual verification that **now holds
real training rows**. `STATE.md` never gives its address; by elimination it is
`monika.zmuda9310@gmail.com` or `monika.zmuda9310+gymlog1@gmail.com`, the only two that went through
a real confirmation link. **This must be resolved against `auth.users` before anything is deleted**,
and production backup retention on the free plan is zero days (`STATE.md:850-851`).

In `gymlog-test`: `rls-owner-a/b` are permanent and shared by twelve suites — deleting either breaks
everything; the growing `s01-signup-<run>@` collection leaks one per run by design; and
`s09i-a@`, `s09i-b@`, `s09i-signout@` became **permanent** on the sibling branch. **This suite must
never delete an `s09i-` address**, and nothing here would notice if it did — it would surface as the
sibling suite failing on a later run.

**Two escalation points are touched** (`CONTRACT.md:58-65` §6.4 and §6.6, plus the stricter local
rule at `STATE.md:651-652`): pushing a migration to production, and deciding which of the eight
production accounts to delete — irreversible, the owner's own data, zero backup retention. That
second one is not an agent call.

## Code References

- `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:55-59` — the only
  `on delete restrict` in the schema, with the reason it is there
- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:57-59` — `profiles` has
  no delete policy and no delete grant, naming this slice as the reason
- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:61-71` —
  `handle_new_user`, the only `security definer` precedent
- `supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql:69-77` — the policy
  that protects the 38 seeded rows, and that a definer function bypasses
- `src/pages/api/profile/index.ts:13-21` — why a self-scoped route takes no `[id]`
- `src/lib/validation/workout.ts:41-43, 67-71` — the specific-vs-`unexpected` line, and the
  never-answer-an-empty-list rule
- `src/components/ui/confirm-dialog.tsx` — the confirmation primitive and its +40 KB measurement
- `src/pages/settings.astro:90-94` — the `loadFailed` ternary a delete panel must sit outside
- `src/middleware.ts:7, 15, 24-27` — route arrays and the `getUser()` resolution
- `src/pages/api/auth/signout.ts:3-12` — the sign-out shape to follow
- `tests/integration/workout-log-rls.test.ts:330-338` — `23503` from this exact constraint, within
  one account
- `vitest.integration.config.ts:19-24` — the env stripping that makes `service_role` unreachable

## Architecture Insights

- **This slice adds the repository's first RPC surface.** No `.rpc()` call exists anywhere today, and
  `Database["public"]["Functions"]` is empty. Function grants behave differently from table grants
  (default `EXECUTE` to `PUBLIC`), which is a new trap for a file that currently documents only the
  table one.
- **`security definer` is about to mean two opposite things in one repository**, one migration apart.
  The sibling's trigger documents it as the edit that silently disables an access-control check; this
  function needs it because `authenticated` has no privilege on `auth.users`. Both headers must name
  the other.
- **Deleting in dependency order inside the function is not defensive coding, it is the design.** The
  cascade order makes the naive version fail for ordinary users, and the failure looks identical to
  the cross-account case it is meant to report.

## Historical Context (from prior changes)

- `context/changes/cross-account-isolation/plan.md` (sibling branch) § Mechanism — why a composite
  key could not scope `exercise_id`, and the `security invoker` trigger that closed it
- `context/changes/cross-account-isolation/reviews/impl-review.md` — the finding that reversed the
  fixture design from throwaway to fixed accounts, which is why `s09i-` addresses are now permanent
- `context/archive/2026-08-11-edit-and-delete-log/` — S-05, where the destructive-action pattern and
  the `<dialog>`-over-`alert-dialog` measurement were established
- `context/deployment/deploy-plan.md:198-199` — the production throwaway account waiting for this
  slice

## Open Questions

1. **Does the self-block actually fire?** § 2 says the catalogue points that way; measure it before
   the plan depends on it either way. This is Phase 1, step 1.
2. **Preflight or no preflight?** The cross-account half is unreadable without `security definer`, so
   the choice is "a second definer function" or "no preflight, honest failure only".
3. **Which production accounts get deleted, and does the real training data go?** Owner's decision
   (`CONTRACT.md` §6.6). Zero backup retention.
4. **Where does the delete panel's destination live** — `/auth/signin?notice=…` reusing a screen the
   user needs anyway, or a dedicated page in neither middleware array, like `/auth/confirm-email`.
5. **Should `auth.audit_log_entries` be mentioned in the product's own words?** It survives the
   deletion and carries the email address. Provider-managed, but a GDPR-justified feature that says
   "everything is gone" should not be wrong.
