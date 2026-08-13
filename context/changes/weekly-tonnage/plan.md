# Weekly Tonnage Implementation Plan

## Overview

Total tonnage for the current training week, next to the previous one, on `/dashboard` (US-03,
FR-017). Computed at read time, aggregated in Postgres, and expressed in the account's chosen unit.

The whole slice turns on one sentence: **"a training week" is defined exactly once, in TypeScript,
and the database never learns what a week is.** Everything else follows from that.

## Current State Analysis

**Nothing in this repository computes tonnage, and nothing can answer which week a workout falls
in.** `src/lib/services/calendar.ts` exports exactly one function, `todayIn`. There is no
`startOfWeek`, no week helper, and the only `date_trunc('week', …)` anywhere is a **comment** in
`20260811005248_create_workout_log_with_row_ownership.sql:33`.

What already exists and this slice depends on:

- **`sets.weight_kg` is generated and unconstrained `numeric`** (`20260811005248:100-102`) — the
  migration's own comment says a scale here "would put a rounding step back into the one column every
  record comparison and **every future tonnage sum** reads". The sum is exact in Postgres.
- **`workouts_user_performed_on_idx` on `(user_id, performed_on desc)`** (`:135`) already exists and
  was written with this slice named: `context/archive/2026-08-10-log-workout-with-estimate/plan.md:218`
  — "the list's ordering and, later, **S-07's weekly window**". A range predicate on the second column
  under an equality on the first is exactly what a daily-grain filter needs. **No new index.**
- **The derived-view pattern is proven** — `set_estimates` and `personal_records`
  (`20260811143000_…sql`), both `security_invoker = true`, both revoke-then-grant, both read with an
  explicit `.eq("user_id", …)` and narrowed once in `src/lib/services/records.ts`.
- **`profiles.timezone` is user-settable since S-06** and validated by **membership** in
  `supportedTimeZones()`, so a well-formed impostor cannot reach the column.
- **`sets.weight` may be negative** (`sets_weight_range` allows −1000). Assisted sets are legal rows;
  excluding them from a sum is the aggregation's job, not a constraint's.

### Measured during planning, not assumed

**PostgREST aggregate functions are disabled on `gymlog-test`.** Probed read-only as `rls-owner-a`:

```
GET /rest/v1/sets?select=id&limit=1          → 200 [{"id":"2d687c41-…"}]
GET /rest/v1/sets?select=weight_kg.sum()     → 400 {"code":"PGRST123","message":"Use of aggregate functions is not allowed"}
```

`db-aggregates-enabled` is off (Supabase's default). Turning it on is a **per-project config change
living outside this repository** — the same class as `site_url`: invisible to every test, silently
different between the two projects, and it would hand `authenticated` an unbounded aggregate surface
over every table. That route is closed with evidence, not with an opinion.

Note this does **not** affect `listWorkouts`' `exercise_entries(count)` embed
(`src/lib/services/workouts.ts:76`) — embedded resource counts are a different feature and keep
working. The comment at `:57-59` calling that "the same discipline S-07's weekly tonnage will need"
is right about the discipline and misleading about the mechanism.

### Two inherited claims that turned out to be false

Both were checked rather than believed, under `context/foundation/lessons.md` — *"a user cannot do X
yet" is not the same as "X is untested"*. Full evidence in `change.md`.

**1. Open Question 2 does not belong to this slice.** It asks how a muscle group is corrected after
the fact, which rewrites **per-group** tonnage — S-08's subject. `exercise_entries` deliberately
stores no muscle group, so a weekly **total** never reads `exercises.muscle_group`; a correction
moves tonnage between buckets and leaves the sum bit-identical. The roadmap assigns it to S-08 in
three places and gives S-07 `Unknowns: —`. `STATE.md` acquired the claim by merging it with FR-006's
date-change warning in S-05's plan.

**2. `record-impact.test.ts` assertion 9 does not prove week membership.** It asserts `getUTCDay()`
of two hardcoded constants (a fact about JavaScript), that `performed_on` propagates through
`set_estimates`, and that the record is unchanged. It computes no week, no tonnage, and never varies
the timezone. **US-03's "moving a workout recomputes both affected weeks" is genuinely uncovered
today** — and unlike S-06's cast, this gap is real: the suite was read, and there is nothing in it.

### Key Discoveries

- `tests/integration/preferences-derive.test.ts:317-335` — **the tripwire aimed at this slice by
  name**: _"the edit that would make this one bite is concrete and plausible, and S-07 is the slice
  that will make it. A weekly view that derives Monday–Sunday boundaries by converting `performed_on`
  through the profile zone would turn a stored date into an instant, and this assertion is what would
  notice."_ Built the right way, it still cannot fail — and its own instruction is to keep it.
- `context/archive/2026-08-10-log-workout-with-estimate/research.md:233-239` — the same rule from the
  other side: _"the user states the date, so there is nothing to re-project … **S-07 aggregates with
  no timezone arithmetic at all**."_
- `context/archive/2026-08-11-personal-records/plan.md:681-683` — _"`personal_records` is a plausible
  input for S-07/S-08 and is **not designed for them** … expect to **add a view, not to widen this
  one**."_
- `context/archive/2026-08-11-personal-records/plan.md:619-629` — index behaviour is **unverifiable**
  in this environment and _"neither slice should claim otherwise without seeding a volume fixture
  first"_. Inherited unchanged.
- `context/archive/2026-08-10-log-workout-with-estimate/plan.md:681` — _"the dashboard is S-07's to
  redesign."_ Explicit permission; this plan uses only a little of it.
- `src/lib/services/set-display.ts:52-63` — `weightInUnit` takes a **set**, not a scalar. A weekly
  total is a scalar in kilograms with no `reps` and no typed original, so it cannot reuse it.
- `src/lib/services/record-display.ts:11-14` — _"**No number computed by SQL is ever displayed**."_
  This slice is the first that must break that rule, deliberately; see § Critical Implementation
  Details.
- `src/pages/dashboard.astro:6-12` — the deliberately **unfiltered** profile read, F-03's
  demonstration that RLS returns exactly one row. It survives, widened by one column.
- `tests/integration/` — every cleanup is `.like("<prefix>%")` **and** `.eq("user_id", …)`. But
  **`s03-` is a strict prefix of `s03-endpoints-` and `s03-page-`**, so `workout-log-rls` deletes two
  other suites' fixtures. Benign only because `fileParallelism: false` orders them. A new MARK must
  not be a prefix of an existing one.

## Desired End State

A signed-in user opens `/dashboard` and sees two figures — this training week's total tonnage and
last week's — in their chosen unit, as whole units with a thousands separator. A week with no logged
sets reads as `0` with a sentence saying why, and a failed read says so in different words and shows
**no figure at all**. A Sunday-evening session counts in that week. Switching the unit changes both
figures together; switching the timezone can move which week a session belongs to, and moves no
`performed_on`.

Verified by: the unit suite (week boundaries at the Sunday, DST and year/month edges); the integration
suite (the sum through Postgres, the exclusions, the boundary, the zero); the render suite (three
screen states, and the unit following the profile); and a human on the deployed URL.

## What We're NOT Doing

- **No per-exercise or per-muscle-group breakdown.** FR-018 and FR-019 are S-08. This slice ships the
  total those breakdowns will have to sum to.
- **No warning when a date change moves tonnage between weeks. Owner ruling, 2026-08-13: do not
  warn.** Tonnage re-derives on read, nothing is stored, and the change is reversible; S-05's dialog
  guards **irreversible** actions, and extending it to a reversible one is how people learn to click
  through the one that matters — the same argument that kept S-06's preference change out of a dialog.
  - **This does not close FR-006, because FR-006 never asked for a warning.** Its Socrates note
    (`prd.md:187-191`) resolves the objection by making **"the recomputation on date change … an
    explicit acceptance criterion rather than an assumption"** — which is US-03's fifth criterion, and
    is delivered by the moved-workout assertion in Phase 2. The warning question was **S-05's**, and
    the ruling above answers that one. Reading FR-006 as a request for a warning was this plan's own
    version of the merge it catches S-05 committing; corrected here rather than inherited onward.
- **Nothing about Open Question 2.** It is S-08's, on the evidence above.
- **No difference or percentage between the weeks.** FR-017 asks for two figures; the comparison is
  the reader's. (And a delta computed from rounded figures disagrees with the true one — if it is ever
  added, it must come from the unrounded kilograms and be rounded once.)
- **No volume fixture and no performance measurement.** The 10 ms CPU justification stays
  architectural and **this plan must not claim otherwise**. Recorded, with what it would take.
- **No island.** A weekly total has no interaction. `records.astro` is the precedent.
- **No stored derived value** — no tonnage column, no cache, no materialised total. The whole
  re-derivation property of S-04 and S-06 rests on this.
- **No change to `personal_records` or `set_estimates`.** A new view, not a widened one.
- **No new index.** The one this needs was created by S-03 with this slice named.
- **No E2E.** Phase 3 of the course contract owns that.

## Implementation Approach

Phase 1 proves the week boundary with no database at all, because that is the piece every later phase
consumes and the only piece whose failures are silent. Phase 2 adds the aggregation and proves it
against Postgres. Phase 3 puts it on screen. The order means a wrong week boundary is caught by a
hermetic test in seconds rather than by reading a number on a page.

## Critical Implementation Details

**The profile timezone is used to decide what "today" is, and for nothing else.** Turning an instant
into a calendar date needs a zone — that is `todayIn`, and it is legitimate. Reinterpreting a stored
`performed_on` through a zone is not: it invents an instant that never existed and moves dates by a
day at the edges. So the zone reaches `todayIn` and stops there; SQL receives four `YYYY-MM-DD`
strings and compares them to a `date` column. **No SQL in this slice may reference
`profiles.timezone`.**

**Week arithmetic must not subtract milliseconds.** `Europe/Warsaw` has two DST transitions a year,
so a week is sometimes 167 or 169 hours. Do the arithmetic on the UTC field accessors of a date-only
value — `new Date(`${iso}T00:00:00Z`)`, `getUTCDay()`, `setUTCDate()` — which has no DST because it
has no zone. This is not "converting through UTC": the value has no zone to begin with, and UTC is
just the arithmetic frame. Say so in a comment, because the next reader will flinch at seeing `UTC` in
a file about timezones. It also avoids a second `Intl` dependency, which would re-open the ICU
question `calendar.ts:18-24` had to measure in real workerd.

**The Worker adds at most 14 numbers, and the distinction is the point.** The rule is "aggregate in
Postgres", and the reason is that work proportional to **the number of sets** grows without bound
under a 10 ms cap. Folding **two weeks of daily totals** is work proportional to the number of days —
constant, 14, forever. The per-set arithmetic stays in SQL. This must be written in the service
header, or the next reader reads a rule violation.

**A week with no sets returns no row, not a zero row.** The zero is synthesised in the service — and
it is a **positive claim**, so it must never be produced by a failed read. This is S-05's
`impact_unavailable` rule applied to a screen: an emitted zero says "you did no work", which is a
different sentence from "we could not tell".

**This slice displays a number computed by SQL, and that is a deliberate departure.**
`record-display.ts` states the opposite rule and re-derives every printed figure in TypeScript. A
tonnage total cannot be re-derived without walking every set — the exact thing the slice exists to
avoid. Left unremarked it reads as an oversight, so the service header says it plainly. The
compensating control is the integration suite's independent TypeScript sum over the same fixture,
which is the role `personal-records.test.ts` assertion 4 plays for the 1RM formula.

---

## Phase 1: The week, in one place

### Overview

The Monday–Sunday boundary, as pure calendar arithmetic, proven before anything consumes it. No
database, no screen, no migration.

### Changes Required:

#### 1. The week helper

**File**: `src/lib/services/calendar.ts`

**Intent**: Give the product one definition of "a training week", in the module that already owns
"what day is it for this user" — dependency-free and `astro:*`-free, so the hermetic suite reaches it.

**Contract**: Two new exports beside `todayIn`.

`mondayOf(isoDate: string): string` — the Monday of the week containing `isoDate`, `YYYY-MM-DD` in,
`YYYY-MM-DD` out. Pure calendar arithmetic on UTC field accessors; no `Intl`, no locale `Date`, no
millisecond subtraction. The `(getUTCDay() + 6) % 7` mapping (Sunday=0 → 6, Monday=1 → 0) is the whole
trick and needs a comment saying why UTC appears in a timezone-aware module.

`trainingWeeksFor(timeZone: string, now?: Date): { current: DateRange; previous: DateRange }` where
`DateRange` is `{ start: string; end: string }`, both inclusive. Composes `todayIn` with `mondayOf`,
so the entire "which week is it" decision is one function. **`now` is injectable, matching `todayIn`'s
existing `now: Date = new Date()` signature** — that parameter is what makes the boundary testable at
exact instants, and what lets Phase 2's integration suite aim at an empty historical week.

#### 2. Its boundaries

**File**: `src/lib/services/calendar.test.ts`

**Intent**: Pin the three edges where a week helper is wrong silently. Chosen deliberately over the
extreme-offset case: two people in Kiritimati and Niue having different current weeks is already
implied by `todayIn`'s own tests, whereas these three break implementations that look correct.

**Contract**: Beyond the existing `todayIn` cases —

- **A Sunday belongs to the week that started six days earlier**, not the next one. The one case the
  PRD names by name (`prd.md:355-357`); the classic off-by-one.
- **A week containing a `Europe/Warsaw` DST transition** — in both directions, spring and autumn.
  This is the case that breaks any implementation that subtracts 7 × 24 hours, which is the
  implementation somebody writes by reflex.
- **A week spanning a month end and a year end** — `2026-08-31` is a Monday; a week across
  31 December. Catches hand-rolled date rollover.
- A Monday itself (`offsetToMonday === 0`), and the previous week being exactly seven days earlier.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit, render, integration and build all pass — the gate is **six** steps
- `calendar.test.ts` covers the Sunday, DST, month-end and year-end boundaries
- No new import in `calendar.ts`: it still imports nothing and reaches no `astro:*` module
- Mutation (a): **rebuilding the date with the LOCAL constructor** — `new Date(y, m - 1, d)` — and
  subtracting `7 * 24 * 3600 * 1000` fails the DST case, then reverted. **The obvious version of this
  mutation does not work and must not be used**: subtracting milliseconds from a value anchored at
  `T00:00:00Z` is exact, because UTC has no DST, so it produces bit-identical results and every case
  passes. The local constructor is what puts a DST transition inside the arithmetic. If the local
  version also fails to break anything, the DST case is decoration and is corrected in the module
  header per `lessons.md`, naming the guarantee and the edit that would make it bite
- Mutation (b): using `getDay()` instead of `getUTCDay()`, run as
  **`TZ=America/New_York npx vitest run src/lib/services/calendar.test.ts`**, fails at least one
  boundary case, then reverted. **The `TZ` prefix is required, not optional.** For a date anchored at
  `T00:00:00Z` the two accessors differ only at a NEGATIVE UTC offset — the owner's machine is UTC+2
  and CI runners are UTC, so without it the mutation is deterministically ineffective in both
  environments anybody would run it in, and "recorded as a finding" would be a foregone conclusion
  dressed as a discovery
- Mutation (c): shifting the `(getUTCDay() + 6) % 7` mapping by one fails the Sunday case

#### Manual Verification:

None. Every claim in this phase is demonstrable by a test.

**Implementation Note**: no user-visible change lands in this phase.

---

## Phase 2: The aggregation

### Overview

The sum, in Postgres, proven against real rows. The first migration in three slices.

### Changes Required:

#### 1. The view

**File**: `supabase/migrations/<timestamp>_derive_daily_tonnage_from_sets.sql` _(new)_

**Intent**: One row per account per day with that day's tonnage, so a weekly total is a bounded range
scan and the per-set arithmetic never leaves the database.

**Contract**: `public.daily_tonnage`, grouped by `(user_id, performed_on)`, exposing
`user_id, performed_on, tonnage_kg, set_count`. Copies `set_estimates` **exactly**:
`with (security_invoker = true)`; `revoke all … from anon, authenticated` **before**
`grant select … to authenticated`; joins written on `(id, user_id)` at every level to give the planner
the owner filter; `notify pgrst, 'reload schema';` last.

The sum is `sum(s.reps * greatest(s.weight_kg, 0))`. **One term implements both domain rules**: a
zero-weight set contributes `reps × 0`, an assisted set contributes `reps × 0` rather than a negative
amount. `weight_kg` is generated from a `not null` column, so `greatest` has no null hazard.

`sum` is wrapped in `coalesce(…, 0)` so `tonnage_kg` is never null in an emitted row — see the
service contract for why a null there must be an error rather than a skipped day.

**The migration must contain no reference to `profiles` and no `date_trunc`.** A header comment says
why: the zone belongs to `todayIn` alone, and a second definition of "week" here would be a second
answer to the same question, which is what this slice exists to avoid.

**`set_count` is NOT carried**, and the reason is worth writing down because the first draft carried
it. The stated justification — that the service needs it to tell "no sets" from "sets that summed to
zero" — is false: the view is grouped over `sets`, so a row exists **if and only if** that day has at
least one set, and `set_count` is therefore never `0` in any emitted row. Row presence alone answers
the question, so `hasSets` is `rows.length > 0`. A column whose justification cannot be exercised is a
column a future reader will assume something depends on. If S-08 wants a count, it adds one — the cost
is identical then and now, since a view whose column list changes must be dropped and recreated
either way.

**The index range predicate pushes into the aggregate only because both filtered columns are GROUP BY
columns.** That is a property of this grain, not a general one — and it is exactly what S-08 changes
when it regroups at `(user_id, performed_on, exercise_id)`. Say so in the header, or "the filter is
pushed down" silently stops being true.

Applied with `npm run db:push` (both projects, test first), then `npm run db:types`. **A view whose
column list changes must be dropped and recreated, never `create or replace`d.**

#### 2. The service

**File**: `src/lib/services/tonnage.ts` _(new)_

**Intent**: Turn "what did this account lift this week and last" into two numbers, with the week
decided by `calendar.ts` and the arithmetic by Postgres.

**Contract**: `weeklyTonnage(supabase, userId, timeZone, now?)` returning
`{ current: WeekTonnage; previous: WeekTonnage }` where `WeekTonnage` is
`{ start: string; end: string; kilograms: number; hasSets: boolean }`.

Calls `trainingWeeksFor`, then **one** read of `daily_tonnage` filtered
`.eq("user_id", userId).gte("performed_on", previous.start).lte("performed_on", current.end)`, and
folds the ≤14 rows. Throws on a read error — a caller that cannot tell "no work" from "unreachable"
will render the wrong sentence confidently.

**Nullable view columns are NOT narrowed by dropping the row here, and this is a deliberate departure
from `records.ts:71-93`.** There, dropping an incomplete row is right: a candidate missing its columns
is one the ranking cannot reason about. Here a row is **one day of the week**, and dropping it
silently **understates the week's tonnage** — producing exactly the "figure that is wrong and looks
right" this slice names as its sharpest risk. A pattern exact for one row is wrong for a set of them
(`lessons.md`). So a null `tonnage_kg` or `performed_on` is treated as a **read error and throws**,
never as a skipped day; the view's `coalesce` means it should be unreachable, and the throw is what
says so if it ever is not.

The range is 14 consecutive dates by construction. The service **asserts that** rather than assuming
it — if `trainingWeeksFor` ever returns a wider range the fold would silently do unbounded work, which
is the one thing the whole design exists to prevent. A thrown error, never `.limit(14)`: a limit is a
silent truncation, which is the same defect wearing a seatbelt.

The header carries the two paragraphs § Critical Implementation Details names: why folding 14 rows is
not a violation of "aggregate in Postgres", and why this is the one place a SQL-computed number is
displayed.

#### 3. The proof

**File**: `tests/integration/weekly-tonnage.test.ts` _(new)_

**Intent**: Prove the sum, the exclusions and the boundary against real rows — including the boundary
nothing covers today.

**Contract**: MARK `s07-` (**not a prefix of, and not prefixed by, any existing MARK** — the `s03-`
nesting trap is live in this directory). Fixture discipline per `AGENTS.md`, plus the rule this suite
is the first to need: **it aggregates by date range, so it must own its dates.** It passes an explicit
`now` far in the past, so its "current week" is a historical week no other suite writes to. That is
what the injectable parameter is for.

- **The sum matches an independent TypeScript sum** over the same fixture — the compensating control
  for displaying a SQL-computed number, the role `personal-records.test.ts` assertion 4 plays. This
  TypeScript sum lives **in the test only**; a production copy would recreate the two-implementations
  hazard.
- **A zero-weight set adds reps and no tonnage; an assisted set subtracts nothing.** A week whose only
  sets are a plank and an assisted pull-up totals exactly `0` — not a negative number, and `hasSets`
  is true.
- **The Sunday boundary**, against the database: a set on the Sunday counts in that week, and the
  Monday after it counts in the next. This is the assertion nothing in the repository has today.
- **A week with no sets returns `hasSets: false` and `kilograms: 0`**, and the read did not fail.
- **Mixed units sum correctly**: a set typed in `lb` and one in `kg` in the same week total the right
  kilograms, proving `weight_kg` is the summed column.
- **Another account's sets are not in the total** — the `security_invoker` boundary, the shape
  `personal-records.test.ts` assertion 2 uses. **An unauthenticated client has no read path at all**
  either (`exercises-rls.test.ts` has the precedent): `revoke all … from anon` is in the contract and
  nothing else attacks it.
- **Moving a workout across a Monday moves tonnage from one week to the other** — a set in the
  previous week's Sunday, read back as `previous > 0, current === 0`; then the workout's
  `performed_on` is patched to the current week's Monday through `updateWorkoutRoute`; read back
  again as `previous === 0, current > 0`, **both in one assertion**, because the property is that
  both walls move together. This is **US-03's fifth acceptance criterion**, it is uncovered today, and
  without this assertion this plan would be claiming coverage it does not have — the exact error it
  spends a section catching in its own inheritance. The date-change mechanics are ready to copy from
  `record-impact.test.ts:483-489`.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit, render, integration and build all pass
- `npm run db:status` shows the new migration applied to **both** projects
- `src/db/database.types.ts` regenerated and committed; `daily_tonnage` present in the `Views` block
- **The migration contains no `profiles`, no `timezone` and no `date_trunc`: a grep over the file.**
  This grep — not the criterion below it — is the real guard on the timezone rule
- `weekly-tonnage.test.ts` passes, including the Sunday-boundary and the moved-workout assertions
- `preferences-derive.test.ts` assertion 3 still passes — **a regression check, expected green, and
  NOT the guard it was believed to be.** That assertion reads only `workouts` and `personal_records`;
  nothing writable in this migration can make it fail, including a view that mis-projects
  `performed_on` through the profile zone, because such a view would move neither relation. Its
  comment says otherwise and is corrected in Phase 5
- Mutation (a): removing `greatest(…, 0)` makes the assisted-set assertion go negative
- Mutation (b): shifting the range by one day fails the Sunday-boundary assertion
- Mutation (c): summing `s.weight` instead of `s.weight_kg` fails the mixed-unit assertion
- Mutation (d): making the service answer `kilograms: 0` on a read error fails the zero assertion —
  and if no assertion catches it, the claim is corrected where it lives (`lessons.md`), naming the
  guarantee, saying no mutation available today breaks it, and naming the edit that would
- **Mutation (e): removing `with (security_invoker = true)` from the view fails the cross-account
  assertion.** Access control is a hard guardrail here and the flag is the whole of it — without the
  mutation there is no evidence the cross-account assertion bites. S-04 ran exactly this mutation on
  `set_estimates` and it is where the defence-in-depth lesson came from

#### Manual Verification:

- The owner has seen the suite's output, in particular the Sunday-boundary assertion — the first
  evidence in this repository that a week boundary is anything more than two hardcoded constants

**Implementation Note**: still no user-visible change. Pause after this phase for the owner.

---

## Phase 3: The screen

### Overview

Two figures on `/dashboard`, and the three states they can be in.

### Changes Required:

#### 1. The scalar converter

**File**: `src/lib/services/set-display.ts`

**Intent**: Convert a total in kilograms to the reader's unit without faking a set and without a third
copy of `KG_PER_LB`.

**Contract**: `kilogramsIn(kilograms: number, unit: WeightUnit): number`, and **`weightInUnit`'s
second branch is refactored to call it**, so the constant keeps exactly one reader inside the module.
This module already owns `KG_PER_LB` and `roundForDisplay`, is dependency-free and `astro:*`-free, and
its test file already imports all three by name — so `src/lib/services/set-display.test.ts` is where
the unit test goes (`lessons.md`: a criterion demanding a unit test must name the module that will
hold it).

#### 2. The figure

**File**: `src/lib/services/tonnage-display.ts` _(new)_

**Intent**: One place that decides what a weekly total looks like, testable without rendering a page.

**Contract**: `tonnageFigure(kilograms: number, unit: WeightUnit): string` — converts through
`kilogramsIn`, then rounds to **whole units** and formats with a thousands separator via
`Intl.NumberFormat` (proven available in workerd by the 418-zone measurement, so no new dependency).

**The locale is passed explicitly, and this is the same hazard `calendar.ts:38` already measured.**
`new Intl.NumberFormat()` with no locale inherits the runtime default: `12 345` under `en-US` and
`12.345` under `de-DE` — a number a reader parses as twelve. `calendar.ts` pins `"en-US"` for exactly
this reason ("a locale that happens to produce ISO order is how a date silently becomes `11/08/2026`
on somebody else's build") and the comment here points at it. Note the render suite cannot catch this:
`vitest.render.config.ts` disclaims runtime fidelity, so a separator proven in Node proves nothing
about workerd.

It returns a **string**, where `record-display.ts` returns `{ value: number }` and lets the page print
the unit. First formatter in the repository; the header says so rather than leaving the difference to
be discovered.

**Rounding is whole units on purpose, and it is a departure from `roundForDisplay`'s one decimal
place.** A tenth of a kilogram is a real distinction on a barbell and noise on a five-digit weekly
total; `12 345.7 kg` claims a precision the figure does not have, and pounds are worse. The conversion
happens **before** the rounding, never after — the rule `roundForDisplay`'s own comment states.

#### 3. The screen

**File**: `src/pages/dashboard.astro`

**Intent**: Put the two figures where US-03 says they belong — visible on opening, not behind a click.

**Contract**: The existing **unfiltered** profile read is **widened by one column** to
`timezone, weight_unit` and otherwise left exactly as it is, comment included. That read is F-03's
demonstration that RLS returns one row; widening it keeps the demonstration, keeps the page to one
profile query, and keeps the render suite's stub to one chain shape.

**`weeklyTonnage` is called in the frontmatter inside a `try/catch`**, following
`workouts/index.astro:16-31`: the `catch` sets `tonnageFailed = true` and logs the house
`console.warn`. Without naming this the criteria below describe a state the page has no way to reach —
a service that throws in Astro frontmatter produces a **500**, not a red panel.

**A page-level failure state, and then a per-figure state for each week.** The page-level state is one
thing; `hasSets` is per `WeekTonnage`, and US-03's criterion is about **a week**, not about the page:

1. **Page-level failure** — the tonnage read failed **or the profile row is absent**. The house red
   panel, the house sentence, and **no figure at all**. The profile case belongs here and is not
   optional: after this change a missing profile means the unit and the zone are both unknown, and
   printing a figure under a defaulted unit — or a week computed in UTC for someone who is not in it —
   is precisely the defect the S-06 implementation review found in `settings.astro` and pinned at
   `tests/render/settings-island.test.ts:181-210` ("refuses to render the form rather than presenting
   defaults as choices"). Note `maybeSingle()` returns `null` **without** throwing, so this needs its
   own branch.
2. **Per figure: no sets that week** — the figure `0` with its unit, plus a sentence saying no sets
   were logged **for that week**. US-03 requires the zero to be shown, so this never replaces the
   number. **The common case makes this per-figure rather than per-page**: the first week anybody ever
   logs has `current > 0` and `previous` empty, and a page-level model puts that in state 3, leaving
   last week's `0` bare — the blank US-03 forbids.
3. **Per figure: a figure** — the week's total, labelled.

At 360 px the two figures must both be readable; the card is narrow, so they stack rather than
crowd.

#### 4. What it asserts

**File**: `tests/render/dashboard-tonnage.test.ts` _(new)_

**Intent**: Prove the three states from the rendered HTML — the only suite that can, since
`/dashboard` is behind `PROTECTED_ROUTES` and `astro dev` authenticates against production.

**Contract**: Renders the real page through Astro's container with a stubbed `locals`, as
`settings-island.test.ts` does. A **non-vacuity assertion first** — the page rendered something —
because every "the wrong thing is absent" check passes against a page that rendered nothing.

- The zero week renders `0` **and** its explanation, and does **not** render the failure sentence.
- The failed read renders the failure sentence and **no digit-and-unit pair**.
- **An absent profile row** (`{ data: null, error: null }` — the stub shape is ready at
  `settings-island.test.ts:191-204`) renders the failure state and no figure.
- **One week with sets and one without** renders **both** figures, with the explanation on the empty
  one only. This is the state a real first-time user is in and the one a page-level model gets wrong.
- **Both figures change together** between `kg` and `lb`: the assertion compares the **pair** and
  requires **both** to differ and both to carry the same unit suffix. Asserting on one figure passes
  against code that converts `current` and prints `previous` raw, which is half of AC-4.
- No hydrated island appears — `<astro-island>` is absent. (Phrased as "hydrated island" because the
  page does carry a plain `<form method="POST">` for sign-out, which is not JavaScript.)

### Success Criteria:

#### Automated Verification:

- **The pre-phase `ls dist/client/_astro` listing is recorded in Progress 3.0 before any code is
  written.** The threshold goes in before the measurement, not after (`lessons.md`)
- Lint, typecheck, unit, render, integration and build all pass
- `dashboard-tonnage.test.ts` passes, including the non-vacuity assertion, the absent-profile state
  and the one-week-empty state
- `kilogramsIn` and `tonnageFigure` are unit-tested at `0`, a small week, a five-digit week and a
  **sub-unit week** — a total that converts to less than one unit (`0.4 kg` is reachable from a
  single light set typed in pounds) must round to `0` while `hasSets` stays true, or the screen tells
  somebody who trained that they did not
- `tonnageFigure` passes an explicit locale: a grep shows no bare `new Intl.NumberFormat()`
- **The `dist/client/_astro` listing recorded in 3.0 is unchanged** — the baseline is written into
  Progress from the pre-phase build, because "gains no new chunk" is unmeasurable without one and
  becomes a negotiation after the fact (`lessons.md`)
- Mutation (a): rounding before converting instead of after fails a pounds assertion
- Mutation (b): rendering `0` on a failed read fails the failure-state assertion
- Mutation (c): dropping the unit conversion fails the kg-vs-lb assertion
- Mutation (d): converting only `current` and printing `previous` raw fails the change-together
  assertion

#### Manual Verification:

All local, against `astro dev`; the same actions are repeated against the public address in Phase 4.

- The two figures appear on `/dashboard` after signing in, without clicking anything
- Logging a set today changes this week's figure on reload, and leaves last week's alone
- Switching the unit on `/settings` changes both figures together
- A plank logged at zero load leaves the figure unchanged
- Moving a workout from the **previous** week's Sunday to the **current** week's Monday — the only
  direction in which both ends are on screen — drops last week's figure by that workout's tonnage and
  raises this week's by the same amount. Taking the *current* week's Sunday instead pushes it into a
  week the screen does not show, and the tonnage disappears from both figures, which looks like data
  loss and is not. Compute the two dates before starting rather than reasoning from "this Sunday"
- At 360 px both figures are readable and nothing overlaps

**Implementation Note**: pause here for the owner's confirmation before deploying.

---

## Phase 4: Deploy, and prove it on the public address

### Overview

The slice's outcome is a screen, so it carries its own deployment phase (`lessons.md`), including the
automatic push-and-CI criterion.

### Changes Required:

#### 1. Push before deploying

**Contract**: `git push origin main`, then a CI run against that exact SHA observed to conclude green
— **its run number written into the Progress row**.

#### 2. Deploy

**Contract**: `npm run build` then `npx wrangler deploy`; the version id recorded in Progress. No new
Worker secret and no new environment variable.

**Order matters this time**: the migration must be on **production** before the Worker that reads the
view is deployed, or the page 500s on every request. `npm run db:push` already applied both in
Phase 2; confirm with `npm run db:status` before deploying rather than after.

#### 3. Prove it under the public address

**Contract**: A read-only scripted probe (`node -e 'fetch(...)'`, never `curl` — schannel fails TLS on
fresh Cloudflare hosts) showing `/dashboard` redirects a signed-out visitor; then the owner, signed
in, seeing the two figures and watching this week's follow a newly logged set.

### Success Criteria:

#### Automated Verification:

- `git status` clean and `git log origin/main..HEAD` empty
- CI run for the deployed SHA is green, run number recorded in Progress
- `npm run db:status` shows the migration on **both** projects before the deploy
- `npx wrangler deployments list` shows the new version at 100% of traffic, id recorded in Progress
- The scripted probe reports `302 → /auth/signin` for `/dashboard` while signed out. **This is the
  only check of the redirect** — the integration suite cannot assert it, because the redirect lives in
  `src/middleware.ts`, which imports `astro:middleware` and is unresolvable in every vitest config
- **The view is reachable through production's PostgREST**, probed as
  `${SUPABASE_URL}/rest/v1/daily_tonnage?select=user_id&limit=1` with the publishable key and no
  session: a **permission error proves the route exists**, while `PGRST205` proves the schema cache
  never reloaded. Being in the schema is not the same as being reachable — the migration ends with
  `notify pgrst, 'reload schema'`, and if that never lands the page shows its failure state, which
  looks identical to a missing view. Run this before any 500 is diagnosed as anything else

#### Manual Verification:

- Public address: the two figures are on the dashboard after signing in
- Public address: logging a set changes this week's figure and not last week's
- Public address: switching the unit changes both figures together

**Implementation Note**: this phase writes to production. Do not run it while the owner is away.

---

## Phase 5: Truth up the documents

### Overview

What this slice made true, and the four inherited claims it proved false.

### Changes Required:

#### 1. The agent guide

**File**: `AGENTS.md`

**Contract**: § Domain rules gains the tonnage rule as implemented — `reps × greatest(weight_kg, 0)`,
one term for both exclusions — and the statement that **the profile timezone decides what "today" is
and nothing else**, with the stored-`date` invariant named. § Known state gains `public.daily_tonnage`
and the dashboard figures.

**§ Access control → the derived-view variant needs the third view.** That section is written around
there being two, and its whole argument is that their flags are *not* equally load-bearing. A third
view reading the base tables directly — whose flag **is** load-bearing and now has a mutation proving
it — is the only new information that section has had since S-04.

**§ Commands is already wrong and this phase fixes it**: it says the gate is `lint → typecheck →
test → test:integration → build` and to "run all **five**", while `.github/workflows/ci.yml` has run
`test:render` since S-06 and this plan says six throughout.

Also correct the `KG_PER_LB` count. `AGENTS.md` says two copies; there are **four** — the generated
column, `set-display.ts`, `tests/integration/preferences-derive.test.ts:38` and
`tests/integration/workout-mutations-rls.test.ts:364`. The two test copies are defensible as fixtures
checking the generated column from outside, but the stated number is wrong. (The first draft of this
plan said "three", which was also wrong — recorded because a miscounted correction is worse than none.)

#### 2. Routes and scripts

**File**: `README.md`

**Contract**: The `/dashboard` row gains the weekly figures. A line stating that tonnage is derived at
read time, summed in Postgres, and stored nowhere. **§ Available Scripts is missing
`npm run test:render` entirely** — it has been in CI since S-06 and is not listed; add it here.

#### 3. Lessons

**File**: `context/foundation/lessons.md`

**Contract**: Append only what this slice actually paid for. The strongest candidate comes from
planning rather than implementation: **a handover sentence that passes two different decisions to the
next slice in one breath will be inherited as one decision** — S-05 handed S-07 FR-006's date-change
warning and Open Question 2 together; `STATE.md` and this slice's own `change.md` both copied the
merged version, and it took a fresh reader and the roadmap to separate them. Second candidate, if the
evidence holds: **a test whose title claims more than its body asserts is worse than a missing test**,
because three documents then cite the title (assertion 9).

#### 4. The corrections

**Files**: `C:\10xdev\handoff\STATE.md`, `context/foundation/roadmap.md`

**Contract**: `STATE.md:158-160,703-706` — remove the claim that assertion 9 proves week membership;
say what it actually asserts. `STATE.md` § what S-06 left S-07 — Open Question 2 is S-08's.
`roadmap.md:241` — the "Full record" path points at `context/changes/personal-records/plan.md`, which
moved to `context/archive/2026-08-11-personal-records/`. Roadmap S-07 → `done`. Also record the
**`s03-` prefix-nesting trap** where the next person choosing a MARK will read it.

**And correct the tripwire comment this slice invalidates.** `preferences-derive.test.ts:331-336`
says _"S-07 is the slice that will make it [bite]"_. After this slice that is false in both
directions: S-07 considered the mis-projecting view and **rejected** it, and nothing in this slice can
make the assertion fail. The plausible next author of that edit is **S-08**, widening `daily_tonnage`
to derive a week in SQL. `lessons.md` requires the named future edit to be **current** — that currency
is the only thing separating a tripwire from decoration, so the file is **not** left unchanged.

#### 5. The handoff

**Files**: `C:\10xdev\handoff\STATE.md`, `context/changes/weekly-tonnage/change.md`

**Contract**: `STATE.md` gains "what S-07 left S-08": the total exists and per-group figures must sum
to it exactly; `daily_tonnage` is grouped at `(user_id, performed_on)` and S-08's grain is
`(user_id, performed_on, exercise_id)` with the muscle group joined at read time; Open Question 2 is
**S-08's and is still open**; the volume-fixture blocker is weaker than the roadmap says, and a third
account removes it. `change.md` records every deviation.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit, render, integration and build all pass
- Every file path and assertion name newly cited in `AGENTS.md` exists: a script resolves each
- A script confirms the documentation facts: `README.md` mentions the dashboard figures; `STATE.md` no
  longer claims assertion 9 proves week membership; `roadmap.md` shows S-07 `done` and its "Full
  record" path resolves
- `git log origin/main..HEAD` empty after the phase commit

#### Manual Verification:

None.

**Implementation Note**: after this phase, `/10x-impl-review` then `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/calendar.test.ts` — `mondayOf` and `trainingWeeksFor` at the Sunday, DST,
  month-end and year-end boundaries, plus a Monday and the seven-day gap between the two weeks.
- `src/lib/services/set-display.test.ts` — `kilogramsIn` in both directions, and `weightInUnit` still
  green after being refactored onto it.
- `src/lib/services/tonnage-display.test.ts` — `tonnageFigure` at `0`, a small week and a five-digit
  week, in both units; the separator; conversion before rounding.

### Integration Tests:

- `tests/integration/weekly-tonnage.test.ts` — the sum against an independent TypeScript sum, the two
  exclusions, the Sunday boundary, the empty week, mixed units, and the cross-account boundary.
- `tests/integration/preferences-derive.test.ts` — **unchanged**, and expected to stay green. It is
  the tripwire for the mistake this slice is most likely to make.

### Render Tests:

- `tests/render/dashboard-tonnage.test.ts` — the three screen states and the unit following the
  profile.

### Manual Testing Steps:

1. Sign in and confirm both figures are on the dashboard without clicking anything.
2. Log a set today; reload; this week's figure moves and last week's does not.
3. Log a plank at zero load; the figure does not move.
4. Move a workout from a Sunday to the Monday after it; tonnage moves between the two weeks.
5. Switch to pounds on `/settings`; both figures change together.
6. Do all of the above at 360 px, keyboard only.

## Performance Considerations

The aggregation is one indexed range scan over `workouts_user_performed_on_idx` joined down to `sets`
through indexes that already exist, returning at most 14 rows. No new index. The `DESC` on that
index's second column is irrelevant to a `BETWEEN` — a btree scans either direction, and the sort
order only matters for satisfying an `ORDER BY`.

**The dashboard gains a second, unavoidably sequential round trip.** It is the landing page after
sign-in (`signin.ts:40`, `middleware.ts:39`), and the tonnage read cannot start until the profile read
returns, because it needs the timezone. Two round trips to Frankfurt on the first page after login,
against an NFR of 2 s p95 on mobile. Not a blocker and not worth restructuring for — but named here so
it reads as a considered cost rather than an oversight.

**A limitation inherited from S-04 and stated rather than hidden**: index usage cannot be verified in
this environment, because `gymlog-test` holds a few dozen sets and Postgres correctly prefers a
sequential scan at that size. Aggregating in Postgres is the right call **on the architecture argument
alone; it is not a measured one**, and this plan does not claim otherwise.

What it would take, recorded because the roadmap's version of this is overstated: seeding ~2,000 sets
under a distinct MARK **on a third account**. No existing cleanup predicate would touch it — every
delete is `.like("<prefix>%")` **and** `.eq("user_id", …)`. The real interaction is two unfiltered
account-wide reads in `preferences-derive.test.ts:341-350`, and a third account removes it entirely.

## Migration Notes

**One migration, additive, on both databases.** It creates a view and grants `select` on it; it drops
nothing and alters no table. `npm run db:push` applies to `gymlog-test` first, then production; there
is no single-target push. `npm run db:types` afterwards regenerates from **production**, so production
must have the view before the committed types are right.

## References

- Change identity, the two corrected inheritances and the FR-022/FR-006 rulings:
  `context/changes/weekly-tonnage/change.md`
- The derived-view seam this slice copies: `context/archive/2026-08-11-personal-records/plan.md`
- The index created for this slice: `context/archive/2026-08-10-log-workout-with-estimate/plan.md:218`
- The tripwire aimed at this slice: `tests/integration/preferences-derive.test.ts:317-335`
- Roadmap item: `context/foundation/roadmap.md` § S-07

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The week, in one place

#### Automated

- [x] 1.1 Lint, typecheck, unit, render, integration and build all pass — 202 unit (was 189), 11 render, 95 integration — c5da6da
- [x] 1.2 `calendar.test.ts` covers the Sunday, DST, month-end and year-end boundaries — 13 new assertions: Sunday, Monday, all seven weekdays of one week, month end, year end, leap day, both DST directions, the Sunday-night rollover in the reader's zone, and a 365-instant sweep asserting both weeks are always 7 days and always meet — c5da6da
- [x] 1.3 `calendar.ts` still imports nothing and reaches no `astro:*` module — zero `import` statements; the only `astro:` in the file is the comment saying it has none — c5da6da
- [x] 1.4 Mutation (a): millisecond subtraction fails the DST case — a LOCAL `Date` constructor plus `days * 86400000` fails the 365-instant sweep (`expected 172800000 to be 86400000`). **Finding: it passes under UTC**, which is what CI runs, so the guard was decoration in the gate until the zone was pinned — see 1.7 — c5da6da
- [x] 1.5 Mutation (b): `getDay()` for `getUTCDay()` fails a boundary — fails six assertions. **Finding: it too was inert until the pin, and for a different reason.** For a value anchored at `T00:00:00Z` the two accessors differ only at a NEGATIVE ambient offset, so it passed under UTC and under `Europe/Warsaw` alike — c5da6da
- [x] 1.6 Mutation (c): shifting the weekday mapping by one fails the Sunday case — fails six assertions — c5da6da
- [x] 1.7 **Added: `vitest.config.ts` pins `TZ` to a zone with DST and a negative offset.** Not in the plan, and it is what makes 1.4 and 1.5 mean anything. The first pin chosen was `Europe/Warsaw` — the product's default and the owner's zone, which read as principled and **silently left mutation (b) inert**, since Warsaw's offset is positive. `America/New_York` has both properties and both mutations bite under one setting. That it is nobody's real zone is the point: the value under test is supposed to be zone-independent. Note the config setting **overrides a `TZ` prefix on the command line** — c5da6da

### Phase 2: The aggregation

#### Automated

- [x] 2.1 Lint, typecheck, unit, render, integration and build all pass — 202 unit, 11 render, 103 integration (+8) — 7f62140
- [x] 2.2 `npm run db:status` shows the migration applied to both projects — `20260813150000` on `gymlog-test` and `gymlog` — 7f62140
- [x] 2.3 `database.types.ts` regenerated and committed with `daily_tonnage` in the `Views` block — three columns, all `T | null` as expected through a view — 7f62140
- [x] 2.4 The migration contains no `profiles`, no `timezone` and no `date_trunc` — the real guard. The single hit in the SQL body is the word "timezones" **inside the `comment on view` string**, which is prose, not a reference — 7f62140
- [x] 2.5 `weekly-tonnage.test.ts` passes, including the Sunday-boundary and moved-workout assertions — 8 assertions — 7f62140
- [x] 2.6 `preferences-derive.test.ts` assertion 3 still passes — regression check, not the guard — 7f62140
- [x] 2.7 Mutation (a): removing `greatest(…, 0)` makes the assisted-set total go negative — **−160 kg** — 7f62140
- [x] 2.8 Mutation (b): shifting the range by one day fails the Sunday boundary — fails three assertions, including the independent-sum one — 7f62140
- [x] 2.9 Mutation (c): summing `weight` instead of `weight_kg` fails the mixed-unit assertion — reads the naive **1000** where the answer is **726.80** — 7f62140
- [x] 2.10 Mutation (d): answering `0` on a read error fails the zero assertion — **it does NOT, and the claim is corrected rather than the test faked** (`lessons.md`). No assertion in this suite provokes a read failure, and none writable from it can: the failure needs the database unreachable or the grant removed, neither of which a suite holding only a publishable key can arrange. **The guarantee is therefore unproven, and the edit that would make it bite is a render assertion in Phase 3** — stubbing the service to throw and requiring the page to show its failure sentence and no figure. Criterion 3.7 is that assertion; this row is what points at it — 7f62140
- [x] 2.11 Mutation (e): removing `security_invoker` fails the cross-account assertion — the sharpest of the five: with the flag off, **account B read ten rows of account A's tonnage**. **Deviation, decided by the owner**: the S-06 review (F2) forbade replacing a view out of band, and doing this needed exactly that. It was allowed here because the two reasons behind that rule do not both hold — nothing depends on `daily_tonnage`, so no drop cascades — and because the verification gap that caused the rule was closed rather than ignored: each mutation was applied to `gymlog-test` alone through a scratchpad runner that refuses a URL equal to production's, and every restore was confirmed by reading `security_invoker`, `GREATEST` and `weight_kg` back out of `pg_class`/`pg_get_viewdef`, not by assuming — 7f62140

#### Manual

- [x] 2.12 Owner has seen the suite's output, in particular the Sunday-boundary and moved-workout assertions — confirmed 2026-08-13 — 7f62140

### Phase 3: The screen

#### Automated

- [x] 3.0 Baseline `ls dist/client/_astro` from the pre-phase build recorded here — **18 files**: ExerciseCatalogue, Layout.css, NewWorkoutForm, PreferencesForm, RecordImpactDialog, SignInForm, SignUpForm, WorkoutDetail, WorkoutHeader, auth, client, index (x2), loader-circle, search, types, utils, workout
- [x] 3.1 Lint, typecheck, unit, render, integration and build all pass — 211 unit (+9), 18 render (+7), 103 integration
- [x] 3.2 `dashboard-tonnage.test.ts` passes: non-vacuity, absent profile, one-week-empty, change-together — 7 assertions across four rendered states
- [x] 3.3 `kilogramsIn` and `tonnageFigure` unit-tested at zero, sub-unit, small and five-digit, both units — 9 assertions; the sub-unit case is the one that separates rounding-before from rounding-after
- [x] 3.4 `dist/client/_astro` listing identical to the 3.0 baseline; no `@supabase/` in `dist/client/` — 18 files, same module names, **no new chunk**. Four content hashes moved (Layout.css, RecordImpactDialog, WorkoutDetail, WorkoutHeader) because `set-display.ts` gained an export those islands import — a rehash, not a new module
- [x] 3.5 `tonnageFigure` passes an explicit locale — no bare `new Intl.NumberFormat()` — the only grep hit is the comment explaining why
- [x] 3.6 Mutation (a): rounding before converting fails a pounds assertion — fails the sub-unit case: `0.4 kg` prints `0` in pounds where it must print `1`
- [x] 3.7 Mutation (b): rendering `0` on a failed read fails the failure-state assertion — fails. **This is also the edit Progress 2.10 named**: the read-error guarantee the integration suite could not prove is proven here, at the screen
- [x] 3.8 Mutation (c): dropping the conversion fails the kg-vs-lb assertion — fails
- [x] 3.9 Mutation (d): converting only `current` fails the change-together assertion — fails — the half of US-03's fourth criterion a single-figure assertion would have missed

#### Manual

- [x] 3.10 Local: both figures appear on `/dashboard` after signing in, without clicking — owner confirmed 2026-08-13
- [x] 3.11 Local: logging a set moves this week's figure and not last week's — owner confirmed 2026-08-13
- [x] 3.12 Local: switching the unit changes both figures together — owner confirmed 2026-08-13
- [x] 3.13 Local: a plank at zero load leaves the figure unchanged — owner confirmed 2026-08-13
- [x] 3.14 Local: moving a workout from the PREVIOUS week's Sunday to the CURRENT week's Monday moves tonnage between the two visible figures — owner confirmed 2026-08-13
- [x] 3.15 Local: at 360 px both figures are readable and nothing overlaps — owner confirmed 2026-08-13

### Phase 4: Deploy, and prove it on the public address

#### Automated

- [ ] 4.1 `git status` clean and `git log origin/main..HEAD` empty
- [ ] 4.2 CI run for the deployed SHA green — run number recorded here
- [ ] 4.3 `npm run db:status` shows the migration on both projects before the deploy
- [ ] 4.4 Worker version at 100% of traffic — version id recorded here
- [ ] 4.5 Scripted probe: `/dashboard` redirects a signed-out visitor
- [ ] 4.6 Probe: `daily_tonnage` answers a permission error (route exists) rather than `PGRST205` (schema cache never reloaded)

#### Manual

- [ ] 4.7 Public address: both figures on the dashboard after signing in
- [ ] 4.8 Public address: logging a set moves this week's figure and not last week's
- [ ] 4.9 Public address: switching the unit changes both figures together

### Phase 5: Truth up the documents

#### Automated

- [ ] 5.1 Lint, typecheck, unit, render, integration and build all pass
- [ ] 5.2 Every newly cited file path and assertion name resolves
- [ ] 5.3 A script confirms the README line, STATE.md's corrected assertion-9 claim, and the roadmap's
      S-07 status and resolved "Full record" path
- [ ] 5.4 `git log origin/main..HEAD` empty after the phase commit
