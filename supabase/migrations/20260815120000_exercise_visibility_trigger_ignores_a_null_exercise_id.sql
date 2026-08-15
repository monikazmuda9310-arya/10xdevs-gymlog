-- Purpose : two corrections to public.exercise_entries_require_visible_exercise, both found by the
--           implementation review of `cross-account-isolation` on 2026-08-15. Neither changes what
--           the trigger refuses for any reachable caller; the first fixes WHICH ERROR a malformed
--           write gets, the second is documentation the original header owed the reader.
-- Affected: function public.exercise_entries_require_visible_exercise, replaced in place. The
--           trigger exercise_entries_exercise_must_be_visible is untouched and keeps pointing at
--           it. No table, column, policy or grant is altered and no row is written. Destructive
--           operations: none.
--
-- 1. A NULL `exercise_id` MUST NOT BE ANSWERED BY THIS FUNCTION. `exercise_id` is `not null`, but
--    `NOT NULL` is enforced in ExecConstraints, which runs AFTER `before row` triggers. So an
--    insert that omits the column reached this function with `new.exercise_id is null`, the
--    existence query found nothing, and the caller got `foreign_key_violation` carrying
--    `exercise  is not available to this account` — an empty `%s`, and the wrong fact about the
--    write. src/pages/api/exercise-entries/index.ts then maps that onto `404 exercise_not_found`
--    where the database used to answer `23502 not_null_violation`. Unreachable through the endpoint,
--    whose schema requires a uuid, so this only ever affected a direct PostgREST caller — but a
--    guard that answers a question it was not asked is how a later reader learns the wrong rule.
--    Short-circuiting on NULL hands the case back to the `NOT NULL` constraint that owns it.
--
-- 2. THE CHECK IS EVALUATED FOR THE CALLER, NOT FOR THE ROW'S OWNER, and everything downstream
--    depends on that distinction staying invisible. `select 1 from public.exercises where id = ...`
--    runs under RLS as whoever is writing, so it asks "can `auth.uid()` see this exercise?" — not
--    "can `new.user_id` see it?". A `before row` trigger fires AHEAD of the RLS `with check`, so at
--    this point `new.user_id = auth.uid()` has NOT yet been established.
--
--    The two coincide only because `"exercise entries are insertable by their owner"` pins
--    `user_id` to `(select auth.uid())` immediately afterwards. The interesting case — B inserting
--    `{user_id: A, exercise_id: <B's own private exercise>}` — passes this trigger and is then
--    correctly refused `42501` by that policy, which is the arrangement working as intended. But it
--    means **this trigger's guarantee is only as strong as that insert policy**, and the original
--    header framed the limitation solely as "postgres and service_role bypass RLS". Weakening the
--    insert policy would silently widen what this function admits.
--
--    Do NOT "fix" that by adding `and (user_id is null or user_id = new.user_id)` to the query.
--    That restates the exercises select policy in a second place and the two would drift, which is
--    the thing the bare existence query exists to avoid. The dependency is a fact to document, not
--    a defect to patch. context/foundation/access-control.md § the access-control-trigger variant
--    carries the same sentence.
--
-- Everything the 20260815090000 header says about `security invoker`, the `MATCH SIMPLE` reason a
-- composite key could not be used, the `authenticated`-only binding, and the message rule that
-- keeps the endpoint's 23503 discrimination working, still applies unchanged. Read it first.

create or replace function public.exercise_entries_require_visible_exercise() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Hand NULL back to the NOT NULL constraint, which runs after this trigger and owns the case.
  if new.exercise_id is null then
    return new;
  end if;

  -- Bare existence query, deliberately: RLS supplies the predicate. Do not add
  -- `and (user_id is null or user_id = new.user_id)` — that restates the select policy in a second
  -- place, and the two would drift. See note 2 in this file's header for what that costs and why
  -- it is still the right trade.
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
  'the caller. Runs as the caller (security invoker) so the check IS the exercises select policy, '
  'which means it is equivalent to "the row owner can see it" only while the insert policy pins '
  'user_id to auth.uid(). Making it security definer disables it silently. A NULL exercise_id is '
  'passed through to the NOT NULL constraint.';

notify pgrst, 'reload schema';
