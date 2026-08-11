<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Log a Workout and See What It Was Worth

- **Plan**: `context/changes/log-workout-with-estimate/plan.md`
- **Scope**: all six phases (40/40 Progress rows checked)
- **Date**: 2026-08-11
- **Verdict**: APPROVED — all four findings triaged, three fixed, one recorded as a rule
- **Findings**: 0 critical, 1 warning, 3 observations
- **Reviewed inline**, without sub-agents, per the owner's standing instruction (session 5).

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence gathered

- **Every file in the plan is in the diff, and every file in the diff is in the plan.** 36 paths across
  seven commits (`585bd55` → `e106f9e`). The only additions beyond the plan's file list are
  `plan-brief.md` (a planning artefact) and `src/lib/services/set-display.ts` (see F4).
- **The five-command gate is green**, and CI agrees: run `31477077197`, success, on `e106f9e`.
- **No schema drift.** `npm run db:status` shows identical four-migration histories on `gymlog` and
  `gymlog-test`.
- **The access boundary re-verified against both live databases**, not recalled: `workouts`,
  `exercise_entries` and `sets` each report `rls=true`, `policies=4`, and **zero grants to `anon`**,
  on production and on the test project.
- **The client bundle carries the arithmetic and nothing else it should not.** `WorkoutDetail`
  ships at 10 096 B and contains the Brzycki denominator and `0.45359237`; the shared rules module
  is 1 255 B. No chunk under `dist/client/_astro/` contains zod, `@supabase/`, `SUPABASE_`, or a
  server-only parser. This is the stronger form of criterion 4.5, which was only a grep.
- **`weight_kg` is never written** — every occurrence in `src/` is a read, a select list, a type or
  a comment. Postgres would have refused otherwise, but nothing tries.
- **No mutation path shipped.** `.update(`, `.delete(` and `.upsert(` appear nowhere in `src/`,
  matching "What We're NOT Doing" — the migration grants both deliberately, with no UI behind them.
- **Five deviations, each recorded in `change.md` with its reason** (2.3, 3.5, 3.6, 4.4, 5.1, 6.4).
  Three share one root cause, now written into `AGENTS.md`: `astro dev` reads `.dev.vars`, which
  points at production, and no process-env override displaces it.

## Findings

### F1 — The workout list is unbounded, and unlike the catalogue it grows forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/workouts.ts:45-57`
- **Detail**: `listWorkouts` has no `.limit()` and no pagination, and every row carries a nested
  `exercise_entries(count)` aggregate. The plan's § Performance Considerations reasons carefully
  about the catalogue read and about computing the count in Postgres rather than in the Worker — but
  never about the list's own growth. The difference matters: the catalogue is bounded by curation at
  38 rows plus a handful, while a training log grows monotonically at roughly 200 workouts a year
  for the user this product is for. The NFR is 2 s p95 on mobile and the Workers Free plan kills an
  invocation at 10 ms of CPU. This is the read most likely to degrade, and it degrades slowly enough
  that nobody notices until the data is real. S-02's implementation review (finding F5) asked for
  exactly this treatment — a documented threshold — on a read that grows _less_ than this one.
- **Fix A ⭐ Recommended**: Document the threshold in a comment now, as `listExercises` does, and
  leave the bound to the slice that adds history or pagination.
  - Strength: No behaviour change and no silent truncation; the next reader meets the limit as a
    known decision instead of discovering it. Matches how S-02 resolved the same question.
  - Tradeoff: The risk is recorded, not removed — the first slow page load is still ahead.
  - Confidence: HIGH — the identical resolution is already in this repository and held.
  - Blind spot: Nobody has measured where the count aggregate actually starts costing; the threshold
    in the comment will be reasoned, not measured.
- **Fix B**: Add `.limit(100)` immediately.
  - Strength: Bounds the CPU cost today, before any user has that much history.
  - Tradeoff: Silently hides the oldest workouts with nothing on screen saying so — trading a
    performance risk for a data-visibility defect, in a product whose whole promise is that a
    logged session is never lost.
  - Confidence: MEDIUM — correct mechanically, wrong in spirit until a UI says "showing the most
    recent 100".
  - Blind spot: No check on whether S-07's weekly window would then read a truncated list.
- **Decision**: FIXED via Fix A — the threshold ("low hundreds; one to two years of real training")
  is now documented on `listWorkouts`, together with the reason no `.limit()` was added, so the next
  reader does not add one reflexively.

### F2 — A missing exercise is reported as "that workout could not be found"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/exercise-entries/index.ts:48-50`
- **Detail**: `23503` is mapped unconditionally to `workout_not_found`, but two different foreign
  keys raise it: the composite ownership key (the workout is not the caller's) and the plain
  `exercise_id` key (the exercise does not exist). `WORKOUT_MESSAGES.exercise_not_found` is defined
  and is now unreachable from this path. The code comment says the conflation is deliberate — both
  are "not found" and neither should be an existence oracle — and that reasoning holds for the
  _workout_, where the id is guessable. It does not hold for the _exercise_, whose catalogue is
  readable by every account anyway, so nothing is being protected by the vaguer message.
- **Fix**: Distinguish the two by checking the exercise's existence before the insert, or map on the
  constraint name in `error.details`, and answer `exercise_not_found` for the second case.
- **Decision**: FIXED — mapped on `WORKOUT_OWNER_CONSTRAINT`, the constraint name our own migration
  declares, rather than on provider prose, and pinned by a new assertion in
  `tests/integration/workout-endpoints.test.ts`. Mutation-verified: renaming the constant fails two
  tests, so the string match cannot rot silently.

### F3 — A failed list read also hides the form that does not depend on it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/workouts/index.astro:44-52`
- **Detail**: `loadFailed` replaces the entire page body, `NewWorkoutForm` included. So a transient
  failure reading the _list_ also blocks _creating_ a workout — the one thing the user opened the
  page to do, and the one thing that does not depend on the read that failed. The page copied this
  shape from `exercises.astro`, where the coupling is real because the form lives inside the
  component that failed to load; here the form is a sibling and the coupling is accidental.
- **Fix**: Render `NewWorkoutForm` above the `loadFailed` branch so the error replaces only the
  list. Note that when the profile read is what failed, the date defaults to UTC — still better than
  no form, and the user can see and change the date.
- **Decision**: FIXED — the form now sits above the failure branch; the error replaces only the list

### F4 — `set-display.ts` is an unplanned module, and it should be

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/set-display.ts`
- **Detail**: Phase 4 states the rule for which weight column feeds the estimate in prose and
  requires a unit test for both of its branches (criterion 4.6), but names no file for it — the
  prose reads as though the rule lives inside `WorkoutDetail.tsx`. It cannot: the unit suite is
  hermetic and does not render components, so a rule living in an island is a rule that criterion
  4.6 cannot test. Extracting it produced a fourth layer — `one-rep-max` (arithmetic) →
  `set-estimate` (is there a number) → `set-display` (which number, in whose unit) → the island —
  and kept `set-estimate.ts`'s import list at exactly `./one-rep-max`, which phase 2's criterion 2.4
  had already pinned. The extraction is right; the plan not naming it is the gap.
- **Fix**: None needed in code. Worth noting for the next plan: when a criterion demands a unit
  test, the plan should name the module that will hold the thing being tested.
- **Decision**: ACCEPTED-AS-RULE — appended to `context/foundation/lessons.md` as "A criterion that
  demands a unit test must name the module that will hold it". No code change: the module exists and
  is in the right place. The plan's Phase 4 gained an addendum naming `set-display.ts`, so the
  archived plan no longer disagrees with the code it produced.

## What was checked and found clean

- The composite ownership keys are the **only** foreign key between each pair of tables — verified in
  the migration, and the header comment states what a second one would do.
- `exercise_entries` carries no `muscle_group` column, so per-group tonnage will read the exercise's
  current group and S-02's open question stays open rather than being answered by accident.
- No `estimated_1rm` column exists anywhere; estimates are derived on read, which is what keeps S-06
  from turning a formula change into a lie about history.
- Every failure response across the three endpoints carries a code, never provider prose.
- The manual criteria are not rubber stamps: phase 4's manual pass produced a real defect and a real
  fix in the diff (the bodyweight placeholder), and phase 1's produced the mutation record in
  `change.md`.
