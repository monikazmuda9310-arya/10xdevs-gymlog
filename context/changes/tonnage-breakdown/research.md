---
date: 2026-08-14T07:15:49Z
researcher: Monika Zmuda
git_commit: d0afb8d02c4fb097e6174734f54d96f46c3c6cd7
branch: main
repository: gymlog
topic: "S-08 tonnage-breakdown — what exists, what constrains it, and what is genuinely open"
tags: [research, codebase, tonnage, daily_tonnage, muscle-group, views, security-invoker, dashboard]
status: complete
last_updated: 2026-08-14
last_updated_by: Monika Zmuda
---

# Research: S-08 `tonnage-breakdown`

**Date**: 2026-08-14T07:15:49Z
**Researcher**: Monika Zmuda
**Git Commit**: `d0afb8d02c4fb097e6174734f54d96f46c3c6cd7`
**Branch**: `main`
**Repository**: gymlog

## Research Question

What already exists in the data, service, test and screen layers that S-08 must build on or must
not break, so that the week's tonnage can be broken down per exercise (FR-018) and per muscle group
(FR-019) with the group figures summing exactly to the weekly total S-07 already renders (US-03)?

Three parallel agents covered the data layer, the service/test layer and the screen layer.

## Summary

Six findings decide the shape of this slice. Two of them are hazards nobody has written down yet.

1. **The join to `public.exercises` can silently drop tonnage, and that is the exact failure mode
   this slice exists to prevent.** `exercise_entries.exercise_id` references `exercises (id)` —
   single-column, **not** ownership-scoped — while `exercises` carries an RLS select policy
   (`user_id is null or (select auth.uid()) = user_id`). Under `security_invoker = true`, an
   **inner** join to `exercises` is filtered by that policy, so a set whose exercise is another
   account's private row becomes invisible to the reader and its tonnage vanishes from the
   breakdown — while `daily_tonnage`, which never joins `exercises`, still counts it. The
   breakdown then does not sum to the total, with no error anywhere. **This is a reading of the
   constraints and the write path, not something executed.** See § The reconciliation hazard.
2. **Open Question 2 is already settled by the schema for the *total*, and remains open only for
   the *breakdown*.** `exercise_entries` deliberately snapshots nothing
   (`20260811005248…:71-76`), so a group correction moves tonnage **between** buckets and leaves
   the weekly sum bit-identical. What is genuinely open is a product question, not a data one:
   **there is no application path to edit `muscle_group` today at all** — no `updateExercise`, no
   `/api/exercises/[id]`, no UI. The database grant and policy do allow the owner to update their
   own custom row. So S-08 can (a) leave it as-is and record the retroactive semantics, or
   (b) ship an edit path and state the consequence on screen. Only (b) is a scope increase.
3. **The grain is forced, and so is the fold.** The S-07 migration header already names S-08's
   grain and its condition: the range predicate descends to `workouts_user_performed_on_idx` only
   while the filter is on **grouping columns**. `(user_id, performed_on, exercise_id)` keeps that;
   `(user_id, exercise_id)` filtered by a date range does **not**. So the view groups by day and
   the Worker folds — exactly as S-07 does. But the fold is no longer bounded by 14: it is
   `days × distinct exercises per day`. That bound must be argued and guarded, not assumed.
4. **`tests/render/dashboard-tonnage.test.ts` contains two tripwires aimed at this slice.** Its
   Supabase stub `throw`s on an unstubbed table (written in anticipation of a third read), and it
   asserts `expect(both).not.toContain("<astro-island")` — **any** hydrated island added to
   `/dashboard` fails it. It also asserts exactly two elements carrying
   `text-2xl font-semibold text-purple-200`, so breakdown rows must not reuse that class string.
5. **There is no charting library, no `<table>` anywhere in `src/`, and no shared muscle-group
   label map.** The house idiom is a bordered `<ul>` with dividers, or a `<dl>` card. The only
   label map (`GROUP_LABELS`) is private to `ExerciseCatalogue.tsx`; `/records` and
   `/workouts/[id]` print the raw lowercase enum. S-08 will need to pick one and probably promote
   it, following the `WEIGHT_UNIT_LABELS` pattern in `src/lib/validation/profile.ts`.
6. **A comment in `preferences-derive.test.ts:343-346` names S-08 by name** as the plausible author
   of "widening `daily_tonnage` to derive a week in SQL". S-08 must not do that (AGENTS.md forbids
   `date_trunc('week', …)` outright), so that comment needs re-aiming or the tripwire it labels
   becomes decoration.

## Detailed Findings

### The data layer

**`public.daily_tonnage`** — `supabase/migrations/20260813150000_derive_daily_tonnage_from_sets.sql`,
the newest migration (92 lines, the view is the only object). It emits
`s.user_id, w.performed_on, coalesce(sum(s.reps * greatest(s.weight_kg, 0)), 0) as tonnage_kg`,
joining `sets → exercise_entries → workouts` on `(id, user_id)` pairs at each level, grouped by
`s.user_id, w.performed_on`. **It never joins `exercises`** — which is precisely why a weekly total
is blind to muscle groups, and why a group correction cannot move it.

The header names this slice twice, `…:24-29`:

```sql
-- WHY THE FILTER STILL USES THE INDEX. The application filters on `user_id` and a `performed_on`
-- range, and both are GROUP BY columns, so Postgres pushes those quals down into the aggregate and
-- the range travels on `workouts_user_performed_on_idx (user_id, performed_on desc)` — created by
-- S-03 with this slice named. That pushdown is a property of THIS grain, not a general one: S-08
-- regrouping at (user_id, performed_on, exercise_id) keeps it only while it filters on grouping
-- columns. `desc` is irrelevant to a range; a btree scans either direction.
```

**Indexes that exist** (nothing else creates an index anywhere):

| Table | Object |
|---|---|
| `workouts` | PK `id`; `unique (id, user_id)`; `workouts_user_performed_on_idx (user_id, performed_on desc)` |
| `exercise_entries` | PK `id`; `unique (workout_id, exercise_id)`; `unique (id, user_id)`; `(user_id, workout_id)`; `(user_id, exercise_id)` |
| `sets` | PK `id`; `(user_id, exercise_entry_id)` |
| `exercises` | PK `id`; partial unique on `lower(name)` (seeded / owned); `(user_id, muscle_group)` |

**No index leads with `performed_on`, none with `exercise_id` on `exercise_entries`, none with
`muscle_group`.** Consequences for S-08:

- Adding `exercise_id` as a third grouping column preserves the pushdown, because `user_id` and
  `performed_on` remain grouping columns. The join `x.id = ee.exercise_id` resolves on the
  `exercises` primary key, so **no new index is required**.
- A predicate on `muscle_group` would be applied *above* the aggregate unless `muscle_group` is
  itself a grouping column, and driving the plan *from* `exercises` (e.g. `where muscle_group = …`)
  has no index path in either table. If group filtering is ever wanted in SQL, that is the plan to
  watch — and per the migration's own "NOT MEASURED, AND SAID SO" paragraph, **there is no
  environment in this project where it can be measured**: `gymlog-test` holds a few dozen sets.

**View conventions to copy exactly** (all three existing views do this):

```sql
create view public.<v> with (security_invoker = true) as …;
comment on view public.<v> is '…';
revoke all on public.<v> from anon, authenticated;
grant select on public.<v> to authenticated;
notify pgrst, 'reload schema';
```

`security_invoker` on a breakdown view is a **load-bearing guard, not a tripwire** — it reads base
tables directly, so it stands where `daily_tonnage` and `set_estimates` stand, not where
`personal_records` stands. This was measured in S-07: with the flag removed, account B read ten rows
of account A's tonnage. AGENTS.md states the deciding rule: *which kind a new view gets is decided
by what it reads, not by where it sits.*

**No `create or replace view` or `drop view` exists anywhere in the repository.** All three views are
created once. A new, purely-additive view needs no drop. (S-04's plan and S-06's finding F2 both
record why: `create or replace view` refuses a column-list change and never touches migration
history, so an out-of-band replacement on `gymlog-test` could not be restored.)

**`public.exercises`** — `muscle_group public.muscle_group not null`, **no default**, so every row
seeded or custom necessarily carries exactly one of six values. The enum:

```sql
create type public.muscle_group as enum ('legs', 'back', 'chest', 'shoulders', 'arms', 'core');
```

Pinned in TypeScript at `src/types.ts:31` with a compile-time assertion at `:144`, and required at
the API by `src/lib/validation/exercise-schemas.ts:25-27`.

**The join path and its fan-out**: `sets (exercise_entry_id, user_id) → exercise_entries (id,
user_id)` and `exercise_entries (workout_id, user_id) → workouts (id, user_id)` are composite and
ownership-scoped; `exercise_entries.exercise_id → exercises (id)` is **single-column**,
`on delete restrict`, `not null`. The join to `exercises` matches exactly one row by primary key —
no fan-out. `unique (workout_id, exercise_id)` means one workout cannot hold two entries for the
same exercise, but **two workouts on the same date can**, so grouping (not assuming one row) is
required.

### The reconciliation hazard — the one thing that can break "sums to the penny"

Stated in full because it is the finding with the largest consequence and it is not written down
anywhere in the repository today.

- `exercises` has an RLS **select** policy: `user_id is null or (select auth.uid()) = user_id`
  (`20260810174840…:65-67`).
- Postgres foreign-key checks do **not** go through RLS, so the FK will accept any existing
  `exercises.id`.
- `addExerciseEntry` (`src/lib/services/workouts.ts:150-154`) inserts `exercise_id` straight through
  with no visibility check; the endpoint's own comment says it relies on the FK.
- Therefore a row *can* exist whose `exercise_id` points at another account's private exercise. The
  only barrier is that the uuid is unguessable.
- Under `security_invoker = true`, an **inner** join to `exercises` in the breakdown view would drop
  that set's tonnage, silently, for the account that logged it.

Three responses are available and the choice belongs to the plan: a `left join` with a
null-group bucket rendered honestly; an inner join plus an integration assertion pinning
`sum(breakdown) == weekly total`; or closing the write path so the row cannot exist. **What is not
available is leaving it unstated** — the reconciliation criterion of US-03 is the headline
acceptance criterion of this slice.

### The service layer

**`src/lib/services/tonnage.ts`** (147 lines) exports exactly one function and one interface:

```ts
export interface WeekTonnage extends DateRange { kilograms: number; hasSets: boolean; }

export async function weeklyTonnage(
  supabase: Client, userId: string, timeZone: string, now: Date = new Date(),
): Promise<{ current: WeekTonnage; previous: WeekTonnage }>;
```

It **throws in five places** rather than answering zero — window ≠ 14 days, PostgREST error, a row
outside the requested window, a null column, a non-finite sum. The module header states two
deliberate rule-exemptions S-08 inherits verbatim:

- *"The Worker adds up to fourteen numbers, and 'aggregate in Postgres' still holds"* — the rule
  bites on work proportional to the number of **sets**, not the number of **days**.
- *"This module displays a number computed by SQL, which `record-display.ts` forbids"* — the
  compensating control is assertion 1 of the integration suite, which sums the same fixture
  independently in TypeScript. **"That TypeScript sum lives in the test and must never move into
  `src/`."**

The 14-row bound is **asserted, not assumed** (`tonnage.ts:71-75`), with the reason written out:
*"A throw, never a `.limit(14)`: a limit is a silent truncation, which is the same defect wearing a
seatbelt."* And `tonnage.ts:90-103` re-checks every returned row against the window, because
*"without it the `.gte`/`.lte` bounds are not load-bearing"* — `fold` filters by week again in
TypeScript, so removing the bounds would change no answer while quietly shipping the account's
entire history to the Worker.

**S-08 has no equivalent constant.** A breakdown at `(day, exercise)` grain over one week returns
`days × distinct exercises per day` rows. That is bounded by the training habit, not by the log's
growth — the same *kind* of argument S-07 made, but the number is not a constant and the guard
cannot be `=== 14`. Naming a bound and a guard for it is a planning decision.

**`src/lib/services/calendar.ts`** — `trainingWeeksFor(timeZone, now)` returns
`{ current: DateRange, previous: DateRange }`, each `{ start, end }` as plain inclusive
`YYYY-MM-DD` strings. `mondayOf` anchors at `T00:00:00Z` and uses `getUTC*` accessors; `todayIn`
catches a `RangeError` from an invalid zone and falls back to UTC. **This is the only place the
profile timezone is allowed to matter.**

**`src/lib/services/set-display.ts:75-77`** — `kilogramsIn(kilograms, unit)` is the sanctioned way
to express a **total** in the reader's unit, and its docstring exists specifically to stop the two
plausible wrong moves (faking a `DisplayableSet`, or writing `0.45359237` at a call site).

### The test layer

**`tests/integration/weekly-tonnage.test.ts`** (378 lines, 8 assertions) is the template. What S-08's
suite must copy:

- **MARK `s07-`**, chosen to be neither a prefix of nor prefixed by any existing mark. Occupied
  marks: `s01-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`, `s06-`, `s07-`.
  **`s08-` is free and safe.**
- **Its own dates, because a name prefix cannot help an aggregate filtered by range.** Seven anchors,
  all Wednesdays in 2025, ≥4 weeks apart: `2025-06-11`, `07-09`, `08-13`, `09-10`, `10-08`, `11-12`,
  `12-10`. **Free months in 2025 for S-08: January–May.**
- `beforeAll` resets preferences via `resetPreferences` (the timezone decides which week is
  "current"), then deletes `workouts` by note prefix **before** `exercises` by name prefix — the
  reverse order fails on `on delete restrict`.
- Fixtures write **directly to the tables**, not through `/api/sets`, because that endpoint stamps
  the unit from the profile and two assertions need one workout carrying both units.
- Assertion 3 is the `weight_kg` reader — it asserts `not.toBeCloseTo(1000, 3)` against the naive
  `sum(reps * weight)`. **Every new aggregate needs its own equivalent**; `weight_kg` is the only
  common unit.
- Assertion 7 is the `security_invoker` guard, and its shape matters: account B naming account A's
  `user_id` **directly against the view**, not through the service (the service's own `.eq()` would
  filter a leak before B saw it).
- Assertion 8 pins the anonymous path: `data === null`, `error.code === "42501"`.
- **The fixture exercises are all `muscle_group: "back"` and `is_bodyweight: true`** — S-08's suite
  needs several groups to prove a breakdown reconciles.

**Config.** `vitest.config.ts` pins `TZ: "America/New_York"` and both properties are load-bearing;
the integration and render configs pin no `TZ` (integration passes `ZONE` explicitly).
`vitest.integration.config.ts` deletes every `SUPABASE_*`/`GYMLOG_*` env var except the three test
ones, so the suite is *incapable* of reaching production, and sets `fileParallelism: false`.

**Counts today**: 187 unit (13 files), 103 integration (12 files), 18 render (2 files).
Note the STATE.md figure of 212 unit counts differently — the `it(` count is 187.
There is **no `src/lib/services/tonnage.test.ts`**; the S-07 implementation review recorded three
defensive guards in that module as unreachable from the unit suite.

**Account-wide reads a new fixture could disturb**: `preferences-derive.test.ts:352-356` and
`:363-367` (all of account A's `workouts` and `personal_records`, compared to themselves before and
after a timezone change) — safe under `fileParallelism: false`. `exercises-rls.test.ts` asserts
`toHaveLength(SEED_TOTAL)` with `SEED_TOTAL = 38` over `user_id is null`, so **fixture exercises must
always carry a `user_id`**.

### The screen layer

**`src/pages/dashboard.astro`** (149 lines) is a single centred, shrink-to-fit card
(`items-center justify-center`, `text-center`, no `max-w-*`) — unlike every other screen, which uses
`mx-auto w-full max-w-2xl py-8`. It performs **exactly two reads**: `profiles`
(deliberately unfiltered — that is F-03's RLS demonstration, and adding a `.eq()` would destroy it)
and `daily_tonnage` through `weeklyTonnage`. The failure model is one boolean per domain,
`tonnageFailed`, seeded from `!profile`, with the throw caught in the frontmatter because an Astro
frontmatter that throws produces a 500 rather than a page.

Load-bearing sentences already on screen:

| State | Sentence | Where |
|---|---|---|
| read failed / no profile | `Your weekly tonnage could not be loaded. Please refresh; if it keeps happening, the database may be unreachable.` | `dashboard.astro:93-94` |
| week with no sets | `No sets logged {this,last} week` | `dashboard.astro:116` |
| zone present | `Your training week runs Monday to Sunday in {timezone}.` | `dashboard.astro:75` |

**There is no "no external load" sentence on the dashboard.** A week of planks renders `0 kg` with
*no* sentence — the distinction AGENTS.md describes is implemented as the *absence* of the
"No sets logged" line. `tonnage-display.test.ts:46-51` says the screen "must pair this with a
sentence saying there was no external load"; that sentence does not exist yet. A breakdown makes the
gap more visible, since a group row can legitimately read zero.

**`src/lib/services/tonnage-display.ts`** exports one function,
`tonnageFigure(kilograms, unit): string` — converts through `kilogramsIn` **before** rounding, whole
units, explicit `"en-US"` locale, and returns a finished string with **no unit suffix** (the page
appends `{weightUnit}` in its own `<span>`).

**Render tripwires aimed squarely at this slice** — `tests/render/dashboard-tonnage.test.ts`:

```ts
// Throws on an unstubbed table rather than quietly answering the daily chain. A third read added
// to the page would otherwise get a chain whose `.eq()` returns a non-thenable, `await` would hand
// that straight back, `error` would be undefined, and the page would sail on …
from: (table: string) => { … throw new Error(`unstubbed table: ${table}`); }
```

```ts
it("ships no hydrated island for this", () => { expect(both).not.toContain("<astro-island"); });
```

and `FIGURE_CLASS = "text-2xl font-semibold text-purple-200"` with `expect(figures).toHaveLength(2)`.
All three go red the moment S-08 touches `/dashboard`, by design — but only the first two are
*wanted* failures. Reusing the figure's class string for breakdown rows would be a false alarm.

**No shared muscle-group label map exists.** `GROUP_LABELS` is private to
`src/components/exercises/ExerciseCatalogue.tsx:11-18` and unexported; `/records:74`,
`ExercisePicker.tsx:85` and `WorkoutDetail.tsx:335` all print the raw lowercase enum. The repo is
already inconsistent — "Shoulders" on `/exercises`, "shoulders" on `/records`. The pattern to follow
if promoting one is `WEIGHT_UNIT_LABELS: Record<WeightUnit, string>` in
`src/lib/validation/profile.ts:42-67`, whose whole point is that a new enum value cannot reach the
screen unnamed, and whose only import is type-only so a `client:load` island can pull it.

**No charting library** is present (full dependency list checked; `lucide-react` and
`class-variance-authority` are the only visual extras), and **no `<table>` exists anywhere in
`src/`**. shadcn components installed: `LibBadge.astro`, `button.tsx`, `confirm-dialog.tsx` — no
card, table, progress or chart.

**Navigation is per-page and ad-hoc**: `Layout.astro` carries no nav chrome, and each screen
hand-writes its own back-links. A new route would need adding to `PROTECTED_ROUTES`
(`src/middleware.ts:7`, prefix match) *and* linking by hand from wherever it should be reachable.

**The headline/evidence unit ruling** lives in `heaviestFigure`
(`src/lib/services/record-display.ts:108-134`) and is visible in two identifiers one character apart
on `records.astro:92-98` — `{weightUnit}` (the reader's) on the headline, `{best.weightUnit}` (the
set's, as typed) on the evidence line. Breakdown rows are **derived headlines** and take the
reader's unit.

## Code References

- `supabase/migrations/20260813150000_derive_daily_tonnage_from_sets.sql:1-91` — the whole S-07 view, its header, and the two paragraphs naming S-08
- `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:59` — `exercise_id … references public.exercises (id) on delete restrict`, the un-scoped FK
- `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:71-76` — "No muscle_group column, and that absence is load-bearing"
- `supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql:65-67` — the shared-catalogue select policy that would filter an inner join
- `src/lib/services/tonnage.ts:61-109` — `weeklyTonnage`, the 14-day assertion, the window re-check
- `src/lib/services/tonnage.ts:125-141` — `fold`, the null-column throw, `hasSets`
- `src/lib/services/calendar.ts:60-92` — `mondayOf`, `trainingWeeksFor`
- `src/lib/services/set-display.ts:75-77` — `kilogramsIn`, the only sanctioned scalar conversion
- `src/lib/services/tonnage-display.ts:37-41` — `tonnageFigure`
- `src/pages/dashboard.astro:1-53` — the frontmatter, both reads, the failure flag
- `src/pages/dashboard.astro:88-124` — the tonnage section markup
- `tests/integration/weekly-tonnage.test.ts:26-77` — MARK, anchors, `weeksAround`, the restated `KG_PER_LB`
- `tests/integration/weekly-tonnage.test.ts:340-368` — assertion 7, the `security_invoker` probe shape
- `tests/render/dashboard-tonnage.test.ts:38-66` — the stub that throws on a third table
- `tests/render/dashboard-tonnage.test.ts:129-133` — "ships no hydrated island for this"
- `src/components/exercises/ExerciseCatalogue.tsx:11-18` — the unexported `GROUP_LABELS`
- `src/lib/validation/profile.ts:42-67` — the label-map pattern to follow
- `src/lib/services/record-display.ts:108-134` — `heaviestFigure`, the headline/evidence ruling
- `src/types.ts:23-31`, `:136-144` — `MUSCLE_GROUPS` and its compile-time assertion

## Architecture Insights

- **The grain is not a free choice.** `(user_id, performed_on, exercise_id)` is the only grain that
  keeps the range predicate on the index *and* lets the muscle group be joined at read time. Any
  regrouping that drops `performed_on` from the `GROUP BY` loses the pushdown.
- **The muscle group is a property of the exercise as it stands today, never of the entry.** That
  is what makes a group correction a re-derivation rather than a data migration — the same shape
  S-06 relied on for the formula change, and the same shape that would be destroyed by any
  "optimisation" that snapshots the group onto a row.
- **Two derived numbers on one screen must be derived from one source or they will drift.** S-07's
  total comes from `daily_tonnage`; a breakdown from a second view means two SQL expressions of the
  same rule (`reps * greatest(weight_kg, 0)`) — the third instance of the hazard this repository
  already documents twice (the 1RM `case` expression, `0.45359237`). Options worth weighing in the
  plan: derive the total *from* the breakdown in the Worker (one SQL expression, one read, and
  reconciliation becomes structural rather than asserted), or keep two views and pin their agreement
  with an assertion. **The first makes "sums to the penny" true by construction.** It also changes
  the dashboard's read count, which is what the render stub is waiting for.
- **"Aggregate in Postgres" is a rule about unbounded work, not about arithmetic location.** S-07's
  exemption is legible because it names the bound (14) and asserts it. S-08 needs its own bound and
  its own assertion, or the exemption becomes precedent-by-analogy.

## Historical Context (from prior changes)

- `context/archive/2026-08-13-weekly-tonnage/change.md:51-58` — S-07 recorded that Open Question 2
  belongs to S-08 and that the schema settles the *total* half of it: "Changing a group moves
  tonnage **between** buckets and leaves the sum bit-identical — which is exactly what US-03's own
  criterion requires."
- `context/archive/2026-08-11-personal-records/plan.md:618-628` — the standing constraint that no
  environment in this project can measure the CPU cap or index behaviour; `gymlog-test` holds a few
  dozen sets. S-08 inherits it unchanged.
- `context/foundation/lessons.md` — four entries bear directly on this slice: *"A query shape that
  is exact for one row can be wrong for a set of them"* (the fold's bound), *"A handover that passes
  two decisions in one sentence is inherited as one decision"* (this slice is the one that was
  mis-inherited), *"A test whose title claims more than its body asserts becomes the citation"*, and
  *"A mutation that fails for the WRONG REASON has not confirmed the guard"*.
- `context/foundation/roadmap.md:244-255` — S-08's own entry, whose Risk paragraph names
  reconciliation as the single thing that makes the breakdown worth showing.

## Related Research

None — this is the first research artifact for `tonnage-breakdown`. The nearest sibling material is
`context/archive/2026-08-13-weekly-tonnage/` (plan, reviews, change), which is **not** to be opened
wholesale: the plan is ~12k tokens.

## Open Questions

1. **PRD Open Question 2 — how is an exercise's muscle group corrected after the fact?** The data
   answer is settled (retroactive by construction, weekly total unaffected). The product answer is
   not, and it now has a concrete cost attached: **no edit path exists at all today**, so "correcting
   it" currently means a direct database call. Owner: user. Needed by: planning.
2. **One view or two?** Deriving the weekly total from the breakdown makes reconciliation structural
   and removes a second copy of the tonnage expression, at the cost of touching S-07's working read
   path and its render stub. Keeping two views is additive and lower-risk, at the cost of an
   asserted rather than structural guarantee.
3. **What bounds the Worker's fold, and what guard enforces it?** S-07 has `=== 14`. S-08's row count
   is `days × distinct exercises per day`, which has no constant.
4. **Inline on `/dashboard`, or its own route?** The dashboard card is a shrink-to-fit centred box
   with no `max-w-*`; six group rows plus an exercise list is a different shape of content. A new
   route needs `PROTECTED_ROUTES` and hand-written links; inline needs the card's layout rethought
   and trips the "no island" assertion if any interactivity is wanted.
5. **Does the breakdown need a muscle-group label map, and should it be promoted out of
   `ExerciseCatalogue.tsx`?** Promoting it fixes an existing inconsistency (`Shoulders` vs
   `shoulders`) beyond this slice's scope; not promoting it duplicates the map.
