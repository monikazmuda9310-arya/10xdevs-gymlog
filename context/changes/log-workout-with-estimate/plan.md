# Log a Workout and See What It Was Worth — Implementation Plan

> Roadmap item: **S-03**, the north star (`context/foundation/roadmap.md` § Slices)
> Change identity: `context/changes/log-workout-with-estimate/change.md`
> Research: `context/changes/log-workout-with-estimate/research.md`

## Overview

This is the slice the product exists for. Everything before it was scaffolding: an account, a
catalogue, a deployment. Here the user creates a workout dated today, adds an exercise from the
catalogue, types repetitions and a weight, and immediately sees an estimated one-rep max — the
arithmetic that the notebook in the gym bag cannot do.

**The hard part is not the CRUD and it is not the formula — both are solved.** The formula has been
sitting in `src/lib/services/one-rep-max.ts` since F-01, correct and tested at every boundary, with
no caller. The hard part is that the record now has **three levels** (workout → exercise entry →
set) and every one of them has to be unreachable from another account, including by naming an
identifier directly. Row-level security as written in this repository checks `user_id` on the row in
front of it and nothing else — which is enough for a flat table and **not** enough for a nested one.
An account can hold a valid `user_id` on a row it inserts and still graft that row onto somebody
else's parent. Closing that without a trigger is this plan's central technical decision.

## Current State Analysis

Measured against the working tree at `1b8aca8` on 2026-08-11, not recalled. Full survey:
`context/changes/log-workout-with-estimate/research.md`.

### What exists

- **The estimate, complete and unused.** `src/lib/services/one-rep-max.ts:27-53` exports
  `isEstimable` and `estimateOneRepMax`, dependency-free, returning `null` rather than a fabricated
  number, pinned at `reps === 1`, and unit-tested at 1, 12, 13, 37 and 40 repetitions plus zero and
  negative load. **Nothing in `src/` calls either function.** This slice is the first caller.
- **Three tables**: `public.profiles` (one row per account, carrying `timezone`, `weight_unit`,
  `estimation_formula`, all `not null` with defaults) and `public.exercises` (38 seeded rows plus
  private custom ones). `public.set_updated_at()` exists and is reusable.
- **A complete vertical-slice template**, worked out end to end by S-02 and copyable file by file:
  migration → `db:types` → `src/types.ts` aliases → service taking an injected client → validation
  split across a browser-safe module and a server-only zod sibling → JSON endpoint returning
  `{code}` on failure → `.astro` page fetching in frontmatter → `client:load` island →
  `PROTECTED_ROUTES` → integration suite asserting against re-read rows.
- **The `weight_unit` and `estimation_formula` enums**, created in F-03 explicitly so that this
  slice would have them (`context/archive/2026-08-09-owned-persistence-baseline/reviews/plan-review.md`).

### What is missing

No `workouts`, no exercise entries, no `sets`. No service reads a profile preference — the only read
in the codebase is an inline single-column query in `src/pages/dashboard.astro:9` that prints the
timezone as text. No tonnage, no record detection, no week arithmetic, no unit conversion, and no
page beyond `/dashboard` and `/exercises`.

### Decisions this slice inherits and must not re-open

Settled with the owner on 2026-08-10 and recorded in `research.md` § Decisions:

- **Weight is stored as entered, with the unit it was entered in, plus a generated canonical
  column.** The round-trip is true by construction, not by a precision argument.
- **`performed_on` is a `date`.** The user states the date; there is nothing to re-project. The
  profile timezone is needed in exactly one place — computing the default "today".
- **`exercise_id` carries `on delete restrict`.** History is never silently destroyed.
- **A zero-load set keeps returning `0` from the estimator; the screen says "bodyweight".**
  Presentation rule, arithmetic untouched.
- **The middle table is `exercise_entries`**; no `position` column; RPE is `numeric(3,1)`.
- **Two Supabase projects stay two.**
- **Sets reference `exercise_id` only and never snapshot the muscle group**
  (`context/archive/2026-08-10-exercise-catalogue/plan.md:580-582`).

## Desired End State

- A signed-in user opens `/workouts`, sees their workouts most recent first, and creates a new one
  whose date already reads as today **in their own timezone**.
- On `/workouts/[id]` they add an exercise from the catalogue, type repetitions and a weight, and
  the set appears with an estimated one-rep max beside it — computed with the formula on their
  profile. Sets outside 1–12 repetitions say so instead of showing a number; zero-load sets say
  "bodyweight"; assisted sets say "assisted". Each exercise entry shows the best estimate among its
  own sets (FR-015).
- Everything survives a reload, because everything was saved when it was typed.
- **No account can read, write, or graft onto another account's workout, exercise entry or set** —
  including by naming an identifier directly — enforced in the database and proven against re-read
  rows.
- The whole flow works on the deployed URL, not only locally.

Verify: the five-command gate exits 0; the new integration suite proves the boundary at all three
levels against persisted state; and a real session on
`https://gymlog.10x-astro-starter.workers.dev` completes the log-and-see-the-estimate flow.

## What We're NOT Doing

- **Editing or deleting anything.** Correcting a workout, a set, or a date is S-05, and it is
  deferred for a concrete reason: FR-006/FR-007 require the user to be warned which record will fall
  and by how much before confirming — and records do not exist until S-04. A warning about a number
  the product cannot yet compute cannot be written, let alone tested.
- **Personal records.** No record detection, no "you beat your best" flag, no records list. That is
  S-04 and it is the next slice. This one stores the sets that S-04 will derive records from.
- **Tonnage, weekly totals, per-group breakdowns.** S-07 and S-08. This slice creates the columns
  and the indexes those aggregations will need and computes none of them.
- **Changing the unit or the formula.** S-06 ships the preference screen. This slice reads
  `profiles.weight_unit` and `profiles.estimation_formula` and honours whatever is there, which is
  today always the defaults (`kg`, `brzycki`).
- **A calendar view.** FR-005 resolves to a list; parked in the roadmap.
- **Reordering exercises within a workout.** No requirement, no column — see § Decisions.
- **Offline capture or a retry queue.** PRD § Non-Goals is explicit that connectivity is assumed,
  and an automatic retry is the one thing that can write the same set twice.
- **A shadcn component sweep.** Primitives get added if a form needs one; redesigning the UI is not
  this slice's job any more than it was S-02's.

## Implementation Approach

Six phases, ordered so that the access boundary is proven before any data can exist behind it, and
the arithmetic is proven — and deliberately broken to confirm the proof works — before any screen
displays it.

1. **The three tables and their access-control boundary**, with the integration suite that proves
   all three levels including the graft attempt.
2. **The estimate as a displayable value** — the pure function that decides what a set shows, and
   the profile read that supplies the formula and the timezone.
3. **Services, validation, and the three endpoints.**
4. **The screens**: the list and the workout.
5. **Deploy, and verify the flow against the public address.**
6. **Truth up the documents.**

### Critical Implementation Details

**Row-level security as written here does not protect a nested record, and the fix is declarative.**
Every policy in this repository is `(select auth.uid()) = user_id` on the row being touched. On
`exercise_entries` that check passes for an account inserting a row with _its own_ `user_id` and
_somebody else's_ `workout_id` — the policy never looks at the parent. The result is a row grafted
onto another account's workout: invisible to both parties, and a genuine integrity breach at exactly
the level US-04 names. A trigger would close it; a **composite foreign key** closes it without one.
Give `workouts` a `unique (id, user_id)`, then have `exercise_entries` reference
`(workout_id, user_id) → workouts (id, user_id)`. The graft now looks for a workouts row owned by
the grafter and does not find one. `sets` does the same against `exercise_entries (id, user_id)`.
The redundant unique indexes are the price, and they are cheap. **This pattern is new to the
repository and every future nested table must copy it** — which is why Phase 6 writes it into
`AGENTS.md`.

**The composite key must be the _only_ foreign key between each pair of tables.** PostgREST builds
its embed join from the foreign-key columns and handles composite keys natively, so
`select("*, exercise_entries(count)")` resolves through the two-column key with no hint syntax — but
only while exactly one path exists. Adding a "clarifying" plain
`workout_id references workouts (id)` alongside it creates a second constraint between the same pair
and every nested read starts failing with `PGRST201`, demanding
`exercise_entries!<constraint_name>(…)` at each call site. The migration says so in a comment,
because the redundant key is exactly the kind of thing a later reader adds for tidiness.

**The stored unit comes from the profile on the server, never from the request body.** A client that
could name the unit could store `100` with `weight_unit = 'lb'` while the user typed kilograms, and
the generated `weight_kg` would be wrong for every derived number afterwards. The endpoint reads
`profiles.weight_unit` and writes it; the body carries a bare number.

**`weight_kg` is an unconstrained `numeric`, deliberately.** Giving it a scale would reintroduce a
rounding step into the one column every record comparison and every future tonnage sum reads, which
is the thing the storage decision existed to remove. `weight` itself is `numeric(7,3)` because that
is what the user typed and input is limited to two decimal places.

**The generated column is legal only because the enum is never cast.** A stored generated column
requires an immutable expression. `case weight_unit when 'kg' then …` compares the enum column
against a literal that the parser folds into a typed constant, and enum equality is immutable — so
it is accepted. Writing the same intent as `weight_unit::text = 'kg'` would be **rejected at
`create table` time**, because `enum_out` is `STABLE`, not immutable. If the expression is ever
refused for a reason we have not anticipated, the fallback is a `before insert or update` trigger
maintaining `weight_kg`, which carries no immutability requirement — at the cost of the column no
longer being declarative. Either way production is protected by the push order: `npm run db:push`
applies to `gymlog-test` first and never touches `gymlog` if that fails.

**The bodyweight rule is the one constraint that cannot live in the database.** Whether a zero or
negative load is allowed depends on `exercises.is_bodyweight` — a different table — so no check
constraint can express it, and denormalising the flag onto the set would be the snapshot that S-02
forbade for the muscle group. It is therefore enforced in the endpoint, which already has to load
the entry to verify ownership. This is a data-quality rule and not an access-control rule, and the
arithmetic is independently defended: a negative load is excluded from estimation by
`isEstimable`, and contributes zero rather than a negative amount to any future tonnage.

**Do not name the TypeScript type `Set`.** It shadows the built-in and produces error messages that
send the reader looking in the wrong place. `WorkoutSet`.

---

## Phase 1: The three tables and their access-control boundary

### Overview

The schema, twelve policies, the composite foreign keys that carry ownership down two levels, the
regenerated types, and the suite that proves all of it — before a single row can exist.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<timestamp>_create_workout_log_with_row_ownership.sql` (new)

**Intent**: Create the three tables of the training record with RLS enabled in the same migration,
and make cross-account grafting impossible by construction rather than by convention.

**Contract**:

- `public.workouts`: `id uuid primary key default gen_random_uuid()`;
  `user_id uuid not null references auth.users (id) on delete cascade`;
  `performed_on date not null`; `note text` (nullable); `created_at` / `updated_at timestamptz not
null default now()`; a length check on `note` (1–500 characters when present — **the constraint
  rejects the empty string, so an untouched note field must arrive as `null`, not `""`**; Phase 3's
  schema is what normalises it); and **`unique (id, user_id)`** — redundant against the primary key
  and present solely as the target of the child's composite foreign key.
- `public.exercise_entries`: the same `id` / `user_id` / timestamps;
  `workout_id uuid not null`; `exercise_id uuid not null references public.exercises (id) on delete
restrict`; **`foreign key (workout_id, user_id) references public.workouts (id, user_id) on delete
cascade`**; `unique (workout_id, exercise_id)`; `unique (id, user_id)`.
- `public.sets`: the same `id` / `user_id` / timestamps; `exercise_entry_id uuid not null`;
  **`foreign key (exercise_entry_id, user_id) references public.exercise_entries (id, user_id) on
delete cascade`**; `reps smallint not null` checked 1–100; `weight numeric(7,3) not null` checked
  −1000–2000; `weight_unit public.weight_unit not null`; `rpe numeric(3,1)` checked 1–10 when
  present; and the generated column
  `weight_kg numeric generated always as (case weight_unit when 'kg' then weight else weight *
0.45359237 end) stored` — **no precision or scale**, for the reason in § Critical Implementation
  Details.
- `on delete restrict` on `exercise_id` is written explicitly rather than left to the default, so
  the next reader sees a decision instead of an omission. A comment states what it protects.
- Indexes: `workouts (user_id, performed_on desc)` — the list's ordering and, later, S-07's weekly
  window; `exercise_entries (user_id, workout_id)`; `sets (user_id, exercise_entry_id)`. Each exists
  because `AGENTS.md` § Access control requires the query to carry its own owner filter rather than
  leaning on the policy predicate under the 10 ms CPU cap.
- One more index that this slice does not use: **`exercise_entries (user_id, exercise_id)`**. S-04's
  central question is "every set this account has logged for this exercise", which reaches `sets`
  only through the entries and has nothing to travel on without it. It costs one line here and a
  migration later, and the asymmetry is the whole argument.
- A comment stating that the composite key is the **only** permitted foreign key to the parent, and
  what adding a second one does to every nested read — see § Critical Implementation Details.
- An `updated_at` trigger per table, reusing the existing `public.set_updated_at()` — three lines,
  no new function.
- **RLS on all three**, `revoke all from anon, authenticated`, `grant select, insert, update, delete
to authenticated`, and the four-policy block from `AGENTS.md` § Access control per table — twelve
  policies, every one `to authenticated`, `(select auth.uid())` never bare, update carrying both
  `using` and `with check`. Update and delete are granted although this slice ships no UI for
  either: the policy is the guarantee, and adding it after rows exist is a migration nobody
  remembers is needed. This is the same call S-02 made and it held.
- `notify pgrst, 'reload schema';` last.

#### 2. Apply and regenerate

**File**: `src/db/database.types.ts` (generated — never hand-edited)

**Intent**: Get the schema onto both projects and the types back into the repository, in that order,
because nothing enforces the second step.

**Contract**: `npm run db:push` (test project first — there is deliberately no single-target push),
then `npm run db:types`, then `npm run db:status` to confirm identical histories. **`git add` the
regenerated file before any `git grep` verification**, since an untracked file is invisible to it —
the gotcha `owned-persistence-baseline` hit.

#### 3. Shared types

**File**: `src/types.ts`

**Intent**: Expose the three new entities through the same derived-from-schema discipline as
`Profile` and `Exercise`.

**Contract**: `Workout`, `WorkoutInsert`, `WorkoutUpdate`; `ExerciseEntry`, `ExerciseEntryInsert`,
`ExerciseEntryUpdate`; `WorkoutSet`, `WorkoutSetInsert`, `WorkoutSetUpdate` — every one an alias of
`Database["public"]["Tables"][…]`, never a restated field list. **`WorkoutSet`, not `Set`.** No new
enum arrives, so no new `MutuallyAssignable` assertion is needed; the two that exist keep working.

#### 4. The boundary test

**File**: `tests/integration/workout-log-rls.test.ts` (new)

**Intent**: Prove the boundary at all three levels against persisted state, before a seed, a service
or a screen exists to hide a defect behind.

**Contract**: the shape of `exercises-rls.test.ts` — the two fixture accounts from
`GYMLOG_TEST_PASSWORD`, publishable key only, `required()` throwing rather than skipping,
run-unique values prefixed `s03-`, cleanup of its own prefix in `beforeAll`. Every negative paired
with a read-back as a caller entitled to see the row, so none can pass vacuously:

1. An account creates a workout, an entry and a set, and reads all three back.
2. **The other account cannot read any of the three by naming its id directly** — paired with that
   account reading its own rows successfully.
3. **Neither account can insert a row carrying the other's `user_id`**, at each of the three levels.
4. **The graft is refused**: account B, using its own `user_id`, cannot create an exercise entry
   whose `workout_id` belongs to account A — the composite foreign key rejects it. Re-read A's
   workout as A and assert the entry count is unchanged. **This assertion is the reason the
   composite keys exist; it is the only thing that would notice if a later migration "simplified"
   them into a plain `references workouts (id)`.** Do not delete it as redundant.
5. The same graft, one level down: B cannot create a set whose `exercise_entry_id` belongs to A.
6. **An exercise with logged history cannot be deleted** — `on delete restrict` raises, and the
   exercise is still readable afterwards. An exercise with no history still can be.
7. **The duplicate exercise entry is refused** — adding the same `exercise_id` twice to one workout
   raises `23505`; the same exercise in a _different_ workout succeeds.
8. **Deleting a workout takes its entries and sets with it** — cascade proven by re-reading for the
   children, not by trusting the declaration.
9. An anonymous client has no read path to any of the three: `data` is null and the error code is
   `42501`.

**Every refused crossing prints what the database actually answered** — the SQLSTATE and the
message — through a small `report()` helper the suite calls beside each negative assertion.
`context/foundation/lessons.md:37-51` requires that a guarantee be demonstrated by something which
attacks it and shows the raw response, rather than by asking a reader to judge SQL; this suite
already performs every crossing, so it is that something, and printing is the only part it was
missing. A standalone script was considered and rejected: a second implementation of the same eight
crossings would live outside the gate, and the copy that rots first is the one nobody runs.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies to both projects and `npm run db:status` shows identical histories.
- `npm run db:types` regenerated the file and it is staged:
  `git grep -n "exercise_entries" -- src/db/database.types.ts` returns matches.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- `npm run test:integration` exits 0 and reports **four** files.
- RLS is on for all three tables and the policy count is twelve, read from the database:
  `select relrowsecurity from pg_class where relname in ('workouts','exercise_entries','sets');`
  returns `t` three times, and
  `select count(*) from pg_policies where tablename in ('workouts','exercise_entries','sets');`
  returns `12`.

#### Manual Verification:

- Run `npm run test:integration -- --reporter=verbose` and read the suite's printed refusals: every
  boundary crossing was refused, and each names a reason — a policy denial (`42501`), a foreign-key
  violation (`23503`), a unique violation (`23505`) — rather than an empty result. An empty result
  where a refusal was expected is the failure mode that looks like success.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: The estimate as a displayable value

### Overview

The heart of this change, isolated so it can be tested and — per
`context/foundation/lessons.md:22-35` — deliberately broken to confirm the tests notice. S-01 shipped
a broken signup past 51 green tests because the load-bearing line stayed inline; this phase exists so
that cannot repeat.

### Changes Required:

#### 1. The display rule

**File**: `src/lib/services/set-estimate.ts` (new)

**Intent**: Decide what a logged set shows. `one-rep-max.ts` answers "what is the number"; this
answers "is there a number, and if not, why not" — and the difference matters because three of the
four answers are not numbers.

**Contract**: a new module rather than an extension of `one-rep-max.ts`, whose stated character is
"no rounding, no unit awareness" and which must stay that way. It imports `estimateOneRepMax` and
nothing else, so it stays browser-safe for the island. Exports a discriminated union and one
function:

```ts
export type SetEstimate =
  | { kind: "estimate"; oneRepMax: number }
  | { kind: "bodyweight" }
  | { kind: "assisted" }
  | { kind: "out-of-range" };

export function estimateForSet(weight: number, reps: number, formula: EstimationFormula): SetEstimate;
```

Order of evaluation is the contract, not an implementation detail: **zero weight is answered first**
(`bodyweight`, whatever the repetitions), then negative weight (`assisted`), then a `null` from
`estimateOneRepMax` (`out-of-range`), then the number. Zero is checked before the repetition range
because a plank at 20 repetitions is a bodyweight set, not an unestimable one, and telling the user
"outside 1–12" there would be answering a question they did not ask.

#### 2. Today, in the user's timezone

**File**: `src/lib/services/calendar.ts` (new)

**Intent**: Supply the workout form's default date. This is the single place the profile timezone is
needed in this slice, and getting it wrong is invisible: at 01:00 in Warsaw, UTC still reads
yesterday, so a session logged just after midnight would default to the wrong day.

**Contract**: `todayIn(timeZone: string, now?: Date): string` returning `YYYY-MM-DD`. Implemented
with `Intl.DateTimeFormat`, no dependency, no `astro:*` import. An invalid timezone string must not
throw a bare `RangeError` onto a page; fall back to UTC and say so in a comment.

**The unit test cannot prove this one works.** `vitest.config.ts` runs in `environment: "node"`, and
Node ships full ICU, so `todayIn` will pass its tests on a machine whose behaviour tells us nothing
about the runtime. The deployment target is workerd, no file in this repository uses `Intl` today,
and no primary Cloudflare document states that Workers carries complete IANA timezone data. If it
does not, the default date is silently wrong for anybody east or west of UTC — and the first check
that would notice sits in Phase 5, after the form, the endpoints and both screens are built on it.

#### 3. The runtime probe

**File**: `src/pages/api/dev/tz-probe.ts` (new, **temporary — deleted in Phase 5**)

**Intent**: Answer the ICU question in this phase, in the runtime that matters, instead of
discovering it three phases later.

**Contract**: a `GET` returning JSON with `todayIn("Pacific/Kiritimati", now)`, `todayIn("UTC", now)`
and `todayIn("Pacific/Niue", now)` for a fixed instant. Those two zones sit +14 and −11 from UTC, so
a correct ICU build puts them on **three different calendar dates** for the same moment and a
timezone-blind one collapses them to one. `astro dev` runs the real workerd (`AGENTS.md` § Cloudflare
traps), so a `curl` against the dev server is a genuine measurement rather than a Node one. Phase 5
deletes the file, and its removal is a success criterion there rather than a thing to remember.

#### 4. The profile read

**File**: `src/lib/services/profiles.ts` (new)

**Intent**: One place that loads the preferences every derived number depends on. Today the only
read is an inline single-column query in `dashboard.astro` that cannot be reused.

**Contract**: `getProfile(supabase, userId): Promise<Profile | null>` — injected client as the first
argument, `.eq("id", userId)` explicit alongside RLS, `maybeSingle()` so an absent row is a missing
value rather than a 500, `throw error` on a real failure. Returns the whole row: this slice needs
`estimation_formula`, `weight_unit` and `timezone`, and S-06 will need the same three.

#### 5. The tests, and the mutation

**Files**: `src/lib/services/set-estimate.test.ts`, `src/lib/services/calendar.test.ts` (new)

**Intent**: Cover the boundaries, then prove the coverage is real.

**Contract**: for `estimateForSet` — zero weight at 1, 5 and 20 repetitions all yield `bodyweight`;
negative weight yields `assisted` at any repetition count; 13 and 37 repetitions yield
`out-of-range`; 1 repetition yields an `estimate` equal to the weight for both formulas; 12
repetitions yields an `estimate`. For `todayIn` — an instant at 00:30 Europe/Warsaw returns a date
one day ahead of the same instant read in UTC; an instant at 23:30 UTC on the last day of a month
returns the next month in Warsaw; an invalid zone falls back rather than throwing.

**Then break each guard and confirm a test fails**, and record which mutation broke which test in
the commit message: change the zero check to `weight <= 0`; delete the `assisted` branch; widen
`MAX_ESTIMABLE_REPS`; make `todayIn` ignore its `timeZone` argument. A guard that cannot be made to
fail is decoration.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- `npm test` reports the two new suites and every boundary above is asserted.
- The new modules are hermetic — they import no `astro:*` module and no Supabase client:
  `git grep -n "astro:" -- src/lib/services/set-estimate.ts src/lib/services/calendar.ts` returns
  nothing (exits 1 on success; run it alone).
- `estimateForSet` is reachable from a hydrated island without pulling in zod or the Supabase
  client — verified by its import list, which is `./one-rep-max` and nothing else.
- **The runtime carries real timezone data**: with `npm run dev` running,
  `curl -s localhost:4321/api/dev/tz-probe` returns three **distinct** dates for Kiritimati, UTC and
  Niue. Identical dates mean a reduced-ICU build and the default-date approach has to change before
  Phase 4 depends on it.

#### Manual Verification:

- Each of the four mutations listed above was applied, the failing test was observed, and the
  mutation was reverted. Name in the commit message which test caught which mutation.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Services, validation, and the three endpoints

### Overview

Everything the screens will call, with the validation discipline S-01 established and the
message-code rule S-01's review turned into a hard rule.

### Changes Required:

#### 1. The service

**File**: `src/lib/services/workouts.ts` (new)

**Intent**: One place that knows how to read and write the training record, so a page and three
endpoints cannot drift in how they query it.

**Contract**: functions taking an already-built client, every read carrying an explicit
`.eq("user_id", userId)` as the index path with RLS as the guarantee:

- `listWorkouts(supabase, userId)` → workouts ordered `performed_on desc, created_at desc`, each
  with a count of its exercise entries via PostgREST's `exercise_entries(count)` so the aggregate is
  computed in Postgres rather than by walking rows in the Worker.
- `getWorkout(supabase, userId, workoutId)` → one workout with its entries, each entry's exercise
  (`id`, `name`, `muscle_group`, `is_bodyweight`) and each entry's sets ordered `created_at asc`.
  **One nested select, not four round trips.** Returns `null` when absent — which is the same answer
  for "does not exist" and "belongs to somebody else", and deliberately so.
- `createWorkout(supabase, userId, { performedOn, note })`.
- `addExerciseEntry(supabase, userId, workoutId, exerciseId)` → inserts and returns the entry; on the
  `23505` from `unique (workout_id, exercise_id)` it re-selects and returns the **existing** entry,
  so choosing an exercise already in the workout is idempotent rather than an error. That is the
  owner's decision on duplicates, expressed where the database enforces it.
- `addSet(supabase, userId, exerciseEntryId, { reps, weight, weightUnit, rpe })`.
- Named error-code constants in the file, as `exercises.ts` does with `UNIQUE_VIOLATION`; this file
  also needs the foreign-key violation code `23503` for the restrict path.

#### 2. Validation, browser-safe half

**File**: `src/lib/validation/workout.ts` (new)

**Intent**: The rules and the message catalogue, importable by a hydrated island without dragging
zod into the bundle — the split S-01 measured at ~59 KB.

**Contract**: imports nothing but types. Exports `MIN_REPS`/`MAX_REPS` (1/100),
`MIN_WEIGHT`/`MAX_WEIGHT` (−1000/2000), `MAX_WEIGHT_DECIMALS` (2), `MAX_NOTE_LENGTH` (500),
`MIN_RPE`/`MAX_RPE` (1/10); a `WORKOUT_MESSAGES` catalogue and `workoutMessageForCode()` following
`exercise.ts` exactly — an unrecognised code resolves to the generic message and **never** echoes
the caller's own string; and the shared predicate
`isWeightAllowed(weight: number, isBodyweight: boolean): boolean`, which is the owner's rule that a
zero or negative load requires the exercise's bodyweight flag. The form pre-checks with it and the
endpoint enforces with it, from one definition.

#### 3. Validation, server-only half

**File**: `src/lib/validation/workout-schemas.ts` (new)

**Intent**: The zod schemas, built from those rules. Nothing hydrated may import this module.

**Contract**: `parseCreateWorkout`, `parseAddExerciseEntry`, `parseAddSet`, each taking `unknown` and
returning `{ success: true, data }` or `{ success: false, code }` where the code is a
`WorkoutMessageCode` — the `code()` identity-helper pattern from `exercise-schemas.ts`. Dates are
validated as `YYYY-MM-DD` and rejected if unparseable; the weight is rejected beyond two decimal
places, which is what makes the round-trip promise checkable. **The note is trimmed and an empty
result becomes `null`, never `""`** — the table's length check starts at one character, so an
untouched note field would otherwise be refused by the database as a constraint violation the user
cannot act on. **The schemas do not know about the bodyweight rule** — it needs the exercise row and
therefore belongs to the endpoint.

#### 4. The endpoints

**Files**: `src/pages/api/workouts/index.ts`, `src/pages/api/exercise-entries/index.ts`,
`src/pages/api/sets/index.ts` (new)

**Intent**: Three creates, one per level, each independently reachable and therefore each
independently guarded.

**Contract**: all three are `POST`, `export const prerender = false`, read
`context.locals.supabase` and `context.locals.user` (never constructing a client — S-01's review
finding F4), parse JSON, validate, call the service, and return `{code}` and nothing else on
failure. Flat routes with the parent id in the body, matching `/api/exercises`.

- `/api/workouts` — body `{ performedOn, note? }`. 201 `{ workout }`.
- `/api/exercise-entries` — body `{ workoutId, exerciseId }`. 201 `{ entry }`, or 200 with the
  existing entry when it was already there. A `workoutId` that is not the caller's is refused by the
  composite foreign key; map `23503` to a not-found code rather than a 500.
- `/api/sets` — body `{ exerciseEntryId, reps, weight, rpe? }`. **The weight unit is not in the
  body**: the endpoint reads `profiles.weight_unit` via `getProfile` and writes it. It loads the
  entry (scoped by `user_id`) together with its exercise's `is_bodyweight`, returns a not-found code
  if absent, applies `isWeightAllowed`, and returns a specific code when the rule refuses — this is
  the user's own mistake and must stay legible, exactly as S-01 kept validation failures out of the
  collapsed-error path.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- Unit tests cover the validation boundaries: 0 and 101 repetitions, a weight with three decimal
  places, a note of 501 characters, **an empty and a whitespace-only note both normalising to
  `null`**, an RPE of 10.5, a malformed date, and `isWeightAllowed` across the four combinations of
  sign and flag.
- No provider prose escapes:
  `git grep -n "error.message" -- src/pages/api/workouts/ src/pages/api/exercise-entries/ src/pages/api/sets/`
  returns nothing (exits 1 on success — run it alone).
- The server-only schemas never reach the browser:
  `git grep -rn "workout-schemas" -- src/components/` returns nothing.
- A scripted sequence with a valid session creates a workout, adds an entry, adds a set, and
  re-reads all three; a second entry with the same exercise returns the first entry's id rather than
  an error; a zero-weight set on a non-bodyweight exercise is refused with the specific code.

#### Manual Verification:

- A POST to each of the three endpoints from a signed-out session creates no row — verified by
  re-reading the tables as the owner, not by the status code.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: The screens

### Overview

The list and the workout. This is where the product finally does arithmetic in front of somebody.

### Changes Required:

#### 1. The list page

**File**: `src/pages/workouts/index.astro` (new)

**Intent**: FR-005 — the user's own workouts, most recent first — and the entry point for creating
one.

**Contract**: server-side fetch in frontmatter via `listWorkouts` and `getProfile`, with a
`loadFailed` branch distinct from the empty state, following `exercises.astro:11-25`. Computes the
default date with `todayIn(profile.timezone)` and passes it to the island. Empty state explains that
no workout has been logged yet rather than rendering a blank area.

#### 2. The workout page

**File**: `src/pages/workouts/[id].astro` (new)

**Intent**: The screen where a set becomes a number.

**Contract**: `getWorkout` plus `listExercises` (for the picker) plus `getProfile`, all server-side.
When `getWorkout` returns `null`, respond **404** and render a plain "not found" — the same answer
for a workout that does not exist and one that belongs to somebody else, so the page is not an
existence oracle. Passes the workout, the catalogue, and the profile's `weight_unit` and
`estimation_formula` to the island.

#### 3. Route protection

**File**: `src/middleware.ts`

**Intent**: Training data belongs behind authentication, in both directions.

**Contract**: add `"/workouts"` to `PROTECTED_ROUTES` — the existing prefix match covers
`/workouts/[id]`. One array entry, never a per-page check.

#### 4. The islands

**Files**: `src/components/workouts/NewWorkoutForm.tsx`, `WorkoutDetail.tsx`, `ExercisePicker.tsx`,
`AddSetForm.tsx` (new)

**Intent**: Creating a workout, adding an exercise, logging a set, and showing what each set was
worth — without a page reload between sets.

**Contract**: each posts JSON and resolves failures **only** through `workoutMessageForCode`, never
by rendering a string from the response. Do **not** reuse `SubmitButton` from
`src/components/auth/` — it derives its pending state from `useFormStatus()`, which reports nothing
during a `fetch` + `preventDefault` submission, so the spinner would never spin; that is S-02's
finding F2 and `ExerciseForm.tsx` is the pattern to copy instead.

- `NewWorkoutForm` — a date input defaulted from the server-computed today and an optional note; on
  success navigates to `/workouts/<id>`.
- `ExercisePicker` — filters the already-fetched catalogue client-side, as `ExerciseCatalogue.tsx`
  does; choosing an exercise already in the workout scrolls to its entry instead of erroring, which
  is the visible half of the idempotent-entry decision.
- `AddSetForm` — repetitions and weight are the only required fields (NFR: one-handed on 360 px),
  RPE optional, the unit rendered as a static label from the profile since the client does not
  choose it. **On a failed save the typed values stay in the fields** and the message appears
  beneath, with the button re-enabled for a manual retry — no automatic retry, which is the one
  behaviour that can write the same set twice.
- `WorkoutDetail` — holds the entries in state and appends on success. Renders each set's
  `estimateForSet` result: a number for `estimate`, and a short phrase for `bodyweight`,
  `assisted` and `out-of-range` so the user learns why there is no number. Shows the best estimate
  among an entry's sets (FR-015), computed from the same union, skipping the three non-numeric
  kinds.

**Which number feeds `estimateForSet`, precisely.** The estimate is always expressed in the unit the
user is currently reading, so it is computed from the value on screen: `set.weight` when
`set.weight_unit === profile.weight_unit`, and otherwise `set.weight_kg` converted into the profile's
unit. In S-03 the second branch is unreachable — every set is stored in the profile's unit and the
profile's unit cannot yet be changed — but it is written and unit-tested now, because leaving it
implicit means S-06 inherits a component that quietly estimates in kilograms for somebody reading
pounds. Without this rule stated, the "a single repetition shows the weight typed" criterion below
has no defined answer.

#### 5. A way in

**File**: `src/pages/dashboard.astro`

**Intent**: The screen must be reachable.

**Contract**: a link to `/workouts` beside the existing one to `/exercises`. Nothing more — the
dashboard is S-07's to redesign.

### Success Criteria:

#### Automated Verification:

- The full five-command gate exits 0.
- `/workouts` is protected: `git grep -n "workouts" -- src/middleware.ts` returns the entry.
- Signed out, a request for `/workouts` and for `/workouts/<any-uuid>` both return 302 to
  `/auth/signin` — verified by a scripted request against the dev server, as S-01 and S-02 verified
  theirs.
- Signed in as account B, a request for account A's workout URL returns 404 — scripted, and paired
  with A requesting the same URL and receiving 200.
- No hydrated component imports a server-only module:
  `git grep -rn "workout-schemas\|@/lib/services/workouts\|@supabase" -- src/components/workouts/`
  returns nothing.
- A unit test covers both branches of the estimate's input rule: a set whose unit matches the
  profile estimates from `weight`, and a set whose unit differs estimates from `weight_kg` converted
  into the profile's unit. The second case is unreachable from the S-03 screen and is asserted
  anyway, because S-06 is what makes it reachable.

#### Manual Verification:

- The whole flow, on a phone-width viewport (360 px), one-handed: create a workout, add an exercise,
  log a set of 5 repetitions at a real weight, and see the estimate appear without a page reload.
- A set of 1 repetition shows an estimate **equal to the weight typed** — the most visible place
  this product can be wrong.
- A set of 15 repetitions shows the out-of-range phrase, not a number.
- A bodyweight exercise at weight 0 says "bodyweight"; the same weight on a barbell lift is refused
  with a legible message.
- Everything is still there after a reload, and the workout appears in the list at the top.
- Signed in as a second account, the first account's workout URL shows the not-found page.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Deploy, and prove it on the public address

### Overview

`context/foundation/lessons.md:6-20` exists because S-02 closed with every checkbox green and 38
exercises sitting unreachable in the production database. This phase is not a bullet inside Phase 4.

### Changes Required:

#### 1. Remove the runtime probe

**File**: `src/pages/api/dev/tz-probe.ts` (delete)

**Intent**: Phase 2 added a temporary endpoint to measure the runtime's timezone data. It answered
its question and must not ship — an unauthenticated route under `/api/` that nothing guards is
exactly the kind of thing that survives by being forgotten.

**Contract**: delete the file. Its absence is a success criterion below rather than a note in
somebody's head, and the deletion happens **before** the build, so what deploys never contained it.

#### 2. Deploy

**Files**: none — this step changes no source.

**Intent**: Put the built application in front of the schema that `npm run db:push` already gave
production in Phase 1.

**Contract**: `npm run build`, then `npx wrangler deploy`. No new Worker secret is needed — the
Worker holds `SUPABASE_URL` and `SUPABASE_KEY` from S-01, and this slice adds no configuration. Say
so explicitly rather than leaving the reader to wonder, because a missing secret fails silently:
the app builds, serves 200s, and signs nobody in.

### Success Criteria:

#### Automated Verification:

- The probe is gone: `git grep -n "tz-probe"` returns nothing (exits 1 on success — run it alone),
  and `ls src/pages/api/dev/` fails.
- `npm run build` exits 0 and `npx wrangler deploy` reports success with a version id.
- `https://gymlog.10x-astro-starter.workers.dev/workouts` returns 302 to `/auth/signin` for an
  unauthenticated request — scripted with `curl -I`, no browser involved.
- `https://gymlog.10x-astro-starter.workers.dev/api/dev/tz-probe` returns 404 — the deployed
  surface never carried it.

#### Manual Verification:

- Signed in **on the deployed URL** with a real account: create a workout, add an exercise, log a
  set, and see the estimate. Reload and confirm it survived. This is the check a green pipeline and
  a green CI run are both blind to.
- The date on the new workout form reads as today, and it is today in the profile's timezone rather
  than in UTC.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 6: Truth up the documents

### Overview

Three documents describe a database with three tables and a product whose screens stop at a
catalogue. One of them also has to carry the composite-foreign-key pattern forward, or the next
nested table will be grafted onto by the first account that tries.

### Changes Required:

#### 1. Agent instructions

**File**: `AGENTS.md`

**Intent**: Record the shape a later slice would otherwise get wrong, and the storage rules that are
now load-bearing.

**Contract**: § Access control gains a **nested-ownership variant**: a child table carries its own
`user_id` _and_ a composite foreign key to `(parent_id, user_id)`, because the four-policy template
alone lets an account graft its own row onto somebody else's parent — with a pointer to assertion 4
of `tests/integration/workout-log-rls.test.ts` as the tripwire, and the warning that the composite
key must remain the **only** foreign key to that parent or every PostgREST embed starts returning
`PGRST201`. § Domain rules gains the weight
storage shape (as entered, plus the unit, plus a generated canonical column) and the rule that a
zero or negative load requires the exercise's bodyweight flag, enforced in the endpoint because no
check constraint can reach across tables. § Known state goes from three tables to five.

#### 2. Repository README

**File**: `README.md`

**Intent**: The route table stops at `/exercises`.

**Contract**: add `/workouts`, `/workouts/[id]`, `/api/workouts`, `/api/exercise-entries` and
`/api/sets` with one line each, matching the existing table's tone.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: § Baseline describes a data layer of three tables and no training data.

**Contract**: rewrite the Backend/API and Data bullets — five tables, the nested-ownership pattern,
the flow that now exists. Leave the S-03 item's `Status` alone; that belongs to `/10x-implement` and
`/10x-archive`.

### Success Criteria:

#### Automated Verification:

- The nested-ownership pattern is documented: `git grep -n "composite" -- AGENTS.md` returns a match
  in § Access control.
- Markdown stays Prettier-clean:
  `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md` exits 0.
- The whole five-command gate is still green.

#### Manual Verification:

- Read `AGENTS.md` § Access control as the agent planning S-04 tomorrow: is it obvious that a nested
  table needs the composite key, and what an account could do without it?

**Implementation Note**: This is the final phase. After it passes, the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit tests

- `src/lib/services/set-estimate.test.ts` — the four kinds and the order they are decided in. The
  most valuable assertions are the ones that look redundant: zero weight at 20 repetitions is
  `bodyweight` and not `out-of-range`, and 1 repetition returns an estimate equal to the weight for
  **both** formulas.
- `src/lib/services/calendar.test.ts` — the timezone boundary, which is the only place this slice can
  silently put a workout on the wrong day.
- `src/lib/validation/workout.test.ts` — the input boundaries and `isWeightAllowed` across all four
  sign/flag combinations.

All pure, no `astro:*` imports, so `npm test` stays hermetic.

### Integration tests

`tests/integration/workout-log-rls.test.ts` — the boundary at three levels. Its centre of gravity is
**assertion 4**, the graft: an account using its own `user_id` attaching a row to another account's
workout. Every policy in this repository would admit that row; only the composite foreign key
refuses it. If a later migration replaces the composite key with a plain `references workouts (id)`,
this is the only thing in the repository that would say so.

Assertion 6 (restrict) and assertion 8 (cascade) are the pair that proves deletion behaves in both
directions: history cannot be destroyed sideways through an exercise, and is destroyed deliberately
through its own workout.

### Manual testing steps

1. Signed out, request `/workouts` — redirected to `/auth/signin`.
2. Signed in, `/workouts` is empty with an explanation, not a blank area.
3. Create a workout — the date already reads as today; land on the workout page.
4. Add an exercise; add a set of 5 repetitions at a real weight — the estimate appears immediately.
5. Add a set of 1 repetition — the estimate equals the weight typed exactly.
6. Add a set of 15 repetitions — the out-of-range phrase, no number.
7. On a bodyweight exercise, log weight 0 — "bodyweight". On a barbell lift, weight 0 — refused,
   legibly.
8. Choose an exercise already in the workout — the page moves to that entry rather than erroring.
9. Reload — everything survives; `/workouts` lists the workout at the top.
10. Sign in as a second account and request the first account's workout URL — not found.
11. At 360 px, one-handed: steps 3–5 are reachable without zooming or two hands.

## Performance Considerations

Two shapes in this slice could reach the Workers Free 10 ms CPU cap and both are handled where they
arise rather than left for S-07 to discover:

- **Every read carries its own `user_id` filter** and every table has a matching index, so the
  planner uses the index instead of leaning on the RLS predicate to scan. On `sets` that difference
  is the whole margin as a log grows.
- **The list's per-workout entry count is aggregated in Postgres** via PostgREST's nested `count`,
  not by fetching entries and counting them in the Worker. The same discipline that S-07's weekly
  tonnage will need, applied to the first aggregate that exists.
- The workout page is **one nested select**, not a query per level.

The catalogue read in the exercise picker stays unbounded, as it is on `/exercises`. At 38 seeded
rows plus a handful of custom ones this is a few kilobytes; the threshold at which it stops being
true belongs in a comment, per S-02's finding F5.

## Migration Notes

- **One migration, entirely additive.** No existing column changes shape; `profiles` and `exercises`
  are untouched except that `exercises` gains an inbound foreign key, which is what makes
  `on delete restrict` meaningful.
- **`unique (id, user_id)` on `workouts` and `exercise_entries` duplicates the primary key index.**
  That is the cost of the composite foreign key and it is accepted deliberately: a redundant index on
  a table this size is cheaper than a trigger, and far cheaper than the graft it prevents.
- **Deleting an account cascades all the way down** — `auth.users` → `workouts` → `exercise_entries`
  → `sets`, by both the `user_id` foreign keys and the composite ones. S-09 inherits a complete
  deletion path and needs no extra cleanup for these tables.
- **`on delete restrict` on `exercise_id` is a behaviour change for `exercises`**, which has granted
  `delete` since S-02 with no UI behind it. From this migration onward an exercise with logged
  history cannot be deleted at all. That is the intended answer and it is asserted.
- **S-04 depends on `weight_kg` and on estimates not being stored.** If a later slice adds an
  `estimated_1rm` column, changing the formula in S-06 stops re-deriving and starts lying.
- **`npm run db:types` must run after the push**, and nothing enforces it — the known gap in
  `STATE.md` § Ryzyka #5. Phase 1 sequences it explicitly and stages the result.

## Decisions

Five taken with the owner on 2026-08-10 during `/10x-research`, five more with the owner during this
planning session, and four by the planner. Each states what would have to be true for it to be wrong.

| #   | Decision                                                                    | Rationale                                                                                                                                                                                                                                                             | Source   |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Weight stored as entered + its unit + a generated `weight_kg`**           | The round-trip becomes true by construction instead of by a precision argument a reviewer must reconstruct. Aggregation reads one ordinary column. Wrong if the extra column ever tempts somebody to compare on `weight` rather than `weight_kg`.                     | Research |
| 2   | **`performed_on date`, "today" computed in the profile timezone**           | The user states the date, so there is nothing to re-project; re-projection after a timezone change would move a workout off the day the user said they trained. Wrong if a time of day ever becomes meaningful, which no requirement asks for.                        | Research |
| 3   | **`on delete restrict` on `exercise_id`, written explicitly**               | The PRD guarantees a saved workout is never silently lost. Wrong if catalogue editing later needs a merge path — which would be new behaviour, not a change to this one.                                                                                              | Research |
| 4   | **Zero-load sets show "bodyweight"; the estimator still returns 0**         | Presentation rule, the same category as rounding — F-01's tests and the `AGENTS.md` sentence stay untouched. Wrong if the owner decides 0 is more honest on screen than a word.                                                                                       | Research |
| 5   | **Two Supabase projects stay two**                                          | The reason to merge (drift) was engineered away by `db:push`; the reason to keep them apart strengthened, since CI now writes real training rows. Wrong if the test project ever costs more to maintain than the isolation is worth.                                  | Research |
| 6   | **Two routes: a list and a workout page**                                   | The list is FR-005's confirmation step; the workout page is where a set becomes a number and can be linked to and returned to between sets. Wrong if the workout page turns out to be so thin that a single expanding list would do.                                  | Plan     |
| 7   | **Incremental save — every entity written when it is created**              | An hour of logging must not live in a phone's browser tab. Each save is small enough for the 200 ms NFR. Wrong if partial workouts in the list turn out to be more confusing than lost sessions are costly.                                                           | Plan     |
| 8   | **`is_bodyweight` gates zero and negative loads**                           | Exactly what FR-014 says, and what the seed migration's comment already assumes. Catches a mistyped `0` on a squat before it silently zeroes a week's tonnage. Wrong if the friction of needing a flagged exercise proves worse than the mistyped zero.               | Plan     |
| 9   | **One exercise entry per exercise per workout, idempotent on re-choice**    | Makes "the best estimate of that entry" (FR-015) unambiguous and puts it in the database rather than in the UI. Wrong for a lifter who genuinely trains one lift in two separate blocks and wants them reported apart.                                                | Plan     |
| 10  | **A failed save keeps the typed values; no automatic retry**                | An automatic retry after a lost response writes the same set twice — silently inflating tonnage and inventing a record, the precise failure class this product forbids. Wrong only if writes become idempotent by key, which they are not.                            | Plan     |
| 11  | **Composite foreign keys carry ownership down, instead of a trigger**       | The four-policy template admits a row grafted onto another account's parent; `(parent_id, user_id)` referencing `(id, user_id)` refuses it declaratively. Wrong if a table ever needs a parent owned by a different account, which this domain never has.             | Planner  |
| 12  | **The stored unit comes from the profile, never from the request body**     | A client naming the unit could store a number in the wrong unit and poison every derived figure through `weight_kg`. Wrong if per-set unit entry is ever a requirement — it is not; FR-022 is an account-level preference.                                            | Planner  |
| 13  | **The bodyweight rule is enforced in the endpoint, not the database**       | It depends on a column in another table, so no check constraint can express it, and denormalising the flag would be the snapshot S-02 forbade. It is data quality, not access control, and the arithmetic already refuses to fabricate from a negative load.          | Planner  |
| 14  | **`set-estimate.ts` is a new module, not an extension of `one-rep-max.ts`** | `one-rep-max.ts` is documented as having no rounding and no unit awareness, and F-01 asked that later slices extend rather than rewrite it. The display rule is presentation and belongs beside it, not inside it. Wrong if the two ever need to share private state. | Planner  |

## Open Risks & Assumptions

- **The graft is invisible without assertion 4.** The composite foreign keys read like ordinary
  referential integrity, and nothing in the policy text says "a child cannot be attached to somebody
  else's parent". If that assertion is ever deleted as redundant — the exact fate `exercises-rls`
  assertion 4 was protected from by a comment — the protection becomes silent, and a "simplifying"
  migration reopens it.
- **The bodyweight rule lives in application code.** An account calling PostgREST directly with its
  own session can store a negative weight on a barbell lift. The blast radius is that account's own
  numbers, and both `isEstimable` and the future tonnage rule already refuse to fabricate from it —
  but it is an honest gap and is recorded rather than hidden.
- **Production receives the tables in Phase 1 and the screens in Phase 5.** Between those two points
  production holds three empty tables no route can reach. That is the same window S-02 left open by
  accident; here it is deliberate, bounded, and closed by a phase with its own success criteria.
- **`0.45359237` appears in the generated column and nowhere else.** If a conversion helper is ever
  written in TypeScript with a different constant, two answers become possible for the same set.
  S-06 must import the canonical value or read `weight_kg`.
- **`sets` is close to a SQL keyword and a JavaScript built-in.** The table name is fine unquoted;
  the TypeScript type is `WorkoutSet` precisely so it is not.
- **A second foreign key to the same parent would break every nested read.** PostgREST embeds
  through the composite key only while one path exists; a well-meant plain
  `workout_id references workouts (id)` added later turns `exercise_entries(…)` into `PGRST201` at
  every call site. The migration comments say so, and no test would catch it before the pages did.
- **The generated column's legality rests on the enum never being cast.** `case weight_unit when
'kg'` is immutable; `weight_unit::text = 'kg'` is not and would be refused at `create table` time.
  The fallback is a `before insert or update` trigger. `db:push` reaching `gymlog-test` first is what
  keeps this from ever being discovered in production.
- **Workers' ICU completeness is assumed, not documented.** No primary Cloudflare source states that
  Workers ships full IANA timezone data, and nothing in this repository has used `Intl` before. Phase
  2's probe is what converts the assumption into a measurement; if it fails, the default-date design
  changes before anything is built on it.
- **Assertion 6 changes existing behaviour**: from this migration onward an exercise with logged
  history cannot be deleted. Nothing ships a delete UI today, so no user sees this in S-03 — but
  whoever builds catalogue editing will meet it, and § Migration Notes says so.

## References

- Roadmap item: `context/foundation/roadmap.md` § Slices → S-03 (the north star)
- Product contract: `context/foundation/prd.md` § US-01, FR-004, FR-005, FR-008, FR-009, FR-014,
  FR-015, § Business Logic (the boundaries), § Access Control
- Research and the nine decisions it settled: `context/changes/log-workout-with-estimate/research.md`
- Agent rules: `AGENTS.md` § Domain rules, § Access control (the table template this slice extends),
  § Conventions, § Testing, § Cloudflare traps
- Standing lessons: `context/foundation/lessons.md` — the deployment phase (Phase 5), the mutated
  guard (Phase 2), the demonstrated attack over a reading task (Phase 1)
- The slice shape this one copies: `context/archive/2026-08-10-exercise-catalogue/plan.md`
- The integration-suite shape this one copies: `tests/integration/exercises-rls.test.ts`
- Why the set form must not reuse `SubmitButton`:
  `context/archive/2026-08-10-exercise-catalogue/reviews/impl-review.md` § F2
- Why a message code travels instead of message text:
  `context/archive/2026-08-10-account-access/reviews/impl-review.md` § F1

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The three tables and their access-control boundary

#### Automated

- [x] 1.1 `npm run db:push` applies to both projects; `npm run db:status` shows identical histories
- [x] 1.2 `npm run db:types` regenerated and staged — `git grep -n "exercise_entries" -- src/db/database.types.ts`
- [x] 1.3 Gate green — lint, typecheck, unit tests, build all exit 0
- [x] 1.4 `npm run test:integration` exits 0 and reports four files
- [x] 1.5 RLS on for all three tables and exactly twelve policies, read from the database

#### Manual

- [x] 1.6 `npm run test:integration -- --reporter=verbose` prints every refused crossing with a named reason, never an empty result

### Phase 2: The estimate as a displayable value

#### Automated

- [ ] 2.1 Gate green — lint, typecheck, unit tests, build all exit 0
- [ ] 2.2 The two new unit suites assert every boundary listed in the phase
- [ ] 2.3 The new modules are hermetic — no `astro:` import in `set-estimate.ts` or `calendar.ts`
- [ ] 2.4 `estimateForSet` imports `./one-rep-max` and nothing else
- [ ] 2.5 `curl -s localhost:4321/api/dev/tz-probe` against `npm run dev` returns three distinct dates for Kiritimati, UTC and Niue

#### Manual

- [ ] 2.6 All four mutations applied, the failing test observed and named in the commit message, then reverted

### Phase 3: Services, validation, and the three endpoints

#### Automated

- [ ] 3.1 Gate green — lint, typecheck, unit tests, build all exit 0
- [ ] 3.2 Unit tests cover the input boundaries and `isWeightAllowed` across all four sign/flag combinations
- [ ] 3.3 No provider prose escapes — `git grep -n "error.message"` over the three endpoint folders returns nothing
- [ ] 3.4 No hydrated module imports `workout-schemas` — `git grep -rn "workout-schemas" -- src/components/`
- [ ] 3.5 Scripted create-workout → add-entry → add-set round trip; duplicate entry returns the first id; zero weight on a non-bodyweight exercise is refused with its own code

#### Manual

- [ ] 3.6 A POST to each endpoint from a signed-out session creates no row, verified by re-reading the tables

### Phase 4: The screens

#### Automated

- [ ] 4.1 Full five-command gate exits 0
- [ ] 4.2 `/workouts` is in `PROTECTED_ROUTES`
- [ ] 4.3 Signed out, `/workouts` and `/workouts/<uuid>` both return 302 to `/auth/signin`
- [ ] 4.4 Account B gets 404 on account A's workout URL; A gets 200 on the same URL
- [ ] 4.5 No component under `src/components/workouts/` imports a server-only module
- [ ] 4.6 A unit test covers both branches of the estimate's input rule — unit matching the profile, and unit differing

#### Manual

- [ ] 4.7 The whole flow works one-handed at 360 px without a page reload between sets
- [ ] 4.8 A 1-repetition set shows an estimate equal to the weight typed
- [ ] 4.9 A 15-repetition set shows the out-of-range phrase, not a number
- [ ] 4.10 Weight 0 says "bodyweight" on a flagged exercise and is refused legibly on a barbell lift
- [ ] 4.11 Everything survives a reload and the workout appears at the top of the list
- [ ] 4.12 A second account sees the not-found page on the first account's workout URL

### Phase 5: Deploy, and prove it on the public address

#### Automated

- [ ] 5.1 The probe is gone — `git grep -n "tz-probe"` returns nothing and `src/pages/api/dev/` no longer exists
- [ ] 5.2 `npm run build` exits 0 and `npx wrangler deploy` reports a version id
- [ ] 5.3 `curl -I` on the deployed `/workouts` returns 302 to `/auth/signin` when unauthenticated
- [ ] 5.4 The deployed `/api/dev/tz-probe` returns 404

#### Manual

- [ ] 5.5 The full log-and-see-the-estimate flow completes on the deployed URL and survives a reload
- [ ] 5.6 The new workout form's default date is today in the profile's timezone, not in UTC

### Phase 6: Truth up the documents

#### Automated

- [ ] 6.1 The nested-ownership pattern is documented in `AGENTS.md` § Access control
- [ ] 6.2 Markdown Prettier-clean across the three documents
- [ ] 6.3 Gate still green

#### Manual

- [ ] 6.4 `AGENTS.md` § Access control makes clear why a nested table needs the composite key
