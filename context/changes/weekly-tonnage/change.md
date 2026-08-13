---
change_id: weekly-tonnage
title: See this training week's total tonnage next to last week's
status: implemented
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

S-07 on the roadmap. Outcome: the user opens the home screen and sees total tonnage for the current
training week next to the previous one, with a week that has no logged sets reading as zero and an
explanation rather than a blank.

PRD refs: US-03, FR-017. Prerequisites S-05, S-06, F-01 — all done. Parallel with S-09.

### What S-06 left S-07 — from `C:\10xdev\handoff\STATE.md` and the archived S-06 folder

- **The timezone is user-settable now, and that is what the weekly boundary stands on.** `/settings`
  writes `profiles.timezone` through `PATCH /api/profile`, validated by **membership in
  `supportedTimeZones()`**, not by shape — `todayIn` catches the `RangeError` an unknown zone raises
  and answers in UTC (`calendar.ts:29`), so a bad value would produce a wrong week boundary with
  nothing on screen saying so. S-07 inherits a closed hole, not an open one.
- **A training week is Monday–Sunday in the user's own timezone**, and `performed_on` is a calendar
  date the user stated rather than an instant. `preferences-derive.test.ts` assertion 3 proves a
  25-hour timezone swing moves no `performed_on`. **That assertion is a tripwire aimed at this
  slice**: a weekly view that derives Monday–Sunday boundaries by converting `performed_on` through
  the profile zone would turn a stored date back into an instant, and that assertion is what would
  notice. Read its comment before touching week boundaries.
- **Tonnage must sum `weight_kg`, never `weight`.** Since S-06 an account can hold both units at
  once — new sets are stamped from the profile while every set already logged keeps the unit it was
  typed in. Summing `weight` across a mixed account produces a number with no unit and no meaning,
  and nothing would catch it but a reader. `weight_kg` is generated from the set's own unit.
- **The headline figure is expressed in the reader's unit; the evidence line is shown as typed**
  (owner ruling on FR-022, 2026-08-12). A weekly total is a derived headline, so it converts.
- **Nothing derived is stored, and S-07 must keep it that way.** S-03 and S-04 refused to store a
  single derived value, which is the only reason S-06's formula change was a re-derivation rather
  than a lie about history. A tonnage cache or a materialised weekly total would undo that.
- **Aggregate in Postgres, not in the Worker.** The Workers Free plan caps CPU at 10 ms per
  invocation — a hard kill, not a throttle — and a weekly rollup that loops every set inside the
  Worker passes in week one and fails once the log grows (`AGENTS.md` § Cloudflare traps).

### CORRECTED 2026-08-13 — two claims this file inherited, both wrong

The first draft of this section (written from `STATE.md`) said Open Question 2's interface half
belongs to S-07, and that S-05's assertion 9 had proved there was nothing to recompute. **Planning
research checked both against the code and the roadmap. Neither holds.** Recorded here rather than
silently fixed, because the same merge has now propagated through three documents.

**1. Open Question 2 belongs to S-08, not here.** It asks how an exercise's muscle group is corrected
after the fact, since that rewrites historical **per-group** tonnage. The roadmap says S-08 in three
places (`roadmap.md:240` gives S-07 `Unknowns: —`; `:251` makes it S-08's only unknown; `:292` says
it "gates … the historical figures in S-08"). The schema settles it independently:
`exercise_entries` deliberately stores no muscle group, so a weekly **total** never touches
`exercises.muscle_group` at all. Changing a group moves tonnage **between** buckets and leaves the
sum bit-identical — which is exactly what US-03's own criterion ("the per-group figures sum precisely
to the week's total") requires. **S-07 must not budget a phase for it.**

The error entered at `context/archive/2026-08-11-edit-and-delete-log/plan.md:123-126`, which handed
S-07 the **FR-006 date-change** warning and Open Question 2 in one sentence. Those are two different
corrections with two different consequences. `STATE.md` copied the merged version.

**2. What FR-006 asked for IS a real S-07 question, and it is answered here.** After this slice,
moving a workout across a Monday genuinely changes two weekly totals the user has just seen.
**Owner ruling, 2026-08-13: do not warn.** Tonnage re-derives on read, nothing is stored, and a date
change is reversible. S-05 established that its dialog guards **irreversible** actions; extending it
to a reversible one is how people learn to click through the dialog that matters — the same argument
that kept S-06's preference change out of a dialog. FR-006 is closed by decision, not by omission.

**3. Assertion 9 does not prove what three documents say it proves.** `record-impact.test.ts:468-506`
asserts that `getUTCDay()` of two hardcoded constants is 0 and 1 (a fact about JavaScript), that
`performed_on` propagates through `set_estimates`, and that the record is unchanged. It computes no
week and no tonnage, and never varies the timezone. **Nothing in this repository can currently answer
which week a workout falls in** — `calendar.ts` exports only `todayIn`. So US-03's "moving a workout
recomputes both affected weeks" is genuinely uncovered, and this slice is where it gets covered.
`STATE.md:158-160,703-706` needs the same correction.

### Domain rules this slice is most likely to get wrong (`AGENTS.md` § Domain rules)

- **Zero-weight sets contribute reps but no tonnage. Negative (assisted) sets contribute zero, never
  a negative amount.** A plank at 0 and an assisted pull-up at −20 must not subtract from a week.
- **Every exercise has exactly one primary muscle group, so per-group tonnage sums exactly to the
  week's total.** Never invent weighted multi-group splits. (Per-group is S-08, but the total this
  slice ships has to be the thing S-08's parts add up to.)
- **A multi-joint lift is filed under the group the lifter has in mind**, not its anatomical mover —
  deadlift is `back`, not `legs`.

### Working mode

No subagents unless the owner asks — including for skills that spawn them by default
(`/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-impl-review`). **For this slice the owner
asked for them explicitly at planning time.** Write to the owner in Polish; documents, comments and
commit messages stay in English.

A slice whose outcome is a screen carries its own deployment phase, and the deploy phase carries an
**automatic** criterion "pushed to `origin/main` and CI green" with the run number in Progress
(`context/foundation/lessons.md`).

The gate is **six** steps since S-06: `lint` → `typecheck` → `test` → `test:render` →
`test:integration` → `build`.

### Deviations from the plan, and what they cost (implementation, 2026-08-13)

Five phases, five commits plus two write-backs. Nothing in § What We're NOT Doing was violated: no
per-group breakdown, no warning on a date change, no delta, no volume fixture, no island, no stored
derived value, no change to the two existing views, no new index, no E2E.

1. **`vitest.config.ts` pins `TZ`, which the plan did not name.** It is what makes Phase 1's mutation
   protocol mean anything: both mutations were inert under UTC, the zone CI runs in. The first pin
   chosen — `Europe/Warsaw`, the product's default — read as principled and left the second mutation
   inert, because that zone's offset is positive. `America/New_York` carries both required
   properties. Recorded in `lessons.md`.
2. **The integration suite gives every test its own pair of weeks**, which the plan did not
   anticipate. A suite that aggregates by date range cannot be isolated by a name prefix, because the
   range does not care what a row is called. Found when four assertions read each other's fixtures.
3. **The moved-workout test poisoned the fixture and had to be fixed.** It PATCHed `note: null`, and
   `updateWorkoutSchema` is a full replacement — so it cleared the very column `beforeAll` cleans up
   by. The row survived every later teardown. The orphan was deleted by hand, the test now re-sends
   its mark, and repeatability was proved by running twice rather than assumed.
4. **Mutations (a), (c) and (e) of Phase 2 needed a temporary view swap on `gymlog-test`, which
   S-06's plan review (F2) forbade.** Escalated and allowed by the owner. The two reasons behind that
   rule do not both hold here — nothing depends on `daily_tonnage`, so no drop cascades — and the
   verification gap that caused it was closed rather than ignored: each mutation went through a
   scratchpad runner that refuses a URL equal to production's, and every restore was confirmed by
   reading `security_invoker`, `GREATEST` and `weight_kg` back out of `pg_class`, not assumed.
5. **`set_count` was dropped from the view before it was written.** The plan carried it with a
   justification the review showed to be false: the view is grouped over `sets`, so a row exists iff
   the day has at least one set and the column is never `0` in an emitted row. Row presence answers
   the question; a column whose justification cannot be exercised is one a future reader assumes
   something depends on.

**Findings recorded rather than smoothed over:**

- **Phase 2's mutation (d) does not bite.** No assertion in the integration suite provokes a read
  failure and none writable from it can — the suite holds only a publishable key and cannot make the
  database unreachable. The guarantee was named as unproven **and the edit that would prove it was
  named with it**: Phase 3's render assertion. Phase 3 then proved it.
- **Plan-review finding F20 was stale.** It said `AGENTS.md` claims a five-step gate and `README.md`
  omits `test:render`. Both were corrected in S-06's Phase 5; nothing was "fixed" here.
- **The `KG_PER_LB` count has now been miscorrected twice** — once to three, once to four — by
  readers grepping the literal. There are **two copies in production code**, which is what the rule is
  about, plus three integration fixtures that restate it deliberately to check the generated column
  from outside. `AGENTS.md` now says "two in production" and explains why a bare count is wrong.

**Deployed**: Worker `20e74767-c789-417c-8c90-4dbec665d892` at 100% of traffic, CI **#51** green for
`d4548bb`. Tests: **211 unit, 103 integration, 18 render**.
