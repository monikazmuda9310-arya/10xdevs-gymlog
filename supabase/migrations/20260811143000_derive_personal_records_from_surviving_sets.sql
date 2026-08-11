-- Purpose : derive personal records from the sets that survive, and store none of them. Two views:
--           public.set_estimates (one row per set, carrying its estimated one-rep max) and
--           public.personal_records (one row per exercise the account has logged, carrying the two
--           records). Establishes the DERIVED-VIEW variant of the access-control template.
-- Affected: new views public.set_estimates, public.personal_records. No table, column, constraint or
--           index is altered. Destructive operations: none. No backfill exists to run — every record
--           for every set that already exists comes into being the moment these views do.
--
-- WHY security_invoker IS THE WHOLE ACCESS-CONTROL STORY HERE. A view executes with the privileges
-- of its OWNER unless told otherwise. Migrations run as `postgres`, which owns every table in this
-- schema, and a table owner is not subject to that table's row-level security. So a view created
-- WITHOUT `security_invoker = true` would return EVERY ACCOUNT'S TRAINING TO EVERY ACCOUNT, through
-- a route that reads exactly like the safe ones. The flag makes the view execute as the caller, so
-- the policies on sets, exercise_entries, workouts, exercises and profiles all apply as usual.
--
-- IT IS PER VIEW AND IS NOT INHERITED, AND THE TWO VIEWS BELOW ARE NOT EQUALLY PROTECTED BY IT.
-- Measured during the Phase 1 mutation protocol, not reasoned about:
--
--   * Remove the flag from set_estimates and account B reads account A's training. Assertion 2 of
--     tests/integration/personal-records.test.ts fails, loudly. THAT is the load-bearing flag.
--   * Remove it from personal_records ALONE and nothing fails, because every row that view emits is
--     drawn through set_estimates, which still checks as the caller. Postgres does not SET ROLE for
--     a view; it decides WHO the underlying relations are checked as, and the inner view's flag
--     hands that decision back to the real caller partway down the chain.
--
-- So the flag on personal_records is DEFENCE IN DEPTH, and no test covers it. It stays because the
-- edit that makes it load-bearing is one somebody will plausibly make: point this view at
-- public.sets directly — to skip a level "for performance" — and its own flag becomes the only
-- thing standing between one account and another's log, silently. Keeping it means that edit is
-- safe by default instead of a breach nobody would notice.
--
-- Do not "simplify" either flag away. The one on set_estimates is proven; the one here is a
-- tripwire for a human reviewer, and it is written down precisely because no assertion holds it.
--
-- WHY `revoke all` COMES FIRST, ON A VIEW. Supabase's default privileges grant ALL on new objects in
-- `public` to anon and authenticated, and PostgreSQL's TABLES object class covers views. Without the
-- revoke, `anon` acquires a read path to the entire records surface that nobody decided on. Same
-- rule as every table in AGENTS.md § Access control; only `select` is granted, because a view over
-- aggregates is not writable and nothing should imply that it is.

create view public.set_estimates with (security_invoker = true) as
select
  s.id                 as set_id,
  s.user_id,
  s.exercise_entry_id,
  ee.exercise_id,
  ee.workout_id,
  w.performed_on,
  s.created_at,
  s.reps,
  s.weight,
  s.weight_unit,
  s.weight_kg,
  -- THE SECOND IMPLEMENTATION OF src/lib/services/one-rep-max.ts. The two must agree, and only
  -- assertion 4 of tests/integration/personal-records.test.ts would notice if they stopped: it walks
  -- a table of boundary cases through this expression and through estimateOneRepMax(), for both
  -- formulas. This is the same hazard AGENTS.md records for the 0.45359237 conversion factor, and it
  -- is weaker, because a constant can be grepped and a `case` expression cannot.
  --
  -- `s.reps::numeric / 30` — THE CAST IS LOAD-BEARING. `reps` is smallint, so `reps / 30` is INTEGER
  -- division and evaluates to 0 for every repetition count in the valid range: without the cast,
  -- Epley silently degenerates to `estimate = weight` across the whole of 1-12. Plausible numbers, a
  -- green pipeline, and a wrong product. Brzycki is safe only by accident, because weight_kg is
  -- already numeric and `* 36` promotes before the divide — which is worse, since the defect would
  -- surface only for accounts that switch formula in S-06.
  --
  -- The guard mirrors isEstimable() exactly. Zero load is answered before the repetition range for
  -- the same reason set-estimate.ts answers it first: a plank held for twenty is a bodyweight set,
  -- not an unestimable one. Both take no part in record detection, so both resolve to null here.
  case
    when s.weight_kg <= 0            then null
    when s.reps not between 1 and 12 then null
    when s.reps = 1                  then s.weight_kg
    when coalesce(p.estimation_formula, 'brzycki') = 'brzycki'
                                     then s.weight_kg * 36 / (37 - s.reps)
    else s.weight_kg * (1 + s.reps::numeric / 30)
  end as estimate_kg
from public.sets s
  -- Joined on (id, user_id) at each level, the same ownership pairs the composite foreign keys use.
  -- The user_id half is redundant against the keys and is written anyway: it gives the planner the
  -- owner filter at every level, which is what AGENTS.md means by "the policy is the guarantee, the
  -- filter is the index path".
  join public.exercise_entries ee on ee.id = s.exercise_entry_id and ee.user_id = s.user_id
  join public.workouts         w  on w.id  = ee.workout_id       and w.user_id  = ee.user_id
  -- LEFT, with the same fallback the application uses (src/pages/workouts/[id].astro reads
  -- `profile?.estimation_formula ?? "brzycki"`, and the column's own default is 'brzycki'). An inner
  -- join would make every set of an account with no profile row vanish from its records rather than
  -- be estimated with the documented default. The trigger on auth.users makes that state
  -- unreachable; failing safe costs one coalesce.
  left join public.profiles    p  on p.id  = s.user_id;

comment on view public.set_estimates is
  'One row per set with its estimated one-rep max, computed with the row owner''s own formula. '
  'Nothing is stored: changing profiles.estimation_formula re-derives every number here, which is '
  'what keeps S-06 a re-derivation rather than a contradiction. estimate_kg is NULL for a set that '
  'takes no part in record detection - zero or assisted load, or outside 1-12 repetitions.';

revoke all on public.set_estimates from anon, authenticated;
grant select on public.set_estimates to authenticated;

-- One row per exercise the account has logged, carrying both records and the set behind each.
--
-- ANCHORED ON THE EXERCISES THE ACCOUNT HAS LOGGED, NOT ON THE RECORDS. Joining the two record sides
-- to each other produces no row at all for an exercise whose sets are all at zero load - a plank, a
-- push-up, an unweighted pull-up, which are routine rather than edge cases. Such an exercise must
-- reach the screen so it can say why it has no record, instead of a logged exercise silently
-- disappearing from the list and reading as lost data. Assertion 5 of the suite pins this.
--
-- THE TWO RECORDS HAVE DIFFERENT EXCLUSION RULES, DELIBERATELY (owner, 2026-08-11). The estimate
-- record takes sets of 1-12 repetitions with a positive load. The heaviest-weight record takes EVERY
-- set with a positive load, at any repetition count, because "the heaviest absolute weight ever
-- handled" (US-02) is a fact about the load and not an estimate. US-02 also says sets outside the
-- estimate's range "never trigger a record" - that sentence governs the save-time ANNOUNCEMENT,
-- which is the only thing US-02's Then clause names, and this slice ships exactly one announcement,
-- on the estimate record. Reasoning: context/changes/personal-records/research.md, D2 and D3.
--
-- `distinct on` rather than two lateral joins: three passes over the account's sets in total, rather
-- than two per exercise. `set_id` is the final tie-break in both orderings so the answer is
-- deterministic between reads, as the NFR on reproducible derived values requires - and ordering by
-- created_at BEFORE it is the equality rule itself: an equal but older set ranks first, so a set
-- that merely ties the previous best is not a record.
create view public.personal_records with (security_invoker = true) as
select
  logged.user_id,
  logged.exercise_id,
  x.name          as exercise_name,
  x.muscle_group,
  x.is_bodyweight,
  best.set_id        as best_estimate_set_id,
  best.estimate_kg   as best_estimate_kg,
  best.reps          as best_estimate_reps,
  best.weight        as best_estimate_weight,
  best.weight_unit   as best_estimate_weight_unit,
  best.weight_kg     as best_estimate_weight_kg,
  best.workout_id    as best_estimate_workout_id,
  best.performed_on  as best_estimate_performed_on,
  heavy.set_id       as heaviest_set_id,
  heavy.reps         as heaviest_reps,
  heavy.weight       as heaviest_weight,
  heavy.weight_unit  as heaviest_weight_unit,
  heavy.weight_kg    as heaviest_weight_kg,
  heavy.workout_id   as heaviest_workout_id,
  heavy.performed_on as heaviest_performed_on,
  -- GREATEST ignores nulls in PostgreSQL, so this is the later of the two record dates, or null when
  -- the exercise holds neither. It is the list's ordering key: most recently improved first, and the
  -- exercises with nothing to show sink to the bottom under `nulls last`.
  greatest(best.performed_on, heavy.performed_on) as last_record_on
from (select distinct user_id, exercise_id from public.set_estimates) logged
  join public.exercises x on x.id = logged.exercise_id
  -- Explicit ON rather than USING (user_id, exercise_id): public.exercises carries its own nullable
  -- user_id, so after the join above there are two columns of that name and USING would be
  -- ambiguous. Written out, it cannot be.
  left join (
    select distinct on (user_id, exercise_id) *
    from public.set_estimates
    where estimate_kg is not null
    order by user_id, exercise_id, estimate_kg desc, created_at, set_id
  ) best on best.user_id = logged.user_id and best.exercise_id = logged.exercise_id
  left join (
    select distinct on (user_id, exercise_id) *
    from public.set_estimates
    where weight_kg > 0
    order by user_id, exercise_id, weight_kg desc, created_at, set_id
  ) heavy on heavy.user_id = logged.user_id and heavy.exercise_id = logged.exercise_id;

comment on view public.personal_records is
  'One row per exercise the account has logged, with the best estimated one-rep max and the heaviest '
  'absolute weight, each backed by the set that still holds it. Derived, never stored: a record may '
  'go DOWN when the set behind it is edited or removed, which is what keeps every number here backed '
  'by evidence that still exists. An exercise with no record at all still appears, so the screen can '
  'say why rather than omitting a lift the user logged.';

revoke all on public.personal_records from anon, authenticated;
grant select on public.personal_records to authenticated;

notify pgrst, 'reload schema';
