-- S-07, weekly tonnage. Adds: view public.daily_tonnage. Nothing else — no table, no column, no
-- index, no change to any existing object. Purely additive, so it is safe on production before the
-- Worker that reads it is deployed.
--
-- WHAT THIS VIEW DELIBERATELY DOES NOT KNOW: what a week is, and what a timezone is.
--
-- A training week runs Monday-Sunday in the reader's own zone, and that decision lives in exactly one
-- place — `trainingWeeksFor` in src/lib/services/calendar.ts, which the hermetic unit suite can reach
-- and which is pinned at both daylight-saving transitions, the Sunday boundary, and month and year
-- ends. This view is grouped by the raw `performed_on` and receives four plain date strings from the
-- application. There is no `date_trunc('week', …)` here and there must never be one: a second
-- definition of "a training week" is a second answer to the same question, and this repository
-- already carries two of those (the 1RM `case` expression and the 0.45359237 factor) and documents
-- both as hazards.
--
-- IT ALSO NEVER READS profiles.timezone, AND THAT IS THE SHARPER RULE. `workouts.performed_on` is a
-- `date` the user STATED — there is no instant behind it and no zone attached. Any
-- `performed_on at time zone p.timezone` invents an instant that never existed and then re-projects
-- it, which moves dates by a day at the edges. The zone is needed only to decide what "today" is for
-- this reader, which is `todayIn`'s job and happens before any SQL runs. `set_estimates` next door
-- joins `profiles` for the estimation formula and likewise never touches the timezone; keep it that
-- way.
--
-- WHY THE FILTER STILL USES THE INDEX. The application filters on `user_id` and a `performed_on`
-- range, and both are GROUP BY columns, so Postgres pushes those quals down into the aggregate and
-- the range travels on `workouts_user_performed_on_idx (user_id, performed_on desc)` — created by
-- S-03 with this slice named. That pushdown is a property of THIS grain, not a general one: S-08
-- regrouping at (user_id, performed_on, exercise_id) keeps it only while it filters on grouping
-- columns. `desc` is irrelevant to a range; a btree scans either direction.
--
-- NOT MEASURED, AND SAID SO. `gymlog-test` holds a few dozen sets, where Postgres correctly prefers a
-- sequential scan, so no query plan taken here would mean anything. Aggregating in the database
-- rather than in the Worker is justified by the Workers Free 10 ms CPU cap on the architecture
-- argument alone. S-04 recorded this limitation first and S-07 inherits it unchanged.

-- Same order as every table and both existing views: revoke before granting. Supabase's default
-- privileges grant ALL on new objects in `public` to anon and authenticated, and PostgreSQL's TABLES
-- object class covers views, so without the revoke `anon` acquires a read path to every account's
-- training volume that nobody decided on.
--
-- `security_invoker = true` IS THE WHOLE OF THE ACCESS CONTROL HERE, AND IT IS LOAD-BEARING. This
-- view reads `sets`, `exercise_entries` and `workouts` DIRECTLY, so it stands exactly where
-- `set_estimates` does rather than where `personal_records` does. Without the flag the view executes
-- as its owner — `postgres`, which owns every table here and is not subject to their policies — and
-- hands every account's tonnage to every account, with no error and no warning, through a route that
-- reads exactly like the safe ones. Assertion 6 of tests/integration/weekly-tonnage.test.ts is what
-- holds it, and the S-07 mutation protocol removed the flag and confirmed that assertion fails.
create view public.daily_tonnage with (security_invoker = true) as
select
  s.user_id,
  w.performed_on,
  -- THE TONNAGE RULE, IN ONE TERM. `greatest(s.weight_kg, 0)` implements both halves of the domain
  -- rule at once: a zero-load set contributes `reps * 0` and an assisted (negative) set contributes
  -- `reps * 0` rather than a negative amount. A bodyweight plank is still real work and its
  -- repetitions are still recorded — it simply adds no kilograms to a volume figure.
  --
  -- NO `::numeric` CAST HERE, AND THE NEIGHBOUR'S CAST IS NOT AN ARGUMENT FOR ONE. `set_estimates`
  -- needs `s.reps::numeric / 30` because `reps` is smallint and integer DIVISION truncates to zero.
  -- This is multiplication against `numeric`, which promotes. Do not add a cosmetic cast by analogy,
  -- and — far more importantly — do not remove the load-bearing one next door by the same analogy.
  --
  -- `coalesce` so the column is never null in an emitted row. It should be unreachable (`weight_kg`
  -- is generated from two `not null` columns, and `greatest` ignores nulls anyway), and the service
  -- treats a null here as a READ ERROR rather than as a day worth nothing — because silently
  -- dropping one day of a week understates the week, which is the "figure that is wrong and looks
  -- right" this slice exists to avoid.
  coalesce(sum(s.reps * greatest(s.weight_kg, 0)), 0) as tonnage_kg
from public.sets s
  -- Joined on (id, user_id) at each level, the same ownership pairs the composite foreign keys use.
  -- The user_id half is redundant against the keys and is written anyway: it gives the planner the
  -- owner filter at every level, which is what AGENTS.md means by "the policy is the guarantee, the
  -- filter is the index path".
  join public.exercise_entries ee on ee.id = s.exercise_entry_id and ee.user_id = s.user_id
  join public.workouts         w  on w.id  = ee.workout_id       and w.user_id  = ee.user_id
group by s.user_id, w.performed_on;

comment on view public.daily_tonnage is
  'One row per account per day with that day''s tonnage in kilograms: sum(reps * greatest(weight_kg, '
  '0)), so zero-load and assisted sets contribute nothing rather than a negative amount. A day with '
  'no sets produces NO ROW - the zero a screen shows for an empty week is synthesised by the service '
  'and must never be produced by a failed read. Knows nothing about weeks or timezones: a training '
  'week is Monday-Sunday in the reader''s own zone and that decision lives in '
  'src/lib/services/calendar.ts alone. Nothing here is stored.';

revoke all on public.daily_tonnage from anon, authenticated;
grant select on public.daily_tonnage to authenticated;

notify pgrst, 'reload schema';
