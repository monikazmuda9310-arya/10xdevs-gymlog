# Tonnage Breakdown Implementation Plan

## Overview

S-08 answers the question the weekly total cannot: **where did the week's work go?** The current
training week's tonnage is broken down per exercise (FR-018) and per muscle group (FR-019), on the
home screen, beside the two totals S-07 already renders — with the group figures summing exactly to
the week's total (US-03).

The slice adds one view, one pure fold, one section on `/dashboard`, and one label map promoted out
of a component. It changes nothing S-07 built.

## Current State Analysis

**What exists and works.** `public.daily_tonnage` (S-07) emits one row per account per day —
`sum(reps * greatest(weight_kg, 0))` — and never joins `exercises`, which is exactly why a weekly
total is blind to muscle groups. `weeklyTonnage` in `src/lib/services/tonnage.ts` folds at most
fourteen of those rows into two `WeekTonnage` values, throwing in five places rather than answering
zero. `/dashboard` reads `profiles` (unfiltered — F-03's RLS demonstration) and `daily_tonnage`, and
carries one failure flag for the whole tonnage domain.

**What is missing.** Nothing in the repository knows which exercise or which muscle group a
kilogram belongs to. `muscle_group` lives on `public.exercises` and is reachable only by joining —
and `exercise_entries` deliberately snapshots nothing, which is what keeps a group correction a
re-derivation rather than a data migration.

**The constraint that shapes everything.** The range predicate descends to
`workouts_user_performed_on_idx` only while the filter is on GROUP BY columns. `(user_id,
performed_on, exercise_id)` keeps that property; `(user_id, exercise_id)` filtered by a date range
does not. So the new view groups by day and the Worker folds, exactly as S-07 does.

### Key Discoveries:

- **The join to `public.exercises` can delete tonnage silently, and that is the exact failure this
  slice exists to prevent.** `exercise_entries.exercise_id references exercises (id)` is
  single-column and **not** ownership-scoped
  (`20260811005248_create_workout_log_with_row_ownership.sql:59`), foreign-key checks do not go
  through RLS, and `addExerciseEntry` (`src/lib/services/workouts.ts:150-154`) inserts the id with
  no visibility check. So a row _can_ exist pointing at another account's private exercise. Under
  `security_invoker = true` an **inner** join to `exercises` — whose select policy is
  `user_id is null or (select auth.uid()) = user_id` — drops that set's tonnage for the account that
  logged it, while `daily_tonnage` still counts it. The breakdown then fails to reconcile, with no
  error anywhere.
- **The float trap nobody has hit yet.** Both views sum in `numeric`, which is exact. The Worker
  sums in `double`: totalling per-day rows and totalling per-exercise rows are two different
  summation orders over the same values, so they may differ in the last bits. **A reconciliation
  assertion or guard written as `===` is a defect**; the comparison needs a stated tolerance.
- **Reconciling the kilograms does not reconcile the SCREEN, and the screen is where the user checks
  it.** `tonnageFigure` (`src/lib/services/tonnage-display.ts:37-41`) rounds to **whole units**, pinned
  by `tonnage-display.test.ts`. Rounded independently, a week of `100.5 kg` split as `33.5 / 33.5 /
33.5` prints `101` above and `34 + 34 + 34 = 102` below; across seven rows the visible drift reaches
  ±3–4 units and is larger in pounds, where conversion multiplies the residuals. **Found by plan
  review (F1); the owner ruled on 2026-08-14 that the column must add up** — the rows are apportioned
  by largest remainder against the rounded total.
- **S-07's `=== 14` cannot be carried over.** A breakdown at `(day, exercise)` grain returns
  `days × distinct exercises per day` rows — bounded by training habit, not by a constant.
- **`tests/render/dashboard-tonnage.test.ts` holds three tripwires aimed here**: a stub that
  `throw`s on an unstubbed table (`:60-64`), `expect(both).not.toContain("<astro-island")`
  (`:129-133`), and `FIGURE_CLASS` counted exactly twice (`:93`, `:158-163`). The first is a wanted
  failure; the second must keep passing; the third must not be tripped by reusing the class string.
- **There is no shared muscle-group label map.** `GROUP_LABELS` is private to
  `src/components/exercises/ExerciseCatalogue.tsx:11-18`; `/records:74`, `ExercisePicker.tsx:85` and
  `WorkoutDetail.tsx:335` print the raw lowercase enum. The repository already reads "Shoulders" on
  one screen and "shoulders" on another.
- **`preferences-derive.test.ts:343-346` names S-08 as the plausible author of "widening
  `daily_tonnage` to derive a week in SQL".** This plan does not do that, so the comment needs
  re-aiming or the tripwire it labels becomes decoration.

## Desired End State

A signed-in user opens `/dashboard` and sees, under the two weekly totals:

- six muscle-group rows for the current week, largest first, each with a proportional bar, each in
  the user's own unit — and a seventh **Unattributed** row only when tonnage exists that this
  account can no longer name;
- the current week's exercises, largest first, each with its tonnage;
- group figures that sum to the week's total, **enforced at read time**: a breakdown that does not
  reconcile is not shown at all.

Verified by: `npm run test:integration` (the breakdown reconciles against `daily_tonnage` on a
fixture built for the purpose, including one row pointing at an unreadable exercise), `npm test` (the
fold's guards), `npm run test:render` (the section renders, ships no island, degrades correctly), and
a signed-in look at the deployed URL.

## What We're NOT Doing

- **No edit path for `muscle_group`** (owner decision, 2026-08-14 — PRD Open Question 2). The
  semantics are settled and recorded: a correction is **retroactive by construction**, moving tonnage
  **between** buckets and leaving the weekly total bit-identical. Shipping `PATCH
/api/exercises/[id]` is a separate slice.
- **No snapshot of `muscle_group` onto `exercise_entries`** — the option that would make corrections
  forward-only. It was considered and declined: it contradicts
  `20260811005248…:71-76` ("No muscle_group column, and that absence is load-bearing") and turns a
  re-derivation into stored state.
- **No change to `public.daily_tonnage`, to `weeklyTonnage`, or to either weekly total's FIGURE.**
  The read path already serving production is untouched. One exception, stated here rather than left
  to be found as a contradiction (plan review F5): Phase 3 adds the **missing "no external load"
  sentence** beside those figures — the gap `tonnage-display.test.ts:46-51` already claims is closed
  and which `dashboard.astro:115-117` shows is not. A sentence, never a number.
- **No `date_trunc('week', …)` and no SQL reference to `profiles.timezone`**, here or anywhere.
- **No charting library, no `<table>`, no hydrated island.** The breakdown is static HTML.
- **No new route.** US-03 puts the breakdown on the home screen.
- **No historical weeks.** The breakdown covers the **current** week only, as US-03 states; last
  week keeps its total and nothing else.
- **No percentages printed as numbers.** The proportional bar is presentation; the number on the row
  is tonnage.

## Implementation Approach

**One new view, additive, at `(user_id, performed_on, exercise_id)`, with a `left join` to
`exercises`.** `daily_tonnage` stays exactly as it is. The two SQL copies of
`sum(reps * greatest(weight_kg, 0))` are a weaker instance of this repository's documented
two-implementations hazard than the 1RM `case` expression or `0.45359237`, for a reason worth stating
rather than assuming: **both copies live in migration files, which are append-only and never
edited**, and an integration assertion compares the two views' figures directly — an assertion that
would be a tautology under the nested alternative. Each migration header names the other copy and the
rule: if the tonnage expression ever changes, both change in the same migration.

**Reconciliation is defended in three layers, not one:**

1. **Structural** — `left join`, so no set's tonnage can be filtered out of the aggregate by
   `exercises`' RLS policy. An unreadable exercise yields `muscle_group is null` and keeps its
   kilograms.
2. **At read time** — `foldBreakdown` compares its own sum against the week total that
   `weeklyTonnage` already produced and **throws** when they differ by more than a stated tolerance.
   A breakdown that does not add up is never rendered.
3. **In CI** — the integration suite builds the hazard row deliberately (account A's entry pointing
   at account B's private exercise) and asserts both that the tonnage survives and that the two views
   agree.

**A breakdown failure degrades the breakdown only.** The two totals are S-07's proven feature and
stay on screen; the breakdown section shows its own sentence. This follows S-05's
`impact_unavailable` ruling — the reliable thing stays, the unknown one says it is unknown — rather
than S-07's page-level flag.

## Critical Implementation Details

**Ordering.** `npm run db:push` writes to **both** projects (there is no single-target push), and
`npm run db:types` reads the **production** schema. So Phase 1 pushes the migration to both databases
and regenerates types before Phase 2 can compile against the new view. The migration is purely
additive and the deployed Worker does not read the view, so production carrying it ahead of the
deploy is safe.

**The reconciliation tolerance is a float artefact, not a data allowance.** State it as such where it
lives: `numeric` in Postgres is exact, `double` in the Worker is not, and the two summation orders
are what differ. A tolerance of `0.001` kg is three orders of magnitude below the display resolution
(whole units) and many orders above the achievable float error, so it cannot mask a real
discrepancy — a single dropped set would be off by kilograms, not by grams. **The integration suite
compares within `1e-6`, a thousand times tighter, and the asymmetry is deliberate**: the suite sums a
fixture of a few dozen sets, where the achievable error is far below a microgram, so a looser bound
there would hide a real defect the runtime guard cannot afford to reject. Say so in both places —
two similar decisions made differently and silently is what leaves the next reader guessing
(`lessons.md`).

**The screen rounds separately from the arithmetic, so it needs its own reconciliation.** The
kilograms reconcile inside `foldBreakdown`; the printed figures reconcile only if they are rounded
**together**, by largest remainder against the rounded total. Both lists need it — group rows and
exercise rows each sum to the whole week, since every exercise belongs to exactly one group.

**The row-count guard must not become a `.limit()`.** S-07's own words: "a limit is a silent
truncation, which is the same defect wearing a seatbelt". The guard throws, and because a breakdown
failure degrades only the breakdown, an implausibly wide day costs the user the breakdown and keeps
their totals.

## Phase 1: The view and the proof that it reconciles

### Overview

Add `public.daily_exercise_tonnage`, push it to both projects, regenerate types, and pin its
behaviour with an integration suite that builds the reconciliation hazard on purpose.

### Changes Required:

#### 1. The breakdown view

**File**: `supabase/migrations/20260814090000_derive_daily_exercise_tonnage_from_sets.sql` (new)

**Intent**: One row per account per day per exercise, carrying that exercise's name and muscle group
as they stand today, so the muscle group is joined at read time and never stored. Purely additive:
no table, no column, no index, no change to any existing object.

**Contract**: `public.daily_exercise_tonnage (user_id, performed_on, exercise_id, exercise_name,
muscle_group, tonnage_kg)`, grouped by `s.user_id, w.performed_on, ee.exercise_id, x.name,
x.muscle_group`; `sets → exercise_entries → workouts` joined on `(id, user_id)` pairs exactly as
`daily_tonnage` does, and `exercises` joined **`left join x on x.id = ee.exercise_id`**. Created
`with (security_invoker = true)`, with `comment on view`, `revoke all … from anon, authenticated`,
`grant select … to authenticated`, `notify pgrst, 'reload schema'` — the same five-step shape all
three existing views use.

The header must carry, in this order:

- **Why `left join` and not `join`** — the un-scoped FK, the `exercises` select policy, and the fact
  that an inner join deletes a set's tonnage from its own owner's breakdown with no error. Name the
  assertion that proves it.
- **The second copy of the tonnage expression** — name `daily_tonnage`, say why the duplication is
  tolerable here (append-only files, plus a direct cross-view assertion), and state the rule: if the
  expression changes, both change in the same migration.
- **`security_invoker = true` is load-bearing, not a tripwire** — this view reads `sets`,
  `exercise_entries`, `workouts` and `exercises` directly, so it stands where `daily_tonnage` and
  `set_estimates` stand, not where `personal_records` does.
- **The grain and the pushdown** — `user_id` and `performed_on` are both GROUP BY columns, so the
  application's filter still travels on `workouts_user_performed_on_idx`; `exercise_id` joins
  `exercises` by primary key, so no new index is needed and no fan-out is possible.
- **What this view still does not know** — what a week is, what a timezone is. No `date_trunc`, no
  `profiles.timezone`. Copy S-07's paragraph by reference, not by rewriting it.
- **NOT MEASURED, AND SAID SO** — `gymlog-test` holds a few dozen sets; no query plan taken here
  would mean anything. Inherited from S-04 unchanged.

#### 2. Generated types

**File**: `src/db/database.types.ts` (regenerated, never hand-edited)

**Intent**: Make the new view's columns visible to TypeScript. Every column arrives `T | null`,
because Postgres cannot prove not-null through a view — narrowed once, in Phase 2's service.

**Contract**: `npm run db:push` then `npm run db:types`.

#### 3. The integration suite

**File**: `tests/integration/tonnage-breakdown.test.ts` (new)

**Intent**: Prove the breakdown reconciles with the weekly total under the conditions that could
break it, including the one that cannot happen through the UI but can happen in the database.

**Contract**: MARK `s08-` (free, and neither a prefix of nor prefixed by any existing mark). Its own
date anchors, because a suite filtering by **range** cannot rely on a name prefix — and **one anchor
per assertion that needs its own window**, mapped explicitly, because the failure mode here is not a
red suite but two assertions quietly reading each other's fixtures and both passing for the wrong
reason (plan review F3; `weekly-tonnage.test.ts` needed seven anchors for eight assertions for this
reason). All Wednesdays, exactly 4 weeks apart, in months no other suite writes to — 2024 is entirely
free and `weekly-tonnage` holds June–December 2025:

| Anchor       | Assertion(s)                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `2024-12-11` | 7 and 8 — both access probes over one fixture, sharing deliberately: neither mutates, and separating them would prove nothing |
| `2025-01-08` | 1 and 2 — the same fixture is the subject of both by design: SQL reconciliation and the independent TypeScript sum            |
| `2025-02-05` | 3 — mixed units in one workout                                                                                                |
| `2025-03-05` | 4 — zero-load and assisted sets                                                                                               |
| `2025-04-02` | 5 — two workouts, one date, one exercise                                                                                      |
| `2025-04-30` | 6 — the moved workout. **Its own window, non-negotiable**: it mutates `performed_on`                                          |
| `2025-05-28` | 9 — the unreadable-exercise hazard. **Its own window**, so that mutation (a) reddens this assertion and nothing else          |

Fixtures write **directly to the tables** (the
`/api/sets` endpoint stamps the unit from the profile, and one assertion needs both units in one
workout). Fixture exercises always carry a `user_id` — `exercises-rls.test.ts` asserts
`toHaveLength(38)` over `user_id is null`. `beforeAll` resets preferences, then deletes `workouts` by
note prefix **before** `exercises` by name prefix (`on delete restrict` makes the other order fail).
Restore in a `finally`, and re-send the mark rather than nulling the column the cleanup keys on.

Nine assertions:

1. **The breakdown sums to `daily_tonnage` over the same week**, within `1e-6` — read both views for
   the same window and compare. This is US-03's headline criterion.
2. **An independent TypeScript sum of the fixture**, per group and per exercise — the compensating
   control S-07 assertion 1 plays for the total, since these figures are computed by SQL and
   displayed. That sum lives in the test and must never move into `src/`.
3. **`weight_kg`, not `weight`** — one workout carrying a kg set and a lb set; the naive
   `sum(reps * weight)` must **not** match (`not.toBeCloseTo`).
4. **Zero-load and assisted sets** — an exercise logged only at zero and negative load emits a row
   with `tonnage_kg === 0`, never a negative amount, and its group row is `0` rather than absent.
5. **Two workouts on the same date with the same exercise fold into one row** — `unique
(workout_id, exercise_id)` permits this and grouping (not "one entry per day") is what handles it.
6. **Moving a workout across a Monday moves its tonnage between weeks in the breakdown**, and both
   weeks still reconcile — US-03's recompute criterion at the new grain.
7. **The `security_invoker` guard** — account B naming account A's `user_id` **directly against the
   view**, not through a service whose own `.eq()` would filter a leak before B saw it. Zero rows.
8. **The anonymous path** — `data === null`, `error.code === "42501"`.
9. **The reconciliation hazard, constructed rather than described** — account A inserts an
   `exercise_entries` row (its own `user_id`, its own workout) whose `exercise_id` names account B's
   **private** exercise, then logs a set under it. Assert: A's breakdown still carries that tonnage
   with `muscle_group === null` and `exercise_name === null`, **and** that the two views still agree
   **in this assertion's own window** — the equality of assertion 1, re-made here over the fixture
   that can actually break it. This is the only assertion in the repository that would notice the
   `left join` being "simplified" to a `join`.

#### 4. Re-aim the comment that names this slice

**File**: `tests/integration/preferences-derive.test.ts:343-346`

**Intent**: The comment anticipates S-08 widening `daily_tonnage` to derive a week in SQL. S-08 did
not, and will not — so the comment must name what it actually guards now, or the tripwire it labels
becomes decoration.

**Contract**: Comment text only; no assertion changes.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies the migration to `gymlog-test` and `gymlog`, and `npm run db:status`
  shows both histories at the same version
- `npm run db:types` regenerates `src/db/database.types.ts` with the new view under `Views`
- `npm run lint` and `npm run typecheck` pass
- `npm run test:integration` passes, and passes again on an immediate second run (fixture
  repeatability)
- Mutation (a): `left join` → `join` fails **assertion 9 and only assertion 9**, and the failure text
  shows that assertion's breakdown sum _below_ its own window's `daily_tonnage` total by exactly the
  hazard set's tonnage — not merely a red suite. **Assertion 1 must stay green**: its window holds no
  unreadable exercise, and forcing the hazard fixture into it would make an access defect and an
  arithmetic defect indistinguishable, which is what `weekly-tonnage.test.ts:344-347` says never to do
- Mutation (b): removing `security_invoker = true` fails assertion 7, with account B receiving
  account A's rows
- Mutation (c): removing `greatest(…)` makes the assisted-set row negative and fails assertion 4
- Mutation (d): `weight_kg` → `weight` fails assertion 3

#### Manual Verification:

- `npm run db:status` output pasted into Progress, showing the two projects at the same migration

**Implementation Note**: After completing this phase and all automated verification passes, pause for
confirmation before Phase 2. Record each mutation's **failure text**, not just its colour — a
mutation that fails for the wrong reason has confirmed nothing (`lessons.md`).

---

## Phase 2: The fold, its guards, and one label map

### Overview

Turn view rows into what a screen needs, in a pure module the hermetic unit suite can reach in full —
S-07's equivalent guards were unreachable from the unit suite, and this phase does not repeat that.
Promote the muscle-group labels out of the component that owns them today.

### Changes Required:

#### 1. The pure fold

**File**: `src/lib/services/tonnage-breakdown.ts` (new)

**Intent**: Fold `(day, exercise)` rows into per-group and per-exercise totals for one week, and
refuse to produce a breakdown that does not reconcile with the week total already on screen. Pure and
dependency-free — no `astro:*` import, no Supabase client — so every guard is unit-testable with
injected rows.

**Contract**:

```ts
export interface ExerciseTonnage {
  exerciseId: string;
  name: string | null;
  muscleGroup: MuscleGroup | null;
  kilograms: number;
}
export interface GroupTonnage {
  group: MuscleGroup | null;
  kilograms: number;
  hasSets: boolean;
}
export interface WeekBreakdown {
  groups: GroupTonnage[];
  exercises: ExerciseTonnage[];
  kilograms: number;
}

export function foldBreakdown(rows: BreakdownRow[], week: DateRange, weekTotalKg: number): WeekBreakdown;
```

Rules the guards enforce, each with its own `throw`:

- a row outside `week` — the query promised a window, so a row outside it is a broken promise
  (S-07's reason, verbatim in intent);
- a null `performed_on`, `exercise_id` or `tonnage_kg` — a read error, never a row worth nothing;
- more than `MAX_BREAKDOWN_ROWS = 7 * 30` rows — a day with thirty distinct exercises is not a
  training day. A `throw`, never a `.limit()`;
- a non-finite sum;
- `Math.abs(sum − weekTotalKg) > RECONCILIATION_TOLERANCE_KG` (`0.001`) — the layer that makes
  "sums to the penny" a runtime property rather than a claim.

Shape rules: **all six groups are always present**, so an untrained group reads as `0` and the
imbalance FR-019 exists to show is visible; the **null group** appears only when it carries tonnage,
and is the `Unattributed` row. Ordering is descending by kilograms, ties broken by the canonical
`MUSCLE_GROUPS` order (groups) and by name (exercises) — deterministic, so a render test can assert
positions. `hasSets` per group comes from row presence, exactly as `WeekTonnage.hasSets` does: a
group of planks has sets and zero kilograms and must not be told it was untrained.

#### 2. The read

**File**: `src/lib/services/tonnage.ts`

**Intent**: Add the breakdown read beside `weeklyTonnage` without touching it. I/O only — every
decision lives in `foldBreakdown`.

**Contract**: `export async function weeklyBreakdown(supabase, userId, week: DateRange,
weekTotalKg: number): Promise<WeekBreakdown>` — asserts the window is 7 days, selects
`performed_on, exercise_id, exercise_name, muscle_group, tonnage_kg` from `daily_exercise_tonnage`
with `.eq("user_id", …).gte(…).lte(…)` (the policy is the guarantee, the filter is the index path),
throws on a PostgREST error, and delegates. The module header gains a paragraph: the same two
rule-exemptions S-07 claimed apply here, and the bound is now `days × exercises per day`, guarded by
`MAX_BREAKDOWN_ROWS` rather than by a constant `14`.

#### 3. The figures that add up

**File**: `src/lib/services/tonnage-display.ts`

**Intent**: Round the breakdown rows **together** rather than one at a time, so the column on screen
sums to the total printed above it. Owner decision, 2026-08-14, on plan-review finding F1: given the
choice between a row that is individually truthful and a column that adds up, the column wins —
because adding the rows up is the only check the user can actually perform, and US-03's criterion is
about exactly that.

**Contract**: `export function apportionedFigures(kilograms: number[], totalKilograms: number, unit:
WeightUnit): string[]` — converts every value and the total through `kilogramsIn`, floors each row,
then distributes the remaining whole units by **largest remainder** until the rows sum to
`Math.round(convertedTotal)`. Returns finished strings formatted exactly as `tonnageFigure` does, so
one formatting decision serves both. `tonnageFigure` itself is untouched and keeps serving the two
weekly totals.

The module header gains a paragraph stating the cost plainly, because it is a second answer to
"what does this row round to": **a row can read one unit away from its own independently rounded
value**, and that is the deliberate price of the column reconciling. Name the alternative that was
declined (independent rounding plus an on-screen admission that the column drifts) and who declined
it.

#### 4. The label map, promoted

**File**: `src/lib/validation/exercise.ts`, then `ExerciseCatalogue.tsx:11-18`, `src/pages/records.astro:74`,
`src/components/workouts/ExercisePicker.tsx:85`, `src/components/workouts/WorkoutDetail.tsx:335`

**Intent**: One name per muscle group, in one place, so a seventh enum value cannot reach a screen
unnamed — and so the repository stops reading "Shoulders" on one screen and "shoulders" on another.
Rewiring all four call sites rather than only the new one is the **owner's decision, 2026-08-14**.

**Contract**: `export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string>` in
`src/lib/validation/exercise.ts`, typed as a `Record` over the enum for the reason
`WEIGHT_UNIT_LABELS` is (`src/lib/validation/profile.ts:42-67`). That module imports only
`MUSCLE_GROUPS` and stays import-light, because two of the four call sites are `client:load` islands.
`GROUP_LABELS` is deleted, not left beside it.

**Three of the four call sites hold a non-null `MuscleGroup`; `records.astro:74` does not** (plan
review F9). Its value comes from `listPersonalRecords`, i.e. the `personal_records` **view**, and
every view column is generated as nullable — so the lookup needs a narrowing there. **The fallback on
`/records` is the raw value, never `Unattributed`**: a null there is a read anomaly, while
`Unattributed` is a specific claim about tonnage whose exercise this account cannot read, and it
belongs to the dashboard breakdown alone.

#### 5. Unit tests

**File**: `src/lib/services/tonnage-breakdown.test.ts` (new); `src/lib/services/tonnage-display.test.ts`
(extended); `src/lib/validation/exercise.test.ts` (extended)

**Intent**: Cover every guard and every shape rule, with rows injected — the coverage S-07 could not
have because its guards sat behind a Supabase client.

**Contract**: one assertion per guard (window, null column, row cap, non-finite, reconciliation
tolerance — including that a difference of `0.0005` kg passes and one of `0.5` kg throws), plus:
six groups always present; the null group present only when it carries tonnage; descending order with
the canonical tie-break; `hasSets` true for a zero-kilogram group that has rows and false for one
that has none; a zero-total week producing no division by zero.

In `tonnage-display.test.ts`, `apportionedFigures`: **the case where naive rounding fails** — three
rows of `33.5` against a total of `100.5`, which must print `101` and three rows summing to `101`,
never `102`; the same case converted to pounds; a zero total; a single row; and a row list that
already rounds exactly, which must be left alone. In `exercise.test.ts`, that every `MUSCLE_GROUPS`
value has a label.

### Success Criteria:

#### Automated Verification:

- `npm test` passes with the new unit file
- `npm run lint` and `npm run typecheck` pass
- Mutation (e): raising `RECONCILIATION_TOLERANCE_KG` to `1000` fails the tolerance assertion —
  confirming the guard, not the arithmetic
- Mutation (f): dropping the six-groups-always-present rule fails the shape assertion, and dropping
  `hasSets` fails the planks assertion
- Mutation (h): replacing `apportionedFigures` with independent `tonnageFigure` calls fails the
  `33.5 / 33.5 / 33.5` assertion with rows summing to `102` against a total of `101` — the exact
  arithmetic plan review F1 found
- `grep -rn "GROUP_LABELS" src/` returns only `MUSCLE_GROUP_LABELS` and its importers

#### Manual Verification:

- `/exercises`, `/records` and `/workouts/[id]` all render the same capitalised group names after the
  rewire (checked in `astro dev`, read-only pages)

**Implementation Note**: Pause for confirmation before Phase 3.

---

## Phase 3: The section on the home screen

### Overview

Render the breakdown under the two totals, static, in the reader's unit, degrading on its own without
taking the totals with it — and update the render suite that was written in anticipation of this.

### Changes Required:

#### 1. The dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Add a third read and a breakdown section. The card is a shrink-to-fit centred box today;
six group rows and an exercise list need a width.

**Contract**: the frontmatter calls `weeklyBreakdown(supabase, user.id, tonnage.current,
tonnage.current.kilograms)` **only when the tonnage read succeeded**, inside its own `try` with its
own `breakdownFailed` flag — an Astro frontmatter that throws produces a 500, not a page, and the
totals must survive a breakdown failure. The card gains a `max-w-2xl` while staying centred. Rows use
their own classes and **must not reuse** `text-2xl font-semibold text-purple-200`, which the render
suite counts. Group rows carry a proportional bar (`aria-hidden`, width from share of the week total,
guarded against a zero total). Figures go through **`apportionedFigures`** — one call for the group
rows and one for the exercise rows, each against the current week's total — so the printed column
adds up; the two weekly totals keep using `tonnageFigure`. A derived headline takes the reader's unit
(owner ruling on FR-022, 2026-08-12).

Sentences this phase introduces or fixes:

| State                                        | Sentence                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| breakdown read failed                        | `Your breakdown could not be loaded. The totals above are unaffected.`                                                 |
| group with no sets this week                 | `No sets`                                                                                                              |
| week or group with sets but no external load | `Sets logged, no external load`                                                                                        |
| tonnage that cannot be attributed            | row label `Unattributed`, with a one-line explanation that an exercise behind it is no longer readable by this account |

The third row closes a gap S-07 left and that `tonnage-display.test.ts:46-51` already claims exists:
today a week of planks renders a bare `0` and the sentence that comment describes does not exist. It
applies to the week figures and to group rows alike — a sentence beside the totals, never a change to
them, per the scope note in § What We're NOT Doing.

#### 2. The render suite

**File**: `tests/render/dashboard-tonnage.test.ts`

**Intent**: Extend the stub to the third table — its `throw` on an unstubbed table is a **wanted**
failure, written for exactly this moment — and assert the new states.

**Contract**: the stub dispatches `daily_exercise_tonnage` to a chain shaped
`select().eq().gte().lte()`, with a `"throw"` mode as `daily_tonnage` has.

**Two couplings the suite creates and must state, both found by plan review (F4).** First,
`foldBreakdown` **throws** unless its rows sum to the week total within the tolerance, and the
existing fixture is `ROWS = [{current, 12345.7}, {previous, 9000}]` (`:97-100`) — so every breakdown
stub for the `both` and `oneEmpty` renders must sum to **exactly `12345.7`**, or the page renders the
breakdown-failure sentence and every new assertion silently tests the failure path. Second,
`expect(inPounds).not.toContain("12,346")` and `not.toContain("9,000")` (`:142-143`) are whole-page
substring guards, and this phase puts six or seven more formatted figures on that page: **the stub's
breakdown values must be chosen so no row formats to either string**, or a passing guard fails for a
reason unrelated to what it guards. Say both in the fixture's comment, not only in this plan.

Assertions kept
unchanged: no `<astro-island>`, and `FIGURE_CLASS` counted exactly twice. Assertions added: the six
group labels render in descending order; an `Unattributed` row appears when `muscle_group` is null
and not otherwise; a failed **breakdown** read renders its own sentence **while both totals stay on
screen** (the degrade rule — the assertion that would catch someone reusing S-07's page-level flag);
a group with rows and zero kilograms reads `0` with `Sets logged, no external load` rather than
`No sets`.

### Success Criteria:

#### Automated Verification:

- `npm run test:render` passes, including the retained no-island and two-figure assertions
- `npm test`, `npm run lint`, `npm run typecheck` pass
- Mutation (g): making the breakdown failure set the page-level `tonnageFailed` flag fails the
  degrade assertion — both totals disappear where the suite requires them
- The full six-step gate passes once, before the commit: `lint → typecheck → test → test:render →
test:integration → build`

#### Manual Verification:

- On `astro dev`, signed in: **the group figures added up by hand equal the "This week" figure
  exactly**, in kilograms and again in pounds — the check `apportionedFigures` exists to make true,
  and the one the user will perform
- The bars read as a shape rather than as noise
- Switching `/settings` to pounds changes the totals **and** every breakdown row together
- A **group** whose only sets this week are planks reads `0` with `Sets logged, no external load`,
  while an untrained group reads `0` with `No sets`. Stated at group level because only the current
  week is broken down, so a "fresh week" precondition is unreachable in the session that logs the
  other fixtures (plan review F5)

**Implementation Note**: Pause for confirmation before Phase 4.

---

## Phase 4: Deploy and prove it on the public URL

### Overview

A slice whose outcome is on a screen carries a phase that deploys it and verifies it at the public
address (`lessons.md`). A green gate and a green CI run are both blind to this.

### Changes Required:

#### 1. Build and deploy

**File**: — (no source change)

**Intent**: Put the section in front of the owner on the deployed Worker.

**Contract**: `npm run build`, then `npx wrangler deploy`. The migration is already on production
from Phase 1 and was additive, so no schema step remains. Record the new Worker version id in
Progress.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npx wrangler deploy` reports a new version at 100% of traffic, and the id is recorded in Progress

#### Manual Verification:

- Signed in at `https://gymlog.10x-astro-starter.workers.dev/dashboard`: the breakdown renders under
  the totals, and the group rows sum to the week's total on screen
- The page still shows both totals if the breakdown is empty (a week with no sets)

**Implementation Note**: Pause for confirmation before Phase 5.

---

## Phase 5: Documents

### Overview

Record what this slice decided, including the two owner decisions, so the next reader inherits one
decision per sentence.

### Changes Required:

#### 1. The agent contract

**File**: `AGENTS.md`

**Intent**: Add what a future agent must not get wrong: the new view, why its `left join` is
load-bearing, the two copies of the tonnage expression, and the reconciliation guard.

**Contract**: under § Known state, `public.daily_exercise_tonnage` joins the three existing views,
with its `security_invoker` role stated as a **guard** (it reads base tables directly). Under
§ Domain rules, one paragraph: **a join to `exercises` inside a `security_invoker` view is filtered
by that table's RLS policy, so an inner join silently deletes tonnage from its owner's own
breakdown** — with the assertion that proves it named. Under the same section: a muscle-group
correction is retroactive by construction and cannot move the weekly total.

**And the two-copies rule, in `AGENTS.md` rather than only in the migration header** (plan review
F8): `sum(reps * greatest(weight_kg, 0))` now exists in **two migrations and they must agree**,
beside the two instances this file already documents (the 1RM `case` expression and `0.45359237`).
The migration header is reachable only from the newer of the two files, so a future migration
changing the tonnage rule would have no pointer back. Name the cross-view assertion that pins the
agreement, and say that this instance is weaker than the other two because migration files are
append-only — the day something replaces a view, it stops being weaker.

#### 2. The reader-facing description

**File**: `README.md`

**Intent**: Describe what `/dashboard` now shows and what reconciles with what.

**Contract**: the `/dashboard` row in § Routes, and a short block under § Weekly tonnage covering the
breakdown, the reader's unit, the `Unattributed` row, and "a breakdown that does not reconcile is not
shown".

#### 3. The PRD open question

**File**: `context/foundation/prd.md` § Open Questions #2

**Intent**: Close it with the owner's decision and its reasoning, in the form #1 already uses.

**Contract**: struck through and marked **RESOLVED (owner, 2026-08-14)**: corrections are
**retroactive** — historical per-group figures move, the weekly total does not, because
`exercise_entries` stores no group. The rejected alternative (snapshotting the group onto the entry,
making corrections forward-only) is recorded with its reason. Note that **no edit path exists yet**
and that shipping one is a separate slice.

#### 4. The lesson

**File**: `context/foundation/lessons.md`

**Intent**: Register the class of defect this slice was built around, since it generalises past
tonnage.

**Contract**: one entry — **"Under `security_invoker`, a JOIN is a FILTER: an inner join to an
RLS-protected table deletes rows from an aggregate and reports success."** Context, problem, rule
(`left join` plus a reconciliation guard at read time, and construct the hazard row in the suite
rather than describing it), applies-to (every view joining a table with a select policy, and every
aggregate whose figure is claimed to reconcile with another).

#### 5. The contract state

**File**: `C:\10xdev\handoff\STATE.md`

**Intent**: Move the contract forward: eleven of twelve delivery items, S-08 closed, S-09 next.

**Contract**: update § Gdzie jesteśmy, the test counts, the CI run, the Worker version, and replace
§ NASTĘPNY KROK with S-09. Add a "what S-08 left S-09" section — one decision per sentence, per
`lessons.md`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (prettier formats the markdown through lint-staged on commit)
- `grep -n "RESOLVED (owner, 2026-08-14)" context/foundation/prd.md` matches — the stamp, not the
  phrase "Open Question 2", which already appears inside Open Question **1** (`prd.md:407`) and would
  make the criterion pass before any edit (plan review F6)

#### Manual Verification:

- The owner confirms the PRD resolution says what they decided, in their words

---

## Testing Strategy

### Unit Tests:

- Every `foldBreakdown` guard, with injected rows: window, null column, row cap, non-finite,
  reconciliation tolerance at both sides of the threshold
- Shape: six groups always, null group only when it carries tonnage, descending order with the
  canonical tie-break, `hasSets` for the zero-load group, zero-total week
- Every `MUSCLE_GROUPS` value has a label

### Integration Tests:

- The nine assertions in Phase 1, the first and ninth of which carry US-03's headline criterion
- Re-run the whole suite twice in a row to prove fixture repeatability

### Manual Testing Steps:

1. Sign in on the deployed URL and log a workout dated **today** with three exercises across three
   different muscle groups.
2. Open `/dashboard` and add the group rows by hand — they must equal the "This week" figure exactly,
   and so must the exercise rows.
3. Switch `/settings` to pounds; every figure on the page changes together.
4. Add a plank at zero load to today's workout; the `core` row reads `0` with `Sets logged, no
external load`, while every untrained group reads `0` with `No sets`.
5. Delete the workout; the breakdown empties and both totals stay on screen.

## Performance Considerations

The Worker folds at most `MAX_BREAKDOWN_ROWS` (210) rows for one week, and the per-set arithmetic
stays in SQL — the same exemption S-07 argued, with its bound named and asserted rather than assumed.
The range predicate still descends to `workouts_user_performed_on_idx` because `user_id` and
`performed_on` remain GROUP BY columns; `exercises` is reached by primary key, so no new index is
needed. **None of this is measured, and it cannot be here**: `gymlog-test` holds a few dozen sets,
where a sequential scan is correct and any plan taken would prove nothing. Inherited from S-04
unchanged.

## Migration Notes

Purely additive. `npm run db:push` applies the view to `gymlog-test` and then `gymlog`; the deployed
Worker does not read it until Phase 4, so the two databases carrying it ahead of the deploy is safe
and is the normal order here. Nothing is backfilled, because nothing is stored: the breakdown is
derived at read time and a muscle-group correction re-derives every historical figure it touches on
the next read.

## References

- Research: `context/changes/tonnage-breakdown/research.md`
- The view this one sits beside: `supabase/migrations/20260813150000_derive_daily_tonnage_from_sets.sql`
- The un-scoped foreign key: `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:59`
- The catalogue select policy that would filter an inner join: `supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql:65-67`
- The service to sit beside: `src/lib/services/tonnage.ts:61-141`
- The suite to copy: `tests/integration/weekly-tonnage.test.ts:26-77`, `:340-368`
- The render tripwires: `tests/render/dashboard-tonnage.test.ts:38-66`, `:129-133`, `:158-163`
- The label-map pattern: `src/lib/validation/profile.ts:42-67`
- US-03 and FR-018/FR-019: `context/foundation/prd.md:121-139`, `:263-272`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The view and the proof that it reconciles

#### Automated

- [x] 1.1 `npm run db:push` applies to both projects; `npm run db:status` shows one version — 0095c0f
- [x] 1.2 `npm run db:types` emits the new view under `Views` — 0095c0f
- [x] 1.3 `npm run lint` and `npm run typecheck` pass — 0095c0f
- [x] 1.4 `npm run test:integration` passes, twice in a row — 0095c0f
- [x] 1.5 Mutation (a): `left join` → `join` fails assertion 9 and only 9, sum below its own total — 0095c0f
- [x] 1.6 Mutation (b): removing `security_invoker` fails assertion 7 — 0095c0f
- [x] 1.7 Mutation (c): removing `greatest(…)` fails assertion 4 with a negative figure — 0095c0f
- [x] 1.8 Mutation (d): `weight_kg` → `weight` fails assertion 3 — 0095c0f

#### Manual

- [x] 1.9 `npm run db:status` output recorded in Progress — 0095c0f

#### Phase 1 evidence

`npm run db:status`, both projects at `20260814090000`:

```
— gymlog-test —            — gymlog (production) —
20260810063450             20260810063450
20260810174840             20260810174840
20260810180526             20260810180526
20260811005248             20260811005248
20260811143000             20260811143000
20260813150000             20260813150000
20260814090000             20260814090000
```

`npm run test:integration`: **112 passed (13 files)**, run twice back to back — 53.8 s then 55.1 s.
`tonnage-breakdown.test.ts` contributes 9.

**The mutation protocol, with the failure TEXT rather than the colour** (`lessons.md` — "a mutation
that fails for the wrong reason has confirmed nothing"). Each mutation was applied to `gymlog-test`
alone, by re-creating the view through the Management API from the real migration file with one
substitution; production was never addressed. After the last one the view was restored and both
projects' `md5(pg_get_viewdef(…))` compared: **identical (`0141edc8…`)**, `reloptions
{security_invoker=true}`, `authenticated` holding `SELECT` only and `anon` zero grants. No drift.

| Mutation                    | Assertion               | Failure text                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `left join` → `join`    | **9, and only 9**       | `expected 500 to be close to 680, received difference is 180` — the breakdown short by exactly the hazard set's `3 × 60 kg`, against its own window's `daily_tonnage`. **Assertion 1 stayed green**, which is the half that matters: its window holds no unreadable exercise, so an access defect and an arithmetic defect stay distinguishable               |
| (b) drop `security_invoker` | 7 (and 9 as collateral) | `expected [] to have a length of 1` — account B received account A's row verbatim: `{exercise_name: "s08-access-legs-…", muscle_group: "legs", tonnage_kg: 500}`. 9 fails too, for the same defect at a second site: with the flag off the view reads the whole catalogue, so B's private exercise becomes attributable and the `Unattributed` row disappears |
| (c) drop `greatest(…)`      | 4                       | `expected -160 to be +0` — the same −160 kg S-07's protocol measured, from `60 × 0` plus `8 × −20`                                                                                                                                                                                                                                                            |
| (d) `weight_kg` → `weight`  | 3                       | `expected 1000 to be close to 726.796185` — the naive sum of the numbers typed, across one kg set and one lb set                                                                                                                                                                                                                                              |

**One process finding, recorded because it nearly cost the run.** Mutations (c) and (d) first
matched on `greatest(s.weight_kg, 0)` alone. That string appears in the migration's HEADER COMMENT
before it appears in the SELECT, `String.replace` takes the first match, and the result was an
**unmutated view that passed 9/9** — a mutation reporting green is the same failure as an assertion
that cannot fail, wearing the opposite colour. It was caught only because the harness reads
`pg_get_viewdef` back after every apply and prints whether `GREATEST` survived. Anchor a mutation on
the whole statement, and verify what is INSTALLED rather than what was sent.

### Phase 2: The fold, its guards, and one label map

#### Automated

- [x] 2.1 `npm test` passes with `tonnage-breakdown.test.ts` and the `apportionedFigures` cases — 5a4f968
- [x] 2.2 `npm run lint` and `npm run typecheck` pass — 5a4f968
- [x] 2.3 Mutation (e): a `1000` kg tolerance fails the reconciliation assertion — 5a4f968
- [x] 2.4 Mutation (f): dropping six-groups-always and dropping `hasSets` each fail their assertion — 5a4f968
- [x] 2.5 Mutation (h): independent `tonnageFigure` rounding makes three `33.5` rows print `102`
      against a total of `101` — 5a4f968
- [x] 2.6 `grep -rn "GROUP_LABELS" src/` shows one definition and its importers — 5a4f968

#### Manual

- [x] 2.7 `/exercises`, `/records`, `/workouts/[id]` show the same capitalised group names — 5a4f968

#### Phase 2 evidence

`npm test`: **240 passed (14 files)**, up from 221 — `tonnage-breakdown.test.ts` contributes 19,
`tonnage-display.test.ts` gains 7 `apportionedFigures` cases, `exercise.test.ts` gains 2.
`npm run lint` clean, `npm run typecheck` 0 errors / 0 warnings over 118 files, `npm run test:render`
**18 passed** — the label rewire touches three of the four call sites the render suite renders and
moved nothing it asserts on.

`grep -rn "GROUP_LABELS" src/` (criterion 2.6): one definition at
`src/lib/validation/exercise.ts:78`, four importers (`ExerciseCatalogue.tsx`, `ExercisePicker.tsx`,
`WorkoutDetail.tsx`, `records.astro`), and the test file. The private `GROUP_LABELS` is gone rather
than left beside it.

Criterion 2.7, confirmed by the owner on 2026-08-14 in `astro dev`: all four label sites — the
`/exercises` filter chips and rows, `/records`, the `/workouts/[id]` entry headers and the exercise
picker inside it — read capitalised. Three of them printed the raw lowercase enum before this phase.

The six-step gate was also run here rather than only at Phase 3, and passed in CI order:
lint → typecheck → `npm test` 240 → `npm run test:render` 18 → `npm run test:integration`
**112 passed (13 files)** → `npm run build` complete in 14.12 s.

**The mutation protocol, with the failure TEXT rather than the colour** (`lessons.md`).

| Mutation                                                     | Assertion                                                                                     | Failure text                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (e) `RECONCILIATION_TOLERANCE_KG` → `1000`                   | "refuses a breakdown that does not add up to the total the user can see" and the constant pin | `expected [Function] to throw an error` — 100 kg of rows against a 100.5 kg total sails through; plus `expected 1000 to be 0.001`. **The threshold test stayed green on purpose**: it is written in terms of the constant (half passes, double throws), so it pins the WIRING and is insensitive to the value. The value is pinned by the two assertions that did fail — said here because an untouched test beside two red ones reads as a gap |
| (f₁) drop the six-groups seeding loop                        | 8 assertions, headed by the shape one                                                         | `expected [ { group: 'legs', …(2) } ] to have a length of 6 but got 1` — an account that trained legs is told nothing about the five groups it did not, which is the whole of FR-019                                                                                                                                                                                                                                                            |
| (f₂) drop `group.hasSets = true`                             | "marks a group that has rows but no external load as having sets", **and only it**            | `- "hasSets": true` / `+ "hasSets": false` — a week of planks would be told "you did not train it". The blast radius of one is the evidence the two rules are independently pinned                                                                                                                                                                                                                                                              |
| (h) `apportionedFigures` → independent `tonnageFigure` calls | the `33.5` case and the thousands-separator case                                              | `expected [ '34', '34', '34' ] to deeply equal [ '34', '34', '33' ]` — 102 printed under a total of 101, **the exact arithmetic plan review F1 found**; and `expected [ '8,000', '4,345' ] to deeply equal [ '8,001', '4,345' ]`, the same defect at five digits                                                                                                                                                                                |

**One assertion was rewritten after it failed for the wrong reason**, recorded because it is the
lesson this repository already carries. The threshold test first asserted the boundary itself —
`100 + RECONCILIATION_TOLERANCE_KG` must pass — and it went red on unmutated code:
`off by 0.0010000000000047748`. `100 + 0.001` does not differ from `100` by exactly `0.001` in binary
floating point, so the assertion was testing IEEE 754 rather than the guard. Rewritten to half and
double the constant, with the reason in the test body.

**And one shape claim was wrong before the suite corrected it.** The `Unattributed` row was asserted
to sort last unconditionally; it does not, and should not — it is ranked by tonnage like any other
row and goes last only on a **tie**. Both facts are now pinned separately (`legs, null, back, …` at
300 kg against the zeros; `legs, core, null, …` when it ties with `core`, the last of the six).

### Phase 3: The section on the home screen

#### Automated

- [x] 3.1 `npm run test:render` passes, no-island and two-figure assertions retained — e1e158b
- [x] 3.2 `npm test`, `npm run lint`, `npm run typecheck` pass — e1e158b
- [x] 3.3 Mutation (g): a page-level failure flag fails the degrade assertion — e1e158b
- [x] 3.4 The six-step gate passes once before the commit — e1e158b

#### Manual

- [x] 3.5 Group figures added by hand equal the "This week" figure exactly, in kg and in lb — e1e158b
- [x] 3.6 The bars read as a shape rather than as noise — e1e158b
- [x] 3.7 Switching to pounds moves totals and breakdown rows together — e1e158b
- [x] 3.8 A planks-only GROUP reads `0` with `Sets logged, no external load`; untrained groups read
      `0` with `No sets` — e1e158b

#### Phase 3 evidence

`npm run test:render`: **24 passed (2 files)**, up from 18 — six new assertions, and the three the
plan required kept unchanged (`not.toContain("<astro-island")`, `FIGURE_CLASS` counted exactly twice,
and the pounds guards). The six-step gate ran once in CI order before the commit:
lint **0 errors** → typecheck **0 errors / 0 warnings over 118 files** → `npm test` **240 passed
(14 files)** → `npm run test:render` **24 passed** → `npm run test:integration` **112 passed
(13 files)**, 56.1 s → `npm run build` complete in 14.29 s.

**Criteria 3.5–3.8, confirmed by the owner on 2026-08-14 in `astro dev`**, against a workout logged
for the purpose: `Back Squat 5 × 102.5`, `Deadlift 5 × 100`, `Bench Press 5 × 62.5` — a week of
`1325 kg` whose rows carry halves, chosen so the apportionment is **observable rather than merely
correct**. Independently rounded, that column prints `513 + 500 + 313 = 1326` under a total of
`1,325`; together it prints `513 + 500 + 312`. Checked again after switching to pounds, where the
residuals are larger, and again after adding `Plank 1 × 0`: the `core` row read `0` with
`Sets logged, no external load` while `shoulders` and `arms` read `0` with `No sets`, and the week's
total did not move.

**The stub's tripwire fired as designed.** S-07 wrote `throw new Error(\`unstubbed table: ${table}\`)`
for exactly this moment, and adding the third read reddened this file before a single new assertion
existed. A wanted failure, and the only one in the repository written a slice in advance.

**Mutation (g), with the failure TEXT rather than the colour** (`lessons.md`).

| Mutation                                                       | Assertion                                     | Failure text                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (g) the breakdown's `catch` also sets the page-level `tonnageFailed` | "degrades on its own, leaving both totals on screen" | `expected '<html lang="en" data-astro-cid-sckkx6…' to contain '12,346'` — and the received page is the proof: it carries `Your weekly tonnage could not be loaded` where the two figures were. A breakdown read failing costs the user S-07's proven feature, which is the defect |

**One shape claim was wrong and the suite corrected it before the owner could see it.** The plan
named `Unattributed` as the label for tonnage this account cannot name; rendered, that word appeared
**twice** — once as the group row and once as the exercise row — and `groupRow()` matched two
elements. Two different claims were wearing one word: the group row means "tonnage belonging to no
group", the exercise row means "one exercise you cannot read". The exercise row now reads
`Unattributed exercise`, and the assertion pins both separately.

### Phase 4: Deploy and prove it on the public URL

#### Automated

- [x] 4.1 `npm run build` succeeds — 5fdaadc
- [x] 4.2 `npx wrangler deploy` reports a new version at 100%, id recorded — 5fdaadc

#### Manual

- [x] 4.3 The breakdown renders on the deployed `/dashboard` and reconciles on screen — 5fdaadc
- [x] 4.4 An empty week still shows both totals — 5fdaadc

#### Phase 4 evidence

`npm run build` complete in 18.66 s. `npx wrangler deploy`: **Worker version
`ea6318d6-ec4d-4666-b1a4-cf8ce26164c4`**, confirmed at **100 %** of traffic by
`npx wrangler deployments list` (deployed 2026-08-14T16:07:51Z, author `monika.zmuda9310@gmail.com`).
Four new client assets uploaded, 2179.07 KiB total / 442.83 KiB gzipped, Worker startup 22 ms.

No schema step: the migration went to both projects in Phase 1 and was purely additive, so production
carried the view for three phases before anything read it.

**A read-only probe of the public address**, which is the check a green gate cannot make
(`lessons.md`): `/dashboard` answers **302 → `/auth/signin`** and `/auth/signin` answers **200**. That
proves the new version is serving and the middleware still guards in both directions; it says nothing
about the breakdown, which is what 4.3 and 4.4 are for and why they need a signed-in human.

Criteria 4.3 and 4.4 confirmed by the owner on 2026-08-14, signed in at
`https://gymlog.10x-astro-starter.workers.dev/dashboard`: the breakdown renders under the two totals
and its group rows add up to the "This week" figure on screen, and a week with no sets still shows
both totals. **This is the check S-02 skipped and `lessons.md` exists for** — the gate and CI are
both blind to it.

### Phase 5: Documents

#### Automated

- [x] 5.1 `npm run lint` passes — 1b2ce56
- [x] 5.2 `grep -n "RESOLVED (owner, 2026-08-14)" context/foundation/prd.md` matches — 1b2ce56

#### Manual

- [x] 5.3 The owner confirms the PRD resolution says what they decided — 1b2ce56

#### Phase 5 evidence

`npm run lint` clean; `npx prettier --check` clean on all four repository documents.
`grep -n "RESOLVED (owner, 2026-08-14)" context/foundation/prd.md` → **`457:   — **RESOLVED (owner,
2026-08-14).**`**.

**Criterion 5.2 caught its own near-miss, which is the reason plan review F6 wrote it that way.**
The stamp was first written wrapped across two lines (`**RESOLVED (owner,\n   2026-08-14).**`), and
the grep answered **exit 1** — a criterion phrased as "Open Question 2 is resolved" would have passed
on prose that was already there, while this one failed on a document that was in fact edited
correctly. Rewrapped so the stamp sits on one line.

Five documents, one decision per sentence:

- **`AGENTS.md`** — `daily_exercise_tonnage` under § Known state with its `security_invoker` role
  stated as a **guard** (three guards, one tripwire, now that there are four views); the join-as-filter
  rule under § Domain rules with assertion 9 named and the mutation figure quoted; the retroactive
  muscle-group correction; the reconciliation guard; the rounded-together column. **And the two-copies
  rule for the tonnage expression here rather than only in the migration header** (plan review F8) —
  the header is reachable only from the newer of the two files.
- **`README.md`** — the `/dashboard` row, and a § "Where the week's work went" block covering the six
  always-present groups, the two zero sentences, the enforced reconciliation, the reader's unit, the
  `Unattributed` row and the retroactive group correction.
- **`context/foundation/prd.md`** — Open Question 2 struck through and resolved, in the form #1 uses:
  the decision, why it is retroactive **by construction** rather than by choice, where the consequence
  stops (the weekly total cannot move), and the rejected snapshot alternative with its reason.
- **`context/foundation/lessons.md`** — one entry: "Under `security_invoker`, a JOIN is a FILTER".
- **`C:\10xdev\handoff\STATE.md`** — eleven of twelve delivery items, the test counts (240 / 112 / 24),
  Worker `ea6318d6`, and § NASTĘPNY KROK rewritten to "close S-08, then S-09", including the fact that
  **six commits are unpushed and CI has never run for S-08** — a green local gate is not a green CI
  run and must not be recorded as one.
