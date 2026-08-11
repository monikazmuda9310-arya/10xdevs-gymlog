# A Record Is Announced When It Happens, and Listed Afterwards — Implementation Plan

> Roadmap item: **S-04** (`context/foundation/roadmap.md` § Slices)
> Change identity: `context/changes/personal-records/change.md`
> Research: `context/changes/personal-records/research.md`

## Overview

S-03 stores the sets. This slice derives the meaning from them: at the moment a set is saved the user
is told whether it beat their previous best for that exercise, and `/records` lists what every
exercise currently stands at — the best estimated one-rep max and the heaviest absolute weight, side
by side.

**The hard part is not the arithmetic and it is not the CRUD.** The arithmetic exists and is tested;
there is nothing to create and nothing to update. The hard part is that the record has to be derived
in **Postgres** — the records list touches every set the account has ever logged, against a hard
10 ms CPU kill — which means the one-rep-max formula acquires a **second implementation, in SQL**,
and the query that runs it must be subject to the same row-level security the tables are. Both of
those fail silently if they fail: a drifted formula produces plausible wrong numbers, and a view
created without `security_invoker` returns every account's training to every account through a route
that reads exactly like the safe ones.

## Current State Analysis

Measured against the working tree at `d146406` on 2026-08-11. Full survey:
`context/changes/personal-records/research.md`.

### What exists

- **The arithmetic, complete and in use.** `src/lib/services/one-rep-max.ts:43-53` (pinned at
  `reps === 1`, `null` outside 1–12 or on a negative load), `src/lib/services/set-estimate.ts:32-49`
  (the four-way answer, zero weight decided first), `src/lib/services/set-display.ts:52-103`
  (`weightInUnit`, `estimateForLoggedSet`, `bestEstimateOf`, `roundForDisplay`). All unit-tested.
- **The three tables and their nested-ownership boundary**, with `sets.weight_kg` generated from
  `weight` and `weight_unit`, and the index
  `exercise_entries (user_id, exercise_id)` created in S-03 **for this slice specifically**
  (`supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:139-142`).
- **A complete vertical-slice template** to copy file by file: migration → `db:push` → `db:types` →
  aliases in `src/types.ts` → service taking an injected client → JSON endpoint returning `{code}` →
  `.astro` page reading in frontmatter → island only where interactive → `PROTECTED_ROUTES` →
  integration suite asserting against re-read rows.
- **`/api/sets`**, four steps deep, already reading the profile for the weight unit
  (`src/pages/api/sets/index.ts:35-68`).

### What is missing

No view, no function, no `.rpc()` call anywhere in `src/` — `src/db/database.types.ts:185-190` shows
`Views` and `Functions` both empty. **This slice creates the first database object that is not a
table**, and `AGENTS.md` § Access control has no template for one. There is no records service, no
`/records` route, and `/api/sets` returns the set and nothing else.

### Decisions this slice inherits and must not re-open

- **Records are derived, never stored.** No `estimated_1rm` column, no record table. A stored
  estimate turns S-06's formula change from a re-derivation into a lie
  (`context/archive/2026-08-10-log-workout-with-estimate/plan.md` § Migration Notes).
- **A record is decided on estimated 1RM**, on `weight_kg`, never on `weight`.
- **The heaviest absolute weight is a second, distinct record**, and the two may belong to different
  sets (US-02).
- **RPE takes no part in any computation** (FR-009).
- **Nothing is ever snapshotted from `exercises`** onto an entry or a set
  (`20260811005248_…:74-76`).

## Desired End State

- A signed-in user logs a set that beats their previous best for that exercise and sees, on that
  set's own row, that it is a personal record and what it beat — without a reload and without asking.
- The first set they ever log for an exercise establishes a baseline and says nothing.
- `/records` lists every exercise they have logged, most recently improved first, each showing the
  best estimated 1RM and the heaviest weight, the set behind each, and when it happened. An exercise
  logged only at zero load says so rather than vanishing.
- **No account can read another account's records** — including through the new views, including by
  naming an identifier — proven against re-read rows.
- The SQL estimate and the TypeScript estimate agree at every boundary, proven by a check that would
  fail if either drifted.
- The whole flow works on the deployed URL, not only locally.

Verify: the five-command gate exits 0; the new integration suite proves the boundary and the parity;
and a real session on `https://gymlog.10x-astro-starter.workers.dev` logs a record and opens
`/records`.

### Key Discoveries

- **`security_invoker` is available and is the whole answer.** Both projects run **Postgres
  17.6.1** (checked through the Management API; the feature needs 15+). Without the flag a view
  executes as its owner — `postgres`, which owns the tables and is therefore not subject to their
  RLS — and returns every row to every caller.
- **The verdict can be decided entirely inside SQL**, so no number crosses the language boundary to
  decide a record: ask for the **top two** sets by estimate and compare **ids**
  (`research.md` § The verdict as a query, not a comparison).
- **The tie-break is the equality rule.** `order by estimate desc, created_at asc` puts an equal
  older set first, so "a set equal to the previous best is not a record" (`prd.md:111-112`) falls out
  of the ordering rather than needing an epsilon.
- **`/api/sets` can grow a field safely.** The three assertions that pin it read `body.set`
  (`tests/integration/workout-endpoints.test.ts:109-126`); a sibling `body.record` disturbs none.
- **The unit suite cannot reach SQL.** `vitest.config.ts` includes `src/**` and forbids `astro:*`
  imports, so the parity and boundary coverage here is **integration**, not unit — with one genuine
  unit-test target, the pure verdict decision (`lessons.md` § "A criterion that demands a unit test
  must name the module that will hold it").
- **`fileParallelism: false`** in `vitest.integration.config.ts:44` — a suite may flip the fixture
  account's `estimation_formula` without racing another file, provided it restores it in a `finally`.

## What We're NOT Doing

- **Editing or deleting anything, and therefore no drop warning.** US-02's "told which record it
  holds and what it will fall to, and must confirm" is triggered by an edit or a delete, and this
  slice ships neither. **No `recordDrop()` helper is written** — a function with no caller cannot be
  exercised end to end. S-05 inherits the query shape for free, because S-04's own message already
  needs the runner-up.
- **A second announcement for the heaviest absolute weight.** Owner decision, 2026-08-11: one
  announcement, on the estimate record. At one repetition the estimate equals the weight lifted, so
  a new heaviest single already fires it; a second notification would usually say the same thing
  twice in the same save, against FR-020's recorded noise argument. Reasoning and the condition that
  would make it wrong: `research.md` § D2 and D3, resolved together.
- **A record badge that survives a reload.** The save-time flag is ephemeral by the PRD's own words
  (`prd.md:280-282`): the list is the durable surface. `/workouts/[id]` is not changed to read the
  records view.
- **Records bucketed by repetition range**, and any "most repetitions" record for bodyweight work.
  Parked in the roadmap and out of MVP scope — named here because the plank row makes the absence
  visible.
- **A browser-test runner.** Owner decision: integration plus manual verification against the
  deployed URL, as S-02 and S-03 did. Wiring Playwright is its own foundation, not a rider on a
  product slice.
- **Per-exercise 1RM history over time** (FR-023, `nice-to-have`, parked).
- **Tonnage of any kind.** S-07 and S-08. The base view this slice creates is a plausible input for
  them and is **not** designed for them.
- **Changing the unit or the formula.** S-06 ships the preference screen; this slice reads whatever
  is on the profile.
- **A shadcn component sweep.**

## Implementation Approach

Five phases, ordered so the access boundary and the arithmetic are both proven — and deliberately
broken to confirm the proofs work — before anything reads them, and so the slice ends on a screen
that has been seen at its public address.

1. **The two views, their access boundary, and the formula's parity with TypeScript.**
2. **The records service and the verdict on `/api/sets`.**
3. **The screens**: `/records`, and the record badge at save time.
4. **Deploy, and verify the flow against the public address.**
5. **Truth up the documents.**

## Critical Implementation Details

**`s.reps::numeric / 30` — the cast is load-bearing.** `reps` is `smallint`, so `reps / 30` is
**integer division** and evaluates to `0` for every repetition count in the valid range. Without the
cast Epley silently degenerates to `estimate = weight` across the whole of 1–12: a green pipeline,
plausible numbers, and a wrong product. Brzycki is safe by accident — `weight_kg` is already
`numeric`, so `* 36` promotes before the divide — which is worse, because the defect would surface
only for accounts that switch formula in S-06.

**`security_invoker = true` must be set on BOTH views.** A view built on another view does not
inherit the inner view's setting; each carries its own, and the inner one governs its own reach into
the tables. And the `revoke all … from anon, authenticated` must come before any grant: Supabase's
default privileges grant `all on tables` to both roles, and PostgreSQL's `TABLES` object class covers
views — so without the revoke, `anon` acquires a read path to the entire records surface that nobody
decided on.

**The records list must be anchored on the exercises the account has logged, not on the records.**
Joining the two record subqueries to each other produces no row at all for an exercise whose sets are
all at zero load — a plank, a push-up, an unweighted pull-up, which are routine rather than edge
cases. The list therefore starts from `select distinct user_id, exercise_id from set_estimates` and
`left join`s both records onto it, so such an exercise arrives with both records null and the screen
can say why.

**The verdict must never turn a successful save into a failure.** The set is already committed when
the verdict query runs. On any failure the endpoint returns 201 with `record: null` and logs
server-side. The alternative is worse than a missing badge: `AddSetForm.tsx:91-99` deliberately keeps
the typed values for a **manual** retry, so an error shown for a set that is in fact saved invites
the user to log it twice — the duplicate write S-03 decision #10 exists to prevent.

**Generated view types are nullable.** `supabase gen types` cannot prove not-null through a view, so
every column of both views arrives as `T | null` in `src/db/database.types.ts`. The service narrows
once, at the boundary; the page and the island must not be written as though the columns were the
table's.

## Phase 1: The two views, their boundary, and the formula's parity

### Overview

Create the SQL that derives a record, put it behind the same row-level security the tables have, and
prove both — the boundary by attacking it, the arithmetic by comparing it against the TypeScript that
already passes the unit suite.

### Changes Required

#### 1. The migration

**File**: `supabase/migrations/20260811143000_derive_personal_records_from_surviving_sets.sql`

**Intent**: Add the per-set estimate view and the per-exercise records view, both subject to the
caller's own RLS, and neither storing anything. The header comment states why a view here is an
access-control decision rather than a convenience, in the register of the S-03 migration's header.

**Contract**: two views in `public`, both `with (security_invoker = true)`, both preceded by
`revoke all … from anon, authenticated` and granted `select` to `authenticated` only. `notify pgrst,
'reload schema';` last. No table is altered; no index is added (S-03 created the one this needs).

`public.set_estimates` — one row per set, carrying what the screen needs to render it and the number
the comparison runs on. The `case` is the second implementation of `one-rep-max.ts` and is the reason
Phase 1 ships a parity check:

```sql
case
  when s.weight_kg <= 0            then null   -- bodyweight and assisted take no part
  when s.reps not between 1 and 12 then null   -- outside the formulas' validity
  when s.reps = 1                  then s.weight_kg          -- Epley must be pinned here
  when p.estimation_formula = 'brzycki'
                                   then s.weight_kg * 36 / (37 - s.reps)
  else s.weight_kg * (1 + s.reps::numeric / 30)              -- NOTE THE CAST
end as estimate_kg
```

joined `sets → exercise_entries → workouts` **by `(id, user_id)` at each level** (the same ownership
pairs the composite foreign keys use) and `→ profiles` on `p.id = s.user_id`, which is what makes the
view parameterless: the formula is the row owner's own, read under the owner's own policy, so S-06
changes what this returns with no migration.

`public.personal_records` — one row per exercise the account has logged:

```sql
from (select distinct user_id, exercise_id from public.set_estimates) logged
join      public.exercises x on x.id = logged.exercise_id
left join (select distinct on (user_id, exercise_id) * from public.set_estimates
           where estimate_kg is not null
           order by user_id, exercise_id, estimate_kg desc, created_at, set_id) best
          using (user_id, exercise_id)
left join (select distinct on (user_id, exercise_id) * from public.set_estimates
           where weight_kg > 0
           order by user_id, exercise_id, weight_kg    desc, created_at, set_id) heavy
          using (user_id, exercise_id)
```

Each record exposes its set's `set_id`, `reps`, `weight`, `weight_unit`, `weight_kg` and
`performed_on`, plus `estimate_kg` / `weight_kg` respectively — the screen re-derives the displayed
number from the typed weight rather than reading a kilogram value back (see § Architecture, and
`AGENTS.md`: read `weight` for anything shown to the user). `set_id` is the final tie-break in both
orderings, so the view is deterministic as the NFR requires (`prd.md:307-308`).

**Note the two exclusion rules differ, deliberately** (owner, 2026-08-11): the estimate record takes
sets of 1–12 repetitions with `weight_kg > 0`; the heaviest-weight record takes **every** set with
`weight_kg > 0`, because "heaviest ever handled" is a fact about the load, not an estimate. A comment
in the migration says so, with the US-02 sentence it is reconciling.

#### 2. Apply and regenerate

**File**: `src/db/database.types.ts` (generated — never hand-edited)

**Intent**: Get both views into the schema of both projects and into the committed types, so the
service is written against a schema that exists rather than one that is intended.

**Contract**: `npm run db:push` (test project first, then production — there is no single-target
push), `npm run db:status` to confirm both histories match, then `npm run db:types` and stage the
result. `Views` in the generated file stops being `[_ in never]: never`; every column arrives
nullable.

#### 3. The boundary and parity suite

**File**: `tests/integration/personal-records.test.ts` (new)

**Intent**: Prove the two things about this phase that fail silently — that the views are subject to
the caller's RLS, and that the SQL formula and the TypeScript formula are the same formula. Written
in the shape of `workout-log-rls.test.ts`: every negative assertion paired with a re-read as a caller
entitled to see the row, and the raw refusal printed as evidence
(`lessons.md` § "Verify with a script that attacks").

**Contract**: fixture accounts `rls-owner-a` / `rls-owner-b`, run-unique marker, rows reset in
`beforeAll` and restored in a `finally`. Assertions:

1. A reads its own rows from both views after logging a workout, an entry and estimable sets.
2. **B reads both views filtered to A's `user_id` and `exercise_id` and gets nothing**, while A
   re-reads the same rows successfully. This is the `security_invoker` tripwire.
3. **An anonymous client has no read path to either view** — the mirror of assertion 9 in
   `workout-log-rls.test.ts`.
4. **Parity**: a table of boundary cases — 1, 2, 5, 12 and 13 repetitions, zero load, negative load,
   a non-integer-representable weight — logged as real sets, read back from `set_estimates`, and
   compared against `estimateOneRepMax` from `src/lib/services/one-rep-max.ts` within a stated
   epsilon, **for both formulas**. The account's `profiles.estimation_formula` is flipped to `epley`
   for the second half and restored in a `finally`; `fileParallelism: false` makes that safe.
   The `reps = 1` case and the `reps = 13` case are the two that must be asserted explicitly.
5. An exercise whose only sets are at zero load appears in `personal_records` with **both** record
   sides null — the plank row the screen has to explain.

**Then break each guard and confirm a test fails**, recording which mutation broke which test in the
phase's Progress notes: drop `security_invoker` from `set_estimates` (assertion 2 must fail); drop it
from `personal_records` only (assertion 2 must still fail — proving each view carries its own);
remove the `::numeric` cast under `epley` (assertion 4 must fail); change the estimate guard to
`weight_kg >= 0` (assertion 5 must fail). `lessons.md` § "A guard you have not mutated may not
guard" — an empty test is worse than a missing one.

### Success Criteria

#### Automated Verification

- `npm run db:push` applies to both projects and `npm run db:status` shows identical histories
- `npm run db:types` regenerates `src/db/database.types.ts` with both views present, and the file is staged
- `npm run test:integration` passes, including all five assertions of the new suite
- `npm run lint` passes
- `npm run typecheck` passes
- `npm test` passes (unchanged — the unit suite cannot reach SQL and must stay green)

#### Manual Verification

- Each of the four mutations above was applied, the named assertion was observed to fail, and the mutation was reverted — recorded in Progress with which mutation broke which test

**Implementation Note**: pause here for confirmation that the mutation testing was carried out before starting Phase 2. Nothing later in this plan can detect a guard that does not guard.

---

## Phase 2: The records service and the verdict on `/api/sets`

### Overview

One place that knows how to ask the database about a record, a pure function that turns the answer
into a verdict, and the endpoint growing a field.

### Changes Required

#### 1. The verdict, as a pure decision

**File**: `src/lib/services/records-verdict.ts` (new)

**Intent**: Turn "the top two estimable sets for this exercise" plus "the id of the set just saved"
into one of three answers, in a module that imports nothing and can therefore be unit-tested directly
and imported by a hydrated island. The split mirrors `set-estimate.ts` (pure) against `workouts.ts`
(querying), and `validation/workout.ts` against `validation/workout-schemas.ts`.

**Contract**: exports the result type and the decision function. The three answers are `record`
(carrying the previous best set), `baseline` (this set is top and there is nothing behind it), and
`none`. The function is total: a set absent from the rows — because it was not estimable — is `none`.

```ts
export type RecordVerdict =
  | { kind: "record"; previousBest: DisplayableSet & { performed_on: string } }
  | { kind: "baseline" }
  | { kind: "none" };

export function verdictForSet(topTwo: readonly RankedSet[], savedSetId: string): RecordVerdict;
```

**Unit tests** (`src/lib/services/records-verdict.test.ts`) cover: the saved set first with a runner-up
(`record`); first with no runner-up (`baseline`); second (`none`); absent (`none`); and the tie case,
where the ordering has already put the equal older set first so the answer is `none` — the assertion
that pins US-02's "equal is not a record" at this level.

#### 2. The querying service

**File**: `src/lib/services/records.ts` (new)

**Intent**: The two reads this slice makes, in the module shape every other service here uses — an
injected client, an explicit `.eq("user_id", …)` beside the policy, and a throw on a real error so a
caller cannot mistake "unreachable" for "nothing yet".

**Contract**: two functions.

- `topTwoEstimatesForExercise(supabase, userId, exerciseId)` — reads `set_estimates`, excludes null
  estimates, orders `estimate_kg desc, created_at asc, set_id asc`, limits to 2. **The ordering is
  the domain rule and must match the view's** — it is what makes an equal older set win.
- `listPersonalRecords(supabase, userId)` — reads `personal_records` for the account, ordered so the
  most recently improved exercise is first and exercises with no record sink to the bottom.

Both narrow the generated nullable view columns once, here, so no caller repeats it.

#### 3. Types

**File**: `src/types.ts`

**Intent**: Alias the two view rows and declare the shape the endpoint sends to the island, derived
from the generated types rather than restated.

**Contract**: `SetEstimateRow` / `PersonalRecordRow` from `Database["public"]["Views"]`, plus a
`RecordAnnouncement` DTO picked from them. The DTO must satisfy `DisplayableSet` so the island can
call `estimateForLoggedSet` on the previous best without a second conversion path.

#### 4. The endpoint

**File**: `src/pages/api/sets/index.ts`

**Intent**: After the insert, ask for the verdict and return it beside the set. Additive: the
existing `{ set }` key and status code are unchanged.

**Contract**: the 201 body becomes `{ set, record }`, where `record` is `null` or the announcement
DTO. The verdict is computed **after** the insert, inside its own `try`, and any failure resolves to
`record: null` plus a `console.error` — never a non-2xx, for the reason in § Critical Implementation
Details. The exercise id needed for the query comes from the entry the endpoint has already loaded to
verify ownership; extend `getEntryForSet` to select it rather than issuing another read.

#### 5. Endpoint assertions

**File**: `tests/integration/personal-records.test.ts` (extended)

**Contract**: drive `addSetRoute` directly, as `workout-endpoints.test.ts` does, and assert the
verdict for: the first set for an exercise (`record` is null — baseline, silent); a heavier
subsequent set (`record` present, previous best matching the earlier set); an equal set (null); a
lighter set (null); a 13-repetition set that would out-estimate everything if the range were ignored
(null); an assisted set on a bodyweight exercise (null); and a set logged into an **older, back-dated**
workout that out-estimates everything (`record` present — the documented consequence of deciding
"previous" as "every other set"). Each paired with a re-read of `set_estimates` so the assertion is
about stored state and not only the response.

### Success Criteria

#### Automated Verification

- `npm test` passes, including the new `records-verdict.test.ts` unit tests
- `npm run test:integration` passes, including the seven verdict assertions
- The three pre-existing `/api/sets` assertions in `tests/integration/workout-endpoints.test.ts` pass **unchanged**
- `npm run lint` passes
- `npm run typecheck` passes

#### Manual Verification

- With `set_estimates` temporarily renamed so the verdict query fails, a set still saves and returns 201 with `record: null`, and the failure appears in the server log — then the rename is reverted

**Implementation Note**: pause here for confirmation before starting Phase 3.

---

## Phase 3: The screens

### Overview

The badge at the moment of saving, and the list that is what the user checks before deciding a load.

### Changes Required

#### 1. The badge

**Files**: `src/components/workouts/AddSetForm.tsx`, `src/components/workouts/WorkoutDetail.tsx`

**Intent**: Carry the verdict from the response up to the set that earned it, and render it on that
set's own row beside the estimate. Ephemeral by decision — nothing reads it back after a reload.

**Contract**: `AddSetForm`'s `onLogged` gains the verdict alongside the set; `WorkoutDetail` holds it
against the new set's id and renders it in the row `SetEstimateLabel` already occupies. **Both
numbers on screen are re-derived in TypeScript** — the new set's estimate as today, the previous
best's through `estimateForLoggedSet` on the DTO — so the screen never displays a value SQL computed.
`roundForDisplay` at the last moment, as everywhere else. A `baseline` verdict renders nothing at
all; the first set for an exercise must be silent (US-02).

#### 2. The records page

**File**: `src/pages/records.astro` (new)

**Intent**: FR-021's list. **A plain Astro page, no island** — it is static, and `AGENTS.md`
§ Conventions puts React only where interactivity is needed.

**Contract**: reads the profile and `listPersonalRecords` in the frontmatter, with the same
`loadFailed` branch `workouts/index.astro:16-31` uses, so a failed read is never indistinguishable
from an account with no records. Each row shows the exercise name and muscle group, then for each of
the two records the value in the account's unit, the set behind it (`reps × weight`) and its date. A
row whose records are both null says why — "bodyweight only — no load to base a record on" — in the
register `SetEstimateLabel` already uses for a set with no number. An account with no workouts at all
gets the empty state, not a blank.

#### 3. Reaching it

**Files**: `src/middleware.ts`, `src/pages/dashboard.astro`, `src/pages/workouts/index.astro`

**Contract**: `/records` added to `PROTECTED_ROUTES` — route protection lives there in both
directions, never in a per-page check — and linked from the dashboard and the workout list the way
`/exercises` is.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run typecheck` passes (`astro check` covers the new `.astro` page)
- `npm test` and `npm run test:integration` pass
- `npm run build` succeeds

#### Manual Verification

- Logging a set that beats a previous best shows the badge on that set's row, naming what it beat, without a reload
- The first set logged for a fresh exercise shows no badge
- After a reload the badge is gone and the record is visible on `/records` — the ephemeral/durable split behaving as designed
- `/records` shows both records for a barbell lift, with the set and date behind each, and a plank logged at zero load appears with the explanation rather than being absent
- `/records` signed out redirects to `/auth/signin`
- The whole flow is operable one-handed at 360 px

**Implementation Note**: pause here for confirmation before deploying.

---

## Phase 4: Deploy, and prove it on the public address

### Overview

`lessons.md` § "A slice that ends in a screen needs a deployment phase": S-02 closed with 38
exercises in production that no route could reach, every criterion green. The database half of this
slice reached production in Phase 1; the screens reach it here.

### Changes Required

#### 1. Deploy

**Contract**: `npm run build` then `npx wrangler deploy`. No new secret and no new binding — the
Worker still holds exactly `SUPABASE_URL` and `SUPABASE_KEY`, and this slice adds no configuration.

### Success Criteria

#### Automated Verification

- The full gate in CI order exits 0: `npm run lint` → `npm run typecheck` → `npm test` → `npm run test:integration` → `npm run build`
- `npx wrangler deploy` completes and reports the deployed version

#### Manual Verification

- On `https://gymlog.10x-astro-starter.workers.dev`, signed in as a real account: log a set that beats a previous best and see the badge
- `/records` on the deployed address lists the record just set, with the correct set and date
- Both checked on a phone-width viewport, not only a desktop window

**Implementation Note**: pause here for confirmation before Phase 5.

---

## Phase 5: Truth up the documents

### Overview

Record the shape a later slice would otherwise get wrong. The nested-ownership variant was written
into `AGENTS.md` for exactly this reason after S-03; the view variant is the same kind of debt.

### Changes Required

#### 1. The agent guide

**File**: `AGENTS.md`

**Intent**: Add the **derived-view variant** to § Access control, beside the shared-catalogue and
nested-ownership variants, and record the SQL/TypeScript formula duplication in § Domain rules beside
the `0.45359237` rule it resembles.

**Contract**: the variant states that a view without `security_invoker = true` executes as its owner
and is therefore not subject to the tables' RLS; that the setting is per-view and not inherited
through a view chain; that `revoke all … from anon, authenticated` precedes the grant because
PostgreSQL's `TABLES` default privileges cover views; and it names the assertion that would fail if
any of that were undone — as the two existing variants do, so it is not deleted as redundant.
§ Known state gains the two views and the `::numeric` cast. § Commands notes that `db:types` now
produces nullable view columns.

#### 2. The change record and the roadmap

**Files**: `context/changes/personal-records/change.md`, `context/foundation/roadmap.md`

**Contract**: `change.md` status advances and records every deviation from this plan with its reason.
The roadmap's S-04 row and body move to `done`, with the lesson learned in § Done in the register the
other entries use.

### Success Criteria

#### Automated Verification

- `npm run lint` passes (prettier formats the markdown through lint-staged on commit)

#### Manual Verification

- Read `AGENTS.md` § Access control as the agent planning S-05 tomorrow: is it obvious that a view carries its own `security_invoker`, and that a records number may never be stored?
- The roadmap's S-04 entry reads as done and names what a reader should not re-open

---

## Testing Strategy

### Unit tests

- `src/lib/services/records-verdict.test.ts` — the five verdict cases, including the tie. This is the
  only genuinely unit-testable piece of the slice, and the plan names its module deliberately
  (`lessons.md` § last entry).
- The existing suites must stay green **unchanged**. If a change here requires editing
  `one-rep-max.test.ts` or `set-display.test.ts`, that is a signal the domain rule moved and the
  change needs stating, not accommodating.

### Integration tests

`tests/integration/personal-records.test.ts`, one new file, covering both phases:

- **Boundary**: B sees nothing of A through either view; anonymous has no path to either; every
  negative assertion paired with a re-read as A.
- **Parity**: SQL against `estimateOneRepMax` across the boundary table, both formulas.
- **Anchoring**: an exercise with only zero-load sets appears with both records null.
- **Verdict**: the seven cases in Phase 2, each paired with a re-read of stored state.

### Manual testing steps

1. Sign in on the deployed address; open an existing workout with a lift already logged.
2. Log a set clearly heavier than anything before it → the badge appears on that row, naming what it beat.
3. Reload → the badge is gone; `/records` shows the new value with the right set and date.
4. Add a brand-new exercise, log one set → no badge (baseline).
5. Log an identical second set → no badge (equal is not a record).
6. Log a 15-repetition set at a very high load → no badge, and the row still says "outside 1–12 reps".
7. Log a plank at zero load → `/records` shows the plank with the explanation rather than omitting it.
8. Repeat 2 and 3 at 360 px width, one-handed.

## Performance Considerations

- **The Worker does no arithmetic over sets.** Both reads return at most two rows (the verdict) or one
  row per logged exercise (the list). The 10 ms cap is CPU, and waiting on Postgres is not charged —
  so the extra query on `/api/sets` costs the endpoint essentially nothing against the 200 ms
  acknowledgement NFR.
- **The list is bounded by the catalogue, not by history** — one row per exercise the account has
  logged. `listWorkouts`' documented "somewhere in the low hundreds this stops being correct"
  (`src/lib/services/workouts.ts:61-71`) does not recur here.
- **The indexes exist and their use is an assumption worth checking once.** Run `explain (analyze,
buffers)` on both queries against `gymlog-test` after Phase 1 and record the plan in Progress. If
  the `distinct on` subqueries do not receive the pushed-down `user_id` qual, the fallback is
  `left join lateral … limit 1` per record, which forces the filter but scales with the number of
  exercises rather than the number of sets.

## Migration Notes

- **One migration, entirely additive.** No table, column, constraint or index changes. Two views are
  created; nothing is dropped.
- **Both projects receive it in one `npm run db:push`**, `gymlog-test` first. There is deliberately no
  single-target push.
- **Production holds the views before any route reads them**, between Phase 1 and Phase 4. The same
  deliberate, bounded window S-03 opened, closed by a phase with its own criteria.
- **The views must be dropped and recreated, never `create or replace`d, if a column's type or order
  changes** — `create or replace view` refuses a column-list change, and a half-applied migration
  against one of two projects is the drift `db:push` exists to prevent.
- **`npm run db:types` must run after the push**, and nothing enforces it. Phase 1 sequences it
  explicitly and stages the result.
- **Nothing here is a data migration.** There is no backfill, because there is nothing stored. Every
  record for every existing set exists the moment the views do.

## Decisions

| #   | Decision                                                              | Rationale                                                                                                                                                                                                                                                  | Source   |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **The record is derived in Postgres, through views**                  | The list touches every set the account has logged, against a 10 ms CPU kill; and one definition prevents the verdict and the list disagreeing. Wrong if the log stays small enough that the Worker could do it — which the list's growth rules out.        | Research |
| 2   | **The verdict is decided by comparing ids, not numbers**              | Postgres `numeric` and JavaScript float64 do not agree in the last bits, and a record decided across that boundary could be invented or erased. Wrong only if the two ever become the same arithmetic, which they cannot.                                  | Research |
| 3   | **"Previous best" means every OTHER set, not every earlier one**      | Records are derived from surviving sets and the list has no time dimension. Consequence, stated and asserted: back-dating a workout can announce a record today.                                                                                           | Research |
| 4   | **One announcement, on the estimate record only**                     | At one repetition the estimate equals the weight lifted, so a new heaviest single already fires it; a second notification would usually duplicate it, against FR-020's recorded noise argument. Wrong for someone whose weight records land above 12 reps. | Owner    |
| 5   | **The heaviest-weight record has no repetition limit**                | "Heaviest ever handled" is a fact about the load, not an estimate; restricting it would blank the record list for anyone training an exercise only at high repetitions. Requires D4 to hold, or it contradicts US-02.                                      | Owner    |
| 6   | **The save-time badge is ephemeral; the list is the durable surface** | The PRD says so in as many words (`prd.md:280-282`). Keeps `/workouts/[id]` free of a second read and free of a badge that would start disappearing on its own once S-05 allows edits.                                                                     | Owner    |
| 7   | **The records list shows the set and the date behind each record**    | "Every record shown is backed by a set that still exists" (US-02) — showing the set IS that evidence, and a number with no date cannot be read as progress. Wrong if the row proves too dense at 360 px.                                                   | Owner    |
| 8   | **An exercise with no record appears, with an explanation**           | Plank, push-up and unweighted pull-up are routine, not edge cases; a logged exercise absent from the list reads as lost data. Matches the voice `set-estimate.ts` already established.                                                                     | Owner    |
| 9   | **No browser-test runner in this slice**                              | The layer that can lie silently — SQL under RLS — is covered by integration; a browser runner is its own foundation. Wrong if the badge's plumbing breaks in a way only a rendered page shows.                                                             | Owner    |
| 10  | **The list is a plain `.astro` page, no island**                      | It is static. `AGENTS.md` § Conventions puts React only where interactivity is needed, and an island would ship the service's types toward the browser for nothing.                                                                                        | Planner  |
| 11  | **The verdict is best-effort; a failed verdict still returns 201**    | The set is already committed. An error here would invite a manual retry that logs the set twice — the failure class S-03 decision #10 exists to prevent. Wrong if a missing badge were ever worse than a duplicated set, which it is not.                  | Planner  |
| 12  | **The pure verdict lives in its own dependency-free module**          | It is the one piece the hermetic unit suite can reach, and `lessons.md` requires a unit-test criterion to name the module that will hold it. Also keeps the island's import graph free of the Supabase client.                                             | Planner  |
| 13  | **The list is anchored on logged exercises, not on records**          | Joining the two record sides to each other drops the plank row entirely, which decision 8 requires to exist. Costs one `distinct` pass.                                                                                                                    | Planner  |
| 14  | **`set_id` is the final tie-break in every ordering**                 | The NFR requires derived values to be deterministic and reproducible; two sets with identical estimates and identical `created_at` would otherwise order arbitrarily between reads.                                                                        | Planner  |

## Open Risks & Assumptions

- **The formula now has two implementations, and only assertion 4 of the new suite notices a drift.**
  It is the direct analogue of `0.45359237`'s "two copies that must agree", and it is weaker, because
  a constant can be grepped and a `case` expression cannot. The migration and `one-rep-max.ts` must
  each carry a comment naming the other.
- **`security_invoker` is documented Postgres behaviour that nothing in this repository has exercised
  yet.** Phase 1 proves it against `gymlog-test` rather than assuming it, and the mutation step is
  what makes the proof worth having.
- **The view's RLS predicate and the pushed-down `user_id` filter are assumed to combine into an
  index scan.** Checked once with `explain`; the fallback is named in § Performance Considerations.
- **A record whose margin is below 0.05 kg displays as beating an equal number.** Both values round
  to one decimal place, which the NFR sets as the display precision. The record is real; only the
  rendering collapses. Accepted rather than solved — solving it means showing more decimals than the
  product shows anywhere else.
- **`personal_records` is a plausible input for S-07/S-08 and is not designed for them.** Tonnage
  needs sums over a week, not argmaxes over all history. Whoever plans those should expect to add a
  view, not to widen this one.
- **The plank row makes the absence of a repetition record visible.** Somebody will ask for "most
  reps at bodyweight". It is parked (PRD § Open Questions, resolved during shaping) and adding it
  later costs nothing, because records are derived.

## References

- Research: `context/changes/personal-records/research.md`
- Prior slice, and the template this copies: `context/archive/2026-08-10-log-workout-with-estimate/plan.md`
- The nested-ownership variant this extends: `AGENTS.md` § Access control
- The rules this plan is bound by: `context/foundation/lessons.md`
- Existing estimate arithmetic: `src/lib/services/one-rep-max.ts:43-53`, `src/lib/services/set-display.ts:52-103`
- The endpoint being extended: `src/pages/api/sets/index.ts:35-68`
- Assertion shapes to copy: `tests/integration/workout-log-rls.test.ts:226-253,388`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The two views, their boundary, and the formula's parity

#### Automated

- [x] 1.1 `npm run db:push` applies to both projects and `npm run db:status` shows identical histories — 50735e8
- [x] 1.2 `npm run db:types` regenerates `src/db/database.types.ts` with both views present, and the file is staged — 50735e8
- [x] 1.3 `npm run test:integration` passes, including all five assertions of the new suite — 50735e8
- [x] 1.4 `npm run lint` passes — 50735e8
- [x] 1.5 `npm run typecheck` passes — 50735e8
- [x] 1.6 `npm test` passes (unchanged) — 50735e8

#### Manual

- [x] 1.7 Each of the four mutations was applied, the named assertion was observed to fail, and the mutation was reverted — recorded with which mutation broke which test (five run; four broke a test, the fifth is recorded as a deviation in `change.md`) — 50735e8

### Phase 2: The records service and the verdict on `/api/sets`

#### Automated

- [x] 2.1 `npm test` passes, including the new `records-verdict.test.ts` unit tests — 30781d5
- [x] 2.2 `npm run test:integration` passes, including the seven verdict assertions — 30781d5
- [x] 2.3 The three pre-existing `/api/sets` assertions pass unchanged — 30781d5
- [x] 2.4 `npm run lint` passes — 30781d5
- [x] 2.5 `npm run typecheck` passes — 30781d5

#### Manual

- [x] 2.6 With the verdict query forced to fail, a set still saves and returns 201 with `record: null`, and the failure is logged (`set_estimates` renamed on gymlog-test; `PGRST205` logged, both sets 201 and stored, `record` null; view restored) — 30781d5

### Phase 3: The screens

#### Automated

- [x] 3.1 `npm run lint` passes — d476769
- [x] 3.2 `npm run typecheck` passes — d476769
- [x] 3.3 `npm test` and `npm run test:integration` pass — d476769
- [x] 3.4 `npm run build` succeeds — d476769

#### Manual

- [x] 3.5 A set beating a previous best shows the badge on its row, naming what it beat, without a reload (verified on the deployed address with Phase 4)
- [x] 3.6 The first set for a fresh exercise shows no badge (verified on the deployed address with Phase 4)
- [x] 3.7 After a reload the badge is gone and the record is on `/records` (verified on the deployed address with Phase 4)
- [x] 3.8 `/records` shows both records with the set and date behind each; a zero-load-only exercise appears with the explanation (verified on the deployed address with Phase 4)
- [x] 3.9 `/records` signed out redirects to `/auth/signin` (read-only probe, locally and on the deployed address: `302 → /auth/signin`)
- [x] 3.10 The flow is operable one-handed at 360 px (verified on the deployed address with Phase 4)

### Phase 4: Deploy, and prove it on the public address

#### Automated

- [x] 4.1 The full gate in CI order exits 0
- [x] 4.2 `npx wrangler deploy` completes and reports the deployed version (`06c4e6f6-d669-4e36-b69d-e3aea4c1a9ca`)

#### Manual

- [x] 4.3 On the deployed address, a set beating a previous best shows the badge
- [x] 4.4 `/records` on the deployed address lists the record just set, with the correct set and date
- [x] 4.5 Both checked at phone width

### Phase 5: Truth up the documents

#### Automated

- [ ] 5.1 `npm run lint` passes

#### Manual

- [ ] 5.2 `AGENTS.md` § Access control makes the view variant obvious to the agent planning S-05
- [ ] 5.3 The roadmap's S-04 entry reads as done and names what should not be re-opened
