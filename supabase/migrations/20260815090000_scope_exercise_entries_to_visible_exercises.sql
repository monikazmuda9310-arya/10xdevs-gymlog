-- Purpose : close the one way an account can reach into another's data. `exercise_entries.exercise_id`
--           is a SINGLE-COLUMN foreign key and is not ownership-scoped; foreign-key checks bypass
--           RLS, and the insert policy only ever looks at the row in front of it. So the database
--           permitted an entry of account A's naming a PRIVATE exercise of account B's. Refuse it,
--           on insert and on update alike.
-- Affected: new function public.exercise_entries_require_visible_exercise; new trigger
--           exercise_entries_exercise_must_be_visible on public.exercise_entries. No table, column,
--           policy or grant is altered and no row is written. Destructive operations: none.
--
-- NO DATA STEP, AND THAT IS A MEASUREMENT RATHER THAN AN ASSUMPTION. A `before` trigger does not
-- validate rows already stored, so a violating row present before this migration would stay and stay
-- invisible. Both hosted projects were counted on 2026-08-15, before this file was written — the
-- entries joined to their exercise, filtered on `e.user_id is not null and e.user_id <> ee.user_id` —
-- and both answered zero. Anything that appears later came in through a path this trigger does not
-- bind; see the next paragraph.
--
-- THIS BINDS `authenticated` AND NOTHING ELSE, ON PURPOSE. The function is `security invoker`, so
-- the visibility check IS the `exercises` select policy — evaluated for whoever is inserting. Under
-- PostgREST that role is `authenticated`, which does not own the tables, so RLS applies inside the
-- function body and a bare `select 1 from public.exercises where id = ...` returns no row precisely
-- when the exercise is neither seeded nor the caller's. The check therefore reuses the existing
-- policy instead of restating it: one definition, not two. The cost is that `postgres` and
-- `service_role` bypass RLS, so on those paths the check admits anything. Migrations and any
-- service-role tooling can still create the hazard row.
--
-- MAKING THIS FUNCTION `security definer` SILENTLY DISABLES IT. It would then run as `postgres`,
-- which owns every table here and is not subject to their policies, so the existence query would
-- find EVERY exercise and the trigger would admit every row while looking exactly as it does now.
-- `security definer` is the reflex for trigger functions and this repository already has one
-- (public.handle_new_user), which is why the word `invoker` is written out below rather than left to
-- the SQL default. Assertions 1 and 2 of tests/integration/account-boundary.test.ts are what fail
-- when it changes.
--
-- WHY NOT A COMPOSITE FOREIGN KEY — and the reason is NOT the one a reader of this repository will
-- reach for first. `exercise_entries` and `sets` close nested ownership with a composite key to the
-- parent's `(id, user_id)`, and the obvious move is to do the same against `exercises (id, user_id)`.
-- It cannot work here, and the obstacle has nothing to do with policies: a foreign key does not
-- evaluate them, and FK checks bypass RLS. The obstacle is `MATCH SIMPLE` matching. FK matching is
-- equality, and `NULL = NULL` is not TRUE — so a referencing tuple whose `user_id` is `not null`
-- could never match a referenced row whose `user_id` is `null`, and the 38 seeded catalogue rows are
-- exactly those null-owner rows. Every account would lose the shared catalogue. The declarative
-- alternative that does work — a generated sentinel owner key on both tables plus a check
-- constraint — was weighed and rejected on cost (two new columns, a backfill, a value every caller
-- must supply, and a sentinel uuid meaning "shared" that somebody will read as a real account);
-- context/changes/cross-account-isolation/plan.md § Mechanism records it.
--
-- THE MESSAGE MUST NOT NAME THE WORKOUT-OWNER CONSTRAINT.
-- src/pages/api/exercise-entries/index.ts tells `workout_not_found` from `exercise_not_found` by
-- testing whether a 23503's message contains `exercise_entries_workout_owner_fkey`. Raising
-- `foreign_key_violation` here therefore lands on `exercise_not_found` — the same answer an exercise
-- that does not exist already gets, so this is no existence oracle and the endpoint needs no change.
-- A message that happened to mention that constraint would flip every refused exercise into "workout
-- not found". Note also that a BEFORE trigger fires ahead of constraint checks, so from now on it is
-- this function, not the plain foreign key, that raises for a genuinely MISSING exercise too.

create function public.exercise_entries_require_visible_exercise() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Bare existence query, deliberately: RLS supplies the predicate. Do not add
  -- `and (user_id is null or user_id = new.user_id)` — that restates the select policy in a second
  -- place, and the two would drift.
  if not exists (select 1 from public.exercises where id = new.exercise_id) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = format('exercise %s is not available to this account', new.exercise_id),
      hint = 'The exercise is absent from the catalogue, or it is another account''s private exercise.';
  end if;
  return new;
end;
$$;

comment on function public.exercise_entries_require_visible_exercise() is
  'Access control, not validation: refuses an exercise_entries row whose exercise_id is invisible to '
  'the caller. Runs as the caller (security invoker) so the check IS the exercises select policy. '
  'Making it security definer disables it silently.';

-- `update of exercise_id` as well as `insert`: exercise_entries carries an UPDATE policy, so
-- re-pointing an entry the caller owns is the same hazard through a second door.
create trigger exercise_entries_exercise_must_be_visible
  before insert or update of exercise_id on public.exercise_entries
  for each row execute function public.exercise_entries_require_visible_exercise();

notify pgrst, 'reload schema';
