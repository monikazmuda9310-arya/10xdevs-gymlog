---
date: 2026-08-10T22:22:03+02:00
researcher: Monika Zmuda
git_commit: 1b8aca8fb6e9dbeb0cd57dd37a70411ae4adebcf
branch: main
repository: gymlog
topic: "S-03 — log a workout and see the estimated one-rep max"
tags: [research, codebase, workouts, sets, one-rep-max, rls, schema, vertical-slice]
status: complete
last_updated: 2026-08-10
last_updated_by: Monika Zmuda
last_updated_note: "All nine open questions decided with the owner; § Open Questions replaced by § Decisions, and the date-column reasoning corrected from timestamptz to date"
---

# Research: S-03 — log a workout and see the estimated one-rep max

**Date**: 2026-08-10T22:22:03+02:00
**Researcher**: Monika Zmuda
**Git Commit**: `1b8aca8fb6e9dbeb0cd57dd37a70411ae4adebcf`
**Branch**: `main`
**Repository**: `gymlog`

> References below are repo-relative with line numbers, which is what `/10x-plan` and the editor
> consume. `HEAD` is pushed, so any of them converts to a permalink with the base
> `https://github.com/monikazmuda9310-arya/10xdevs-gymlog/blob/1b8aca8fb6e9dbeb0cd57dd37a70411ae4adebcf/<path>#L<line>`.

## Research Question

What does the codebase already provide, and what does it constrain, for S-03 — the north-star
slice in which a user creates a workout dated today, adds an exercise from the catalogue, logs a
set of repetitions and weight, saves, and immediately sees an estimated one-rep max, with the
workout present in their list (most recent first) after a reload?

Scope agreed with the owner: **S-03 plus forward constraints** from S-04 (records), S-06
(unit / formula / timezone preferences) and S-07–S-08 (weekly tonnage and its breakdown), because
S-03 fixes two storage decisions the roadmap itself calls expensive to reverse
(`context/foundation/roadmap.md:186`).

## Summary

**The arithmetic is done; the storage is not.** `src/lib/services/one-rep-max.ts` already
implements the estimate correctly and is pinned at every boundary AGENTS.md names. S-03 does not
write a formula — it builds the three tables underneath it, a service, an endpoint, a screen, and
the tests, following a vertical-slice template that S-02 has already worked out end to end.

Five findings shape the plan:

1. **The estimate exists and must be extended, not rewritten.** `estimateOneRepMax` /
   `isEstimable` are dependency-free, return `null` for "no estimate", perform no rounding, and
   are unit-tested at 1 rep, 12 reps, 13 reps, 37 reps, zero load and negative load
   (`src/lib/services/one-rep-max.ts:27-53`, `src/lib/services/one-rep-max.test.ts`). Nothing in
   the application calls them yet — S-03 is the first caller.

2. **Everything else in the domain layer is absent.** No tonnage, no record detection, no
   week-boundary calculation, no kg↔lb conversion, no `workouts`/`sets` tables, and no
   "load the user's preferences" path. The only read of a profile preference in the whole codebase
   is an inline query for `timezone` in `src/pages/dashboard.astro:9`, which prints it as text.
   S-03 needs a real profile-reading service because the estimate depends on
   `profiles.estimation_formula`.

3. **The vertical-slice template is fully worked out by S-02** — migration → generated types →
   `src/types.ts` aliases → service → two-file validation split → JSON API route → `.astro` page
   fetching server-side → `client:load` island → `PROTECTED_ROUTES` → integration RLS suite. It is
   copyable file-by-file (§ "The vertical-slice template" below). One deliberate divergence:
   `workouts`/`sets` take the **plain** row-ownership RLS template, not the shared-catalogue
   variant `exercises` uses (`AGENTS.md:125-126`).

4. **Nine decisions were open when this research started; all nine are now settled** — see
   § Decisions. The three with real reversal cost were the weight storage shape, the workout date
   column type, and the `on delete` behaviour when a custom exercise with logged history is
   deleted. That last one was a live collision: `exercises` already grants `delete` to owners with
   no UI behind it (`supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql:62`).

5. **Two process rules bind this plan specifically.** A slice whose outcome is a screen needs its
   own deployment phase verified against the public URL (`context/foundation/lessons.md:6-20`) —
   S-02 was closed without one and left 38 exercises unreachable in production. And the one
   load-bearing line of logic must be extracted into a pure function and mutation-tested
   (`context/foundation/lessons.md:22-35`), because S-01 shipped a broken signup past 51 green
   tests by leaving exactly such a line inline.

## Detailed Findings

### 1. The domain layer: what exists, what does not

**Exists** — `src/lib/services/one-rep-max.ts` (53 lines, zero imports):

```ts
export type EstimationFormula = "epley" | "brzycki";
export const MIN_ESTIMABLE_REPS = 1;
export const MAX_ESTIMABLE_REPS = 12;
export function isEstimable(weight: number, reps: number): boolean;
export function estimateOneRepMax(weight: number, reps: number, formula: EstimationFormula): number | null;
```

- `src/lib/services/one-rep-max.ts:44-52` — `null` when not estimable; `weight` returned verbatim
  at `reps === 1` (the Epley pin); Brzycki `(w*36)/(37-r)` otherwise.
- `src/lib/services/one-rep-max.ts:27-35` — `isEstimable` excludes non-integer reps, non-finite
  weights and **negative** weights, but admits **zero**. Deliberate: a bodyweight set estimates to
  `0` rather than being suppressed.
- `src/lib/services/one-rep-max.ts:4-6` — no rounding inside the helper, stated as a rule:
  "record comparison must happen on the unrounded value, so that a rounding step can never invent
  a record or erase one."
- Boundary assertions verified present in `src/lib/services/one-rep-max.test.ts`: 1 rep → exactly
  the weight for both formulas; 12 reps → 144 (Brzycki) / 140 (Epley) at w=100; 0, 13, 37 and 40
  reps → `null`; zero load → `0`; negative load → `null`.
- **No caller anywhere in `src/`.** S-03 is the first.

**Does not exist** (searched across `src/`, migrations and generated types):

| Missing                                                                                | Owed to                           |
| -------------------------------------------------------------------------------------- | --------------------------------- |
| `workouts`, exercise entries, `sets` tables and their types                            | S-03                              |
| a service that reads `profiles` (unit, formula, timezone)                              | S-03 — needed to pick the formula |
| tonnage calculation (zero-weight → reps but no tonnage; negative → zero, not negative) | S-07                              |
| record detection (best surviving set; heaviest absolute weight as a second record)     | S-04                              |
| week boundaries, Monday–Sunday in the profile timezone                                 | S-06/S-07                         |
| kg↔lb conversion and the exact round-trip guarantee                                    | S-06                              |
| per-muscle-group aggregation in Postgres                                               | S-08                              |

`src/types.ts:32` already carries the marker for the open piece: _"Unit weights are entered and
displayed in. Storage is canonical; see S-03."_ The decision was explicitly deferred to this slice.

### 2. The vertical-slice template (from S-02, copyable file-by-file)

| Step                      | File in S-02                                                                    | Notes for S-03                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Migration                 | `supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql` | `-- Purpose:` / `-- Affected:` header, RLS in the same migration, `notify pgrst, 'reload schema';` last |
| Seed (separate)           | `supabase/migrations/20260810180526_seed_exercise_catalogue.sql`                | idempotent `on conflict do nothing` — S-03 seeds nothing                                                |
| Generated types           | `src/db/database.types.ts` via `npm run db:types`                               | production schema only; never hand-edited                                                               |
| Entity types              | `src/types.ts:19-38`                                                            | `Row`/`Insert`/`Update` aliases, never a restated field list                                            |
| Service                   | `src/lib/services/exercises.ts`                                                 | client passed in as first arg; `throw error`; named PG error-code constants                             |
| Validation (browser-safe) | `src/lib/validation/exercise.ts`                                                | constants + message-code catalogue + type guards, import-free                                           |
| Validation (server-only)  | `src/lib/validation/exercise-schemas.ts`                                        | zod built _from_ the above; nothing hydrated may import it                                              |
| API route                 | `src/pages/api/exercises/index.ts`                                              | `export const prerender = false;`, `{code}`-only failure bodies                                         |
| Page                      | `src/pages/exercises.astro`                                                     | fetches in frontmatter via the service; `loadFailed` branch distinct from empty state                   |
| Island                    | `src/components/exercises/ExerciseCatalogue.tsx`, `ExerciseForm.tsx`            | `client:load`; posts JSON; resolves errors only via `messageForCode`                                    |
| Route guard               | `src/middleware.ts:5`                                                           | one array entry, never a per-page check                                                                 |
| Integration test          | `tests/integration/exercises-rls.test.ts`                                       | two fixture accounts, run-unique prefixes, every negative paired with a positive re-read                |
| Unit test                 | `src/lib/validation/exercise.test.ts`                                           | pure functions only, no `astro:*` imports                                                               |

Concrete details worth carrying over:

- **Service shape** (`src/lib/services/exercises.ts`): `type Client = SupabaseClient<Database>` is
  the first parameter of every function; the middleware-built client on `context.locals.supabase`
  is reused rather than a second one being constructed. `export const UNIQUE_VIOLATION = "23505";`
  is how a Postgres error code becomes an HTTP status in the route.
- **Never interpolate into a PostgREST filter expression.** S-02's review finding F1 fixed
  `userId` being spliced into `.or(...)`; the guard `assertUserId()` was added and
  mutation-tested. Argument-form `.eq(...)` is encoded by PostgREST and is the safe path.
- **Message codes, never prose.** `EXERCISE_MESSAGES` maps code → sentence; an unrecognised code
  resolves to the generic message and never echoes the caller's own string. This is the
  anti-phishing rule from S-01 (`AGENTS.md:202-206`).
- **Do not reuse `SubmitButton` reflexively.** S-02 finding F2: it derives pending state from
  `useFormStatus()`, which only reports during a form-action submission — on a
  `fetch` + `preventDefault` island the spinner never spins. S-03's set-logging form is almost
  certainly a fetch island.
- **shadcn/ui is available but the S-02 slice does not use it** — hand-written Tailwind with
  `cn()` throughout. `src/components/ui/button.tsx` is used only by
  `src/components/auth/SubmitButton.tsx`. Worth a deliberate choice rather than drift.

### 3. Schema and access control

**The plain table template**, verbatim from
`supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:36-59`, with the delete
pair from `.../20260810174840_create_exercises_with_shared_catalogue.sql`:

```sql
alter table public.<t> enable row level security;
revoke all on public.<t> from anon, authenticated;
grant select, insert, update, delete on public.<t> to authenticated;

create policy "<t> are selectable by their owner" on public.<t>
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "<t> are insertable by their owner" on public.<t>
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "<t> are updatable by their owner" on public.<t>
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);
create policy "<t> are deletable by their owner" on public.<t>
  for delete to authenticated using ((select auth.uid()) = user_id);
```

Column conventions in force:

- `id uuid primary key default gen_random_uuid()`.
- `created_at` / `updated_at timestamptz not null default now()`, with `updated_at` maintained by
  the **shared** `public.set_updated_at()` function defined in the profiles migration
  (lines 24-30) — attach the trigger, do not redefine the function.
- FKs to `auth.users (id) on delete cascade`. **`workouts → exercise entries → sets` will be the
  first foreign keys between two `public` tables in this schema** — no precedent exists.
- `check` constraints for simple bounds (`char_length(name) between 1 and 80`).
- Index naming `<table>_<columns>_idx`, sized to match the service's explicit filter.

**Nested ownership: denormalise `user_id` onto every level.** `AGENTS.md:125-126` states
`workouts` and `sets` take the plain template with `user_id not null`, and `AGENTS.md:90-95`
explains why the query must also carry `.eq("user_id", user.id)`: _"The policy is the guarantee;
`.eq(...)` in the query is the index path. Without the explicit filter, every read leans on the
policy predicate to do the filtering, which on `workouts` and `sets` is a full scan under the
10 ms CPU cap."_ So `sets.user_id` is carried down two levels rather than derived by joining up to
`workouts` — and each level gets its own four-policy block.

**Three levels are mandated, not optional.** US-04's acceptance criterion
(`context/foundation/prd.md:152-153`) requires the protection to hold at _"every level of the
record — workouts, exercise entries, and individual sets"_, and FR-008/FR-009
(`prd.md:199-209`) describe an exercise entry as the thing sets hang under. The middle table
exists; only its name is unfixed.

**`sets` must never snapshot `muscle_group`.** S-02's plan hands this to S-03 explicitly
(`context/archive/2026-08-10-exercise-catalogue/plan.md:580-582`): sets reference `exercise_id`
only, so a later group correction applies to history. Denormalising the group would answer PRD
Open Question 2 by accident, in the direction nobody chose.

**No records table.** Records are derived from surviving sets, never stored
(`AGENTS.md` § Domain rules; `prd.md:357-361`). The schema S-03 creates must not contain one, even
though S-04 is the slice that reads them.

**No stored estimate column.** `roadmap.md:186`: estimates are _"derived on read rather than
written down"_, so S-06 can change the formula without rewriting history. `sets` stores raw reps
and weight only.

### 4. Forward constraints from S-04, S-06, S-07, S-08

- **S-07/S-08 — aggregation must happen in Postgres.** `AGENTS.md` § Cloudflare traps: the Workers
  Free plan caps CPU at 10 ms per invocation and kills the request outright (Error 1102); weekly
  and per-group rollups must be summed in the database, not looped in the Worker. S-03 does not
  build the rollup, but it decides whether the rollup is cheap: an index on `(user_id, <date>)` on
  `workouts`, and a `sets` row reachable from a week window without a three-level join, are what
  make a later SQL view or RPC an index range scan instead of a sequential one.
- **S-06 — changing unit or formula may rewrite nothing.** Satisfied by storing canonically and
  deriving on read (above). The binding rule is the round-trip:
  _"A weight entered in lb and read back in lb must be the number the user typed"_, and neither
  conversion nor rounding may create or erase a record (`prd.md:352-353`, NFR at `prd.md:309-310`).
- **S-06/S-07 — the week is Monday–Sunday in `profiles.timezone`.** The timezone rule exists for
  dates that are _derived_ from an instant. Here the user states the date, so there is nothing to
  re-project: `performed_on date` holds a fact the user asserted, and the profile timezone is
  needed in exactly one place — computing the default "today" for the form, since 01:00 in Warsaw
  is still the previous day in UTC. Week bucketing then reduces to
  `date_trunc('week', performed_on)`, which Postgres starts on Monday, so S-07 aggregates with no
  timezone arithmetic at all. See Decision 2.
- **S-04 — records decided on estimated 1RM**, with heaviest absolute weight tracked separately,
  and both excluded for sets outside 1–12 reps or with negative load. S-03's job is to make sure
  those sets are still _stored_ (they are recorded honestly; they are only excluded from the
  arithmetic).

### 5. Testing and verification practice

- Gate order is fixed: `npm run lint` → `npm run typecheck` → `npm test` →
  `npm run test:integration` → `npm run build` (`AGENTS.md:132-137`).
- `vitest.config.ts` includes `src/**/*.test.{ts,tsx}` in a `node` environment with the `@` alias;
  anything under unit test must not import an `astro:*` virtual module.
- `vitest.integration.config.ts` includes `tests/integration/**/*.test.ts`, runs with
  `fileParallelism: false`, and **strips every `SUPABASE_*` / `GYMLOG_*` env var except
  `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY`, `GYMLOG_TEST_PASSWORD`** — the suite is structurally
  incapable of reaching production.
- Integration fixtures: the RLS suites reuse `rls-owner-a@gymlog-test.dev` /
  `rls-owner-b@gymlog-test.dev` with `GYMLOG_TEST_PASSWORD`, prefix their rows with a run-unique
  id, and clean their own prefix in `beforeAll`. Every negative assertion is paired with a re-read
  as the row's owner so it cannot pass vacuously.
- `tests/integration/exercises-rls.test.ts` assertion 4 (no account may forge a seeded row) is
  marked non-deletable; the equivalent for S-03 is that every negative must be provably non-vacuous.

## Code References

- `src/lib/services/one-rep-max.ts:27-53` — `isEstimable` and `estimateOneRepMax`; the whole of the
  domain arithmetic that exists today.
- `src/lib/services/one-rep-max.test.ts` — the boundary pins (1, 12, 13, 37, 40 reps; zero and
  negative load).
- `src/types.ts:19-38` — entity/DTO alias convention; `MUSCLE_GROUPS` runtime tuple.
- `src/types.ts:32` — "Storage is canonical; see S-03" — the deferred decision, in writing.
- `src/types.ts:45-56` — `MutuallyAssignable` / `Assert` compile-time enum pins, and the comment on
  why `false` rather than `never`.
- `src/lib/services/exercises.ts` — service shape: injected client, explicit owner filter,
  `throw error`, `UNIQUE_VIOLATION` constant, `assertUserId` guard.
- `src/lib/validation/exercise.ts` / `exercise-schemas.ts` — the browser-safe / server-only split
  and the message-code catalogue.
- `src/pages/api/exercises/index.ts` — `prerender = false`, independent `locals.supabase` /
  `locals.user` re-check, `{code}`-only failure bodies, `23505` → 409.
- `src/pages/exercises.astro` — server-side fetch in frontmatter, `loadFailed` branch, single
  `client:load` island.
- `src/middleware.ts:5` — `PROTECTED_ROUTES`; S-03 adds its route here.
- `src/pages/dashboard.astro:9` — the only existing read of a profile preference, inline and
  single-column.
- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:24-59` — shared
  `set_updated_at()` trigger function and the canonical RLS block.
- `supabase/migrations/20260810174840_create_exercises_with_shared_catalogue.sql:52-93` — index
  sized to the query filter, and the four policies with the delete pair.
- `scripts/supabase-db.mjs` — `push()` applies to `gymlog-test` then `gymlog` with a named
  divergence message; `types()` targets production only.

## Architecture Insights

- **The guarantee and the index path are two different things, and both are required.** RLS
  proves ownership; the explicit `.eq("user_id", …)` makes it fast enough to survive the 10 ms CPU
  cap. `profiles` is the single documented exception, because it is a one-row primary-key lookup.
- **Derived values are never stored.** Estimates, records and tonnage are all recomputed. The
  schema is deliberately kept to raw facts — reps, weight, date, exercise reference — so that
  changing a preference in S-06 re-derives instead of migrating.
- **Rounding is strictly a presentation concern.** Comparison and record detection run on
  unrounded values; the NFR "at most one decimal place" applies to what is displayed.
- **Validation is split by bundle cost, not by taste.** Anything a `client:load` island imports
  ships to the browser; moving the zod schemas into the shared module was measured at ~59 KB. The
  three-file split (`<domain>.ts`, `<domain>-schemas.ts`, `<domain>-errors.ts`) is the response.
- **Silent failure is the recurring enemy.** Missing Worker secrets, a wrong `site_url`, an empty
  test glob, a `never`-resolving type assertion, an integration assertion guarded by an early
  `return` — every serious defect this project has recorded was invisible to a green pipeline.

## Historical Context (from prior changes)

- `context/archive/2026-08-09-verification-harness/plan.md:257` — _"S-03 and S-06 extend this file;
  they do not rewrite it"_, about `one-rep-max.ts`.
- `context/archive/2026-08-09-verification-harness/plan.md:503` — Decision 4: a zero-load set
  estimates to `0` rather than `null`, originally flagged "pending owner confirmation". It is now
  stated as settled in `AGENTS.md`, but **S-03 is the first slice that puts it on a screen**.
- `context/archive/2026-08-09-owned-persistence-baseline/reviews/plan-review.md` — the
  `weight_unit` / `estimation_formula` enums were created in F-03 _because S-03 needs them_; S-03
  reads preferences from `profiles` and invents no storage of its own. The same review rejected a
  verification step that would have toggled RLS off in production to "red-prove" an assertion —
  the accepted alternative made the assertion self-proving by construction.
- `context/archive/2026-08-10-account-access/reviews/impl-review.md` — F2, the project's most
  instructive failure: the line the plan itself called "the heart of this change" had no test, so
  swapping `data.session` for `data.user` passed all 51 tests and broke every production signup.
  F1: prose in a redirect query string rendered as a system message — hence codes, never text.
  F4: an endpoint constructing a second Supabase client instead of using `context.locals.supabase`,
  caught only in review.
- `context/archive/2026-08-10-exercise-catalogue/reviews/impl-review.md` (five findings fixed in
  `79e8d5c`) — F1 PostgREST `.or()` interpolation; F2 `SubmitButton` / `useFormStatus` mismatch;
  F3 server-side search options built but never wired, leaving tests that read as proof of a live
  feature; F4 the missing deployment phase; F5 `listExercises` is unbounded and **S-03 is named as
  the slice that runs it on a hotter path** (an exercise picker inside the workout form).
- `context/archive/2026-08-10-exercise-catalogue/plan.md:139-262` and `:633-705` — the phase and
  `## Progress` format the next plan must match: `### Changes Required` with
  **File / Intent / Contract** per artifact, `### Success Criteria` split into
  `#### Automated Verification` and `#### Manual Verification`, a 1:1 numbered checkbox in
  `## Progress` for every criterion, and the "pause here for manual confirmation" note ending each
  phase but the last.
- `context/foundation/lessons.md:6-20`, `:22-35`, `:37-51` — the three standing rules: a
  screen-producing slice carries its own deployment phase; a guard you have not mutated may not
  guard; replace a manual "is the guarantee holding?" criterion with a script that attacks it and
  prints the raw responses.

## Related Research

None — this is the first `research.md` in the project. Prior changes went straight to `plan.md`,
with `plan-brief.md` and `reviews/` alongside. The closest analogues are
`context/archive/2026-08-10-exercise-catalogue/plan.md` (the slice this one copies structurally)
and `context/changes/bootstrap-verification/verification.md` (the Astro 7 record).

## Decisions (owner, 2026-08-10)

Every open question raised by this research was decided before planning began. Recorded here so
`/10x-plan` inherits them rather than re-opening them.

1. **Weight is stored as entered, alongside the unit it was entered in, with a generated stored
   canonical column.**

   ```sql
   weight      numeric(7,3) not null,        -- exactly what was typed
   weight_unit public.weight_unit not null,  -- what it was typed in
   weight_kg   numeric(9,4) generated always as (
                 case weight_unit when 'kg' then weight else weight * 0.45359237 end
               ) stored
   ```

   Rejected: a single canonical `weight_kg` column with conversion on read, and an integer of
   grams. Both hold the round-trip only by a precision argument a reviewer must reconstruct — and
   that argument needs a test that attacks it. This shape makes the round-trip **true by
   construction**: what is read back is what was typed, byte for byte. Comparison and aggregation
   always use `weight_kg`, so S-04's record detection and S-07's Postgres-side rollups are exactly
   as cheap as with a single column, and `weight_kg` indexes like any ordinary column.
   `weight_unit` here is a fact about the entry, not a derived attribute — unlike a snapshotted
   `muscle_group`, which stays forbidden.

2. **The workout date is `performed_on date`, with "today" computed in the profile's timezone.**
   Rejected: `timestamptz`. The user _states_ the date, so there is nothing to re-project, and
   re-projection would be a defect rather than a feature — changing timezone in S-06 must not move
   a workout to a different day than the one the user said they trained. `timestamptz` would also
   force inventing a time of day nobody entered. The timezone is needed in exactly one place: the
   form's default value, because 01:00 in Warsaw is already the previous day in UTC. Week bucketing
   becomes `date_trunc('week', performed_on)` — Monday-based in Postgres, matching the rule with no
   timezone arithmetic in the aggregation. Index: `(user_id, performed_on)`.

3. **`exercise_entries.exercise_id` carries `on delete restrict`, written explicitly.** Deleting an
   exercise that has logged history is refused by the database; an unused one — a typo, say — is
   still deletable. `cascade` was rejected because it silently destroys training history, against
   the PRD guardrail that a saved workout is never silently lost. Revoking `delete` on `exercises`
   outright was rejected as a decision that would have to be undone the moment catalogue editing
   ships.

4. **A zero-load set keeps returning `0` from `estimateOneRepMax`; the screen shows "bodyweight"
   instead of "estimated 1RM: 0".** The domain function, its F-01 tests and the sentence in
   `AGENTS.md` are untouched — this is a presentation rule, the same category as rounding. Zero
   next to a set of push-ups reads as a bug rather than as information, but `0` is not a fabricated
   number the way an estimate at 15 reps would be, so suppressing it belongs in the view, not in
   the arithmetic.

5. **The middle table is `exercise_entries`.** It matches the vocabulary the PRD and US-04 already
   use, so a reader searching for "exercise entry" finds the table without a translation step. It
   is also an entity with children rather than a junction, which `workout_exercises` would imply.

6. **No `position` column; exercise entries order by `created_at`, with `id` as tiebreaker.** No FR
   asks for reordering, and insertion order is the order the exercises were actually performed in.
   Adding the column later is a migration with a trivial backfill
   (`row_number() over (partition by ...)`), so it is cheap in both directions — no reason to pay
   now.

7. **RPE is `numeric(3,1) null` with `check (rpe between 1 and 10)`, and the form exposes it in
   S-03.** Covers the half-points lifters actually use. FR-009 belongs to this slice, so shipping
   the column without the field would reproduce S-02's F3 finding — built and never wired.

8. **`gymlog` and `gymlog-test` stay two projects.** The reason to merge — schema drift — was
   engineered away: `db:push` applies to both in one invocation, there is no single-target push,
   and `db:status` is the check. The reason to keep them apart just strengthened, because from
   S-03 onward CI writes real training rows, and merging would point those writes at the database
   the owner trains against.

9. **`listExercises` stays unbounded in the workout form's picker** (decided by the implementer, as
   low-stakes and reversible). At 38 seeded rows plus a handful of custom ones the payload is a few
   kilobytes. The threshold at which this stops being true is recorded in a comment; wiring the
   service's existing server-side search options is separate work, not part of this slice.

## Still Open

- **PRD Open Question 2 — retroactive muscle-group correction** (`context/foundation/prd.md:456-460`).
  Not blocking: S-03 ships no exercise-editing UI, and Decision 1 above keeps the schema neutral by
  never snapshotting the group onto a set.
- **Nothing enforces `npm run db:types` after a push.** A schema change without a regenerate
  type-checks against stale types. S-03 is a schema-adding slice, so the plan must sequence
  `db:push` → `db:types` → commit the regenerated file explicitly.
