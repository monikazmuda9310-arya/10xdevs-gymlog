# Cross-account isolation — Implementation Plan

## Overview

Close, in the database, the one way an account can reach into another's: `exercise_entries.exercise_id`
is a single-column foreign key that is not ownership-scoped, so a row can exist in which account A's
entry points at account B's private exercise. Then cover the one acceptance criterion of US-04 that
nothing in the repository asserts today.

## Current State Analysis

**US-04 is already proven, and this is the plan's most important finding.** All thirteen integration
suites were read before any phase was written, per `lessons.md` § "A user cannot do X yet" is not "X
is untested" — the lesson that cost S-06 an entire phase. Coverage as it actually stands:

| US-04 acceptance criterion                                                | Where it is proven today                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The failure is verified against **recorded data**, not the response alone | `workout-mutations-rls` 1–5 — every cross-account attempt paired with a read-back as the owner; `profiles-rls` 4                                              |
| The same protection at **every level** — workouts, entries, sets          | `workout-log-rls` 2 (read by id), 3 (insert carrying the other's `user_id`), 4 and 5 (the graft, two levels); `workout-mutations-rls` 1–5 (update and delete) |
| **Signing out and returning requires authenticating again**               | **Nothing.** `workout-endpoints` 5 refuses an _unauthenticated_ caller, which is a different claim: it never signs a real session out and retries with it.    |

Derived views, catalogue, profile and page are covered too (`personal-records` 2/3, `weekly-tonnage`
7/8, `tonnage-breakdown` 7/8, `exercises-rls`, `profiles-rls`, `profile-mutations-rls`,
`workout-page-access`). **So this slice adds one assertion to a nearly complete proof and spends the
rest of its effort on a real defect** — not on rebuilding what S-03 through S-08 already built.

### The defect

`exercise_entries.exercise_id uuid not null references public.exercises (id) on delete restrict`
(`20260811005248_create_workout_log_with_row_ownership.sql:59`) is **single-column** and **not**
ownership-scoped. Foreign-key checks bypass RLS, the INSERT policy only checks the entry's own
`user_id`, and `addExerciseEntry` (`src/lib/services/workouts.ts:149`) inserts the id it is handed
with no visibility check. **`exercise_entries` also carries an UPDATE policy**, so an account can
equally re-point an entry it owns — the same hazard through a second door.

Assertion 9 of `tests/integration/tonnage-breakdown.test.ts` constructs exactly this row on purpose,
so it is proven constructible rather than hypothetical. S-08 met it from the tonnage side and answered
with `left join` in `public.daily_exercise_tonnage`.

**It has a second end, and that is why it is worth a migration.** `exercises.user_id references
auth.users (id) on delete cascade`, so deleting account B cascades into B's private exercises — and
the `on delete restrict` above then **blocks the cascade**. One account can permanently prevent
another from deleting their own account, which the PRD keeps in scope as a baseline GDPR duty. Nothing
surfaces but a database error.

## Desired End State

A row in which one account's entry points at another account's private exercise **cannot be created or
updated into existence**, refused by the database rather than by the endpoint, and the caller receives
the same `exercise_not_found` it already receives for an exercise that does not exist. Signing out
provably ends read access. Verified by a new suite that fails when the trigger is removed.

### Key Discoveries

- **The endpoint needs no change at all, if the trigger raises `23503`.**
  `src/pages/api/exercise-entries/index.ts:51-56` already maps `FOREIGN_KEY_VIOLATION` to
  `exercise_not_found`, discriminating on whether the message contains `WORKOUT_OWNER_CONSTRAINT`.
  A trigger raising `foreign_key_violation` therefore lands on the chosen answer — the same code as
  "no such exercise", no existence oracle — with zero application code. **This is a finding that
  shrank Phase 2**; it was scoped as "map the trigger's error" before the endpoint was read.
- **A composite foreign key cannot work here in its ordinary form** — and the reason is NOT the one a
  reader of this repository will reach for first. It has nothing to do with policies: a foreign key
  does not evaluate them, and FK checks **bypass** RLS, which `AGENTS.md` and `lessons.md` both state.
  The actual reason is `MATCH SIMPLE` matching: a referencing tuple whose `user_id` is `not null` can
  never match a referenced row whose `user_id` is `null`, because FK matching is equality and
  `NULL = NULL` is not `TRUE`. The 38 seeded rows are exactly those null-owner rows. **Write this
  reason, not the policy one**, wherever it is repeated — see § Mechanism below.
- **A `security invoker` trigger is not this repository's first trigger, and saying so would be
  false.** `set_updated_at` (`20260810063450_create_profiles_with_row_ownership.sql:24-25`) already
  fires on five tables including `exercise_entries`, and `handle_new_user` (`:61-62`) is
  `security definer`. What is new is a trigger used as an **access-control mechanism**, which is why
  it needs writing into `context/foundation/access-control.md`.
- **A `security invoker` trigger function gets the visibility check for free.** Under PostgREST the
  role is `authenticated`, which does not own the tables, so RLS applies inside the function: a plain
  `select 1 from public.exercises where id = new.exercise_id` returns no row precisely when the
  exercise is neither seeded nor the caller's. The check therefore reuses the existing select policy
  instead of restating it — one definition, not two.
- `UNIQUE_VIOLATION` / `FOREIGN_KEY_VIOLATION` are already exported from
  `src/lib/services/workouts.ts:23-24`.

## What We're NOT Doing

- **Not rebuilding the US-04 proof.** The existing suites are the proof; this plan cites them and adds
  what is missing.
- **Not changing `on delete restrict` on `exercise_id`.** It is a deliberate decision recorded in the
  migration: an exercise with logged history cannot be deleted at all.
- **Not changing `exercises.user_id` to `on delete set null`.** That would turn a deleted account's
  private exercises into shared rows and leak their names to every account.
- **Not handling the deletion failure path.** A blocked cascade answering honestly belongs to
  `account-deletion`; this slice owns whether the blocking row can exist. Stated once, in both
  `change.md` files, because `lessons.md` records what happens when a handover merges two decisions.
- **Not deploying the application.** `npx wrangler deploy` runs once, after both PRs merge, because
  production is served from `main` and the user must never get code from an unmerged branch.
  **`npm run db:push` is a different thing and runs normally, in Phase 1** — see below.
- **No E2E.** Phase 3 of the course owns the browser level.

## Implementation Approach

One migration adding a trigger function and a `before insert or update` trigger; one new integration
suite that owns the whole of this slice's evidence; one assertion for the sign-out gap. The endpoint
is expected to need no change — Phase 2 proves that rather than assuming it.

## Mechanism: why a trigger, and what it beat

`change.md` asked for options compared rather than one assumed. Two are viable; the owner chose the
trigger on 2026-08-15, and the rejected option is recorded here so that "lost on cost after being
weighed" is not confused with "never considered".

**Chosen — `before insert or update` trigger.** No new column, no backfill, nothing for callers to
supply. It reuses the `exercises` select policy instead of restating it, because RLS applies inside a
`security invoker` function. Cost: enforcement is procedural rather than declarative, so it is
invisible in the table definition a reader inspects first — which is why it goes into
`access-control.md` as a named exception rather than being left for someone to find.

**Rejected — a declarative composite key over a generated sentinel owner.** Add a stored generated
`owner_key` on `exercises` (`coalesce(user_id, <nil uuid>)`) with `unique (id, owner_key)`, carry a
matching column on `exercise_entries` constrained by
`check (exercise_owner_key = user_id or exercise_owner_key = <nil uuid>)`, and point a composite
foreign key at it. This is closer to how the repository closes nested ownership everywhere else, and
it would be enforced by the constraint system rather than by a function. It loses on cost: a new
column on both tables, a backfill over every existing row, a value every caller of `addExerciseEntry`
must now supply correctly, and a sentinel uuid that means "shared" and will be mistaken for a real
account by somebody. **It does not lose because "a policy admits a row only on `TRUE`"** — that
sentence is about RLS and does not apply to foreign keys at all.

## Critical Implementation Details

**The trigger's error message must not contain the workout-owner constraint name.**
`src/pages/api/exercise-entries/index.ts:53` discriminates `workout_not_found` from
`exercise_not_found` by `message.includes(WORKOUT_OWNER_CONSTRAINT)`. A trigger raising
`foreign_key_violation` whose message happened to mention that constraint would flip every rejected
exercise into "workout not found". Name the trigger and its message after the exercise.

**Measure before constraining.** A `before insert or update` trigger does not validate existing rows,
so a violating row already stored stays and stays invisible. Phase 1 counts violations in **both**
hosted projects before the migration is written, and the plan branches on the answer rather than
assuming zero.

**The trigger only guards `authenticated`.** `postgres` and `service_role` bypass RLS, so the
visibility check admits anything on those paths. Say so in the migration header: it is the same
asymmetry that makes the guard below unrecoverable by re-seeding the hazard row from a test.

**"Deployment" means two different things here, and conflating them produced a contradiction in the
first draft of this plan.** The schema and the application move on different schedules:

- **`npm run db:push` runs in Phase 1, and reaches production.** There is deliberately no
  single-target push — advancing one schema and forgetting the other is the only way the two drift, so
  forgetting is not an available mistake. Working around the wrapper to touch `gymlog-test` alone would
  break the guarantee that rule exists to provide, which is a worse trade than an additive trigger
  arriving on production early. The migration adds a function and a trigger and changes no data; it
  cannot affect a row already stored, and no application code reaches it until the Worker is deployed.
- **`npx wrangler deploy` waits for both PRs to merge.** That is where the owner's decision binds, and
  it is the half that a user could actually observe.

---

## Phase 1: The trigger, and the proof that it bites

### Overview

Settle what happens to the existing guard this change destroys, measure, add the trigger, and build
the suite that would notice its removal.

### Changes Required

#### 1. Retire `tonnage-breakdown` assertion 9, and record what stops being guarded

**Files**: `tests/integration/tonnage-breakdown.test.ts`, `AGENTS.md`, `context/foundation/lessons.md`

**Intent**: assertion 9 constructs the hazard row **on purpose**, through `logWorkout`, which throws
when an insert is refused. Once the trigger exists that row cannot be built, so the assertion does not
fail an expectation — it dies in setup, and `npm run test:integration` runs every suite, so the gate is
red from the moment the migration lands. **This step comes first, before the migration, so the gate is
never red in between.**

The larger loss is what assertion 9 was holding: it is the only thing that would notice `left join`
being "simplified" to `join` in `public.daily_exercise_tonnage`. **The `left join` must stay** — the
trigger does not validate rows already stored, and does not apply to `postgres` or `service_role` — so
after this change that guard is real and **unguarded**.

**Contract**: rewrite assertion 9 to assert only what it can still construct, or retire it outright;
either way do not delete it silently. In the same commit, amend `AGENTS.md` § Domain rules (which
currently calls it "the only thing here that would notice the `left` being simplified away") and append
to `lessons.md` in the shape that file prescribes for a guard that can no longer fail: name the
guarantee, say plainly that no mutation available today breaks it, and name the exact future edit
(`left join` → `join`) that would. This is `lessons.md` § "When a mutation does not break anything, fix
the claim — never the test", applied to a guard that a different change removed the ability to test.

#### 2. Measurement (no file — a recorded step)

**Intent**: establish, before writing the migration, whether either hosted project already holds an
`exercise_entries` row whose `exercise_id` names an exercise that is neither seeded nor owned by the
entry's `user_id`. The result decides whether the migration needs a data step.

**Contract**: one read-only query run against `SUPABASE_DB_URL` and `SUPABASE_TEST_DB_URL`, joining
`exercise_entries` to `exercises` on id and filtering `e.user_id is not null and e.user_id <>
ee.user_id`. Record both counts in `## Progress`.

**`gymlog-test` will almost always be non-zero, and that is not a defect.**
`tonnage-breakdown.test.ts` resets its fixtures at the **start** of a run rather than the end, so
assertion 9's cross-account entry survives from one integration run until the beginning of the next.
Exclude that suite's `s08-` fixtures from the count, or take the measurement immediately after a clean
run and re-check. **The escalation applies to `gymlog` only**: any non-zero count in **production** is
the owner's decision, because the choice there is between deleting somebody's logged sets and leaving a
known hole. A leftover test fixture is neither.

#### 3. The trigger

**File**: `supabase/migrations/<timestamp>_scope_exercise_entries_to_visible_exercises.sql`

**Intent**: refuse, in the database, any `exercise_entries` row whose `exercise_id` is not visible to
the row's owner — on insert and on update alike, because `exercise_entries` carries an UPDATE policy
and re-pointing an entry is the same hazard through a second door.

**Contract**: a **`security invoker`** trigger function in `public` (the plpgsql default — state it
explicitly anyway, because it is the whole design), and a `before insert or update of exercise_id`
trigger on `public.exercise_entries`. `set search_path = ''` on the function, matching
`set_updated_at` and `handle_new_user`, which means the body schema-qualifies everything —
`public.exercises`. The function raises `foreign_key_violation` (`23503`) so the existing endpoint
mapping applies unchanged; its message names the exercise and **must not contain**
`exercise_entries_workout_owner_fkey`. The visibility check is a bare existence query against
`public.exercises` — RLS supplies the predicate, so the select policy is not restated. End with
`notify pgrst, 'reload schema';`, as six of the seven existing migrations do.

The migration header states: why a composite key was not used (`MATCH SIMPLE` equality against a null
owner — **not** the RLS policy rule), that the check binds `authenticated` only, and that
`security definer` would silently disable it.

#### 4. The suite

**File**: `tests/integration/account-boundary.test.ts`

**Intent**: own every claim this slice makes, in one place a reviewer can read as the US-04 dossier,
with its own fixtures so the parallel branch cannot collide with it.

**Contract**: MARK `s09i-` — not a prefix of, and not prefixed by, `s03-`, `s08-` or any existing
mark. Its own throwaway accounts; **never** `rls-owner-a/b`. Assertions:

1. account B cannot **insert** an entry naming account A's private exercise — refused, and the row is
   absent when re-read as B;
2. account B cannot **update** its own entry onto account A's private exercise — refused, and the
   entry still names what it named before;
3. a **seeded** exercise is still insertable by both accounts (the trigger must not break the
   catalogue, which is the whole point of the nullable owner);
4. an account's **own private** exercise is still insertable by that account;
5. an account can still **delete its own unused private exercise** — `on delete restrict` is not
   tripped when nothing references it. This is the assertable neighbour of the seam, and it is titled
   after exactly that, claiming nothing about account deletion.

**The seam is NOT an assertion, and that is a deliberate reversal.** It was planned as one — "with
the hazard row refused, the cascade account deletion depends on is not blocked" — and it cannot be
written: deleting an account needs `auth.admin.deleteUser` and a `service_role` key, which
`AGENTS.md` forbids and `vitest.integration.config.ts` actively strips from the process; and the
weaker form is unreachable too, because under RLS the hazard row is by construction visible to
neither account. It would have become a green body checking nothing, which `lessons.md` calls worse
than an obvious gap. It goes in the **suite header as prose**, in the shape that file prescribes:
name the guarantee, say that no mutation available today breaks it, and name the future edit that
would — here, `account-deletion` landing a deletion path.

Cross-account reads at all three levels are **not** restated here. They are proven in
`workout-log-rls` and `workout-mutations-rls`; the header cites them by title text rather than by
position, because `workout-endpoints` and `workout-page-access` do not number their `it` titles and a
positional citation rots the moment somebody inserts a test.

### Success Criteria

#### Automated Verification

- Assertion 9 settled and the `left join`'s new status recorded, **before** the migration exists — and
  `npm run test:integration` green at that point, with no migration applied
- Violation counts recorded for both projects, `s08-` fixtures excluded from the `gymlog-test` count;
  any non-zero count on **`gymlog`** escalated to the owner
- Migration applies to both projects: `npm run db:push`
- The new suite passes: `npm run test:integration` — **every suite, not only the new one**
- The suite is repeatable: run `npm run test:integration` twice, second run green
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- **Mutation (a)**: drop `or update of exercise_id` from the trigger → assertion 2 fails
- **Mutation (b)**: remove the trigger entirely → assertions 1 and 2 fail
- **Mutation (c)**: flip the function to `security definer` → assertions 1 and 2 **pass when they
  should fail**, because the function then runs as `postgres`, which owns the tables and is not
  subject to their RLS. This is the keystone of the whole design and the single most plausible future
  edit — `security definer` is the reflex for trigger functions and this repository already has one.
- Every mutation's failure is read, not just its colour: `lessons.md` § "A mutation that fails for the
  WRONG REASON has not confirmed the guard"

#### Manual Verification

- The migration header gives the `MATCH SIMPLE` reason a composite key was not used — not the RLS
  policy one — and a reader who has not seen this plan can tell why the trigger exists

**Implementation Note**: pause after this phase for confirmation before proceeding.

---

## Phase 2: The sign-out gap, and proving the endpoint already answers correctly

### Overview

Cover US-04's third criterion, and verify the expectation that no application change is needed.

### Changes Required

#### 1. The sign-out assertion

**File**: `tests/integration/account-boundary.test.ts`

**Intent**: assert US-04's third criterion — signing out ends read access — at the level of the
session rather than the screen.

**Contract**: sign in as this suite's own account, read a training row successfully, `signOut()`, then
retry the identical read **with the same client** and assert it is refused and returns no training
data. The claim is session invalidation; the title must not imply anything about the UI.

#### 2. The endpoint mapping

**File**: `tests/integration/account-boundary.test.ts` (assertion) — **no source change expected**

**Intent**: confirm that `POST /api/exercise-entries` answers `404 exercise_not_found` when the trigger
refuses, and **not** `500 unexpected` and **not** `workout_not_found`. If it does not, the endpoint
gains a branch; if it does, the plan records that the existing mapping covered it.

**Contract**: call the exported handler as account B with account A's private exercise id, in the
pattern of `tests/integration/workout-endpoints.test.ts` — never through `astro dev`, whose
`.dev.vars` point at production. Assert status and message code, then re-read as B to confirm nothing
was stored.

**A second suite now depends on the message-name rule.** A `BEFORE` trigger fires ahead of constraint
checks, so once this lands it is the trigger — not the plain foreign key — that raises for a
**genuinely missing** exercise too. `workout-endpoints`' assertion titled "tells a missing exercise
apart from a workout that is not the caller's" therefore keeps passing **only** because the trigger's
message does not contain `exercise_entries_workout_owner_fkey`. Confirm that suite is green and record
that the constraint named in § Critical Implementation Details is now load-bearing in two places.

### Success Criteria

#### Automated Verification

- Both assertions pass: `npm run test:integration`
- The endpoint answers `404 exercise_not_found`, and the plan states whether a source change was
  needed — either outcome is recorded, neither is assumed
- `workout-endpoints`' "tells a missing exercise apart from a workout that is not the caller's" is
  still green after the trigger
- **Mutation (d)**: make the function raise a code other than `23503` → the endpoint assertion above
  fails with `500 unexpected` instead of `404 exercise_not_found`, confirming the mapping is
  load-bearing rather than incidental. (Moved here from Phase 1, where the assertion it names did not
  yet exist.)
- The full gate passes: `npm run lint` → `npm run typecheck` → `npm test` → `npm run test:render` →
  `npm run test:integration` → `npm run build`

#### Manual Verification

- None. This phase adds no user-visible behaviour.

---

## Phase 3: Documents, and the pull request

### Overview

Make the documents true, then open the PR.

### Changes Required

#### 1. `AGENTS.md`

**Intent**: record the trigger as the answer to the unscoped-`exercise_id` hazard the file already
documents twice (§ Domain rules → "Under `security_invoker`, a JOIN is a FILTER", and § Known state).
Both currently describe the hazard as open.

**Contract**: amend those two places to say it is closed, by what, and name
`account-boundary.test.ts` assertions 1 and 2 as what would notice the trigger being dropped. **Say in
the same breath what is NOT closed**: rows already stored, and anything acting as `postgres` or
`service_role`. Phase 1 already amended the sentence about assertion 9 guarding the `left join`; this
step must not contradict it.

Add the trigger to `context/foundation/access-control.md` as a **fifth shape** — an access-control
trigger, the exception to "nested ownership is closed by a composite key" — with the `MATCH SIMPLE`
reason, and with `security definer` named as the edit that silently disables it.

#### 2. `README.md`

**Intent**: the route table's `/api/exercise-entries` row should say that an exercise the caller cannot
see is refused like one that does not exist.

**Contract**: one row amended; no new section.

#### 3. `context/foundation/lessons.md`

**Intent**: append one entry — a single-column foreign key to a table with a select policy is an
ownership hole that no policy on either table will show you, and it has as many ends as the table has
cascades.

**Contract**: appended at the end, in the register's Context / Problem / Rule / Applies-to shape.

#### 4. Change and roadmap bookkeeping

**Contract**: `change.md` → `status: implemented`; roadmap item **S-09 `account-boundary`** annotated
as split into `cross-account-isolation` and `account-deletion` and flipped to `in-progress`.

#### 5. The pull request

**Contract**: PR from `feature/cross-account-isolation` to `main`, body naming the defect, the closure,
the measured violation counts, and the fact that the deployment is shared with `account-deletion` and
runs after both merge. **Do not merge** — this is one of the two PRs M2 deliverable 5 asks for, and it
wants a solo review first.

### Success Criteria

#### Automated Verification

- Full gate green: all six steps
- CI green on the pushed branch
- Every test file and assertion number named in the amended documents exists

#### Manual Verification

- The PR body is readable by somebody who has not seen this plan
- `AGENTS.md` no longer describes the hazard as open anywhere

---

## Post-merge (shared with `account-deletion`, owned by neither alone)

`npx wrangler deploy`, then confirm on the public URL. Runs once, after both PRs merge. The schema is
**already** on both projects by then — each slice pushes its own migration in its own Phase 1, per
§ Critical Implementation Details — so this step is the application only. Recorded here and in
`account-deletion`'s plan identically.

**Between merge and `db:push` the documents on `main` are ahead of production**: `AGENTS.md` says the
hazard is closed while the database has no trigger, and during exactly that window the `left join` in
`daily_exercise_tonnage` is both load-bearing and — after Phase 1 — no longer test-guarded. Keep the
window short, and do not start it on a day nobody can finish it.

## Shared-resource hazards with the parallel branch

Beyond the MARK, the throwaway accounts and the expected `AGENTS.md` conflict already recorded in
`change.md`:

- **The two integration runs must not overlap.** `fileParallelism: false` orders files **within** one
  run; it does nothing about two worktrees running `npm run test:integration` against the same
  `gymlog-test` at the same time — and the sibling suite deletes accounts. Own throwaway accounts stop
  fixture damage, not `auth` contention.
- **Migration timestamps**: whichever branch merges second needs the later one, and `db:push` advances
  both hosted projects at once.

## Testing Strategy

### Integration Tests

`tests/integration/account-boundary.test.ts`, MARK `s09i-`, own throwaway accounts, fixtures reset in
`beforeAll` and restored in a `finally` — and each precondition established by this suite itself rather
than trusted from another, per `lessons.md` § "A `finally` that restores shared state does not survive
a killed process".

### Manual Testing Steps

None. This slice changes no screen.

## Performance Considerations

The trigger adds one indexed primary-key lookup per entry insert or `exercise_id` update. Entries are
created at human speed, one per exercise per workout, so this is not on any hot path and is nowhere
near the 10 ms Worker CPU cap.

## References

- Change identity and the seam: `context/changes/cross-account-isolation/change.md`
- The hazard, from the tonnage side: `AGENTS.md` § Domain rules, and assertion 9 of
  `tests/integration/tonnage-breakdown.test.ts`
- Why a composite key does not transfer: `context/foundation/access-control.md`
- Sibling slice: `context/changes/account-deletion/change.md` on `feature/account-deletion`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles.

### Phase 1: The trigger, and the proof that it bites

#### Automated

- [x] 1.1 Assertion 9 settled, the `left join`'s unguarded status recorded in `AGENTS.md` and
      `lessons.md`, and `npm run test:integration` green with no migration applied
      — retired outright (its reasoning preserved at the foot of `tonnage-breakdown.test.ts`; a
      weaker replacement was refused per `lessons.md` § "A guard you have not mutated may not
      guard"). 13 files / 111 tests green, no migration applied. — d417b63
- [x] 1.2 Violation counts recorded for both projects, `s08-` fixtures excluded on `gymlog-test`; any
      non-zero count on `gymlog` escalated to the owner
      — **`gymlog` 0, `gymlog-test` 0** (0 excluding `s08-` in both). Nothing to escalate and no data
      step in the migration. `gymlog-test` reads zero rather than the non-zero the plan expected
      because step 1.1's run retired assertion 9 and its `beforeAll` swept the previous run's
      leftover on the way past. Taken with the Management API query endpoint, `read_only: true`, not
      `psql`: this machine has neither `psql` nor a `pg` package. Same databases, same privileges —
      it runs as the database owner, so RLS hides nothing from the count. — d417b63
- [x] 1.3 Migration applies to both projects: `npm run db:push`
      — `20260815090000_scope_exercise_entries_to_visible_exercises.sql`; `npm run db:status` shows
      both histories at that version. — d417b63
- [x] 1.4 Every suite passes, not only the new one: `npm run test:integration`
      — 14 files / 116 tests. **Required one adaptation the plan did not foresee** (owner approved,
      2026-08-15): `workout-log-rls` assertion 3 forged an entry naming account A's PRIVATE exercise,
      so the new BEFORE trigger fired ahead of the RLS `WITH CHECK` and answered `23503` where the
      assertion wanted `42501`. The row was still refused, but the assertion had silently stopped
      exercising the insert POLICY — it would have stayed green with that policy weakened. Fixed by
      forging `exerciseB` instead, which the trigger admits, restoring `42501` and the original
      claim; the reason is written into the test beside it. — d417b63
- [x] 1.5 The suite is repeatable: second consecutive run green — two consecutive full runs, 116/116 — d417b63
- [x] 1.6 Type checking passes: `npm run typecheck` — 119 files, 0 errors, 0 warnings — d417b63
- [x] 1.7 Linting passes: `npm run lint` — clean — d417b63
- [x] 1.8 Mutation (a): dropping `or update of exercise_id` fails assertion 2
      — assertion 2 alone red, assertion 1 green — d417b63
- [x] 1.9 Mutation (b): removing the trigger fails assertions 1 and 2 — both red — d417b63
- [x] 1.10 Mutation (c): flipping the function to `security definer` makes assertions 1 and 2 pass
      when they should fail
      — confirmed, with the wording sharpened: what the criterion describes is the GUARD passing a
      row it should refuse, and the assertions are what notice, so both go red. **The failure is
      byte-identical to mutation (b)'s** — `security definer` is indistinguishable from having no
      trigger at all, which is precisely why it is the keystone. Verified against `pg_proc.prosecdef`
      before and after, not merely applied. — d417b63
- [x] 1.11 Every mutation's failure message read and confirmed to be the intended one
      — all three read `AssertionError: expected undefined to be '23503'`: **no error was raised at
      all**, i.e. the write was admitted. That is the criterion's own reason (`lessons.md` § "A
      mutation that fails for the WRONG REASON has not confirmed the guard") — a wrong-reason red
      here would have been a different code, or a red in an assertion the mutation does not name.
      Each mutation applied to `gymlog-test` only, restored afterwards, and the restore verified by
      re-reading `pg_get_triggerdef` and `prosecdef`; the violation count was re-taken at the end and
      is still 0/0, so the mutation runs left no hazard row behind. — d417b63

#### Manual

- [x] 1.12 The migration header gives the `MATCH SIMPLE` reason, not the RLS policy one
      — confirmed by the owner, 2026-08-15, against both halves: the `WHY NOT A COMPOSITE FOREIGN
      KEY` paragraph gives equality / `NULL = NULL` / the 38 null-owner rows and explicitly disowns
      the policy explanation, and the `Purpose:` block alone conveys what the trigger closes. — d417b63

### Phase 2: The sign-out gap, and proving the endpoint already answers correctly

#### Automated

- [x] 2.1 Both assertions pass: `npm run test:integration`
      — 14 files / **118 tests** (116 + the two). Assertion 6 needed a **third throwaway account**,
      which the plan did not anticipate: it ends its account's session, and every other assertion —
      plus `afterAll`'s deletes — needs a live one. Teardown now re-authenticates every account it
      created before deleting, unconditionally, so a leak cannot depend on which assertions ran or
      on assertion 6 reaching its last line. The refused read answers `42501` (`anon` holds no grant
      on `workouts`), asserted alongside an empty `data`: "the read failed" and "the read returned
      the row anyway" are different outcomes and only one is a leak. — c9ba922
- [x] 2.2 The endpoint answers `404 exercise_not_found`; the outcome is recorded, not assumed
      — **no source change was needed.** `src/pages/api/exercise-entries/index.ts` mapped it
      correctly with no branch of its own, exactly as § Key Discoveries predicted, and assertion 7
      now holds that prediction as a claim rather than as an expectation. It also checks the two
      wrong answers by name: not `500 unexpected`, not `workout_not_found`. — c9ba922
- [x] 2.3 `workout-endpoints`' "tells a missing exercise apart from a workout that is not the
      caller's" still green after the trigger
      — confirmed by name in a `--reporter=verbose` run, not merely by the file's colour. The
      constraint name in § Critical Implementation Details is now **load-bearing in two suites**:
      that assertion, and assertion 7 here. A `BEFORE` trigger fires ahead of constraint checks, so
      it is the trigger — not the plain foreign key — that raises for a genuinely missing exercise
      too, and both keep working only because its message does not contain
      `exercise_entries_workout_owner_fkey`. — c9ba922
- [x] 2.4 Mutation (d): a raised code other than `23503` makes the endpoint answer `500 unexpected`
      — applied to `gymlog-test` alone (`errcode = 'raise_exception'`, P0001) and confirmed:
      assertion 7 red on `expected 500 to be 404`, with the endpoint's own diagnostic
      `[exercise-entries] unexpected insert failure { code: 'P0001' }` in stderr. **The guard still
      held and only the MAPPING broke** — same refusal, same message, same hint — which is the whole
      point of the criterion: the mapping is load-bearing rather than incidental. Assertions 1 and 2
      went red for the same single reason (`expected 'P0001' to be '23503'`), and assertion 6 stayed
      green, correctly: sign-out has nothing to do with the trigger. Restored from the migration file
      verbatim and verified byte-identical against a `pg_get_functiondef` dump taken before the
      mutation (`prosecdef: false` throughout); violation counts re-taken afterwards and still
      **0/0**, so the mutation run left no hazard row behind. The write to `gymlog-test` was refused
      by the permission classifier and was run by the owner, 2026-08-15. — c9ba922
- [x] 2.5 The full six-step gate passes
      — `lint` clean (exit 0) → `typecheck` 119 files, 0 errors → `npm test` 240 → `test:render` 25
      → `test:integration` 118 → `build` complete. The integration step was run again after the
      mutation was restored, and is the 118 recorded here. — c9ba922

### Phase 3: Documents, and the pull request

#### Automated

- [x] 3.1 Full gate green: all six steps
      — `lint` exit 0 → `typecheck` 0 errors → 240 unit → 25 render → 118 integration → `build`
      exit 0, run after every document edit rather than before them. — 8662333
- [x] 3.2 CI green on the pushed branch
      — run 31874937534, all six gate steps green in 4m09s on `feature/cross-account-isolation`.
      This is the first run of the integration check **from CI against the migrated
      `gymlog-test`**, so it is also the evidence that the trigger survives a clean clone with no
      local state. PR: <https://github.com/monikazmuda9310-arya/10xdevs-gymlog/pull/1> — **not
      merged**, per § Changes Required #5. — 8662333
- [x] 3.3 Every test file and assertion number named in the amended documents exists
      — checked one by one rather than assumed: `account-boundary.test.ts` assertions 1, 2 and 7;
      `workout-endpoints`' "tells a missing exercise apart from a workout that is not the caller's"
      (cited by **title text**, since that suite does not number its `it` titles and a positional
      citation rots on the next insertion); `exercise_entries_workout_owner_fkey` in the migration,
      in `WORKOUT_OWNER_CONSTRAINT` and in the generated types; `public.handle_new_user` as the
      repository's existing `security definer` trigger; and
      `20260815090000_scope_exercise_entries_to_visible_exercises.sql`.
      **One thing the plan did not list and that had to change**: `access-control.md` gained a fifth
      shape, so `AGENTS.md`'s "The four shapes live in…" heading, its intro sentence and the file's
      own header all said **four** and were now false. Amended in the same commit — a document that
      undercounts its own contents is how the fifth shape stops being read. — 8662333

#### Manual

- [x] 3.4 The PR body is readable by somebody who has not seen this plan
      — confirmed by the owner, 2026-08-15. — 8662333
- [x] 3.5 `AGENTS.md` describes what the trigger closes **and** what it does not — stored rows,
      `postgres`, `service_role` — without contradicting Phase 1's amendment about the `left join`
      — confirmed by the owner, 2026-08-15, against both places: the new paragraph under "a JOIN is
      a FILTER" sits **directly above** Phase 1's paragraph about the unguarded `left join`, so the
      two claims are read together and a contradiction would be visible rather than a page apart;
      and the new § Known state bullet at `exercise_id`. — 8662333
