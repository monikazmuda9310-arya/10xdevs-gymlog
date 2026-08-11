---
date: 2026-08-11T14:07:21+02:00
researcher: Monika Zmuda
git_commit: d14640694114f2578fe090c9d5512a5b485f5a3f
branch: main
repository: 10xdevs-gymlog
topic: "S-04 personal records — where the record is computed, when it is announced, and how much of the fall rule belongs here"
tags: [research, codebase, personal-records, rls, postgres-views, one-rep-max, api-sets]
status: complete
last_updated: 2026-08-11
last_updated_by: Monika Zmuda
---

# Research: S-04 — a record is announced when it happens, and listed afterwards

**Date**: 2026-08-11T14:07:21+02:00
**Researcher**: Monika Zmuda
**Git Commit**: `d14640694114f2578fe090c9d5512a5b485f5a3f`
**Branch**: `main`
**Repository**: `10xdevs-gymlog`

## Research Question

Settle the three unknowns named at the end of session 7 in
`context/changes/personal-records/change.md`, so a plan can be written:

1. **Where is the record computed** — Worker or Postgres — and how does that interact with RLS?
2. **When is the record announced** — does `/api/sets` grow a field, or does the screen ask again?
3. **How much of "a record can fall"** belongs in S-04 rather than S-05?

## Summary

All three are answerable from the working tree, and each answer narrows the plan more than expected.

1. **Postgres, through two `security_invoker` views.** Not for CPU reasons in the announcement path
   — the 10 ms cap is CPU, and a scalar aggregate costs the Worker nothing — but because the
   **records list** (FR-021) touches every set the account has ever logged, and because the verdict
   and the list must not be two implementations that can disagree. `security_invoker = true` is
   available (both projects run **Postgres 17.6.1**, the feature needs 15+), and omitting it is a
   **total cross-account leak** that no existing test would notice.
2. **`/api/sets` grows a sibling field.** The change is additive — the three assertions that pin the
   endpoint read `body.set` and are untouched by a `body.record` beside it
   (`tests/integration/workout-endpoints.test.ts:109-126`). A second round trip would cost the NFR's
   200 ms save acknowledgement and would recompute state the endpoint already holds.
3. **Defer the drop rule whole — and inherit its query shape for free.** S-04's own message ("beats
   your previous best of X") needs the **runner-up**, not just the winner. That is the same "top two"
   shape S-05's warning needs. So S-04 gets the shape because its own screen needs it, and writes no
   `recordDrop()` helper with no caller.

The single largest risk this slice introduces is not access control and not performance: it is that
**the 1RM formula acquires a second implementation, in SQL**. That is the same class of hazard
`AGENTS.md` already guards for `0.45359237` ("exactly two copies and they must agree"). The
mitigation shapes the design: **decide the verdict entirely inside SQL** so no number crosses the
language boundary to decide a record, and pin the two implementations against each other with an
integration test.

## Detailed Findings

### 1. Where the record is computed

#### What already exists, and what it cannot do

- `src/lib/services/one-rep-max.ts:43-53` — `estimateOneRepMax`, pinned at `reps === 1`, `null`
  outside 1–12 or on a negative load. Dependency-free, unit-tested at every boundary.
- `src/lib/services/set-estimate.ts:32-49` — turns that into a four-way answer
  (`estimate` / `bodyweight` / `assisted` / `out-of-range`); zero weight is answered **first**,
  whatever the rep count.
- `src/lib/services/set-display.ts:77-92` — `bestEstimateOf` already computes "the best estimate
  among these sets", skipping the three non-numeric kinds rather than treating them as zero.

`bestEstimateOf` is the right function for **one exercise entry's own sets** (FR-015, already
shipped in `WorkoutDetail.tsx:113`). It is the wrong tool for a record, for a concrete reason:

- **The announcement path could be done in the Worker.** One exercise, all of that account's sets:
  a main lift accumulates roughly 150–400 rows a year at 3–4 sessions a week. Parsing 400 small JSON
  rows costs low single-digit milliseconds of CPU. It fits — for now.
- **The records list cannot.** FR-021 is _every_ exercise the account has logged. That is every set
  in the log, thousands of rows within a year, on every page load, against the hard 10 ms kill
  (`AGENTS.md` § Cloudflare traps — Error 1102 is a kill, not a throttle).
- **And if the list is SQL while the verdict is TypeScript, the two can disagree.** Postgres
  `numeric` is exact decimal; JavaScript is binary float64. `36/34` is not the same last bit in both.
  Two implementations produce a save-time announcement and a records list that differ in the exact
  place the PRD forbids: "no rounding or unit conversion may turn a non-record into a record"
  (`prd.md:76`, `prd.md:112`).

**Conclusion**: one SQL definition, used by both paths, and the verdict decided by _which row wins_
rather than by comparing a SQL number against a TypeScript number.

#### The verdict as a query, not a comparison

The shape that answers everything S-04 needs, in one query, after the insert:

> the top **two** sets for this exercise by estimate, tie-broken toward the **older** set.

- top row is the set just inserted **and** there is a second row → **record**, and the second row is
  the "previous best" the message quotes.
- top row is the set just inserted **and** there is no second row → **baseline**, not announced
  (US-02 AC: "The first-ever set for an exercise establishes the baseline and is NOT announced").
- top row is anything else → no record.
- **the tie-break is the equality rule.** `order by estimate desc, created_at asc` puts an equal
  older set first, so "a set equal to the previous best once both are expressed in the same unit is
  not a record" (`prd.md:111-112`) falls out of the ordering instead of needing an epsilon.

No number crosses the language boundary to decide anything. The Worker compares two **ids**.

#### The SQL expression, and the one trap in it

```sql
case
  when s.reps = 1 then s.weight_kg                                   -- Epley must be pinned here
  when p.estimation_formula = 'brzycki' then s.weight_kg * 36 / (37 - s.reps)
  else s.weight_kg * (1 + s.reps::numeric / 30)                      -- NOTE THE CAST
end
```

guarded by `where s.reps between 1 and 12 and s.weight_kg > 0`.

- **`s.reps::numeric / 30` — without the cast this is integer division.** `reps` is `smallint`, so
  `reps / 30` is `0` for every rep count in the valid range, and Epley silently degenerates to
  `estimate = weight` for all of 1–12. Green pipeline, plausible numbers, wrong product. Brzycki
  is safe by accident (`weight_kg` is already `numeric`, so `* 36` promotes before the divide) —
  which is worse, because the bug would only appear for accounts that switched formula in S-06.
- The guard mirrors `isEstimable` exactly: `weight_kg > 0` excludes bodyweight (`= 0`, which TS
  answers as `bodyweight` and `bestEstimateOf` skips) **and** assisted (`< 0`). The
  `Number.isInteger(reps)` half of the TS guard has no SQL counterpart and needs none — the column
  is `smallint`.
- **The formula comes from `profiles.estimation_formula`, joined per row.** Under
  `security_invoker` the profile join reads only the caller's own row (`profiles` select policy is
  `(select auth.uid()) = id`, `20260810063450_create_profiles_with_row_ownership.sql:45-47`), so the
  view needs no parameter and S-06 changes what it returns with no migration and no stored value.

#### RLS: `security_invoker` is the whole answer, and its absence is silent

Verified against both projects through the Management API (read-only):

```
gymlog      | pg: 17.6.1.155 | eu-central-1 | ACTIVE_HEALTHY
gymlog-test | pg: 17.6.1.155 | eu-central-1 | ACTIVE_HEALTHY
```

`WITH (security_invoker = true)` needs Postgres 15+. Both are on 17.

- **Default (`security_invoker = false`) a view executes as its owner.** Migrations run as
  `postgres`, which owns the tables, and a table owner is not subject to its own RLS unless
  `FORCE ROW LEVEL SECURITY` is set. So a view created without the flag returns **every account's
  sets to every account**, through a route that reads exactly like the ones that are safe.
- **This must be set on every view in the chain.** A view built on another view does not inherit the
  inner view's setting — each carries its own, and the inner one governs its own reach into the
  tables.
- **`revoke all` first, as with every table.** Supabase's default privileges grant `all on tables`
  to `anon` and `authenticated`, and PostgreSQL's `TABLES` object class covers views. Without the
  revoke, `anon` gets a read path to the whole records surface that nobody decided on — the exact
  wording of the template in `AGENTS.md` § Access control.
- **Nothing in the current suite would catch either mistake.** `workout-log-rls.test.ts` asserts
  against the three tables; a view is a new object with a new privilege surface. The suite needs a
  new assertion in the shape of its assertions 2 and 9: **B reads the view and sees nothing of A's,
  and an anonymous client has no read path to it at all** — paired with a re-read as A, per the
  suite's own rule.
- The explicit `.eq("user_id", userId)` filter stays on every read of the views, for the reason
  `AGENTS.md` gives: the policy is the guarantee, the filter is the index path.

#### The indexes are already there

`20260811005248_create_workout_log_with_row_ownership.sql:139-142` created
`exercise_entries (user_id, exercise_id)` for this slice specifically — added during S-03's plan
review as finding F6 (`.../reviews/plan-review.md:141-152`). With `sets (user_id, exercise_entry_id)`
(line 137, `user_id` leading so it also serves as a plain owner index) the announcement query has a
path at both levels: entries by `(user_id, exercise_id)`, then sets by `(user_id, exercise_entry_id)`.
**No migration is needed for indexes.** Worth confirming with `explain` once real rows exist rather
than assuming.

#### Sketch — two views, and what the second one costs

A base view, one row per set, carrying the estimate:

```sql
create view public.set_estimates with (security_invoker = true) as
select s.id as set_id, s.user_id, ee.exercise_id, w.performed_on, s.created_at,
       s.reps, s.weight, s.weight_unit, s.weight_kg,
       case ... end as estimate_kg          -- null when not estimable
from public.sets s
join public.exercise_entries ee on ee.id = s.exercise_entry_id and ee.user_id = s.user_id
join public.workouts w          on w.id  = ee.workout_id      and w.user_id  = ee.user_id
join public.profiles p          on p.id  = s.user_id;
```

- FR-020's verdict is then plain PostgREST against it: `.eq("user_id",…).eq("exercise_id",…)`,
  `.not("estimate_kg","is",null)`, `.order("estimate_kg", {ascending:false})`,
  `.order("created_at")`, `.limit(2)`. **No `distinct on`, no function, no rpc.**
- FR-021's list is a second view over the first, one row per exercise, carrying the winner of each
  record. It needs an **argmax**, not a `max()` — the screen should show the set's typed `weight`
  and `weight_unit`, not a kilogram value converted back (see § Architecture insights). Two
  `distinct on (user_id, exercise_id)` subqueries — one ordered by `estimate_kg desc, created_at`,
  one by `weight_kg desc, created_at` — **full-joined**, because an exercise can have a heaviest
  weight and no estimate at all (every set above 12 reps). Join `exercises` in for the name and
  muscle group; nothing is snapshotted, a view is always current.
- The `workouts` join exists only to carry `performed_on`. Drop it if the plan decides a record
  does not show its date; the joins to `exercise_entries` and `profiles` are not optional.

**Alternative considered and not recommended: a `security invoker` function called through `.rpc()`.**
Functions are `SECURITY INVOKER` by default, so RLS would apply, and a parameter would carry the
formula. Rejected because the repository has **no `.rpc()` call anywhere** (`grep` over `src/`
returns nothing), views are typed into `database.types.ts` under `Views` and read with the same
PostgREST idiom as every other query in the codebase, and `revoke all` + `grant select` mirrors the
table template exactly rather than needing a different incantation (`revoke execute … from public`).

### 2. When the record is announced

#### The endpoint as it stands

`src/pages/api/sets/index.ts` does four things in order: validate → load the entry (ownership,
`is_bodyweight`) → read the profile (the unit, **never** from the body) → insert. It returns
`{ set }` with 201.

Three integration assertions pin it (`tests/integration/workout-endpoints.test.ts`):

- `:109-116` — status 201, and `logged.weight` / `weight_unit` / `weight_kg` read back exactly.
- `:118-126` — persisted state re-read, one set under one entry.
- `:130-158` — the bodyweight refusal writes nothing.

Every one of them reads `body.set`. **A sibling `body.record` breaks none of them.** The plan should
add an assertion rather than change one.

#### Recommendation: grow the response

- FR-020 is "at the moment of saving" (`prd.md:273`). The verdict is _about_ the write; the endpoint
  is the only place that holds the new set's id without asking for it again.
- The NFR budget is "acknowledgement of any save within 200 ms" (`prd.md:306`). A second round trip
  from the island spends it twice and opens a window where the set is on screen and its verdict is
  not.
- Cost: the endpoint goes from three queries to four. **The 10 ms cap is CPU, not wall-clock** —
  waiting on Postgres is not charged. The added CPU is parsing two small rows.

#### The failure mode that has to be designed, not discovered

**The set is already saved when the verdict query runs.** If that query fails, the endpoint must
still return 201 with the set and `record: null`, and log server-side. Turning a successful save into
an error would make the form show a failure for a set that is in the database — and
`AddSetForm.tsx:91-99` deliberately keeps the typed values for a **manual** retry, so the user's
natural response would be to press the button again and log the set twice. That is the duplicate
write S-03 decision #10 exists to prevent (`.../plan.md` § Decisions, row 10).

#### Where the announcement is rendered

`WorkoutDetail.tsx:88-92` appends the logged set to state; `AddSetForm` hands it up through
`onLogged`. Carrying a verdict alongside the set through the same callback is a small, local change.
`WORKOUT_MESSAGES` in `src/lib/validation/workout.ts:47-70` is a catalogue of **failures**; a record
announcement carries numbers and is not an error, so it composes in the island rather than resolving
to a fixed sentence from a code. Worth stating in the plan so nobody adds `record_beaten:` to a
catalogue whose documented job is the opposite.

### 3. How much of "a record can fall" belongs here

- **US-02's warn-before-confirm criterion** (`prd.md:118-119`) is triggered by editing or deleting.
  S-04 ships neither: `/api/sets` is POST-only, there is no PATCH or DELETE anywhere in
  `src/pages/api/`, and the roadmap puts editing in S-05 with S-04 as its prerequisite
  (`roadmap.md:201-214`).
- **S-03 hit the mirror image and deferred**: its § What We're NOT Doing declines editing precisely
  because "records do not exist until S-04. A warning about a number the product cannot yet compute
  cannot be written, let alone tested."
- **The shape arrives anyway, and not speculatively.** S-04's own message quotes the previous best,
  so it needs the runner-up. "What the record falls to when this set is removed" is the same
  runner-up, asked from the other side. S-05 inherits the query with nothing added.

**Recommendation: defer the rule whole. Write no `recordDrop()` helper.** A function with no caller
is what `lessons.md` § "A guard you have not mutated may not guard" warns about from the other
direction — and the drop rule cannot be exercised end to end until a delete path exists.

## Code References

- `src/lib/services/one-rep-max.ts:43-53` — the arithmetic the SQL expression must mirror exactly.
- `src/lib/services/set-estimate.ts:32-49` — the branch order; zero weight answered before the rep range.
- `src/lib/services/set-display.ts:33` — `KG_PER_LB`, one of the two copies of `0.45359237`.
- `src/lib/services/set-display.ts:77-92` — `bestEstimateOf`, the per-entry best (FR-015), not a record.
- `src/lib/services/workouts.ts:73-215` — the service pattern every new read must copy (injected client, explicit `.eq("user_id", …)`).
- `src/pages/api/sets/index.ts:35-68` — the four steps a verdict has to slot into, and the profile read that already exists.
- `src/components/workouts/AddSetForm.tsx:90-99` — `onLogged`, and the manual-retry decision the failure mode above turns on.
- `src/components/workouts/WorkoutDetail.tsx:113,130-137` — where the per-entry best already renders.
- `src/middleware.ts:7` — `PROTECTED_ROUTES`; a `/records` route is one array entry, never a per-page check.
- `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:100-102` — the generated `weight_kg` and its exact factor.
- `supabase/migrations/20260811005248_…:135-142` — the four indexes, including the one created for this slice.
- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:45-47` — the `profiles` select policy the view's join relies on.
- `tests/integration/workout-endpoints.test.ts:109-126` — the three assertions a grown response must not disturb.
- `tests/integration/workout-log-rls.test.ts:226-253,388` — the assertion shapes a view-level RLS check should copy (read-back as owner; anonymous has no path).
- `src/db/database.types.ts:185-190` — `Views` and `Functions` are both empty today; a view populates the first.

## Architecture Insights

- **Postgres decides _which_ set wins; TypeScript decides _what number_ to show.** This is the clean
  seam between the two implementations of the formula. The comparison happens once, in exact
  `numeric`, on `weight_kg`. The display value is then re-derived by `estimateForLoggedSet` from the
  record set's own `weight` / `weight_unit` — which is what keeps `AGENTS.md`'s "read `weight` for
  anything shown back to the user" true, and reuses code that is already unit-tested. It follows
  that the records view must return the **winning set's row**, not just a kilogram maximum.
  - The two orderings agree mathematically — both formulas are linear in weight, so a positive unit
    conversion cannot reorder them — and can differ only in float noise far below the one decimal
    place the product displays (`prd.md:308`).
- **Nothing new is stored.** No `estimated_1rm` column, no record table. `AGENTS.md` and S-03's
  migration notes both say so explicitly, and the reason is S-06: a stored estimate turns a formula
  change from a re-derivation into a lie. A view is the only shape that keeps the SQL under version
  control without storing a number.
- **The records list is bounded, unlike the workout list.** One row per exercise the account has
  logged — 38 seeded plus custom ones. `listWorkouts`' documented "low hundreds and this stops being
  correct" problem (`src/lib/services/workouts.ts:61-71`) does not recur here.
- **A new screen means a deploy phase.** `lessons.md` § "A slice that ends in a screen needs a
  deployment phase" — S-02 closed with 38 exercises in production that no route could reach. FR-021
  is a screen.
- **A criterion demanding a unit test must name its module.** `lessons.md` § last entry. Most of
  this slice's logic is SQL, which the hermetic unit suite cannot reach at all
  (`vitest.config.ts` includes `src/**`, and nothing under test may import an `astro:*` module) —
  so the parity and boundary coverage here is **integration**, not unit, and the plan should say so
  rather than writing a unit criterion no module can satisfy.

## Decisions the plan must take

Each changes what gets built, not just how it is worded.

| #   | Question                                                                          | Recommendation                                                                                                                                                             | Owner   |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| D1  | Does "previous best" mean _all other_ sets, or only chronologically earlier ones? | **All other sets.** Records are derived from surviving sets and the list has no time dimension. Consequence to state: back-dating a workout can announce a record "today". | Planner |
| D2  | Does the save-time announcement also fire for a new **heaviest absolute weight**? | **RESOLVED (owner, 2026-08-11): no — one announcement, on the estimate record.** See below.                                                                                | Owner   |
| D3  | Does the heaviest-weight record exclude sets above 12 reps?                       | **RESOLVED (owner, 2026-08-11): no restriction — every set with `weight_kg > 0` counts.** See below.                                                                       | Owner   |
| D4  | Previous sets exist but none is estimable — record or baseline?                   | **Baseline.** The rule is "no previous _estimate_", not "no previous set". Falls out of the top-two query with no extra branch.                                            | Planner |
| D5  | One view or two? Does the records view carry `performed_on`?                      | **Two** (per-set base + per-exercise list); carry the date — a record without a "when" is half a fact, and the join is a primary-key lookup.                               | Planner |
| D6  | The records route: `/records`, `/exercises/[id]`, or a panel on the dashboard?    | **`/records`**, one entry in `PROTECTED_ROUTES`, linked from `/dashboard` and `/workouts` the way `/exercises` is.                                                         | Owner   |

### D2 and D3, resolved together — owner, 2026-08-11

**They are one decision, because the obvious pair is self-contradictory.** If the heaviest-weight
record carries no rep restriction (D3) _and_ the save-time announcement fires for it (D2), then a
set of 20 reps at 100 kg produces a notification — and US-02's acceptance criterion says in as many
words that sets "over twelve repetitions, or assisted with a negative load — never trigger a
record". D2 = yes and D3 = no-restriction cannot both hold.

**The resolution: one announcement (the estimate record), and an unrestricted weight record in the
list.** "Trigger" in that criterion is about the save-time flag, which is the only thing US-02's
_Then_ clause names; the list is a separate surface and "the heaviest absolute weight **ever
handled**" is a fact about the load, not an estimate.

Three reasons beyond the contradiction, in the order that decided it:

1. **At one repetition the estimate equals the weight lifted** — a domain rule of this product, not
   a coincidence. So the case a lifter cares about most, a new heaviest single, already fires the
   estimate announcement. A second notification would buy almost nothing and would usually say the
   same thing twice in the same save.
2. **FR-020 already carries a recorded counter-argument about noise** ("will fire on every session
   in the first weeks … and become noise"), resolved by adding the first-ever exclusion rather than
   by adding more notifications. Doubling the kinds of announcement runs against that decision.
3. **The asymmetry is the same one that settled the muscle-group taxonomy**: adding the second
   announcement later is cheap — the query already returns both records, so it is a change in one
   component — while removing a notification the user has learned to ignore is not, because trust in
   the save-time moment comes back slowly.

**What would make this wrong**: an account that sets its weight records mainly in sets above twelve
repetitions, for whom the list would show progress the save-time moment stays silent about. Not the
expected training pattern here; it is the signal to revisit.

**Consequences for the plan**: the announcement path needs one verdict, not two. The records list
needs both columns, with **different exclusion rules** — best estimate over sets of 1–12 reps with
`weight_kg > 0`, heaviest weight over every set with `weight_kg > 0` — and the two may belong to
different sets, which US-02 requires the screen to allow for.

## Open Risks

- **The formula now has two implementations.** Same class as `0.45359237`, and it needs the same
  treatment: a named comment on both sides, and an **integration** assertion that walks a table of
  boundary cases (1 rep, 12, 13, both formulas, zero, negative) through SQL and through
  `estimateOneRepMax`, comparing within a stated epsilon. Nothing else would notice a drift.
- **`s.reps::numeric / 30`.** Documented above; the plan should carry it as an explicit line in the
  migration contract, with a comment in the SQL.
- **`security_invoker` omitted, or omitted on the second view.** Total cross-account read through a
  route that looks like every safe one. Needs its own RLS assertion, and — per
  `lessons.md` § "A guard you have not mutated may not guard" — the plan must require **breaking it
  and confirming the test fails**, recorded as S-03 Phase 1 did.
- **The verdict query failing must not fail the save.** 201 with `record: null`, logged.
- **`npm run db:types` must run after the push and be committed.** `Views` is empty today; view
  columns come back **nullable** in generated types, because Postgres cannot guarantee not-null
  through a view. Expect the TypeScript to need null handling that the table types did not.
- **Production receives the views before the screen.** The same deliberate window S-03 opened and
  closed with a deploy phase.
- **`explain` on the announcement query is worth one command** once rows exist. The indexes are
  there; that they are _used_ through a view with an RLS predicate is an assumption.

## Historical Context (from prior changes)

- `context/archive/2026-08-10-log-workout-with-estimate/plan.md` § What We're NOT Doing — S-03
  deferring editing _because_ records did not exist yet; the mirror image of unknown 3.
- `.../plan.md` § Decisions rows 1, 4, 10, 14 — weight storage, the zero-load presentation rule, no
  automatic retry, and why `set-estimate.ts` is a separate module. All four constrain this slice.
- `.../plan.md` § Migration Notes — "S-04 depends on `weight_kg` and on estimates not being stored.
  If a later slice adds an `estimated_1rm` column, changing the formula in S-06 stops re-deriving
  and starts lying."
- `.../reviews/plan-review.md:141-152` (F6) — the index for this slice's central query, added a
  slice early with the asymmetry stated as the reason.
- `context/foundation/lessons.md` — all four entries apply: deploy phase for a screen; mutate the
  guard; verify with a script that attacks; name the module a unit-test criterion lives in.

## Related Research

- `context/archive/2026-08-10-log-workout-with-estimate/research.md` — the storage decisions this
  slice reads (`weight` / `weight_unit` / generated `weight_kg`) and the two-project setup.
- `context/archive/2026-08-10-exercise-catalogue/plan.md` — the shared-catalogue RLS variant and the
  "never snapshot the muscle group" rule the views must respect.

## Open Questions

- ~~**D2 and D3 above** need the owner.~~ **Resolved 2026-08-11** — see § Decisions. D6 is a
  presentation call the plan can take.
- **Does the records list show an exercise with no records at all?** An exercise logged only at 0
  load (a plank) has neither an estimate nor a heaviest weight. Showing an empty row is noise;
  hiding it means "logged but absent from records", which may read as a bug. Not blocking — a
  presentation call for the plan, but it should be made deliberately rather than by whichever `join`
  gets written.
- **Verified by reading, not by running**: the `security_invoker` behaviour is documented Postgres
  semantics and the version check confirms the feature exists, but nothing in this repository has
  exercised a view under RLS yet. The first migration must prove it against `gymlog-test` rather
  than assume it.
