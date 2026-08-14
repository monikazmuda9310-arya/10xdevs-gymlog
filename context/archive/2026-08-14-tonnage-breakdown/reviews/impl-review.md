<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Tonnage Breakdown (S-08)

- **Plan**: `context/changes/tonnage-breakdown/plan.md`
- **Scope**: all five phases (full plan)
- **Date**: 2026-08-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations
- **Method**: two parallel review sub-agents (plan drift; safety, quality and pattern compliance),
  plus a full re-run of the six-step gate.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**No security defect found.** The new view carries `security_invoker = true`, revoke-then-grant,
`select`-only to `authenticated`, and both halves are exercised by integration assertions 7 and 8.
The `left join` that the whole slice was built around is in place and assertion 9 constructs the
grafted-entry hazard row rather than describing it.

**Success criteria, re-verified rather than trusted**: `npm run db:status` shows both projects at
`20260814090000`; lint 0 errors; `astro check` 0 errors / 0 warnings over 118 files; `npm test` 240;
`npm run test:render` 24; `npm run test:integration` **112, run twice back to back** (57.1 s, 55.7 s);
`npm run build` complete. Every automated criterion in all five phases passes. Manual criteria carry
owner confirmation recorded in the Progress evidence blocks.

**Two deviations from the plan's literal text are documented rather than silent**, and both are
counted as correct: the exercise row reads `Unattributed exercise` rather than the plan's bare
`Unattributed` (one word rendered twice with two meanings — recorded in the Phase 3 evidence), and
the null group sorts by tonnage with last-on-tie rather than unconditionally last (recorded in the
Phase 2 evidence, pinned by two unit tests).

## Findings

### F1 — The row cap runs after the rows have already crossed into the Worker

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/tonnage.ts:154-162`, with `src/lib/services/tonnage-breakdown.ts:108-113`
- **Detail**: `weeklyBreakdown` selects with no server-side cap, so the whole payload is fetched and
  JSON-parsed by `supabase-js` before `foldBreakdown` can refuse it at
  `rows.length > MAX_BREAKDOWN_ROWS`. The stated purpose of the cap is the 10 ms CPU budget
  (`tonnage.ts:147`: "a wider range would be unbounded work under a 10 ms CPU cap"), and
  deserialisation proportional to row count is exactly the work it claims to prevent. **The guard
  protects the fold, not the thing its comment says it protects.** Note this is a claim-accuracy
  problem as much as a performance one: the module's own sentence is what makes it a finding.
- **Fix A ⭐ Recommended**: Add `.limit(MAX_BREAKDOWN_ROWS + 1)` to the query in `weeklyBreakdown`.
  - Strength: This is **not** the silent truncation the module rightly rejects — the `+ 1` row is
    precisely the signal `foldBreakdown` throws on, so the refusal is preserved _and_ the transfer is
    bounded. One line, no behaviour change on any real week.
  - Tradeoff: A reader who greps for `.limit(` in this repository will find one and has to read the
    `+ 1` to see why it is not the forbidden thing. Needs a comment saying so.
  - Confidence: HIGH — the throw stays reachable by construction, and the existing unit test for the
    cap is unaffected.
  - Blind spot: Not measured. `gymlog-test` holds a few dozen sets, so no timing here would mean
    anything — the same disclaimer the plan already makes about every performance claim in the slice.
- **Fix B**: Narrow the comment instead, saying the cap bounds the FOLD rather than the transfer.
  - Strength: Zero risk; makes the existing sentence true at no cost.
  - Tradeoff: Leaves the transfer genuinely unbounded, which is the half that runs under the CPU cap.
  - Confidence: MEDIUM — correct as documentation, but it accepts the underlying exposure.
  - Blind spot: Whether an account can realistically reach 210 `(day, exercise)` rows in one week.
- **Decision**: FIXED via Fix A — `.limit(MAX_BREAKDOWN_ROWS + 1)` in `weeklyBreakdown`, with a
  comment stating why the `+ 1` preserves the refusal rather than truncating it.

### F2 — The new week-level "no external load" sentence has no automated coverage

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/dashboard.astro:189-191`, `tests/render/dashboard-tonnage.test.ts`
- **Detail**: Phase 3 added `Sets logged, no external load` beside the two weekly totals — the gap
  `tonnage-display.test.ts:46-51` already described as closed and which S-07 had left open. The render
  suite asserts that sentence only on a **group** row (`:352`). The plan's assertion list and manual
  criterion 3.8 were both written at group level deliberately, so this is consistent with the plan —
  but the week-level branch is new user-visible behaviour that nothing would notice losing.
- **Fix**: Add one render fixture whose current week has rows summing to `0` and assert the sentence
  appears beside the "This week" figure while `No sets logged this week` does not. The breakdown stub
  must sum to `0` in that fixture, per the coupling the suite already documents.
- **Decision**: FIXED — new fixture `planksWeek` plus `thisWeekCard()`, which bounds the assertion to
  the "This week" card so a `not.toContain` means something (the same sentence legitimately appears on
  a group row below). **Mutated to confirm it bites**: forcing the branch to `false` failed that
  assertion and only it, with the received markup showing the bare `0` and no sentence.

### F3 — `apportionedFigures`' comment promises a guarantee the clamp does not give

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/tonnage-display.ts:74-77`, `:83-85`
- **Detail**: The header says the clamp exists "so a caller who ignored `foldBreakdown`'s
  reconciliation gets a wrong-but-sane column rather than a negative figure or a crash". The clamp is
  only on the deficit, never on the row values: `apportionedFigures([-5, 105], 100, "kg")` returns
  `["-5", "105"]`, and a `NaN` argument propagates to the string `"NaN"` — the exact output
  `foldBreakdown:167` and `tonnage.ts:196` both refuse by name. Neither input is reachable today
  (`greatest(weight_kg, 0)` makes rows non-negative and the fold refuses a non-finite sum first), so
  this is a claim-vs-code mismatch rather than a live defect — which `lessons.md` says to name rather
  than leave: "that sentence is itself a claim, and it is checkable".
- **Fix A ⭐ Recommended**: Narrow the sentence to what the clamp actually guarantees — that
  `remaining` stays within `[0, n]`, so no row is over- or under-allocated — and say plainly that the
  thing keeping rows non-negative is `greatest(weight_kg, 0)` one layer down plus the fold's own
  guard.
  - Strength: Makes the documentation true without adding a second answer to "who validates this".
  - Tradeoff: The function stays willing to print `NaN` if a future caller skips the fold.
  - Confidence: HIGH — matches how the module already delegates its guarantees.
  - Blind spot: A future caller that formats figures without going through `foldBreakdown`.
  - **Chosen.**
- **Fix B**: Add the guard the sentence implies — one `Number.isFinite`/non-negative check over the
  inputs, with a unit test.
  - Strength: Makes the claim true by making the code stronger, and the display layer stops depending
    on a caller two modules away.
  - Tradeoff: A second validation site for an invariant the fold already enforces — the kind of
    duplication this repository documents as a hazard.
  - Confidence: MEDIUM — cheap to write, but it moves a guarantee to a place the plan did not put it.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the header now says what the clamp actually guarantees
  (`remaining` inside `[0, n]`), states plainly that the function does NOT sanitise values, and names
  the two things that do: `greatest(weight_kg, 0)` in the view and `foldBreakdown`'s non-finite guard.

### F4 — `records.astro`'s comment says "the raw value" where the code returns an empty string

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/records.astro:42` vs `:46`
- **Detail**: The comment reads "**The fallback is the raw value, never `Unattributed`**" while the
  code is `group === null ? "" : MUSCLE_GROUP_LABELS[group]`. There is no raw value to fall back to
  when the value is null. The reasoning about not printing `Unattributed` here is correct and worth
  keeping; only the first clause is wrong. Found independently by both reviewers.
- **Fix**: Reword to "the fallback is nothing at all, never `Unattributed`".
- **Decision**: FIXED — one clause reworded; the reasoning it introduces is unchanged.

### F5 — The breakdown's failure sentence invites a reload that cannot help

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/dashboard.astro:215-217`
- **Detail**: "Your breakdown could not be loaded. The totals above are unaffected." reads as
  transient. Two of the three ways `foldBreakdown` throws are **deterministic and permanent for that
  week**: the row cap and a genuine reconciliation failure. A week that reaches 210 `(day, exercise)`
  rows never renders its breakdown again, and every reload produces the same sentence. The degrade
  itself is right and the `throw`-not-`.limit()` choice is right; only the copy over-promises.
- **Fix**: Reword so the sentence does not imply a retry will help, keeping the two `console.error`
  diagnostics as they are — they already name the row count and the drift, which is what a support
  diagnosis needs.
- **Decision**: FIXED — now "This week's breakdown could not be shown. The totals above are
  unaffected." **This deviates from the sentence in the plan's Phase 3 table**, deliberately and after
  the fact; the plan stays as the historical record and this report is the amendment. The render
  suite's `BREAKDOWN_FAILURE` constant moved with it, and the `console.error` diagnostics are
  untouched.

### F6 — The roadmap still shows S-08 as `in-progress`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/foundation/roadmap.md:66` and the S-08 item body
- **Detail**: `change.md` reads `implemented` (now `impl_reviewed`) while the roadmap row and the item
  body still read `in-progress`. Roadmap edits were never in the plan, so this is a leftover rather
  than drift — and `/10x-archive` flips it to `done` as its normal job.
- **Fix**: None now; let `/10x-archive tonnage-breakdown` settle it, which is the step this change is
  queued for.
- **Decision**: SKIPPED — owner's call, 2026-08-14: `/10x-archive` owns this flip.

### F7 — `barWidth` can emit a long float into the style attribute

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/dashboard.astro:107-110`
- **Detail**: `String(Math.max(0, Math.min(100, share)))` produces e.g. `48.60000000000001%` for
  ordinary inputs. Purely cosmetic — the bar is `aria-hidden` and no percentage is printed — but it is
  markup nobody chose.
- **Fix**: Round to one decimal place, e.g. `share.toFixed(1)`.
- **Decision**: FIXED — `toFixed(1)`, with a comment saying why rounding is safe here and nowhere
  near a figure: nothing is added up and no number is read off the bar.

## Where the reviewers looked and found nothing

Recorded so an absent finding is distinguishable from an unchecked area.

- **RLS and the derived-view template** — flag, revoke, grant, no write path; assertions 7 and 8 cover
  both halves.
- **The join-as-filter hazard** — `left join` in place, nulls tolerated in the fold, assertion 9
  constructs the hazard row.
- **`.eq("user_id", …)` on every read** — `tonnage.ts:98`, `tonnage.ts:160`, both integration helpers.
- **`weight_kg` vs `weight`; `greatest(weight_kg, 0)`** — correct, and pinned by assertions 3 and 4.
- **`date_trunc('week', …)` and `profiles.timezone` in SQL** — grepped every migration; prose only.
- **Hermetic unit suite** — no `astro:*` import reachable from the three new/changed modules.
- **Island props** — the breakdown is static markup; the label map is a six-key object and
  `exercise.ts` still imports only `MUSCLE_GROUPS`.
- **Migration shape** — purely additive; nothing derived is stored.
- **Astro frontmatter 500s** — both throw sites caught, with separate flags.
- **`apportionedFigures`' sum invariant** — no input satisfying the fold's guarantees breaks the
  column, in kg or lb; sum-of-floors ≤ `round(total)` ≤ sum-of-floors + n, so `remaining` is never
  clamped at either end.
- **`foldBreakdown` guard bypass** — none found. The one legitimate-data throw is a concurrent write
  between the two round trips, which is correct behaviour under this project's rules and is recorded
  here so it is not later misdiagnosed as arithmetic.
- **Generated types** — no sign of hand-editing.
- **Pattern comparison** against `records.ts`, `record-display.ts`, `calendar.ts`, the S-07 migration,
  `weekly-tonnage.test.ts` and `settings-island.test.ts` — no substantive mismatch.
