<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Tonnage Breakdown Implementation Plan

- **Plan**: `context/changes/tonnage-breakdown/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE
- **Findings**: 2 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

Two FAILs, but both are fixable with targeted edits rather than a change of approach — hence
REVISE, not RETHINK. The architecture (two views, `left join`, pure fold, degrade-alone failure
model) survived verification intact.

## Grounding

19/19 line references ✓, 14/14 file paths ✓, 7/7 commands ✓ (`db:push`, `db:types`, `db:status`,
`test`, `test:integration`, `test:render`, `build` all in `package.json`), brief↔plan ✓ except one
attribution gap (F8). `s08-` MARK is genuinely free. January–May 2025 is genuinely unused. No
`create or replace view` / `drop view` exists anywhere in `supabase/`.

## Findings

### F1 — Rounded group figures will not sum to the rounded weekly total on screen

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §1 (Contract, "Figures go through `tonnageFigure`"), criterion 3.5, Testing Strategy step 2
- **Detail**: All three reconciliation layers defend the underlying kilograms. None defends the
  *printed* number. `tonnageFigure` (`src/lib/services/tonnage-display.ts:37-41`) converts and then
  `Math.round`s to **whole units** — pinned by `tonnage-display.test.ts` (`not.toContain(".")`). Each
  group row is rounded independently of the total. A week of `100.5 kg` split as `33.5 / 33.5 / 33.5`
  prints `101` above and `34 + 34 + 34 = 102` below. With up to seven rows the visible drift reaches
  ±3–4 units, and it is larger in pounds because conversion multiplies the residuals. Criterion 3.5
  ("the group rows visibly sum to the week's total shown above them") and Testing Strategy step 2
  ("add the group rows by hand — they must equal the 'This week' figure") are therefore **not
  satisfiable by correct code**, and US-03's headline criterion — the owner's stated priority, "the
  breakdown reconciles to the penny with a figure already on production" — fails at the only place
  the user can check it.
- **Fix A ⭐ Recommended**: Apportion the rounding. Have the fold (or a new
  `breakdownFigures(groups, total, unit)` in `tonnage-display.ts`) round the group figures by
  largest-remainder against the *rounded* total, so the printed rows sum to the printed total by
  construction. Unit-test it: rows summing to the total for a case where naive rounding does not.
  - Strength: makes the headline criterion true where the user checks it, keeps `tonnageFigure`
    untouched for the two totals, and stays in a pure module the hermetic suite reaches.
  - Tradeoff: one group row can be off by 1 from its own independently rounded value — state that in
    the module header, since it is exactly the kind of "second answer" this repo documents.
  - Confidence: HIGH — the arithmetic is verified against the real formatter.
  - Blind spot: whether the owner prefers each row to be individually truthful over the column
    summing. That is a product call and is worth asking before implementing.
- **Fix B**: Keep independent rounding, restate criterion 3.5 and Testing Strategy step 2 as "sum to
  the total within one unit per row", and say so on screen.
  - Strength: no new code; every row is individually correct.
  - Tradeoff: concedes the acceptance criterion the slice exists to satisfy; "no percentages printed
    as numbers" was chosen partly to avoid exactly this reading problem.
  - Confidence: HIGH — trivially correct, just weaker.
  - Blind spot: none significant.
- **Decision**: PENDING

### F2 — Mutation (a)'s criterion names an assertion that will not fail

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria, mutation (a); Progress 1.5
- **Detail**: The criterion reads "`left join` → `join` fails assertion 9 **and** assertion 1". But
  the plan also gives every assertion its own date anchor ("Its own date anchors, because a suite
  filtering by **range** cannot rely on a name prefix") and has assertion 9 re-check reconciliation
  in its own window ("**and** assertion 1's equality still holds"). Assertion 1's window will contain
  no set pointing at an unreadable exercise, so switching to an inner join **cannot** make assertion 1
  fail. The implementer will either see one red assertion where the plan demanded two and paper over
  it, or force the hazard fixture into assertion 1's window — which is what `weekly-tonnage.test.ts`
  assertion 7's own comment (`:344-347`) says never to do, because it makes an access test fail
  whenever an arithmetic test does and breaks `-t`. This is the `lessons.md` rule "a mutation that
  fails for the WRONG REASON has not confirmed the guard", one step earlier: a mutation criterion
  that names a failure which cannot occur.
- **Fix**: Rewrite as "Mutation (a): `left join` → `join` fails **assertion 9**, and the failure text
  shows assertion 9's own breakdown sum *below* its window's `daily_tonnage` total by exactly the
  hazard set's tonnage — not merely a red suite." Drop assertion 1 from the criterion and from
  Progress 1.5.
- **Decision**: PENDING

### F3 — Five date anchors for a suite that needs about seven independent windows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3 (Contract, the anchor list)
- **Detail**: The plan names five anchors (`2025-01-08`, `02-12`, `03-12`, `04-09`, `05-14` — all
  Wednesdays, all ≥4 weeks apart, all in genuinely free months ✓) for nine assertions, without saying
  which assertion uses which. Counting the ones that need their own window: {1,2} reconcile+TS sum,
  {3} mixed units, {4} zero/assisted, {5} two workouts one date, {6} moved workout (mutates dates —
  cannot share), {7,8} access, {9} the hazard. That is six or seven, not five. `weekly-tonnage.test.ts`
  needed **seven anchors for eight assertions** for exactly this reason, and its header says why. The
  failure mode is not a red suite — it is two assertions quietly reading each other's fixtures and
  both passing for the wrong reason.
- **Fix**: Enumerate anchor→assertion in the Contract, and extend the list. Jan–May 2025 holds six at
  exact 4-week spacing (`2025-01-08`, `02-05`, `03-05`, `04-02`, `04-30`, `05-28`); a seventh can go
  to `2025-05-28` + a 2024 anchor if needed. State explicitly which assertions deliberately share a
  window and why.
- **Decision**: PENDING

### F4 — The render suite's new stub must reconcile, and the plan does not say so

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2
- **Detail**: Two unstated couplings, both created by Phase 3.
  1. `foldBreakdown` **throws** unless its rows sum to `weekTotalKg` within `0.001`. The existing
     fixtures are `ROWS = [{current, 12345.7}, {previous, 9000}]` (`dashboard-tonnage.test.ts:97-100`),
     so every `daily_exercise_tonnage` stub in the `both` and `oneEmpty` renders must sum to **exactly
     12345.7** or the page silently renders the breakdown-failure sentence and the new assertions
     ("six group labels in descending order", "an `Unattributed` row appears") test the failure path
     while reading green-ish. The plan's Contract for the stub says nothing about this.
  2. The suite asserts `expect(inPounds).not.toContain("12,346")` and `not.toContain("9,000")`
     (`:142-143`). Those are whole-page substring checks, and Phase 3 puts six-to-seven more formatted
     figures on the page. A breakdown row that happens to format to one of those strings turns a
     passing guard into a failure with no relation to what it guards.
  Confirmed as **not** a problem: the no-island assertion (`:129-133`) and the two-figure count
  (`:93`, `:158-163`) both survive Phase 3's contract as written, and `expect(failed).not.toContain(FIGURE_CLASS)`
  (`:183`) survives because the breakdown is not read when the tonnage read failed. The plan's
  three-tripwire claim is right on the tripwires it names; it is the fourth interaction it misses.
- **Fix**: Add to Phase 3 §2's Contract: the breakdown stub rows must sum to the current week's
  `tonnage_kg` exactly (say so, and say that this is what keeps the new assertions on the success
  path), and the stub's group figures must avoid the two digit strings the pounds assertions exclude.
- **Decision**: PENDING

### F5 — The "no external load" sentence contradicts "no change to either weekly total", and its manual criteria cannot be run in one session

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution / Plan Completeness
- **Location**: § What We're NOT Doing; Phase 3 §1 (sentence table); criterion 3.7; Testing Strategy step 4
- **Detail**: Two problems with one subject.
  - § What We're NOT Doing says "**No change to `public.daily_tonnage`, to `weeklyTonnage`, or to
    either weekly total.** The read path already serving production is untouched." Phase 3 then adds
    a new sentence under the week figures ("It applies to the week figures and to group rows alike").
    That *is* a change to the weekly totals' rendering. It is a good change — the gap is real, verified
    at `dashboard.astro:115-117` (only `!week.hasSets` renders anything) and
    `tonnage-display.test.ts:46-51` does claim the sentence exists — but a fresh reader hits a
    contradiction, and this is precisely the S-07-scope boundary the slice promised not to cross.
  - Criterion 3.7 and Testing Strategy step 4 ask for "a week whose only sets are planks" / "a plank
    at zero load **in a fresh week**". Only the **current** week is broken down, and steps 1–3 have
    just logged a loaded workout into it. The precondition is unreachable in the same session without
    deleting the earlier fixture, and waiting for next Monday is not a criterion.
- **Fix**: Move the sentence out of "NOT doing" into an explicit one-line scope note ("the totals'
  *figures* are untouched; one missing sentence is added beside them, closing the gap
  `tonnage-display.test.ts:46-51` names"). Restate 3.7 and step 4 at **group** level — "a group whose
  only sets this week are planks reads `0` with `Sets logged, no external load`, while untrained
  groups read `No sets`" — which is reachable in the same session and tests the same distinction.
- **Decision**: PENDING

### F6 — Phase 5's PRD criterion passes today, before any edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 Success Criteria; Progress 5.2
- **Detail**: `grep -n "Open Question 2" context/foundation/prd.md` already matches — `prd.md:407`,
  inside Open Question **1**, contains the literal phrase ("every historical per-group tonnage
  rewritten — Open Question 2"). The criterion cannot fail, which is `lessons.md` "A guard you have
  not mutated may not guard": decoration that reads as coverage.
- **Fix**: Grep for the stamp instead, matching OQ1's existing form:
  `grep -n "RESOLVED (owner, 2026-08-14)" context/foundation/prd.md`.
- **Decision**: PENDING

### F7 — The tolerance is three orders below display resolution, not four, and the suite's tolerance is 1000× tighter than the guard's with no reason given

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: § Critical Implementation Details; Phase 1 §3 assertion 1; Phase 2 §1
- **Detail**: The float claim itself is **correct** (see F10). But "a tolerance of `0.001` kg is four
  orders of magnitude below the display resolution (whole units)" is off by one — `1e-3` against `1e0`
  is three. Separately, Phase 1 assertion 1 compares within `1e-6` while `RECONCILIATION_TOLERANCE_KG`
  is `0.001`; both are defensible (the suite's fixture is tiny, the guard's input is not) but the
  1000× gap is unexplained, and an unexplained asymmetry between two similar decisions is what
  `lessons.md` warns produces the wrong lesson for the next reader.
- **Fix**: Correct "four" to "three", and add one clause saying why the suite may be tighter than the
  runtime guard.
- **Decision**: PENDING

### F8 — The two-copies rule is promised in Phase 5's Intent but absent from its Contract

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §1; Phase 2 §3
- **Detail**: Phase 5 §1's Intent names "the two copies of the tonnage expression" as something a
  future agent must not get wrong. Its Contract then lists three things and that is not one of them.
  AGENTS.md is the durable location for this class of hazard — the 1RM `case` expression and
  `0.45359237` both live there, and the new migration's header is only reachable from the newer of the
  two files, so a future migration changing the tonnage rule has no pointer back. Separately,
  `plan-brief.md` records the label-map promotion as an **Owner** decision; `plan.md` Phase 2 §3
  records it with no attribution, so the plan alone does not show it was the owner's call.
- **Fix**: Add the two-copies rule to Phase 5 §1's Contract explicitly (§ Domain rules, beside the
  other two instances, naming the cross-view assertion that pins agreement), and stamp Phase 2 §3
  "(owner decision, 2026-08-14)".
- **Decision**: PENDING

### F9 — `records.astro`'s `muscle_group` comes through a view and is nullable

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3
- **Detail**: Three of the four rewire sites hold a non-null `MuscleGroup`. The fourth does not:
  `records.astro:74` renders `row.muscle_group` from `listPersonalRecords`, i.e. the
  `personal_records` **view**, whose generated type is `Database["public"]["Enums"]["muscle_group"] | null`
  (AGENTS.md: "Generated types make every view column nullable"). `MUSCLE_GROUP_LABELS[row.muscle_group]`
  will not typecheck without a narrowing, and the right answer there is **not** `Unattributed` — a null
  on `/records` is a read anomaly, not unattributed tonnage.
- **Fix**: State in Phase 2 §3 how `/records` narrows (fall back to the raw value or omit the badge),
  and say explicitly that `Unattributed` belongs to the dashboard breakdown only.
- **Decision**: PENDING

### F10 — Confirmed: every load-bearing technical claim I could check is true

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: whole plan
- **Detail**: Stated explicitly because several were expected to be wrong.
  - **The left-join hazard is real and correctly described.** `exercise_entries.exercise_id uuid not
    null references public.exercises (id) on delete restrict` — single-column, not ownership-scoped
    (`20260811005248…:59`, exactly as cited). The select policy is
    `user_id is null or (select auth.uid()) = user_id` (`20260810174840…:65-67`, exactly as cited).
    `addExerciseEntry` (`src/lib/services/workouts.ts:149-154`) inserts `exercise_id` straight through
    with no visibility check. Under `security_invoker` an inner join is filtered by that policy.
  - **The hazard row IS constructible by the suite** — the plan's headline assertion is writable.
    PostgreSQL runs referential-integrity checks with row security bypassed, so the FK accepts B's
    private `exercises.id`; the `exercise_entries` insert policy only checks `(select auth.uid()) =
    user_id` on the row in front of it; the composite key names `workouts (id, user_id)`, which A
    satisfies with its own workout. A left join then null-extends and keeps the kilograms.
  - **The float claim is true, not overstated.** `sets.weight_kg` is `numeric`
    (`20260811005248…:100`), `sum(numeric)` is exact, and PostgREST delivers it as a JSON number —
    `daily_tonnage.tonnage_kg: number | null` in `src/db/database.types.ts:189`. Two different
    summation groupings over doubles can differ in the last bits, so `===` would be a defect.
  - **Two views, not one — the argument is sound, not rationalisation.** No `create or replace view`
    or `drop view` exists anywhere in `supabase/`, so "append-only" holds today; the cross-view
    assertion is genuinely non-tautological (two independent SQL expressions) and *would* be a
    tautology under research's nested alternative. The plan also avoids an unstated cost of that
    alternative: deriving the totals from the breakdown would replace `weeklyTonnage`'s 14-row bound
    with up to 420 rows and make production's proven totals inherit the breakdown's failure modes.
  - **Every "nothing covers this today" claim checks out** (`lessons.md`'s coverage-claim rule):
    `GROUP_LABELS` is unexported and private to `ExerciseCatalogue.tsx:11`; `/records:74`,
    `ExercisePicker.tsx:85` and `WorkoutDetail.tsx:335` do print the raw lowercase enum; there is no
    `src/lib/services/tonnage.test.ts`; `dashboard.astro` has no "no external load" sentence while
    `tonnage-display.test.ts:46-51` says the screen must; `preferences-derive.test.ts:343` does name
    S-08 by name.
  - **`MAX_BREAKDOWN_ROWS` is genuinely reachable from `npm test`**: `vitest.config.ts` includes
    `src/**/*.test.{ts,tsx}`, and `foldBreakdown` as specified imports only `@/types` and
    `calendar.ts`'s `DateRange`, neither of which touches `astro:*`.
  - **Progress↔Phase structure is mechanically correct** — one `## Progress`, every phase and every
    success-criteria bullet mapped, no stray checkboxes in phase bodies.
- **Fix**: None.
- **Decision**: PENDING

## Triage — 2026-08-14

All ten findings triaged in the planning session that received this report. Every one is applied to
`plan.md`; nothing was deferred.

| Finding | Decision | Where it landed |
|---|---|---|
| F1 rounded rows do not sum | **Fix A**, owner decision 2026-08-14 — the column must add up | New Phase 2 §3 `apportionedFigures` (largest remainder), § Key Discoveries, § Critical Implementation Details, Phase 3 §1 Contract, criteria 3.5 / step 2, mutation (h) |
| F2 mutation (a) names an impossible failure | Applied verbatim | Phase 1 criterion, Progress 1.5, assertion 9's wording |
| F3 too few date anchors | Applied — seven anchors, mapped one per assertion | Phase 1 §3 Contract (anchor→assertion table, `2024-12-11` added) |
| F4 render stub must reconcile | Applied — both couplings stated | Phase 3 §2 Contract |
| F5 "no external load" contradiction | Applied — scope note, criteria restated at group level | § What We're NOT Doing, criterion 3.8, manual step 4 |
| F6 PRD grep passes today | Applied — greps the stamp | Phase 5 criterion, Progress 5.2 |
| F7 orders of magnitude, tolerance asymmetry | Applied — "three", and the asymmetry explained | § Critical Implementation Details |
| F8 two-copies rule absent from Contract; label map unattributed | Applied | Phase 5 §1 Contract, Phase 2 §4 |
| F9 `/records` muscle_group nullable | Applied — raw-value fallback, `Unattributed` is dashboard-only | Phase 2 §4 |
| F10 confirmed claims | No action — recorded as evidence the architecture was verified rather than assumed | — |
