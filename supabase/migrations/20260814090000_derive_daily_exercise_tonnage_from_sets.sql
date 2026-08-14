-- S-08, tonnage breakdown. Adds: view public.daily_exercise_tonnage. Nothing else — no table, no
-- column, no index, no change to any existing object, and in particular NO CHANGE to
-- public.daily_tonnage. Purely additive, so it is safe on production before the Worker that reads it
-- is deployed.
--
-- WHY `left join` AND NOT `join`, AND WHY THIS IS THE MOST IMPORTANT LINE IN THE FILE.
--
-- `exercise_entries.exercise_id references public.exercises (id)` is a SINGLE-COLUMN foreign key and
-- is NOT ownership-scoped (20260811005248_create_workout_log_with_row_ownership.sql:59) — unlike the
-- composite keys one level up, which reference the parent BY OWNER. Foreign-key checks in Postgres
-- run with RLS bypassed, and `addExerciseEntry` (src/lib/services/workouts.ts) inserts whatever
-- exercise_id it is handed without a visibility check. So a row CAN exist in which account A's entry
-- points at account B's PRIVATE exercise. Nothing in the product creates one today; the database
-- permits it, which is enough.
--
-- Under `security_invoker = true` this view is executed with the READER's permissions, so every
-- relation it touches is filtered by that relation's policy — including `exercises`, whose select
-- policy is `user_id is null or (select auth.uid()) = user_id`
-- (20260810174840_create_exercises_with_shared_catalogue.sql:65-67). An INNER join to `exercises`
-- therefore DROPS that set's whole row from A's own breakdown, while `daily_tonnage` — which never
-- joins `exercises` — still counts it. The breakdown then fails to reconcile with the total printed
-- directly above it, with no error raised anywhere and both numbers looking plausible.
--
-- Under RLS, A JOIN IS A FILTER. The `left join` keeps the kilograms and yields
-- `muscle_group is null` / `exercise_name is null`, which the screen renders as an `Unattributed`
-- row. Assertion 9 of tests/integration/tonnage-breakdown.test.ts constructs exactly that hazard row
-- — A's entry naming B's private exercise — and asserts both that the tonnage survives and that the
-- two views still agree. It is the only thing in this repository that would notice this `left`
-- being "simplified" away.
--
-- THE SECOND COPY OF THE TONNAGE EXPRESSION, NAMED RATHER THAN LEFT TO BE FOUND.
--
-- `sum(reps * greatest(weight_kg, 0))` now exists TWICE: here and in
-- 20260813150000_derive_daily_tonnage_from_sets.sql. This repository documents the
-- two-implementations hazard twice already (the 1RM `case` expression and the 0.45359237 factor) and
-- this is a WEAKER instance of it, for two reasons worth stating rather than assuming. First, both
-- copies live in MIGRATION FILES, which are append-only and never edited — the drift the other two
-- suffer comes from somebody editing one live definition. Second, assertion 1 of the S-08 suite
-- compares the two views' figures over the same window directly, so a divergence is a red assertion
-- rather than a reader's catch. THE RULE: if the tonnage expression ever changes, both change in the
-- SAME migration. The day something replaces one of these views, this stops being the weaker case.
--
-- `security_invoker = true` IS LOAD-BEARING HERE, NOT A TRIPWIRE. This view reads `sets`,
-- `exercise_entries`, `workouts` AND `exercises` DIRECTLY, so it stands exactly where `daily_tonnage`
-- and `set_estimates` stand rather than where `personal_records` does (whose rows are all drawn
-- through `set_estimates`, which hands the decision back to the real caller partway down the chain).
-- Without the flag the view executes as its owner — `postgres`, which owns every table here and is
-- not subject to their policies — and hands every account's per-exercise volume to every account.
-- Assertion 7 of tests/integration/tonnage-breakdown.test.ts holds it: account B naming account A's
-- user_id directly against the view.
--
-- THE GRAIN AND THE PUSHDOWN. `user_id` and `performed_on` are both GROUP BY columns, so the
-- application's `.eq("user_id", …)` plus `performed_on` range still push down into the aggregate and
-- travel on `workouts_user_performed_on_idx (user_id, performed_on desc)`. That property belongs to
-- THIS grain: `(user_id, exercise_id)` filtered by a date range would not have it, which is why the
-- view groups by day and the Worker folds a week, exactly as S-07 does. `exercise_id` reaches
-- `exercises` by PRIMARY KEY, so no new index is needed and no fan-out is possible — at most one
-- catalogue row per entry.
--
-- WHAT THIS VIEW STILL DOES NOT KNOW: what a week is, and what a timezone is. Unchanged from
-- 20260813150000_derive_daily_tonnage_from_sets.sql, whose header states the rule in full — no
-- `date_trunc('week', …)`, and no reference to `profiles.timezone`, here or anywhere. Read it there
-- rather than trusting a paraphrase here; a rule restated twice is a rule that can drift.
--
-- NOT MEASURED, AND SAID SO. `gymlog-test` holds a few dozen sets, where Postgres correctly prefers a
-- sequential scan, so no query plan taken here would mean anything. Aggregating in the database
-- rather than in the Worker is justified by the Workers Free 10 ms CPU cap on the architecture
-- argument alone. S-04 recorded this limitation first; S-07 and now S-08 inherit it unchanged.

create view public.daily_exercise_tonnage with (security_invoker = true) as
select
  s.user_id,
  w.performed_on,
  ee.exercise_id,
  -- Joined at read time, never stored. `exercise_entries` deliberately snapshots no name and no
  -- muscle_group (20260811005248…:71-76), which is what makes a muscle-group correction a
  -- re-derivation of every historical figure rather than a data migration. Null here means the
  -- catalogue row is unreadable BY THIS ACCOUNT, not that it is missing — see the `left join` above.
  x.name as exercise_name,
  x.muscle_group,
  -- THE SAME TONNAGE TERM AS `daily_tonnage`, AND THE SECOND COPY THE HEADER NAMES.
  -- `greatest(s.weight_kg, 0)` implements both halves of the domain rule at once: a zero-load set
  -- contributes `reps * 0` and an assisted (negative) set contributes `reps * 0` rather than a
  -- negative amount. `weight_kg`, never `weight` — since S-06 one account can hold both units at
  -- once, so summing the number typed produces a figure with no unit and no meaning. No `::numeric`
  -- cast: this is multiplication against `numeric`, which promotes; the load-bearing cast next door
  -- in `set_estimates` is a DIVISION and must not be removed by analogy with this line.
  --
  -- `coalesce` so the column is never null in an emitted row, for the reason `daily_tonnage` gives:
  -- the service treats a null here as a READ ERROR rather than as an exercise worth nothing.
  coalesce(sum(s.reps * greatest(s.weight_kg, 0)), 0) as tonnage_kg
from public.sets s
  -- Joined on (id, user_id) at each level, the same ownership pairs the composite foreign keys use —
  -- identical to `daily_tonnage`. The user_id half is redundant against the keys and is written
  -- anyway: it gives the planner the owner filter at every level.
  join public.exercise_entries ee on ee.id = s.exercise_entry_id and ee.user_id = s.user_id
  join public.workouts         w  on w.id  = ee.workout_id       and w.user_id  = ee.user_id
  -- LEFT. See the header. An inner join here deletes tonnage from its own owner's breakdown.
  left join public.exercises   x  on x.id  = ee.exercise_id
group by s.user_id, w.performed_on, ee.exercise_id, x.name, x.muscle_group;

comment on view public.daily_exercise_tonnage is
  'One row per account per day per exercise with that day''s tonnage for it in kilograms: '
  'sum(reps * greatest(weight_kg, 0)) - the same term as public.daily_tonnage, and the two must '
  'agree. LEFT JOIN to public.exercises on purpose: under security_invoker that table''s select '
  'policy filters the join, so an inner join would silently delete a set''s tonnage from its own '
  'owner''s breakdown whenever an entry points at another account''s private exercise. A null '
  'exercise_name/muscle_group therefore means "unreadable by this account", never "no tonnage". '
  'A day with no sets produces NO ROW. Knows nothing about weeks or timezones. Nothing is stored.';

-- Same order as every table and all three existing views: revoke before granting. Supabase's default
-- privileges grant ALL on new objects in `public` to anon and authenticated, and PostgreSQL's TABLES
-- object class covers views, so without the revoke `anon` acquires a read path nobody decided on.
revoke all on public.daily_exercise_tonnage from anon, authenticated;
grant select on public.daily_exercise_tonnage to authenticated;

notify pgrst, 'reload schema';
