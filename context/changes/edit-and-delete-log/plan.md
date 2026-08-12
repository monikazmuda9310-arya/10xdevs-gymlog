# Edit and Delete the Log Implementation Plan

## Overview

Four correcting operations — edit a workout's date and note, delete a workout with everything under
it, remove an exercise from a workout, and edit or delete an individual set — each preceded by a
warning naming which personal record it holds and what that record will fall to, and each requiring
confirmation (FR-006, FR-007, FR-010, US-02).

This is the last hole in the badge's "meaningful CRUD" criterion: read and create are on screen,
update and delete are not. It is also the sharpest false summit on the roadmap — stopping before it
leaves a product that is complete and **uncorrectable**, in which a mistyped weight is permanent.

## Current State Analysis

**The database is already ready and needs no migration.** `20260811005248_create_workout_log_with_row_ownership.sql`
grants `update` and `delete` to `authenticated` on all three tables and carries the matching
per-operation policies, with an explicit comment at line 151: *"Update and delete are granted
although this slice ships no UI for either. The policy is the guarantee… absent screens are scope
(S-05), not permission."* The cascades exist too: `exercise_entries` and `sets` reference their
parent's `(id, user_id)` `on delete cascade`, so deleting a workout removes everything beneath it in
one statement. **This slice is pure application code.**

**Nothing derived is stored.** `public.set_estimates` and `public.personal_records` (S-04) are
`security_invoker` views over the surviving sets. There is no record column, no record row and no
cache, so a delete needs no invalidation: the next read simply returns a different row. That is what
makes "warn, then let the record fall" a re-derivation rather than a repair.

**The application has no write path other than insert.** S-03's implementation review verified that
`.update(`, `.delete(` and `.upsert(` appear nowhere in `src/`. Every one of the twelve
update/delete policies exists and **has never been exercised by application code**. They are
therefore guards that have never been mutated, which Phase 2 addresses directly.

### Three findings that changed the design

**1. `topTwoEstimatesForExercise` covers one of the two records, not both.**
`src/lib/services/records.ts:37` filters `.not("estimate_kg","is",null)` and orders by `estimate_kg`.
The heaviest-weight record ranks differently — `weight_kg > 0`, `weight_kg desc`, **no repetition
limit** (AGENTS.md § Domain rules: "the two records have different exclusion rules, deliberately").
The gap is the common case, not an exotic one: with `100 kg × 1` (estimate 100) and `90 kg × 10`
(estimate 120) logged, the heaviest record belongs to the first set and the estimate record to the
second. Deleting the `100 kg × 1` set drops the heaviest record while the estimate ranking reports
"this set is not the leader" — a silent fall, which is precisely what this slice exists to prevent.

**2. Top-two is the wrong shape for three of the four operations.** It is exact for deleting **one**
set, because only one row disappears. Deleting an exercise entry removes every set of that exercise
in that workout, and deleting a workout can remove **both** the leader and the runner-up for the same
exercise — in which case the record falls to the third-best, which top-two cannot see.

The shape that works for all four is **"the best surviving candidate, excluding what is about to
disappear"**: one ordered query with an exclusion filter and `.limit(1)`. The current holder does not
need to be computed at all — `public.personal_records` already reports it, together with the workout
it belongs to (`best_estimate_set_id`, `best_estimate_workout_id`, `heaviest_set_id`,
`heaviest_workout_id`). That covers all three exclusion levels without touching the views:

| Operation      | Holder is affected when                                            | Successor query excludes  |
| -------------- | ------------------------------------------------------------------ | ------------------------- |
| set edit/delete| `best_estimate_set_id = <set>` / `heaviest_set_id = <set>`         | `set_id = <set>`          |
| entry delete   | `<record>_workout_id = <workout>` **and** `exercise_id = <entry's>`| `exercise_entry_id = <entry>` |
| workout delete | `<record>_workout_id = <workout>`                                  | `workout_id = <workout>`  |

The successor query only runs for exercises that a record read already flagged as affected —
typically zero, one or two per operation — so the cost is bounded regardless of how large the log
grows.

**3. For an edit, the exact post-change record cannot be computed without breaking the seam.**
The record after an edit is `max(the set's new estimate, the successor)`. Computing the new estimate
in TypeScript (float64) and comparing it against a value Postgres produced (exact `numeric`) is the
one comparison this project forbids — the hazard `records-verdict.ts` exists to avoid. The warning
therefore quotes **the successor**, which is exact and comes from SQL, and states it conditionally
for an edit ("if this change takes the record off this set, it falls to X") and absolutely for a
delete ("it falls to X"). No number shown is ever computed by TypeScript against a number computed by
SQL.

### Key Discoveries

- `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:151` — update/delete
  grants and policies exist; the comment names S-05 as the missing screen, not the missing permission.
- `src/lib/services/records-verdict.ts:56` — the verdict compares **ids**, never numbers. Every
  decision in this slice keeps that seam.
- `src/lib/services/records.ts:28` — the ordering `estimate desc, created_at asc, set_id asc` is the
  tie-break rule and must match the `distinct on` ordering in `public.personal_records`. The
  successor queries added here are a third copy of that ordering and are pinned by assertion.
- `src/lib/services/record-display.ts:51` — every figure printed is re-derived in TypeScript from the
  winning set's typed `weight`/`weight_unit`. **No number computed by SQL is ever displayed.**
- `src/components/workouts/WorkoutDetail.tsx:41` — the record-badge map's comment defers to this
  slice: *"Keeping them would also mean inventing behaviour for what happens when S-05 lets a set be
  edited out from under one."*
- `src/components/workouts/WorkoutDetail.tsx:109` — the island only ever **appends** to its entry
  state. Replacing and removing are new operations on that state.
- `src/pages/workouts/[id].astro:66` — the workout note renders as static Astro text. There is no
  edit affordance for date or note anywhere in the product today.
- `src/lib/validation/workout.ts:93` — `isWeightAllowed` is the single definition of the bodyweight
  rule, already shared by the form and the endpoint. The edit path is a third caller, not a second
  definition.
- `src/components/ui/` holds only `button.tsx` — there is no dialog primitive in the project yet.

## Desired End State

A signed-in user on `/workouts/<id>` can correct anything they logged:

- change the workout's date and note in place;
- delete the workout, after a dialog naming every exercise whose record it holds and what each falls
  to;
- remove an exercise from the workout, with the same warning scoped to that exercise;
- edit a set's repetitions, weight and RPE, or delete it, with the same warning.

After any of these, `/records` reflects the new truth on the next read — with no write to any record
and nothing to invalidate, because there is no stored record to be wrong.

Verified by: the integration suite (a second account cannot mutate the first's rows, asserted against
re-read state); the unit suite (which records fall, and to what, decided from ids); and a human
clicking through the deployed URL.

## What We're NOT Doing

- **No migration.** The grants, policies and cascades already exist. If this plan produces a
  migration, something has gone wrong.
- **No new database object** — no function, no RPC, no view change. The successor query is ordinary
  PostgREST against `set_estimates`.
- **No stored record, no `estimated_1rm` column, no cache.** Recomputation is re-reading. Patching a
  stored figure would undo S-04 and turn S-06's formula change from a re-derivation into a lie.
- **No warning about weekly tonnage when a date crosses a week boundary.** FR-006's Socrates note
  asks for it; tonnage does not exist until S-07, so a warning here would describe numbers the user
  has never seen. Phase 1 instead *proves* there is nothing to recompute. **Open Question 2's
  interface half is hereby passed to S-07 in writing** (Phase 5 records this).
- **No browser test runner.** Phase 3 of the course contract owns E2E through `/10x-e2e` with two
  chosen risks; bootstrapping Playwright here would duplicate that work.
- **No editing which exercise an entry points at.** Removing it and picking another is the same
  outcome with no extra surface.
- **No undo, no soft delete, no trash.** A confirmation dialog carrying the real consequence is what
  US-02 asks for; recoverable deletion is a different product decision.
- **No bulk operations** (delete several sets at once).
- **No pagination or bounding of `listWorkouts`** — S-03's finding F1 documented the threshold
  deliberately without a limit; that stands.

## Implementation Approach

The slice reuses the seam S-04 established and adds nothing to the way records are decided.

1. **Postgres ranks; TypeScript reads the ranking.** Two new query shapes (one per record) answer
   "what is the best surviving candidate, excluding these rows". A pure module compares **ids** to
   decide whether a record is affected. No arithmetic crosses the boundary.
2. **Every number on screen is re-derived in TypeScript** from the surviving set's typed weight,
   through the same `set-display.ts` the workout screen and `/records` already use.
3. **Resource routes carry the mutations**, leaving the three existing `POST` endpoints untouched so
   the assertions pinning them cannot move.
4. **The island replaces state with the row the server returned**, so `weight_kg` is never guessed
   client-side and the entry's best estimate recomputes from the array by itself.

### Ordering hazard — the third copy

`estimate_kg desc, created_at asc, set_id asc` now exists in three places: the `distinct on` inside
`public.personal_records`, `topTwoEstimatesForExercise`, and the successor query added in Phase 1.
The heaviest ranking (`weight_kg desc, created_at asc, set_id asc`) gains its second copy at the same
time. A disagreement between any two of them makes the warning name a set that does not become the
record. Phase 1 pins this with an assertion that reads the view's own answer and the service's answer
for the same fixture and requires them to name the same set id.

### The zero-rows trap

Under RLS, an `update` or `delete` naming another account's row does not error — it matches **zero
rows** and reports success. Every mutation here must therefore `.select()` what it touched and answer
`404` when nothing came back. A handler that returns `204` on a zero-row delete tells one account
that it just deleted another's data, which is both a lie and an existence oracle. Phase 2 asserts
this directly.

---

## Phase 1: What falls, and to what

### Overview

The data-layer question ("which set holds this record, and what survives without these rows") and the
pure decision ("is this record affected, and what does it fall to") — with no endpoint and no screen.
Ends with a unit-testable module and integration assertions pinning the two rankings' exclusion rules
and their agreement with the views.

### Changes Required:

#### 1. The successor queries

**File**: `src/lib/services/records.ts`

**Intent**: Answer "the best surviving candidate for this exercise, ignoring the rows that are about
to disappear", once per record kind. Used by all four operations through one exclusion argument, which
is why the entry- and workout-level cases need nothing of their own.

**Contract**: Two exported async functions taking the request-scoped client, the user id, an exercise
id, and an exclusion selecting exactly one of `setId` / `exerciseEntryId` / `workoutId`. Each reads
`public.set_estimates` with an explicit `.eq("user_id", …)`, applies the record's own filter
(`estimate_kg is not null` / `weight_kg > 0`), applies the exclusion as a `.neq(...)`, orders by that
record's ranking, and takes `.limit(1)`. Both return `null` when nothing survives. The estimate
variant returns the existing `RankedSet`; the heaviest variant returns a shape without `estimate_kg`,
because a heaviest-record holder may carry no estimate at all.

Also export a reader for the current holders of a given set of exercises, reading
`public.personal_records` with the same explicit user filter — the view already carries
`best_estimate_set_id`, `best_estimate_workout_id`, `heaviest_set_id` and `heaviest_workout_id`, which
is what removes the need for any "who holds it" computation.

**Contract note (the ordering is load-bearing):**

```
estimate ranking:  .not("estimate_kg","is",null)  order estimate_kg desc, created_at asc, set_id asc
heaviest ranking:  .gt("weight_kg", 0)            order weight_kg    desc, created_at asc, set_id asc
```

Both must match the corresponding `distinct on` in `public.personal_records`. `.gt` not `.gte`: a
zero load is not a heaviest record.

#### 2. The pure decision

**File**: `src/lib/services/record-impact.ts` *(new)*

**Intent**: Given the current holder rows, a description of what is about to disappear, and the
surviving candidates, say which records fall and to what. **This module is where the "compare ids,
never numbers" rule lives for this slice**, and it is the module the unit criteria below name.

**Contract**: **Two exported functions, not one** — the split is forced by the data flow and naming it
here is the point. Deciding *which* records are affected needs only ids; fetching each successor needs
that answer first; so a single function taking "holders + removal + successors" cannot be written
without the caller already knowing what it is asking about.

- `affectedRecords(holders, removal): AffectedRecord[]` — pure id comparison. Takes the
  `personal_records` rows and a `Removal` union naming the three exclusion levels (set, entry,
  workout); returns one entry per record kind that this removal takes off its current holder, carrying
  the exercise id and name and the id of the set losing it. No successor, no arithmetic.
- `fallingRecords(affected, successors): FallingRecord[]` — pairs each affected record with the
  candidate that survives it, or with the reason none does.

Also exports `RecordCandidate` (`DisplayableSet` plus `set_id` and `performed_on`) and the
`FallingRecord` shape, whose successor field carries **three** outcomes rather than two: a surviving
candidate; `no_estimable_set` (sets remain but none can hold this record — the exercise stays on
`/records` with an explanation); or `no_sets_left` (nothing remains, so the exercise disappears from
`/records` altogether). Collapsing the last two into a bare `null` would let the dialog promise a
screen state that will not happen. Browser-safe and dependency-free at runtime, so the confirmation
dialog can import the shapes.

#### 3. What the dialog prints

**File**: `src/lib/services/record-display.ts`

**Intent**: One exported function turning a `FallingRecord` into the figure the dialog shows,
re-deriving it from the successor's typed `weight`/`weight_unit` through `set-display.ts` — never from
a column SQL computed. Extends the module that already does exactly this for `/records`, rather than
starting a second convention.

**Contract**: Takes a `FallingRecord`, the reader's unit and formula; returns the existing
`RecordFigure` when a successor survives, and otherwise passes through which of the two no-successor
outcomes applies, so the dialog can say "this exercise will have no estimated record" or "this
exercise will no longer appear in your records" — never a zero, and never the wrong one of the two.

#### 4. Integration coverage for the second ranking

**File**: `tests/integration/record-impact.test.ts` *(new)*

**Intent**: Pin the exclusion rules and orderings that no unit test can see, against `gymlog-test`,
following the fixture discipline in AGENTS.md § Testing (reset in `beforeAll`, run-unique values,
restore in a `finally`).

**Contract**: Assertions covering — a set outside 1–12 repetitions is a heaviest candidate but not an
estimate candidate; a zero-load set is neither; the successor query's answer for "exclude the current
holder" names the same set the view would promote; excluding at entry level and at workout level each
skip every set beneath them; and an exercise whose every set is excluded yields `null` rather than a
row.

#### 5. Proving there is nothing to recompute on a date change

**File**: `tests/integration/record-impact.test.ts`

**Intent**: Close FR-006's recomputation clause by evidence rather than by feature. Changing
`performed_on` must change which week a set belongs to on the next read, with no stored figure
anywhere to migrate.

**Contract**: One assertion that updates a fixture workout's `performed_on` across a Monday boundary
and re-reads `set_estimates`, showing `performed_on` changed on every set beneath it and that the
account's records are otherwise identical — the record is decided by load, not by date.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm test`
- `src/lib/services/record-impact.test.ts` covers **both exported functions by name** —
  `affectedRecords`: holder unaffected, holder affected, a removal affecting the heaviest record but
  not the estimate record (the `100 kg × 1` / `90 kg × 10` case), and removals at entry and workout
  level; `fallingRecords`: a surviving successor, `no_estimable_set`, and `no_sets_left` kept distinct
- Integration check passes: `npm run test:integration`
- Build passes: `npm run build`
- `git grep -n "estimate_kg desc" -- src supabase` shows exactly the two expected call sites plus the
  view, and their orderings are identical
- Mutation (a): `.gt("weight_kg", 0)` → `.gte` fails the zero-load assertion, then reverted
- Mutation (b): dropping `created_at asc` from the successor ordering fails the tie assertion, then
  reverted
- Mutation (c): removing the `.neq(...)` exclusion fails the "successor is not the holder" assertion,
  then reverted. **Any mutation that breaks nothing is recorded as a finding, not smoothed over**
  (`lessons.md`)
- The date-change assertion passes, showing a workout moved across a Monday changes which week its
  sets fall in and leaves every record untouched — FR-006's recomputation clause closed by evidence

#### Manual Verification:

None. Every claim in this phase is demonstrable by a script or a test; per `lessons.md`, a manual
criterion that could be automated belongs in the automated list.

**Implementation Note**: no user-visible change lands in this phase.

---

## Phase 2: The writes — validation, services, six handlers

### Overview

The mutation surface: three resource routes with their preflight siblings, the service functions
behind them, and the first integration suite in this repository that exercises the `update` and
`delete` policies at all.

### Changes Required:

#### 1. Validation

**File**: `src/lib/validation/workout-schemas.ts`

**Intent**: Schemas for the two editable payloads, built from the existing constants so no rule is
restated.

**Contract**: `updateWorkoutSchema` = `{ performedOn, note }`, reusing the existing field schemas.
`updateSetSchema` = `{ reps, weight, rpe }` — **no unit field**, deliberately: the unit comes from the
set's own stored row (see the service below). Both full replacements of the editable fields rather
than partial patches, so "absent" never has to be distinguished from "set to null". Exported through
`parseUpdateWorkout` / `parseUpdateSet` in the established `ParseResult` shape.

**File**: `src/lib/validation/workout.ts`

**Intent**: One new message code for a set that is absent or not the caller's.

**Contract**: `set_not_found` added to `WORKOUT_MESSAGES`, worded like its two siblings so that
"absent" and "somebody else's" remain the same answer.

#### 2. Services

**File**: `src/lib/services/workouts.ts`

**Intent**: The five mutations and the one read the set-edit path needs, each scoped by `user_id` and
each reporting what it actually touched.

**Contract**: `getSetForEdit` returns the set together with its entry's exercise (`id`,
`is_bodyweight`) and the owning `workout_id`, or `null`. `updateSet`, `deleteSet`, `updateWorkout`,
`deleteWorkout` and `deleteExerciseEntry` each carry `.eq("user_id", userId)` **and** `.eq("id", …)`,
and each `.select()`s the affected row so a zero-row result is distinguishable from a success.
`weight_unit` is **never** in an update payload — the column keeps whatever the row already holds, so
a set typed in pounds is still read back as the number typed after S-06 changes the profile
preference. `weight_kg` is never written; it is generated.

#### 3. The routes

**Files**:
`src/pages/api/sets/[id]/index.ts`, `src/pages/api/sets/[id]/impact.ts`,
`src/pages/api/workouts/[id]/index.ts`, `src/pages/api/workouts/[id]/impact.ts`,
`src/pages/api/exercise-entries/[id]/index.ts`, `src/pages/api/exercise-entries/[id]/impact.ts`
*(all new)*

**Intent**: `PATCH` and `DELETE` per resource, plus a `GET` preflight returning what the dialog needs.
The three existing `POST` endpoints under `index.ts` are **not touched**, so the assertions pinning
their response shapes cannot move.

**Contract**: Every handler exports `prerender = false`, resolves `supabase`/`user` from
`context.locals`, answers `500 not_configured` / `401 unauthenticated` before anything else, validates
the `[id]` param against `UUID_PATTERN` before it reaches a query (Postgres answers `22P02` for a
malformed uuid, which would surface as a 500 for what is really "not found"), and answers `404` with
the resource's own message code for both "absent" and "not yours". `GET .../impact` answers
`{ impact: FallingRecord[] }`. `PATCH` answers the updated row. `DELETE` answers `204`, and `404`
when the delete matched nothing.

**A failed impact read must never look like an empty one.** When the ranking queries throw, the
endpoint answers a non-2xx carrying `impact_unavailable` — it does **not** fall back to
`{ impact: [] }`, because an empty list is a positive claim ("no record is at stake") and the caller
would render it as reassurance. This is the opposite of the rule `/api/sets` follows for the save-time
badge, and deliberately so: there the verdict was a decoration arriving after a committed write, so
losing it cost nothing; here the preflight **is** the guarantee US-02 asks for, and silently
downgrading it to "nothing at stake" defeats the slice. The action stays available — see Phase 3 —
but the screen must say the consequence is unknown.

**The set path additionally re-checks `isWeightAllowed`** against the exercise's `is_bodyweight` flag
loaded by `getSetForEdit` — the same single definition the create path and the form already use, now
with a third caller and no second definition.

`workout_not_found`, `entry_not_found` and `set_not_found` are the only codes these routes emit for a
missing target, and the same code is used whether the row is absent or another account's.

#### 4. The mutation boundary suite

**File**: `tests/integration/workout-mutations-rls.test.ts` *(new)*

**Intent**: The twelve update/delete policies have never been exercised by application code. This is
the suite that makes them load-bearing, following `workout-log-rls.test.ts`'s pattern — **every
negative assertion paired with a read back as the row's owner**, because the failure worth catching is
a caller told "nothing happened" while the write landed.

**Contract**: Account B attempts, against account A's rows: `PATCH` a set; `DELETE` a set; `PATCH` a
workout's date; `DELETE` a workout; `DELETE` an exercise entry. Each is followed by a re-read as A
asserting the original values are intact. Plus: the endpoint answers `404` rather than `204`/`200`
when the target is not the caller's (the zero-rows trap); deleting a workout as its owner cascades so
that its entries and sets are gone; and deleting the set behind a record leaves
`public.personal_records` reporting the runner-up — the derivation, proven end to end.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- `tests/integration/workout-mutations-rls.test.ts` passes, including the `404`-not-`204` assertion
- The three existing `POST` endpoint files are unchanged: `git diff --stat` names none of
  `src/pages/api/{sets,workouts,exercise-entries}/index.ts`
- `git grep -n "weight_unit" -- src/lib/services/workouts.ts` shows it only in the insert path, never
  in an update
- `git grep -n "weight_kg" -- src/lib/services/workouts.ts` returns no write
- An assertion forces the ranking query to fail and confirms the impact endpoint answers a non-2xx
  with `impact_unavailable` rather than `{ impact: [] }`
- Mutation (a): dropping `.eq("user_id", …)` from `deleteSet` **breaks nothing — and that is the
  recorded result, not a gap to paper over.** The DELETE policy's predicate is
  `(select auth.uid()) = user_id`, read from `pg_policies` rather than assumed, so account B's delete
  matches zero rows through the policy alone. The application filter is the index path, exactly as
  AGENTS.md § Access control says, and **no assertion writable from this suite can catch its
  removal**. The edit that would make it load-bearing is RLS being disabled on `sets` — which
  `workout-log-rls.test.ts` covers from the other side. The filter stays (`lessons.md`: a mutation
  that breaks nothing is a finding; fix the claim, never the test)
- Mutation (b): making `DELETE` answer `204` on zero rows fails the `404` assertion, then reverted
- Mutation (c): removing the `isWeightAllowed` re-check from the set `PATCH` fails an assertion
  editing a barbell set to `0`, then reverted. A mutation that breaks nothing is recorded as a finding

#### Manual Verification:

- The owner has seen the mutation-boundary suite's output before any screen work begins — this is the
  first evidence that twelve policies written in S-03 actually hold

**Implementation Note**: pause after this phase for the owner to see the suite's output before any
screen work begins.

---

## Phase 3: The screens — correcting, and being warned first

### Overview

The user-visible half: an editable workout header, per-set edit and delete, per-entry delete, and one
confirmation dialog carrying the real consequence.

### Changes Required:

#### 1. The dialog primitive

**File**: `src/components/ui/alert-dialog.tsx` *(added via `npx shadcn@latest add alert-dialog`)*

**Intent**: A confirmation that traps focus, closes on Escape, and cannot be dismissed by an
accidental click-through — for the first actions in this product with an irreversible effect.
Hand-rolling focus management is the classic way to get this subtly wrong.

**Contract**: The shadcn "new-york" component, unmodified. `@radix-ui/react-slot` is already a
dependency (`button.tsx` uses it), so this is not a new ecosystem — but `@radix-ui/react-alert-dialog`
is a new package on a hydrated island, so the phase measures the delta rather than assuming it is
free. **Threshold, named in advance so the measurement can decide something**: if `WorkoutDetail`'s
built island grows by more than ~15 KB, fall back to the native `<dialog>` element with explicit focus
management, and record the measurement either way.

#### 2. The warning

**File**: `src/components/workouts/RecordImpactDialog.tsx` *(new)*

**Intent**: One component used by all four operations, so the sentence a user reads before an
irreversible action is written once. Names each affected record, the exercise, and what it falls to —
or says the exercise will hold no record at all, rather than printing a zero.

**Contract**: Props: the impact result, whether the action is a deletion or an edit, and a
confirm/cancel pair. The estimate record's sentence is conditional for an edit ("if this change takes
the record off this set…") and absolute for a delete. Every figure comes from the display function
added in Phase 1; no arithmetic happens in this component.

**The dialog has three states, and the third is the point of finding F2:**

1. **No record affected** — the dialog still appears for a deletion, because the action is
   irreversible whether or not a record is at stake, and says plainly that none is.
2. **These records fall** — one line per affected record, naming the exercise, the value it falls to,
   or which of the two no-successor outcomes applies: "this exercise will have no estimated record"
   versus "this exercise will no longer appear in your records". Two different futures, never the same
   sentence.
3. **The impact could not be determined** — shown when the preflight answered `impact_unavailable`.
   Confirmation stays available, because a database hiccup must not make the product uncorrectable
   again, but the dialog says the consequence is unknown. **State 3 must never render as state 1.**

**The impact is fetched when the dialog opens, never at page load.** This is the one screen in the
product where the underlying state changes under the user throughout a session — they log sets between
efforts — so a number fetched with the page would be stale by the time it is read, and stale is worse
than absent for a figure the user is about to act on.

#### 3. The workout header

**File**: `src/components/workouts/WorkoutHeader.tsx` *(new)*, wired from `src/pages/workouts/[id].astro`

**Intent**: Make the date and note editable in place, and put "delete this workout" where the user is
when they realise they logged it twice.

**Contract**: A `client:load` island receiving the workout id, `performed_on` and `note`. Editing
`PATCH`es and replaces its own state with the returned row; deleting fetches the impact, shows the
dialog, and on confirmation navigates to `/workouts`. The date field is a plain `YYYY-MM-DD` input and
the value is never reformatted through `new Date` — the page comment at
`src/pages/workouts/index.astro:75` explains why that would show the previous day to anybody west of
UTC.

#### 4. Editing and removing what was logged

**File**: `src/components/workouts/WorkoutDetail.tsx`

**Intent**: Each set row gains edit and delete; each entry header gains "remove this exercise". The
island's entry state learns to replace and to remove, not only to append.

**Contract**: Set edit reveals an inline form over the set's own fields (repetitions, weight, RPE),
pre-checking the weight with `isWeightAllowed` exactly as `AddSetForm` does, and **labelling the field
with the set's own stored `weight_unit`** rather than the profile's — the unit is a property of the
row being edited. On success the returned row replaces the old one in state; the entry's best estimate
recomputes from the array by itself, with no extra request.

**The record badge is dropped from the map whenever its set is edited or deleted.** The badge asserts
"this set beat your record"; after an edit that sentence may be false, and a false badge is the same
class of defect as S-03's placeholder — technically explicable, a lie to a human. `/records` remains
the durable surface.

#### 5. Empty states

**File**: `src/components/workouts/WorkoutDetail.tsx`

**Intent**: Deleting the last set of an entry, or the last entry of a workout, must leave a screen that
explains itself rather than an empty box.

**Contract**: An entry with no sets keeps its "remove this exercise" control and says the exercise has
no sets yet; a workout with no entries falls back to the existing empty-state paragraph.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- No server-only module is reachable from a hydrated island: the built client bundle contains no
  `zod` and no `@supabase/` — checked against `dist/client/_astro/` as in S-03, not by grep over `src`
- The `WorkoutDetail` island's built size is recorded in Progress alongside its pre-change size, and
  measured against the ~15 KB threshold that decides between the dialog primitive and native
  `<dialog>`

#### Manual Verification:

- Editing a set's weight to a value below the runner-up shows the conditional warning naming the
  correct fall value, and after confirming, `/records` shows that value
- Deleting the set behind the heaviest record warns about the heaviest record even when the estimate
  record is untouched
- Deleting a workout that holds records for two exercises names both
- **With the impact endpoint forced to fail, the dialog says the consequence is unknown — it does not
  say "no record is affected"** (the F2 state, and the one that silently defeats the slice if wrong)
- Deleting the only set of an exercise says the exercise will disappear from the records list;
  deleting the only *estimable* set while a zero-load set remains says instead that it will have no
  estimated record
- Editing a set removes its record badge; reloading the page shows no badges at all, as before
- Deleting the last set of an entry leaves a usable screen with the exercise still removable
- The dialog is operable by keyboard alone: Escape cancels, and focus does not escape it
- At 360 px the dialog's text wraps and the confirm control remains reachable

**Implementation Note**: pause here for the owner's confirmation before deploying. The manual list is
what only a human can see; everything else in this phase is in the automated list.

---

## Phase 4: Deploy, and prove it on the public address

### Overview

The slice's outcome is on a screen, so it carries its own deployment phase (`lessons.md`). This phase
also closes the process gap that bit session 8 twice: **work finished and verified locally, commit not
pushed, CI unaware — once while the Worker was already serving it.**

### Changes Required:

#### 1. Push before deploying

**Intent**: The deployed code must exist in the remote repository. No local gate can see that it does
not.

**Contract**: `git push origin main`, then a CI run against that exact SHA observed to conclude
green — **its run number written into the Progress row**. This is an automated criterion, not a habit.

#### 2. Deploy

**Intent**: Ship the Worker and record which version is serving.

**Contract**: `npm run build` then `npx wrangler deploy`; the resulting version id recorded in
Progress. No new Worker secret is required — this slice adds no environment variable.

#### 3. Prove it under the public address

**Intent**: A green pipeline is blind to a deployment that builds, returns 200 and does nothing
useful (AGENTS.md § Cloudflare traps).

**Contract**: A read-only scripted probe (`node -e 'fetch(...)'`, not `curl` — schannel fails TLS on
fresh Cloudflare hosts) confirming the new routes exist in the deployed build and that
`/workouts`, `/records` still redirect a signed-out visitor; then the owner, signed in, performing one
real edit and one real deletion and watching `/records` change.

### Success Criteria:

#### Automated Verification:

- `git status` clean and `git log origin/main..HEAD` empty — **nothing local and unpushed**
- CI run for the deployed SHA is green, **run number recorded in Progress**
- `npx wrangler deployments list` shows the new version at 100% of traffic, id recorded in Progress
- The scripted probe reports `302 → /auth/signin` for `/workouts` and `/records` while signed out
- The new API routes are present in the built manifest (`dist/server/virtual_astro_middleware.mjs`)
  before any 404 from the public address is diagnosed as a failure — edge propagation takes tens of
  seconds and has presented as both stale content and a 404 on a new route

#### Manual Verification:

- On the public address, signed in: edit a set's weight, see the warning, confirm, and see `/records`
  change accordingly
- On the public address: delete a workout that holds a record, and confirm the record falls to the
  value the dialog named
- On the public address: remove an exercise from a workout and confirm the screen stays usable

**Implementation Note**: this phase writes to production. Do not run it while the owner is away from
the machine.

---

## Phase 5: Truth up the documents

### Overview

Everything this slice made true or false in the written record — including the handoff S-07 needs.

### Changes Required:

#### 1. The agent guide

**File**: `AGENTS.md`

**Intent**: Record what a future agent would otherwise get wrong: that the two records need two
rankings, that the successor shape covers all three exclusion levels, and that a zero-row update under
RLS is a success that must be reported as a 404.

**Contract**: § Domain rules gains the "a warning must cover both records, and top-two is not enough
above set level" note; § Access control gains the zero-rows trap; § Known state gains the six new
routes. No claim is written that no test backs — where a guarantee is untested, it is named as such
(`lessons.md`).

#### 2. Routes and commands

**File**: `README.md`

**Intent**: The routes table is the first place anybody looks for what the API does.

**Contract**: Six new rows for the resource routes and their preflights, and a line stating that the
weight unit is not in the update payload either — it is a property of the stored row.

#### 3. Lessons

**File**: `context/foundation/lessons.md`

**Intent**: Append only what this slice actually paid for.

**Contract**: A rule about the zero-row mutation under RLS if the mutation protocol confirms it bites,
and a rule about a query shape that is exact for one row and wrong for a set of them — both written
only if the phase evidence supports them, never speculatively.

#### 4. The handoff

**File**: `C:\10xdev\handoff\STATE.md`, `context/foundation/roadmap.md`, `context/changes/edit-and-delete-log/change.md`

**Intent**: Close S-05 in the record, and pass S-07 what it needs.

**Contract**: `STATE.md` gains a "what S-05 left S-06 and S-07" section carrying, explicitly: **Open
Question 2's interface half is still open** — whether to warn before an edit that changes tonnage
figures the user has already seen — and that the schema half was already settled. Roadmap S-05 →
`done`. `change.md` records every deviation from this plan.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- Every file path and assertion name newly cited in `AGENTS.md` exists: a script resolves each
  reference and prints its target
- `git log origin/main..HEAD` empty after the phase commit

#### Manual Verification:

- Three facts checkable by eye, not a code-quality judgement (`lessons.md`): the README routes table
  lists six new rows; `STATE.md` names Open Question 2 as open with S-07 as its owner; the roadmap
  shows S-05 as `done`.

**Implementation Note**: after this phase, `/10x-impl-review` then `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/record-impact.test.ts` — the decision, from ids only: holder unaffected; holder
  affected with a successor; holder affected with none; one removal affecting both records; a removal
  affecting the heaviest record but not the estimate record; a removal at entry level and at workout
  level.
- `src/lib/services/record-display.test.ts` — the fall figure re-derived in the reader's unit; `null`
  where the record disappears rather than a zero.
- Existing suites must stay green untouched — in particular `records-verdict.test.ts`, whose seam this
  slice reuses rather than modifies.

### Integration Tests:

- `tests/integration/record-impact.test.ts` — the two rankings' exclusion rules, the successor
  agreeing with the view, and the date-change proof.
- `tests/integration/workout-mutations-rls.test.ts` — five cross-account mutation attempts, each
  paired with a re-read as the owner; the `404`-not-`204` rule; the cascade; and the record falling to
  the runner-up after the holder is deleted.

### Manual Testing Steps:

1. Log a workout with `100 kg × 1` and `90 kg × 10` of the same exercise; confirm `/records` shows the
   heaviest as `100` and the estimate as the `90 × 10` set.
2. Delete the `100 kg × 1` set; confirm the dialog warns about the **heaviest** record and names what
   it falls to, and that `/records` agrees afterwards.
3. Edit the `90 kg × 10` set down to `50 kg`; confirm the conditional warning appears and the estimate
   record falls.
4. Delete a whole workout holding records for two exercises; confirm both are named.
5. Remove an exercise from a workout; confirm the sets go with it and the screen stays usable.
6. Change a workout's date across a Monday; confirm nothing breaks and no figure is orphaned.
7. Attempt each of the above with the keyboard only.

## Performance Considerations

The successor query runs **only for exercises a record read already flagged as affected** — typically
zero, one or two — and takes `.limit(1)` each. It never walks the log. That matters under the Workers
Free 10 ms CPU cap, which is a hard kill rather than a throttle.

**A limitation inherited from S-04 and stated rather than hidden**: index usage cannot be verified in
this environment. `gymlog-test` holds a few dozen sets, so Postgres correctly prefers a sequential
scan and an `explain` proves nothing about the plan on a real log. The `user_id` filter push-down and
`security_invoker` behaviour *are* verifiable and were confirmed during S-04's review; index choice is
not. S-07 and S-08 inherit the same gap.

## Migration Notes

**None.** No schema change, no data migration, no backfill. The grants, policies and cascades this
slice needs were created by S-03's migration, which named this slice as their consumer. Existing rows
need nothing done to them: records are derived, so the first read after a deletion is already correct.

## References

- Change identity and the handoff notes this plan was built from: `context/changes/edit-and-delete-log/change.md`
- Records derivation and the id-comparison seam: `context/archive/2026-08-11-personal-records/plan.md`
- The nested-ownership boundary this slice exercises for the first time: `AGENTS.md` § Access control
- Prior art for a mutation-boundary suite: `tests/integration/workout-log-rls.test.ts`
- Prior art for endpoint-level integration coverage: `tests/integration/workout-endpoints.test.ts`
- Roadmap item: `context/foundation/roadmap.md` § S-05

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: What falls, and to what

#### Automated

- [x] 1.1 Lint passes — 02379ba
- [x] 1.2 Type checking passes — 02379ba
- [x] 1.3 Unit tests pass — 02379ba
- [x] 1.4 `record-impact.test.ts` covers `affectedRecords` and `fallingRecords` by name, including the heaviest-only removal and the two no-successor outcomes — 02379ba
- [x] 1.5 Integration check passes — 02379ba
- [x] 1.6 Build passes — 02379ba
- [x] 1.7 The three copies of the estimate ordering agree, verified by grep — 02379ba
- [x] 1.8 Mutation (a): `.gt` → `.gte` on `weight_kg` fails the zero-load assertion — 02379ba
- [x] 1.9 Mutation (b): dropping `created_at asc` fails the tie assertion — 02379ba
- [x] 1.10 Mutation (c): removing the exclusion fails the "successor is not the holder" assertion — 02379ba
- [x] 1.11 Date-change assertion proves no stored figure needs recomputing — 02379ba

### Phase 2: The writes — validation, services, six handlers

#### Automated

- [x] 2.1 Lint, typecheck, unit, integration and build all pass — f6cf0ce
- [x] 2.2 `workout-mutations-rls.test.ts` passes, including the `404`-not-`204` assertion — f6cf0ce
- [x] 2.3 The three existing POST endpoint files are unchanged — f6cf0ce
- [x] 2.4 `weight_unit` appears in the insert path only, never in an update — f6cf0ce
- [x] 2.5 `weight_kg` is never written — f6cf0ce
- [x] 2.6 A failed ranking query yields `impact_unavailable`, never `{ impact: [] }` — f6cf0ce
- [x] 2.7 Mutation (a): dropping `.eq("user_id", …)` from `deleteSet` breaks nothing — the policy is the guarantee, recorded as a finding — f6cf0ce
- [x] 2.8 Mutation (b): `204` on zero rows fails the `404` assertion — f6cf0ce
- [x] 2.9 Mutation (c): removing the `isWeightAllowed` re-check fails the barbell-at-zero assertion — f6cf0ce

#### Manual

- [x] 2.10 Owner has seen the mutation-boundary suite's output — f6cf0ce

### Phase 3: The screens — correcting, and being warned first

#### Automated

- [x] 3.1 Lint, typecheck, unit, integration and build all pass — 165 unit, 83 integration — 16e4dfe
- [x] 3.2 Built client bundle contains no `zod` and no `@supabase/` — grep over `dist/client/_astro/`, with a sanity match proving the same grep can find something that is there — 16e4dfe
- [x] 3.3 `WorkoutDetail` island size recorded before and after, measured against the ~15 KB threshold — before **10 689 B**; with the shadcn/radix `alert-dialog` **50 720 B (+40 KB)** plus a new 5 194 B chunk, so the threshold decided against it; shipped on the native `<dialog>` at **16 086 B (+5 397 B)**, plus shared `RecordImpactDialog` 6 551 B and the new `WorkoutHeader` island 4 654 B — 16e4dfe

#### Manual

- [x] 3.4 Editing a set below the runner-up shows the conditional warning with the correct fall value — 16e4dfe
- [x] 3.5 Deleting the heaviest-record set warns about the heaviest record — 16e4dfe
- [x] 3.6 Deleting a workout holding two exercises' records names both — 16e4dfe
- [x] 3.7 With the impact endpoint failing, the dialog says the consequence is unknown, not "no record affected" — verified against a forced throw in `sets/[id]/impact.ts`, reverted immediately after — 16e4dfe
- [x] 3.8 The two no-successor outcomes read as different sentences — 16e4dfe
- [x] 3.9 Editing a set removes its record badge — 16e4dfe
- [x] 3.10 Deleting the last set of an entry leaves a usable, still-removable entry — 16e4dfe
- [x] 3.11 The dialog is fully keyboard-operable and traps focus — 16e4dfe
- [x] 3.12 The dialog is usable at 360 px — 16e4dfe

### Phase 4: Deploy, and prove it on the public address

#### Automated

- [ ] 4.1 `git status` clean and `git log origin/main..HEAD` empty
- [ ] 4.2 CI run for the deployed SHA green — run number recorded here
- [ ] 4.3 Worker version at 100% of traffic — version id recorded here
- [ ] 4.4 Scripted probe: `/workouts` and `/records` redirect a signed-out visitor
- [ ] 4.5 New API routes present in the built manifest

#### Manual

- [ ] 4.6 Edit a set on the public address and see `/records` change
- [ ] 4.7 Delete a record-holding workout on the public address and see the record fall as warned
- [ ] 4.8 Remove an exercise from a workout on the public address

### Phase 5: Truth up the documents

#### Automated

- [ ] 5.1 Lint, typecheck, unit, integration and build all pass
- [ ] 5.2 Every newly cited file path and assertion name resolves
- [ ] 5.3 `git log origin/main..HEAD` empty after the phase commit

#### Manual

- [ ] 5.4 README lists six new routes; STATE.md names Open Question 2 as S-07's; roadmap shows S-05 done
