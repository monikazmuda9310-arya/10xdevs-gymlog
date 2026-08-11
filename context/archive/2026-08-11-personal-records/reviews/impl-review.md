<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: A Record Is Announced When It Happens, and Listed Afterwards

- **Plan**: `context/changes/personal-records/plan.md`
- **Scope**: All 5 phases (full plan review)
- **Date**: 2026-08-11
- **Verdict**: NEEDS ATTENTION — all five findings triaged 2026-08-11: four fixed, one accepted
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

**Automated criteria re-run at review time**: `npm run lint` ✅, `npm run typecheck` ✅ (0 errors),
`npm test` ✅ (141), `npm run test:integration` ✅ (57), `npm run build` ✅. All 24 Progress rows are
`[x]` and carry a commit SHA.

**Positive evidence worth recording.** `EXPLAIN` run as the `authenticated` role with a JWT claim
shows the RLS predicates of `exercises` (`user_id IS NULL OR (InitPlan 1).col1 = user_id`), `sets`,
`workouts` and `profiles` all applied _inside_ the view. That corroborates `security_invoker` from
the opposite direction to the black-box assertion — the policies are demonstrably engaged, not merely
un-violated.

## Findings

### F1 — The `explain` the plan required was never run, and cannot answer its question here

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: `context/changes/personal-records/plan.md` § Performance Considerations
- **Detail**: The plan says "Run `explain (analyze, buffers)` on both queries against `gymlog-test`
  after Phase 1 and record the plan in Progress." It was never run, and no Progress row covered it —
  so nothing failed when it was skipped. Run during this review, it produces a second, larger
  finding: **`gymlog-test` holds 36 sets, 26 workouts and 25 entries**, and at that size Postgres
  correctly prefers sequential scans. The check as written therefore cannot answer the question it
  was written for ("do these queries use the indexes through a view with an RLS predicate"), and a
  green result from it would have been meaningless reassurance.
  - What the run **did** establish: the `user_id` qual is pushed down to the base table inside the
    `distinct on` subqueries (`Filter: (user_id = '…')` on `sets s`), so the fallback-to-lateral
    contingency named in the plan is not needed. Execution time 0.4 ms — true, and uninformative.
  - **S-07 and S-08 inherit this exactly.** Both are justified by the 10 ms CPU cap, and there is no
    environment in this project where that justification can be measured.
- **Fix A ⭐ Recommended**: Record the finding as a constraint rather than re-running the check —
  amend the plan's § Performance Considerations and the roadmap's S-07/S-08 risk notes to say that
  index behaviour is unverifiable below a realistic data volume, and name seeding a volume fixture as
  the prerequisite for ever claiming otherwise.
  - Strength: Turns a silently skipped step into a stated limitation the next planner meets, which is
    the same move that made the S-04 `security_invoker` asymmetry safe.
  - Tradeoff: The performance claim stays unverified — accepted honestly rather than closed.
  - Confidence: HIGH — the row counts are measured, and the plan shape is unambiguous.
  - Blind spot: Nobody has estimated at what volume the seq-scan/index crossover actually lands.
- **Fix B**: Seed `gymlog-test` with a synthetic year of training (~2,000 sets) and re-run.
  - Strength: Produces a real answer, and gives S-07/S-08 a bench for the same question.
  - Tradeoff: A fixture of that size collides with the suites that clean by prefix, and it is a
    piece of infrastructure this slice did not plan for.
  - Confidence: MEDIUM — the seeding is easy; keeping it from disturbing the shared fixture accounts
    is not.
  - Blind spot: Whether the free-plan test project's own resources make the measurement
    representative of production at all.
- **Decision**: FIXED via Fix A — constraint recorded in plan.md § Performance Considerations and in the roadmap's S-07/S-08 risk notes

### F2 — `records.astro` restates the two enums by hand

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/records.astro:13-14`
- **Detail**: The page declares `let weightUnit: "kg" | "lb" = "kg";` and
  `let estimationFormula: "epley" | "brzycki" = "brzycki";`. `src/types.ts` opens with "Everything
  here is _derived_ from the generated schema types — never restated by hand", and the sibling page
  `src/pages/workouts/[id].astro:41-42` obeys it by letting the type flow from `Profile`. A third
  weight unit or a third formula added to the Postgres enum would leave this page compiling against
  a union that no longer describes the column — the exact failure the `MUSCLE_GROUPS` compile-time
  assertion exists to prevent elsewhere.
- **Fix**: Import `WeightUnit` and `EstimationFormula` from `@/types` and annotate with those.
- **Decision**: FIXED — records.astro imports WeightUnit / EstimationFormula from @/types

### F3 — Six commits are local; CI has never run this slice, and production is ahead of the remote

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A — `git status`: `main...origin/main [ahead 6]`
- **Detail**: All five phase commits plus the epilogue are local. `.github/workflows/ci.yml` runs on
  push to `main`, so the pipeline has never seen the migration, the new suite or the new page —
  every check reported here was run on this machine only. Meanwhile `wrangler deploy` has already
  put the code on the public address, so **the deployed application has no counterpart in the
  remote repository**. The plan did not include a push step, which is why nothing caught this.
- **Fix**: `git push origin main`, then confirm the run is green.
- **Decision**: FIXED — pushed to origin/main

### F4 — Two Phase 5 edits fall outside the plan's stated scope and are undocumented

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/foundation/lessons.md`, `README.md`
- **Detail**: Phase 5's Changes Required names `AGENTS.md`, `change.md` and `roadmap.md`. The
  implementation also appended a `lessons.md` entry and updated `README.md`'s routes table and the
  `/api/sets` contract. Both are consistent with the repository's conventions — the roadmap's Done
  entries reference `lessons.md`, and README documents every route — but neither was recorded in
  `change.md` § Deviations, where the `record-display.ts` addition and the Phase 3 deferral both
  were. The record of what happened is therefore slightly incomplete.
- **Fix**: Add both to `change.md` § Deviations in one line each.
- **Decision**: FIXED — both edits recorded in change.md § Deviations

### F5 — Criteria 5.2 and 5.3 were assessed by the author of the text under review

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/personal-records/plan.md` § Progress, rows 5.2 / 5.3
- **Detail**: Both are reader-judgement criteria ("is it obvious to the agent planning S-05…"),
  and both were marked complete by the same agent that wrote the prose being judged, after the owner
  delegated the call. That is structurally weak evidence. It is not zero: the self-assessment did
  surface a real gap — the "a records number may never be stored" half of 5.2 was absent from
  § Access control and was added rather than waved through — which is not what a rubber stamp
  produces. Recorded so the weakness is visible rather than implied.
- **Fix**: None required. If S-05's planner finds § Access control unclear, that is the real signal,
  and it should come back as a lesson rather than a retroactive correction here.
- **Decision**: ACCEPTED — left recorded, no fix. If S-05's planner finds § Access control unclear, that is the real signal and it should return as a lesson.
