<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Duplicate Record-Impact Sentence

- **Plan**: `context/changes/duplicate-record-impact-sentence/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan — Progress 14/14)
- **Date**: 2026-08-22
- **Verdict**: APPROVED (all four findings triaged and fixed 2026-08-22)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Success criteria, re-verified

Every automated criterion was re-run during this review, on `main` at `96be416`.

| Row | Command                            | Result                                                        |
| --- | ---------------------------------- | ------------------------------------------------------------- |
| 1.1 | `npm test`                         | 259 passed                                                    |
| 1.2 | `npm run lint`                     | clean                                                         |
| 1.3 | `npm run typecheck`                | 0 errors, 0 warnings                                          |
| 1.4 | `npx prettier --check`             | clean on all four files                                       |
| 1.5 | `test:render` / `test:integration` | 52 passed / 142 passed — but see **F2**                       |
| 1.7 | grep under `src/components/`       | no definition of `impactSentence` or `RECORD_LABEL` remains   |
| 2.1 | `npm run deploy`                   | not re-run — a review must not redeploy. Evidence: `8403c036` |
| 2.2 | `npm run db:parity`                | not re-run — recorded exit 0, 12/12 aspects                   |

Manual rows 1.8, 1.9, 2.3, 2.4 and 2.5 are marked `[x]` and each has observable evidence: the header
comment exists and states the counting rule (1.8); all five sentence templates are byte-identical to
their pre-change form, verified by literal extraction (1.9); and the three deployed checks were
confirmed by the owner on the public URL (2.3–2.5).

## Findings

### F1 — Three deviations from Phase 1's contracts are undocumented in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/record-display.ts:213-238`; plan.md § Phase 1 "Changes Required" #1
  and #2
- **Detail**: The implementation is right and the plan text is what is wrong, in three places.
  1. **The collapse key.** Contract #2 says "one row per distinct `(scope, exerciseId)`". Taken
     literally that collapses two _different_ records of one exercise into one line — contradicting
     the plan's own Testing Strategy control ("two kinds, same exercise, different successors → two
     rows"). Implemented as `exercise-<id>` for exercise scope and `record-<kind>-<id>` for record
     scope.
  2. **Where the collapse lives.** Contract #2 assigns it to `RecordImpactDialog.tsx`. It is in
     `record-display.ts` as `impactSentences`, because the plan's own test contract demands an
     assertion that two entries "collapse to **one** row" — unreachable from the unit suite if the
     collapse sits in a `client:load` island. This is `lessons.md` § "A criterion that demands a unit
     test must name the module that will hold it", recurring inside the very change that cites it.
  3. **An unlisted export.** `ImpactRow` (`ImpactSentence` plus a `key`) is not in contract #1's
     shape. It carries the row identity the React `key` needs.

- **Fix**: Append a short addendum to `plan.md` § Phase 1 recording all three, so the next reader
  comparing plan against code does not read them as drift.
- **Decision**: FIXED — addendum appended to plan.md § Phase 1

### F2 — The integration suite went red once in four runs, and the cause is not this change

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `.github/workflows/ci.yml` § `concurrency`; `AGENTS.md` § Commands
- **Detail**: During this review `npm run test:integration` reported `1 failed | 141 passed`. It
  passed on the two runs before and the two runs after, and the failing run's output was not
  captured — so **which** assertion failed is unknown, and is stated here rather than guessed.

  The cause is established by timing, not inferred from the code. CI run `32582561154` executed its
  own `test:integration` step against `gymlog-test` from `15:44:57Z` to `15:48:01Z`; the local run
  started `17:47:08` CEST (= `15:47:08Z`) and ran 71.9 s. **The two overlapped for 53 seconds,
  writing to the same project.** Independently, no suite under `tests/` imports `record-display` at
  all, so the change cannot be the cause.

  What makes this worth writing down: `AGENTS.md` presents the workflow's `concurrency` group as the
  thing that stops two runs racing the shared fixture rows, and it does — **but only CI against CI.**
  A developer running the suite locally while a PR's `ci` is in flight hits exactly the same rows
  with nothing serialising them, and the resulting failure looks like a product defect. Nothing in
  `AGENTS.md` or `README.md` says so.

- **Fix**: Record it as a lesson and add one line to `AGENTS.md` § Commands next to
  `test:integration` — the fixture race the `concurrency` group prevents is CI-vs-CI only; check
  `gh run list` before running the suite locally against `gymlog-test`.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "The CI concurrency group serialises CI against CI — a local run races it anyway" (lessons.md), plus a nested bullet in AGENTS.md § Known state

### F3 — The collapse relies on an invariant nothing states or asserts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/services/record-display.ts:213-238`,
  `src/lib/services/record-impact.ts:158-184`
- **Detail**: `impactSentences` is coherent only because one exercise can never produce both an
  exercise-scoped and a record-scoped row. That holds today by construction — `fallingRecords` reads
  one `SurvivingFor` per exercise, and `anySetSurvives: false` implies both candidates are null — but
  it is incidental rather than stated. Were it ever violated, the dialog would print "falls to X" and
  "will no longer appear at all" for the same lift, side by side.

  Not a regression: the pre-change dialog would have printed the same contradiction. Worth a sentence
  where the reasoning lives.

- **Fix**: One line in `impactSentences`' doc comment naming the invariant and where it comes from.
- **Decision**: FIXED — the invariant is now stated in impactSentences' doc comment

### F4 — The dialog is still rendered by no suite, which is why this defect shipped

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/components/workouts/RecordImpactDialog.tsx`
- **Detail**: The plan names this gap explicitly and declines to close it, with reasons: the render
  suite cannot mount React islands, and the browser harness has crashed three times this week for
  reasons unrelated to the product (`test-plan.md` § 6.3). The function is now covered; **the
  component is not**, and the component is where the defect was visible.

  Flagged not as drift — the plan was honest — but so that a green suite is not read as covering it,
  and so the gap stays on the record after this change folder is archived.

- **Fix**: None here. Carry it to `test-plan.md` as a named gap rather than leaving it inside a change
  folder that is about to be archived (`lessons.md` § "A pointer INTO `context/changes/` dies the day
  that change is archived").
- **Decision**: FIXED — carried to test-plan.md § 7 as a named gap, so it survives archiving

## What was checked and found clean

- **Scope Discipline — every "What We're NOT Doing" boundary held.** `fallingRecords`, `impactOf` and
  the three `…/impact` route payloads are untouched; the collapse is on declared scope rather than on
  comparing rendered strings; no e2e spec was added; the `edit` sentences are byte-identical.
- **Safety & Quality.** No security surface — the change is string formatting with no I/O, no SQL, and
  no user-controlled interpolation reaching anything but React's escaped text. `impactSentences` is
  linear over a list bounded by the exercises in one workout.
- **Architecture.** The move is in the right direction: `record-display.ts` was already imported by
  the island, so this removes bundle weight rather than adding it, and the function now sits beside
  the `FallTo` doc comment that already governed it.
- **Pattern Consistency.** The new tests follow the file's existing `falling(...)` / `successorSet()`
  fixture shape; the claim-carrying assertion is first, per `lessons.md`; every expected string is a
  literal rather than derived from the subject, per `lessons.md` § "An expectation derived from the
  subject is not an assertion".
- **Mutation testing was performed and is reproducible.** Removing the collapse reddens exactly one
  assertion — the one carrying the claim. Flipping `scope` on the `no_sets_left` delete branch reddens
  that same assertion first.
