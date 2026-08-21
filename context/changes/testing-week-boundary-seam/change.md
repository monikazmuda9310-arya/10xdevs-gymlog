---
change_id: testing-week-boundary-seam
title: Week-boundary seam — prove a screen's week is bounded by the profile's stored zone
status: impl_reviewed
created: 2026-08-20
updated: 2026-08-21
archived_at: null
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md`: "Week-boundary seam".
Goal: the week the screen shows is bounded by the zone the profile holds.

Risks covered: Risk #1 — "The week's figures are computed from the wrong days after a timezone
change; the number looks correct and is believed" (High impact x High likelihood — the only
High x High row on the map; evidence: interview Q3; hot-spot src/lib/services/ — 53 changes/30d).

Test types planned: integration + render.

Risk response intent (from test-plan.md section 2, Risk Response Guidance):

- Risk #1: prove that a SCREEN shows a week bounded by the days of the profile's stored zone, not by
  UTC — including for a zone the form accepts. Must challenge the assumption that "the unit tests pin
  both DST transitions": they pin a pure function, not what a screen does with a settable zone.
  Context to ground: where the stored zone is read, what happens to an unknown one, and whether the
  form and the validator share one list. Anti-patterns to avoid: a guard left inert by the runner's
  ambient zone; asserting a figure without asserting WHICH DAYS made it.

Inherited from Phase 3 (named in test-plan.md section 6.6 with this phase as owner):

- Two class-E fallbacks that degrade silently and are compensated on /settings only:
  `todayIn` answering in UTC for an unknown zone (`calendar.ts:26-35`), and
  `Intl.supportedValuesOf("timeZone")` degrading from 418 entries to a seven-entry hardcoded list
  (`timezones.ts:50-63`). Both are week-boundary-shaped, which is why they were assigned here.
- Note the CATEGORY rather than a count: test-plan.md said "three swallows are deliberate" and there
  are five (lessons.md section "The conversion constant has been miscounted twice").

## Decisions taken outside the artifacts

- **2026-08-20 — the §2 backport is DEFERRED to `/10x-test-plan --refresh`, deliberately.** Research
  surfaced four corrections to `test-plan.md` §2 (the hot-spot citation is adjacent rather than the
  anchor; "assert which days made the figure" is structurally impossible from `/dashboard`'s HTML;
  the inertness mechanism is circularity, not the ambient zone the anti-pattern column names; and
  the fallback list has seven entries, not twelve). The owner chose to leave §2 frozen: `research.md`
  already carries all four, `/10x-plan` read it in full, and Phase 4 is not blocked by any of them.
  **Do not backport them into §2 as a side effect of implementing this change** — §6 and §6.6 are
  this phase's to edit, §1–§2 are not. The 12 → 7 correction is the one exception and is Phase 4
  step 3, because a wrong number is a fact rather than a framing.

## Mutation record — Phase 1 (2026-08-21)

All three run against `tests/render/week-boundary.test.ts` and reverted with `git checkout`. Each was
read for the reason it failed, not merely for the suite turning red (`lessons.md` § "A mutation that
fails for the WRONG REASON has not confirmed the guard").

- **Mutation 1 — `dashboard.astro:43` → `weeklyTonnage(supabase, user.id, "Europe/Warsaw")`.** Red on
  the **negative-offset** test and on the cross-check, both on the `daily_tonnage` window:
  `expected 2026-07-27..2026-08-09, received 2026-08-03..2026-08-16`. The positive-offset test stayed
  **green**, which is the point of keeping two instants — a suite holding only I1 passes against this
  defect.
- **Mutation 2 — the same line → `"UTC"`.** Red on **both** instant rows, in opposite directions:
  I1/`Europe/Warsaw` received `2026-07-27..2026-08-09` where it wanted `2026-08-03..2026-08-16`, and
  I2/`America/New_York` received the reverse. That opposition is the pair's whole claim.
- **Mutation 3 — `tonnage.ts:99-100` → `.gte()` / `.lte()` with no arguments.** Red on all three
  tests with `{ gte: undefined, lte: undefined }`. `dashboard-tonnage.test.ts` stayed green at its
  full 14 tests, which is the sharpest available statement of what this file adds: the bounds S-07's
  implementation review found were guarded by nothing now have a reader.

## Mutation record — Phase 2 (2026-08-21)

- **Mutation 4 — `workouts/index.astro:23` → `todayIn("UTC")`.** Red on **both** stored-zone rows:
  the negative-offset one wanted `2026-08-09` and got `2026-08-10`, the positive-offset one wanted
  `2026-08-10` and got `2026-08-09`. **Both fallback rows stayed green**, which is the point of the
  mutation: it is what proves they pin the fallback rather than the happy path.
- **Mutation 5 — `dashboard.astro:143` printing a literal instead of `profile.timezone`.** Red on the
  unformattable-zone test alone, and on its **sentence** half (`toContain("… in Europe/Warsawa.")`),
  not on its window half — which is what the criterion asks for. Every other test stayed green.

### The plan/reality mismatch this phase found, and how it was settled

The plan put all four `/workouts` assertions at **I2** and expected Mutation 4 to redden "the two
stored-zone rows". At I2 `Europe/Warsaw` reads `2026-08-10` and **so does UTC** — the plan's own
instant table says so — so the Warsaw row there is a varied-zone control and is structurally blind to
a UTC substitution. Owner ruling, 2026-08-21: **add a fifth assertion at I1**, where Warsaw reads
`2026-08-10` against UTC's `2026-08-09`. The four I2 assertions from the contract are untouched, and
criterion 2.3 is now literally satisfiable — confirmed by the mutation above.

The instant/zone table was moved into the test file's own header for the same reason, with the
sentence a future author needs: half the zone/instant pairs prove nothing, so read the table before
adding a case.

## Mutation record — Phase 3 (2026-08-21)

- **Mutation 6 — `updateProfile` (`profiles.ts:77`) dropping `timezone` from its `update`.** Red on
  assertion 2 alone: `expected { start: '2023-08-14', … } to deeply equal { start: '2023-08-07', … }`.
  That is the read-back doing its job — the endpoint answered `200`, the column never moved, so the
  zone `weeklyTonnage` was driven by was still `Europe/Warsaw` and the set stayed in the previous
  week. Assertions 1 and 3 stayed green, correctly: neither leaves the default zone.

### The date window, re-checked rather than trusted

`grep -rn "2023-" tests/ src/ supabase/` outside this file returns **0 hits**. The suite's two windows
are `2023-06-12..2023-06-25` and `2023-07-31..2023-08-20` — seven weeks clear of each other, which
matters because this suite aggregates by date range and a name prefix protects nothing there.

### What an interrupted run actually costs, measured rather than reasoned

Criterion 3.7 asked for this to be confirmed or recorded. It was **simulated** rather than argued:
`profiles.timezone` on `rls-owner-a` was written to `America/New_York` directly, the way a Ctrl-C
between a flip and its `finally` would leave it, and read back to confirm the poisoned state. The
suite was then re-run from there — **green, 3 of 3**, and the column read `Europe/Warsaw` afterwards.

So the answer is both halves of the plan's question: an interrupted run **does** leave the column
flipped (a `finally` is application-level and a kill skips it), and `beforeAll`'s `resetPreferences`
**does** recover it on the next run. That is the split `fixture-preferences.ts` states — teardown
protects the happy path, only setup protects the next run — demonstrated instead of quoted.

## Phase 4 notes (2026-08-21)

### Criterion 4.3, and why "no occurrence survives in `context/`" is the wrong literal reading

The two **live claims** are fixed — `test-plan.md:433` and `change.md:34` now say `seven-entry`, and
§6.6 restates it by **category** rather than leaning on the number, which is the instruction
`lessons.md` § "The conversion constant has been miscounted twice" gives and which this change's own
brief had violated.

Six occurrences remain, deliberately, in three classes that a grep cannot tell apart:

- **`context/archive/2026-08-20-testing-silent-failure-audit/{plan,research}.md`** — a closed record
  of what Phase 3 believed when it wrote it. Editing an archived document to correct a fact it
  recorded rewrites history rather than fixing a claim, and the reader who needs the right number is
  served by §6.6 naming the category instead.
- **`plan.md:438`, `plan.md:486`, `research.md:341`** — the sentences that STATE the correction
  (`` `12-entry hardcoded list` → `7-entry` ``, "both say a 12-entry hardcoded list"). Editing them
  would delete the instruction and the finding.
- **`plan.md:598`** — the Progress row's own title, which `/10x-implement` forbids renaming.

Owner ruling, 2026-08-21: read 4.3 as "no live claim still says twelve", checked off on that basis.

### The full gate, run in CI order

`lint` → `typecheck` (0 errors) → `test` (249) → `test:render` (52) → `test:integration` (142) →
`test:middleware` (11) → `build` → `test:e2e` (2). All green.
