<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cross-account isolation

- **Plan**: `context/changes/cross-account-isolation/plan.md`
- **Scope**: full plan — Phases 1, 2 and 3
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION — triaged 2026-08-15: 9 fixed, 1 skipped by owner decision
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**What passed, so it is not re-litigated later.** Every numbered plan item is implemented as
specified — the migration matches its contract clause by clause (`security invoker` written out,
`set search_path = ''`, bare existence query, `23503`, the constraint name absent from the message,
`notify pgrst`), the suite carries assertions 1–7 with each negative paired against a re-read row,
the seam with `account-deletion` is prose rather than a green body checking nothing, and no scope
guardrail was crossed: no `src/` file changed at all, `on delete restrict` and `exercises.user_id`
are untouched, no E2E, no deploy. The trigger mechanics were verified rather than assumed: RLS does
apply inside a `security invoker` plpgsql body for `authenticated`; `update of exercise_id` fires
whenever the column is named and cannot be evaded, because the column cannot change without being
named; the function cannot be called directly. Success criteria are green in CI on both branch
commits (runs 31874937534 and 31875243483, all six gate steps).

The one unplanned file change, `tests/integration/workout-log-rls.test.ts`, was traced and is
**necessary and correct**: forging `exerciseB` leaves the RLS `WITH CHECK` as the only thing that
can refuse the row, so assertion 3 still exercises the insert policy and still expects `42501`.
With `exerciseA` it would have gone green against a weakened policy.

## Findings

### F1 — The suite has neither a `beforeAll` reset nor a `finally`, and the plan says it has both

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: `tests/integration/account-boundary.test.ts:205-243` vs `plan.md:451-454`
- **Detail**: The plan's § Testing Strategy states the suite has "fixtures reset in `beforeAll` and
  restored in a `finally`". The implementation does neither: it cleans only in `afterAll` and
  explicitly declines a reset at `:214-217`, reasoning that throwaway accounts own nothing. That
  reasoning is sound **for row collisions** and wrong for durability. Every sibling RLS suite resets
  at the START of a run, with the reason written out at `workout-log-rls.test.ts:163-166` — "an
  interrupted run then cannot poison the next one". Here, a killed run converts its rows into
  **permanently unreachable garbage**: no later run knows those account ids, and no `like('s09i-%')`
  sweep from any other account can see them under RLS. This is `lessons.md` § "A `finally` that
  restores shared state does not survive a killed process" reaching a suite that thought it was
  exempt.
- **Fix A ⭐ Recommended**: Switch to a fixed pool of three accounts (`s09i-a@`, `s09i-b@`,
  `s09i-signout@gymlog-test.dev`, no `RUN_ID`) obtained through the sign-in-or-sign-up helper
  `workout-log-rls.test.ts:86-104` already establishes, and add the `beforeAll` reset that then
  becomes both possible and meaningful.
  - Strength: Restores the documented pattern, makes the plan's own sentence true, and resolves F2
    in the same edit — the three properties the suite header argues for (owns its accounts, never
    touches `rls-owner-a/b`, safe against the sibling worktree) all survive, because the addresses
    are still unique to this suite.
  - Tradeoff: The accounts become shared state across runs, which is exactly what the throwaway
    design was avoiding — mitigated by the `beforeAll` reset the change adds.
  - Confidence: HIGH — the helper, the pattern and the reasoning all already exist in this repo.
  - Blind spot: Has not been run; the sibling worktree's suite may pick colliding addresses.
- **Fix B**: Keep throwaway accounts and correct `plan.md:451-454` to describe what was built and why.
  - Strength: Cheapest; the design decision was deliberate and is argued in the file.
  - Tradeoff: Leaves the unreachable-garbage failure mode and the divergence from every sibling suite.
  - Confidence: HIGH — a documentation edit.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — fixed pool of three accounts (`s09i-a@`, `s09i-b@`, `s09i-signout@`) obtained through a sign-in-or-sign-up helper, plus a `beforeAll` sweep. Three consecutive green runs, the third reusing the accounts rather than creating them. `plan.md` § Testing Strategy amended to describe what was built and why the original shape was wrong.

### F2 — Three auth users leak per run, taking a full integration run from 1 to 4

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `tests/integration/account-boundary.test.ts:130-146, 226-243`
- **Detail**: `afterAll` deletes `workouts` and `exercises` but the `auth.users` rows are never
  deleted, and each carries a `profiles` row from the `handle_new_user` trigger. The suite is
  structurally incapable of deleting them — that needs `auth.admin.deleteUser` and a `service_role`
  key, which `vitest.integration.config.ts:19-24` strips — and the file says so at `:45`. Verified
  precedent: `auth-flows.test.ts:24` leaks exactly **one** per run and says so; every other suite
  reuses the two shared `rls-owner-a/b` accounts and creates nothing. So this branch quadruples the
  only unbounded growth in `gymlog-test`, and CI runs on every push and PR.
- **Fix**: The fixed-account pool from F1 Fix A — it bounds growth at three rows total and removes
  three signups per run.
- **Decision**: FIXED — carried by F1 Fix A in the same edit. Growth bounded at three rows total; three signups per run removed.

### F3 — Four references to retired assertion 9 are now stale, in three files outside `AGENTS.md`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/integration/tonnage-breakdown.test.ts:170` and `:322-323`;
  `context/foundation/lessons.md:318`; `context/foundation/roadmap.md:322`
- **Detail**: Phase 1 amended `AGENTS.md` and appended to `lessons.md`, and Phase 3's criterion was
  scoped to `AGENTS.md`. Four claims elsewhere still describe assertion 9 as live:
  - `tonnage-breakdown.test.ts:170` — the `logWorkout` docstring, present tense: "assertion 9 needs
    an entry the service would happily create but the UI never would".
  - `tonnage-breakdown.test.ts:322-323` — "this run **may still meet one of its rows**, because that
    fixture survived from one run to the beginning of the next". No longer possible: the fixture is
    retired, and the violation count was re-taken at 0/0 on both projects after the mutation runs.
  - `lessons.md:318` — the S-08 entry still prescribes "**construct the hazard row in the suite
    rather than describing it**", which an `authenticated` caller can no longer do. The new entry at
    `:350` explains the situation, but a reader reaching `:318` first gets an instruction that cannot
    be followed — in an append-only register whose whole purpose is to be read as rules.
  - `roadmap.md:322` — the archived S-08 lesson line still asserts "integration assertion 9
    constructs the grafted row rather than describing it".
  This is the repository's own § "A test whose title claims more than its body asserts becomes the
  citation", one level up: a retired guard still cited as live in three documents.
- **Fix**: Amend all four to past tense with a pointer to `lessons.md` § "Closing a defect can retire
  the only test of an unrelated guarantee". Leave the S-08 rule's substance intact — it is still the
  right rule for any view this repository has not yet closed.
- **Decision**: FIXED — all four amended to past tense with a pointer to `lessons.md` § "Closing a defect can retire the only test of an unrelated guarantee". The S-08 rule keeps its substance and gains a sub-bullet saying the "construct it" half is unperformable HERE and still right elsewhere.

### F4 — The trigger's check is CALLER-scoped, and its equivalence to "the row's owner can see it" is undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260815090000_scope_exercise_entries_to_visible_exercises.sql:65`
- **Detail**: `select 1 from public.exercises where id = new.exercise_id` asks "can `auth.uid()` see
  this exercise?", not "can `new.user_id` see it?". A `BEFORE ROW` trigger fires **ahead of** the RLS
  `WITH CHECK` — which is precisely what forced the `workout-log-rls` edit — so when the trigger
  runs, `new.user_id = auth.uid()` has not yet been established. **There is no hole today**: the
  insert policy pins `user_id` to `auth.uid()` immediately afterwards, and the interesting case (B
  inserting `{user_id: A, exercise_id: <B's own private exercise>}`) passes the trigger and is then
  correctly refused `42501`. But the trigger's guarantee rests on a policy in a different file, and
  nothing says so — the header frames the limitation solely as "postgres and service_role bypass
  RLS". This repository documents exactly this class of dependency everywhere else.
- **Fix**: One sentence in the migration header and in the `access-control.md` trigger variant: the
  check is evaluated for the CALLER, so it means "the row's owner can see it" only while the table's
  INSERT/UPDATE policy pins `user_id` to `auth.uid()`. **Do not** add `and user_id = new.user_id` to
  the query — the header is right that restating the select policy creates a second definition.
- **Decision**: FIXED — documented in the new migration `20260815120000` (note 2) and in `access-control.md` § the access-control-trigger variant, with an explicit instruction NOT to close it by adding an owner term to the query.

### F5 — The `left join` guarantee is unguarded, and a hermetic guard may now be possible

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `tests/integration/tonnage-breakdown.test.ts:525-561`;
  `supabase/migrations/20260814090000_derive_daily_exercise_tonnage_from_sets.sql:99`
- **Detail**: Retiring assertion 9 was correct, deliberate, owner-approved and documented in three
  places, and no integration assertion can replace it — the hazard row is refused at insert and
  constructing one needs a stripped `service_role` key. It is not drift. What is new is that the gap
  now protects a wrong-numbers-with-no-error defect indefinitely. One guard was not considered: a
  hermetic assertion in `npm test` that reads the migration file as text and asserts it contains
  `left join public.exercises`. It cannot prove semantics, but it IS broken by exactly the edit
  `tonnage-breakdown.test.ts:553-556` names as the one nothing would notice.
- **Fix**: Add that text assertion — **but note it would be a NEW pattern here.** Checked: no test in
  this repository reads a migration file, and the two-copy hazards (`0.45359237`, the tonnage
  expression) are guarded by behavioural comparisons, not by text. Weigh that against
  `lessons.md` § "A weaker replacement assertion is the wrong answer", which Phase 1 invoked to
  refuse a replacement — a text guard is a different thing (it is mutated by the named edit) but the
  distinction deserves an explicit decision rather than an assumption.
- **Decision**: SKIPPED — owner decision, 2026-08-15. The gap stays named in three places rather than covered by a text guard that would be a new pattern here and cannot prove semantics.

### F6 — A NULL `exercise_id` now answers a misleading `23503` instead of `23502`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260815090000_scope_exercise_entries_to_visible_exercises.sql:65-69`
- **Detail**: `NOT NULL` is enforced after `BEFORE ROW` triggers, so an insert omitting the column
  reaches the trigger with `new.exercise_id IS NULL`, the existence query finds nothing, and the
  message renders as `exercise  is not available to this account` with an empty id — which the
  endpoint then maps to `404 exercise_not_found` where the database used to answer `23502`.
  Unreachable through the endpoint (`parseAddExerciseEntry` requires a uuid), so this affects direct
  PostgREST use only.
- **Fix**: `if new.exercise_id is null then return new; end if;` at the top of the function, so the
  `NOT NULL` constraint keeps owning that case.
- **Decision**: FIXED — migration `20260815120000` short-circuits on NULL. Pinned by assertion 8, confirmed load-bearing BEFORE the migration was applied: `expected "23502" received "23503"`.

### F7 — The MARK justification cites an incomplete list of existing marks

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `tests/integration/account-boundary.test.ts:57-59`; same defect at
  `tests/integration/tonnage-breakdown.test.ts:33-34`
- **Detail**: The header enumerates `s01-signup-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s07-`,
  `s08-`. Verified: the repository has ten — also `s04-`, `s05-`, `s05m-`, `s06-`. The **conclusion
  holds** (`s09i-` is neither a prefix of nor prefixed by any of the ten), but the evidence offered
  for it is wrong, which is the kind of claim this repository treats as checkable.
- **Fix**: List all ten, or state the check rather than the list.
- **Decision**: FIXED for this suite — the header now lists all ten marks. The identical defect at `tonnage-breakdown.test.ts:33-34` is left as that suite's to correct.

### F8 — `afterAll` swallows every teardown error, and re-authenticates more accounts than it needs to

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `tests/integration/account-boundary.test.ts:231-242`
- **Detail**: Three sign-ins and two delete loops are awaited with no error inspection. If a sign-in
  fails, the `workouts` delete silently matches zero rows, the `exercises` delete then fails on
  `on delete restrict`, and the run leaks everything with nothing printed — which, given F1's absent
  `beforeAll` reset, is unrecoverable. Separately, only `accountC` is ever signed out, so two of the
  three sign-ins are wasted requests; the unconditional loop was chosen for robustness against a
  future assertion that ends a session, which is a defensible but currently unpaid-for cost.
- **Fix**: `console.warn` the `error` from each call (`workout-log-rls.test.ts` has a `report()`
  helper for exactly this).
- **Decision**: FIXED in part — a `report()` helper now reads the error from every cleanup call. The unconditional re-authentication was KEPT deliberately: teardown must not depend on which assertions ran.

### F9 — A local `created` shadows the teardown-critical module-level `created`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `tests/integration/account-boundary.test.ts:274` vs `:109`
- **Detail**: Assertion 2 declares `const created = await accountB.client.from("exercise_entries")…`,
  shadowing the module-level `created: Account[]` that `afterAll` iterates. Harmless today; verified
  that `eslint.config.js` enables no `no-shadow` rule, so nothing would catch a later edit that
  pushed to the wrong binding.
- **Fix**: Rename the local to `entry`.
- **Decision**: FIXED — the module-level binding is now `accounts`, so the local `created` shadows nothing.

### F10 — The seeded-exercise fixture is read without an `order by`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `tests/integration/account-boundary.test.ts:219`
- **Detail**: `.select("id").is("user_id", null).limit(1).single()` — which of the 38 seeded rows
  comes back is unspecified. Harmless for assertions 2 and 3 (any seeded row satisfies them), but a
  failure would be attributed to a different exercise on different runs.
- **Fix**: Pin it by name, as `workout-endpoints.test.ts:78-88` does with
  `.in("name", ["Deadlift", "Plank"])`.
- **Decision**: FIXED — the seeded fixture is pinned by name (`Deadlift`), as `workout-endpoints.test.ts` does.
