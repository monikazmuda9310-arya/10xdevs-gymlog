<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Weekly Tonnage (S-07)

- **Plan**: `context/changes/weekly-tonnage/plan.md`
- **Mode**: Deep — two sub-agents at the owner's explicit request, since the plan's author is also its
  implementer
- **Date**: 2026-08-13
- **Verdict**: REVISE → **SOUND after fixes** (all findings applied)
- **Findings**: 6 critical, 4 warnings, 8 observations

## Verdicts

| Dimension             | Before  | After fixes |
| --------------------- | ------- | ----------- |
| End-State Alignment   | FAIL    | PASS        |
| Lean Execution        | WARNING | PASS        |
| Architectural Fitness | WARNING | PASS        |
| Blind Spots           | FAIL    | PASS        |
| Plan Completeness     | WARNING | PASS        |

## Grounding

8/8 paths ✓, brief↔plan ✓, Progress structure ✓ (1 heading, 5 phases both directions, no checkboxes
outside Progress). Criteria↔Progress parity after fixes: 6 / 12 / 16 / 9 / 4, matching in both
directions.

**Confirmed correct and left alone**: no new index is needed (a `DESC` second column serves a
`BETWEEN` — a btree scans either direction); `greatest(weight_kg, 0)` has no null hazard, doubly
(inputs are `not null`, and `GREATEST` ignores nulls anyway); no `::numeric` cast is needed for
multiplication, unlike the division next door; the ≤14-row bound holds by construction; a separate
`tonnage-display.ts` is the established per-feature split, not proliferation; Phase 1 as its own phase
is justified, not padding; rollback and migration ordering are handled in one line each.

## The shape of the criticals

Three of the six share one shape, and it is the uncomfortable one: **a plan whose strongest section
catches two inherited false coverage claims went on to write three of its own.** F1, F2 and F5 are
each a statement about what is covered, made without checking. Four more (F3, F8, and two
observations) are direct repeats of rules already accepted in `lessons.md` — which, per the review
brief, makes them weigh more rather than less.

## Findings

### F1 — US-03's fifth criterion promised as covered, delivered as a manual checkbox

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: § Current State Analysis; Phase 2 suite contract; Progress 3.12
- **Detail**: The plan states that "moving a workout recomputes both affected weeks" is uncovered
  today and that "this slice is where it gets covered". The Phase 2 suite contract listed six
  assertions and **none changed a workout's date** — the Sunday assertion is a static set logged on a
  Sunday, not a move. The only coverage was a manual step.
- **Fix**: A seventh assertion: a set in the previous week's Sunday reads `previous > 0, current === 0`;
  the workout is patched to the current week's Monday through `updateWorkoutRoute`; it reads back
  `previous === 0, current > 0`, both in one assertion because the property is that both walls move
  together. Mechanics copied from `record-impact.test.ts:483-489`.
- **Decision**: FIXED

### F2 — Two of the three Phase 1 mutations are ineffective by construction

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 Success Criteria, mutations (a) and (b)
- **Detail**: Mutation (a) subtracts milliseconds and expects the DST case to fail. It cannot: the
  plan mandates anchoring at `T00:00:00Z`, and **UTC has no DST** — the plan says so two paragraphs
  earlier without noticing it invalidates its own mutation. Mutation (b) swaps `getUTCDay()` for
  `getDay()`, which differ only at a **negative** UTC offset; the owner's machine is UTC+2 and CI is
  UTC, so it is deterministically ineffective in both environments anybody would run it in, and
  "recorded as a finding" was a foregone conclusion dressed as a discovery.
- **Fix**: (a) mutate with the **local** constructor `new Date(y, m-1, d)`, which puts a real DST
  transition inside the arithmetic; (b) run under `TZ=America/New_York`, written into the criterion
  and the Progress row rather than left to chance.
- **Decision**: FIXED

### F3 — No `security_invoker` mutation on the new view

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 mutation protocol
- **Detail**: `daily_tonnage` reads the base tables directly, so it stands exactly where
  `set_estimates` does — whose flag S-04 **proved** load-bearing. Without it the view runs as
  `postgres` and hands every account's tonnage to every account, silently. The protocol carried four
  mutations and the flag was not among them, against `lessons.md` § "A guard you have not mutated may
  not guard".
- **Fix**: Mutation (e) — removing the flag must fail the cross-account assertion. Plus Phase 5 now
  updates `AGENTS.md` § Access control → the derived-view variant, whose entire argument is built on
  there being two views.
- **Decision**: FIXED

### F4 — Criterion 2.5 was vacuous, and the tripwire comment it rested on is wrong

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 criterion 2.5; `tests/integration/preferences-derive.test.ts:331-336`
- **Detail**: Assertion 3 reads only `workouts` and `personal_records`. **Nothing writable in this
  migration can make it fail — including a view that mis-projects `performed_on` through the profile
  zone**, because such a view moves neither relation. The comment claiming S-07 is the slice that
  would make it bite was written during the S-06 implementation review; fixing one decorative
  assertion produced a second.
- **Fix**: Demote 2.5 to a regression check and say plainly it is not the guard — the grep over the
  migration file (2.4) is. Phase 5 corrects the comment and names **S-08** as the plausible next
  author of that edit, since currency is the only thing separating a tripwire from decoration.
- **Decision**: FIXED

### F5 — FR-006 read backwards

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: § What We're NOT Doing; `change.md`
- **Detail**: The plan asserted "FR-006 asks for a warning". `prd.md:187-191` resolves its objection
  by making **"the recomputation on date change an explicit acceptance criterion rather than an
  assumption"** — which is US-03's fifth criterion, i.e. F1. The warning question was **S-05's**. The
  owner's ruling stands; it just answers a different question, and FR-006 was being closed by
  something that never addressed it.
- **Fix**: Reframed in both documents: FR-006 is satisfied by the moved-workout assertion; the ruling
  answers S-05's question and is labelled as such.
- **Decision**: FIXED

### F6 — Progress row 2.6 was an orphan

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Progress
- **Detail**: 11 Progress rows against 10 Success Criteria. `/10x-implement` parses this section as
  the source of truth, so a mismatch is a criterion that exists to be ticked and not to be checked.
  The orphan was the only row asserting that the **new integration suite passes** — covered otherwise
  only through the generic "integration … all pass".
- **Fix**: Added as a Success Criteria bullet rather than deleting the row. (A second orphan, 3.0,
  was introduced while fixing the others and caught by re-running the parity check — recorded because
  it is the same defect committed while repairing it.)
- **Decision**: FIXED

### F7 — The failure path had no anchor, and a missing profile had no state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3 contract #3
- **Detail**: The service "throws on a read error" while the screen was to show a red panel — but a
  throw in Astro frontmatter is a **500**, and the contract never said where `weeklyTonnage` is called
  or that it is wrapped. Separately, after this change an absent profile row means the **unit and the
  zone are both unknown**, and `maybeSingle()` returns `null` without throwing — printing a figure
  under a defaulted unit is the exact defect the S-06 review found in `settings.astro`.
- **Fix**: The contract now names the `try/catch` in the frontmatter following
  `workouts/index.astro:16-31`, and folds "profile absent" into the page-level failure state, with a
  render assertion whose stub shape already exists at `settings-island.test.ts:191-204`.
- **Decision**: FIXED

### F8 — Three page-level states where the criterion is per-week

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 contract #3; render suite contract
- **Detail**: US-03's sixth criterion is about **a week**, not a page. The most common real state —
  the first week anybody logs, `current > 0` and `previous` empty — fell into "figures" and left last
  week's `0` bare, which is the blank the criterion forbids. `hasSets` is already per `WeekTonnage`,
  so the data structure carried it and the contract did not.
- **Fix**: Failure stays page-level; "no sets" and "a figure" moved per-figure. A render assertion
  covers one-empty-one-not.
- **Decision**: FIXED

### F9 — `Intl.NumberFormat` with no locale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 contract #2
- **Detail**: With no locale it inherits the runtime default: `12 345` under `en-US`, `12.345` under
  `de-DE` — a number a reader parses as twelve. This is the hazard `calendar.ts:38` already measured
  and pinned. The render suite cannot catch it: `vitest.render.config.ts` explicitly disclaims runtime
  fidelity, so a separator proven in Node proves nothing about workerd.
- **Fix**: Pin the locale explicitly, with a comment pointing at `calendar.ts:38`, and a criterion
  grepping for a bare constructor.
- **Decision**: FIXED

### F10 — The narrowing pattern is wrong for an aggregate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 service contract
- **Detail**: The plan copied `records.ts`'s "drop rather than assert". There, dropping an incomplete
  row is right — the ranking cannot reason about it. Here a row is **one day of the week**, and
  dropping it silently **understates the total**: the "figure that is wrong and looks right" the brief
  names as the sharpest risk. `lessons.md` § "A query shape that is exact for one row can be wrong for
  a set of them" is the same trap.
- **Fix**: `coalesce(sum(…), 0)` in SQL; a null in the service is a **read error and throws**, never a
  skipped day. The service also asserts the range is 14 dates — a throw, never `.limit(14)`, which
  would be a silent truncation wearing a seatbelt.
- **Decision**: FIXED

## Observations, all applied

- **`set_count` removed.** Its justification was self-contradictory and false: the view is grouped
  over `sets`, so a row exists iff the day has at least one set — the column is never `0` in an
  emitted row and row presence already answers the question. Nothing left but speculation for S-08, at
  identical cost then and now.
- **`KG_PER_LB` has four copies, not three.** The plan's own correction of `AGENTS.md` missed
  `workout-mutations-rls.test.ts:364`. A miscounted correction is worse than none.
- **"the constant keeps exactly one reader inside the module" was wrong** — `toKilograms` is a second,
  before and after. Claim dropped.
- **"keeps the render suite's stub to one chain shape" was false** — two reads, two chains, needing
  table dispatch. Justification dropped; the widening is still right for the other two reasons.
- **Baseline for criterion 3.4 recorded before the phase**, not after — `lessons.md` § "Write the
  threshold into the plan BEFORE taking the measurement".
- **`AGENTS.md` says "run all five" and `README.md` omits `test:render`** — both wrong since S-06;
  added to Phase 5.
- **An `anon` assertion on the new view** — the revoke was in the contract with nothing attacking it.
- **Manual step reworded to name the direction**: only previous-Sunday → current-Monday has both ends
  on screen. The other direction pushes tonnage into an invisible week and reads as data loss — the
  same hour-dependent defect `lessons.md` records from S-06, three days old.
- **A sub-unit week added to the unit tests** — `0.4 kg` rounds to `0` while `hasSets` is true, so the
  screen must show `0` **without** the "no sets logged" sentence, or it tells somebody who trained
  that they did not.
- **Production probe sharpened**: a permission error proves the route exists; `PGRST205` proves the
  schema cache never reloaded. Presence in the schema is not reachability.
- **The second sequential round trip named** in § Performance Considerations — the tonnage read cannot
  start before the profile read returns, on the landing page, against a 2 s p95 NFR.
- **Index pushdown holds only because both filtered columns are GROUP BY columns** — a property of
  this grain, which S-08 changes. Now stated.

## Post-review state

All 18 findings applied. Criteria↔Progress parity verified in both directions after the edits.
Verdict moves REVISE → SOUND.
