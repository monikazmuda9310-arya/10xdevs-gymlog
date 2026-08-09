<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain-Rule Verification Harness

- **Plan**: `context/changes/verification-harness/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan; 17 of 19 Progress boxes checked — 3.5 and 3.6 pending)
- **Diff reviewed**: `74a3371..HEAD` (`32ef294`, `c40bc47`, `8b3f529`, `70a0a63`)
- **Date**: 2026-08-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

Every finding below is documentation or process. **No defect was found in
`src/lib/services/one-rep-max.ts`, in its tests, in `vitest.config.ts`, or in the CI gate.**

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Verification actually run by this review

Not trusted from the Progress checkboxes — re-run against the working tree.

| Command                                                                           | Result                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run lint`                                                                    | exit 0                                                       |
| `npm run typecheck`                                                               | exit 0 — `Result (31 files): 0 errors, 0 warnings, 4 hints`  |
| `npm test`                                                                        | exit 0 — `Test Files 1 passed (1)`, `Tests 14 passed (14)`   |
| `npm run build`                                                                   | exit 0 — `Complete!`                                         |
| `npm ls vite`                                                                     | every line `7.3.6`, no nested copy (criterion 1.1 confirmed) |
| `git grep -n "lint + build" -- README.md AGENTS.md context/foundation/roadmap.md` | no match (criterion 3.3 confirmed)                           |

Independent mutation proofs (not the ones the implementer ran):

1. `MAX_ESTIMABLE_REPS` 12 → 11 → `npm test` exit 1, one failure:
   `includes the twelve-repetition upper edge — expected 138.46153846153845 to be 144`. Reverted;
   `git status --porcelain` empty.
2. Epley divisor 30 → 25 → `npm test` exit 1, two failures: `applies Epley inside the estimable range`
   (`expected 120 to be close to 116.66666666666667`) and the 12-rep edge (`expected 148 to be 140`).
   Reverted; tree clean.
3. Type error appended to `one-rep-max.test.ts` → `npm run typecheck` exit 1, error reported **in the
   test file**. Confirms criterion 2.3's claim that the test file is itself type-checked. Reverted.
4. `npx vitest run "src/nothing-matches-this"` → `No test files found, exiting with code 1`. Confirms
   `passWithNoTests` is off, so a broken include glob turns CI red rather than passing vacuously.

## Findings

### F1 — Roadmap F-01 Status flipped against an explicit plan prohibition, leaving roadmap.md unformatted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/roadmap.md:56` (At-a-glance row) and `context/foundation/roadmap.md:110` (F-01 item body)
- **Detail**: Plan Phase 3 § 4 Contract states verbatim: "Leave the F-01 item body, the At-a-glance
  table and every other slice alone — the status flip is `/10x-archive`'s job, not this phase's."
  Commit `8b3f529` flipped `ready` → `in-progress` in both places. Second-order effect: the longer
  cell broke the markdown table's column padding. `npx prettier --check context/foundation/roadmap.md`
  now **exits 1** (13 lines of re-padding pending). Since `lint-staged` runs `prettier --write` on
  `*.md`, this also shows the pre-commit hook did not run for that commit. `npm run lint` does not
  cover markdown, so no gate catches it — but the next agent to touch this file gets 13 lines of
  unrelated reformat in their diff. (`AGENTS.md` is also prettier-dirty, but that is **pre-existing**
  at `74a3371` and not attributable to this change.)
- **Fix A ⭐ Recommended**: Run `npx prettier --write context/foundation/roadmap.md` and revert both
  Status cells to `ready`, leaving the flip to `/10x-archive`.
  - Strength: Restores the plan's explicit contract and the file's formatting in one pass; keeps a
    single owner for status transitions, which is what `/10x-archive` assumes.
  - Tradeoff: `ready` briefly understates reality — the work is done but unarchived.
  - Confidence: HIGH — the prohibition is verbatim in the plan and the prettier failure is reproducible.
  - Blind spot: Whether `/10x-archive` in this repo expects `ready` or `in-progress` as its input state.
- **Fix B**: Keep `in-progress` (it is more accurate than `ready`), but run
  `npx prettier --write context/foundation/roadmap.md` and record the flip as an accepted deviation
  in the plan's "Decisions taken without the owner" table.
  - Strength: Preserves information a reader wants; the formatting defect is fixed either way.
  - Tradeoff: Two skills now write the same field, which is how status drift starts.
  - Confidence: MEDIUM — depends on how strictly the course contract reserves status writes.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — roadmap § Baseline says F-01 "closed" and the pipeline "is green"; the new gate has never run

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/foundation/roadmap.md:90` and `context/foundation/roadmap.md:92`
- **Detail**: The Baseline bullets now read "the pipeline … runs lint, typecheck, unit tests and build
  on `main` and is green" and "This is what `F-01` closed" (past tense). `git branch -vv` shows
  `main … [origin/main: ahead 4]` — the four commits are unpushed, so a CI run containing
  `npm run typecheck` and `npm test` has never executed. The plan's own Progress agrees: 3.5 ("the
  GitHub Actions run is green and shows the typecheck and test steps") and 3.6 are still `- [ ]`,
  and the same file marks F-01 `in-progress`. The document therefore contradicts itself.
- **Fix**: Change the two bullets to present-tense configuration — "the pipeline is configured to run
  lint, typecheck, unit tests and build; the first run with the new steps is pending" — and change
  "This is what `F-01` closed" to "This is what `F-01` closes", until Progress 3.5 is checked.
- **Decision**: PENDING

### F3 — Criterion 2.2 is marked done but its stated output does not appear in a non-interactive run

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/verification-harness/plan.md:578`
- **Detail**: 2.2 reads "the `npm test` output names `src/lib/services/one-rep-max.test.ts` (guards
  against a silent zero-test pass)". Vitest 4's default reporter prints the per-file line only in a
  TTY. Redirected to a file — which is what GitHub Actions does — the entire output is the banner
  plus `Test Files 1 passed (1)` / `Tests 14 passed (14)`; grepping the captured output for
  `one-rep-max.test.ts` returns **0 matches**. The criterion's _intent_ is met, and met more strongly
  by `passWithNoTests` being off (probe 4 above), but as written it is not reproducible in CI.
- **Fix**: Reword 2.2 to assert `Test Files 1 passed (1)` and a non-zero `Tests N passed`, or add
  `--reporter=verbose` to the `test` script.
- **Decision**: PENDING

### F4 — New AGENTS.md § Commands paragraph duplicates README, which plan-review F10 advised against

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AGENTS.md:49-52`
- **Detail**: Phase 3 added all three scripts to `README.md` § Available Scripts (`README.md:58-60`)
  **and** a paragraph to `AGENTS.md` § Commands re-listing `npm test`, `npm run test:watch` and
  `npm run typecheck`. Placing it _above_ "Two things README does not cover" does keep that sentence
  true — the implementer's stated reason, and it works — but it re-creates the exact README/AGENTS
  duplication that `reviews/plan-review.md` F10 flagged, whose recommended fix was to carry the
  agent-specific facts in § Testing only (which the implementation also did). The one fact in the new
  paragraph that is genuinely not in README is the gate _order_ and the instruction to run all four.
- **Fix**: Trim the paragraph to the gate-order sentence, and drop the per-command restatement that
  README already carries.
- **Decision**: PENDING

### F5 — `@types/node@^26` declared against a Node 22 runtime

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `package.json:42`
- **Detail**: `.nvmrc` pins 22.14.0 and `.github/workflows/ci.yml` pins `node-version: 22`, but the
  Node typings resolve to `^26.2.0`. Typings ahead of the runtime describe APIs that do not exist at
  runtime: such code type-checks clean and fails in production. No live defect today — the only Node
  API used is `fileURLToPath` from `node:url` in `vitest.config.ts` — but the mismatch is a trap for
  the slices that follow. The plan specified `npm install -D vitest @types/node` with no version, so
  this is plan-conformant; the plan is what is slightly wrong.
- **Fix**: `npm i -D @types/node@^22` so the typings track `.nvmrc` and the CI runtime.
- **Decision**: PENDING

### F6 — Test glob accepts `.tsx` in a `node` environment with no DOM

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `vitest.config.ts:11` vs `AGENTS.md:99`
- **Detail**: `test.include` is `["src/**/*.test.{ts,tsx}"]` with `environment: "node"`, no jsdom or
  happy-dom and no setup file — so any `.tsx` test that renders fails at the first DOM access. The
  new `AGENTS.md` § Testing bullet meanwhile documents the convention as `src/**/*.test.ts`, so the
  config and the instruction file disagree. This is `reviews/plan-review.md` F9, which the plan chose
  not to apply; the implementer followed the plan's contract exactly, so this is a plan carry-over,
  not implementer drift.
- **Fix**: Narrow the include to `src/**/*.test.ts`; the slice that needs component tests widens it
  and adds a DOM environment in the same change.
- **Decision**: PENDING

### F7 — "Every one of them has a unit test" is now _partially_ true, which reads as fully true

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `AGENTS.md:14`
- **Detail**: § Domain rules still asserts "**Every one of them has a unit test; do not change
  behaviour here without changing the test and saying so.**" That is true for the two 1RM rules only.
  The other six — records-are-derived, PR-decided-on-estimate, Monday–Sunday in the user's timezone,
  zero/negative tonnage, exact unit round-trip, one primary muscle group — have neither implementation
  nor test. Before this change the sentence was uniformly false and therefore obviously aspirational;
  now it is half true, and § Testing's new "Unit tests run on Vitest and live beside the code" bullet
  sits four lines away, which makes the guard look real for all eight. The plan retained the sentence
  deliberately (Contradictions § 1: "retained as written because it is the standard those slices must
  meet"), so this is a recorded decision, not an oversight — but the hazard grew rather than shrank.
- **Fix A ⭐ Recommended**: Add a parenthetical without weakening the standard — "Every one of them
  has a unit test (today: the one-rep-max rules; the rest land with the slices that own them); do not
  change behaviour here without changing the test and saying so."
  - Strength: Keeps the standard binding for future slices while making today's coverage checkable;
    an agent can no longer infer a guard that does not exist.
  - Tradeoff: The sentence needs one more edit each time a slice lands, until it can be deleted.
  - Confidence: HIGH — the coverage gap is verifiable (one test file in the repo).
  - Blind spot: None significant.
- **Fix B**: Leave it as the plan decided and rely on the roadmap Baseline bullet, which already names
  the gap ("unit tests for every domain rule other than the one-rep-max boundaries" still absent).
  - Strength: Zero churn; the gap _is_ recorded, just not in the file agents read first.
  - Tradeoff: `AGENTS.md` is the file the course contract says every agent reads first; the roadmap is not.
  - Confidence: MEDIUM — depends on whether future agents read the roadmap at all.
  - Blind spot: None significant.
- **Decision**: PENDING

## Answers to the six review questions

1. **Domain correctness — correct on all four rules.** 1–12 inclusive, `null` outside, never a
   fabricated number (`one-rep-max.ts:44-46`); `reps === 1` returns `weight` for both formulas
   (`:48-50`), so Epley is pinned; `weight >= 0` in `isEstimable` (`:33`) excludes assisted sets from
   both estimation and the predicate S-04 will use for record detection; zero load is _not_ excluded
   and estimates to 0, which matches PRD § Business Logic and US-02 AC (only ">12 reps" and "assisted
   with negative load" are enumerated exclusions). The tests pin each rule against literals, not
   against the implementation — mutation probes 1 and 2 confirm it.
2. **Test quality — non-tautological.** Every expected value is a hard-coded literal
   (`100`, `112.5`, `74.48275862068965`, `116.66666666666667`, `76`, `144`, `140`, `0`, `null`)
   matching the independently computed table in the plan; the formula is never re-derived in the test.
   Boundaries covered: 0, 1, 12, 13, 37, 40, 2.5, zero load, `-20`, `NaN`, `+Infinity`, determinism
   across 1–12 for both formulas. One structural caveat, non-blocking: `MIN_ESTIMABLE_REPS` and
   `MAX_ESTIMABLE_REPS` are never asserted `toBe(1)` / `toBe(12)` — the `isEstimable` boundary tests
   loop _to_ the constants and would stay green if a constant moved. The boundary is pinned only by
   the literals `144` and `140`, which do uniquely determine `r = 12` under both formulas; probe 1
   confirms the boundary is genuinely caught.
3. **Drift — four of the five reported deviations are defensible; the fifth is not.** Fourth epilogue
   commit: fine (docs-only; makes the plan's "revert of the three commits" note stale, trivially).
   Criterion 1.6 in Phase 2: not just defensible, **necessary** — with `passWithNoTests` off, `vitest`
   watch cannot stay running before a test file exists, so the plan's own phasing was wrong.
   AGENTS § Commands rewording: defensible on truthfulness grounds, see F4 for the cost.
   NaN/Infinity tests: these directly implement plan-review F8(a) — an improvement, not drift.
   **Roadmap Status flip: contravenes an explicit written prohibition (F1).** Unreported drift found:
   roadmap.md is now prettier-dirty (F1), the § Baseline text claims a close and a green pipeline that
   have not happened (F2), criterion 2.2's stated output is not reproducible non-interactively (F3),
   and plan-review F8(b) — recording the zero-load record-detection consequence for S-04 in Decision 4
   — was skipped without note (F8 was explicitly listed as skippable, so this is minor).
4. **Scope — clean.** `git diff --stat 74a3371..HEAD` lists 13 files, all planned. The only file not
   named in the plan's file list is `package-lock.json`, which is a mechanical consequence of
   `npm install -D`. `plan-brief.md` and `reviews/plan-review.md` appear in the diff only because they
   were untracked before `32ef294`. No source file, migration, endpoint, or component landed outside
   the plan. `overrides`, `lint-staged` and the pre-existing scripts are untouched, as instructed.
5. **The CI gate genuinely gates.** Order is `npm ci → npx astro sync → npm run lint → npm run
typecheck → npm test → npm run build`, exactly as planned; `npm run typecheck` carries the
   Supabase env block, `npm test` correctly carries none (nothing under test imports anything).
   A wrong derived number turns it red at the `npm test` step: verified locally by two mutations, both
   exiting 1 with the assertion naming the wrong value. No vacuous-pass path found — `passWithNoTests`
   is off so a broken glob exits 1 (probe 4), `npm ci` installs devDependencies so vitest is present,
   the default working directory is the repo root where `vitest.config.ts` lives, and GitHub Actions
   `run:` propagates the non-zero exit. The one thing that has **not** been proven is the gate running
   on GitHub itself — the commits are unpushed and Progress 3.5 is correctly still unchecked.
6. **Document truthfulness — the "lint + build" sweep is complete and accurate; two new inaccuracies
   were introduced.** `git grep "lint + build"` over the three files returns nothing; README § CI,
   README § Available Scripts, AGENTS § Known state and roadmap § Baseline all now describe the
   four-step gate correctly, and README's build-time-vs-runtime secrets paragraph was correctly left
   alone. New inaccuracies: roadmap § Baseline's past-tense "This is what `F-01` closed" and "is
   green" (F2). And `AGENTS.md`'s "Every one of them has a unit test" is now half-true rather than
   plainly aspirational (F7) — true for 1RM only, false for the other six rules.

## Bottom line

The code is right and the gate is real. Both mutations I introduced independently — a boundary
constant and a formula divisor — turned `npm test` red at the correct assertion, and the zero-test
path exits 1, so this change delivers F-01's stated outcome. Everything found is a document or
process blemish; the two worth fixing before push are the unformatted `roadmap.md` (F1) and the
past-tense "F-01 closed" claim in the same file (F2).
