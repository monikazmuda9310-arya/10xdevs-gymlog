-- Purpose : let a signed-in account delete ITSELF — its auth.users row and every training row hanging
--           off it — with no service_role key anywhere in this repository. Supabase's
--           auth.admin.deleteUser needs an admin key; the Worker carries exactly SUPABASE_URL and
--           SUPABASE_KEY, and AGENTS.md § Environment forbids a service_role key reaching either the
--           application or the tests. A `security definer` function granted to `authenticated` is the
--           only shape that fits.
-- Affected: new function public.delete_own_account(). No table, column, policy or row is altered.
--           Destructive operations: none by this migration — the function it creates is destructive
--           BY DESIGN, on the caller's own account and on nothing else.
--
-- WHY `security definer` HERE, WHEN THE FUNCTION ONE MIGRATION AGO SAYS IT WOULD BE A DEFECT.
-- 20260815090000 creates public.exercise_entries_require_visible_exercise() as `security invoker`,
-- with a header stating that `security definer` would silently disable it — that function's whole
-- design is that the visibility check IS the caller's own RLS policy. This one is the opposite case
-- and the reason is different in kind, not in degree: `authenticated` holds no privilege on
-- auth.users at all (has_table_privilege('authenticated','auth.users','DELETE') is false, measured
-- 2026-08-15) and must never be given one. The elevated rights are the point, and they are confined
-- by the function taking NO PARAMETERS. After both slices merge this repository holds one function of
-- each kind, each documenting the other as its failure mode. Neither is a licence for a third.
--
-- NO PARAMETERS, ON PURPOSE. The uid comes from auth.uid() inside the body, so there is no argument a
-- caller could aim at somebody else's account. A parameterised delete_own_account(p_user_id uuid)
-- guarded by `if p_user_id <> auth.uid() then raise` is strictly worse: the guard is one line somebody
-- can delete, and PostgREST would publish the signature. Assertion 6 of
-- tests/integration/account-deletion.test.ts asserts that a call carrying ANY argument answers
-- PGRST202 — the tripwire for an overload being added later.
--
-- A NULL uid RAISES RATHER THAN DELETING NOTHING. auth.uid() reads a JWT claim PostgREST sets per
-- request and returns null off that path. `delete from auth.users where id = auth.uid()` would then
-- match zero rows and REPORT SUCCESS — the lie AGENTS.md § "A zero-row UPDATE or DELETE is a SUCCESS"
-- exists to prevent. The same applies to a replayed call: an access token stays verifiable for its
-- remaining lifetime after the row is gone, so "deleted nothing" is reachable and must never be
-- answered as "deleted your account".
--
-- WHY THE DELETES ARE EXPLICIT AND ORDERED — AND WHAT THAT IS *NOT*.
-- Every user-owned table cascades from auth.users, so `delete from auth.users` alone would in fact
-- remove everything. **That was measured on 2026-08-15, against gymlog-test, and it succeeded** — for
-- an account owning a custom exercise with a workout, an entry logging it and a set, exactly as it did
-- for an account logging only against the seeded catalogue. So this order is NOT load-bearing today
-- and the header will not pretend otherwise.
--
-- What it buys is independence from AFTER-trigger queue ordering. exercise_entries.exercise_id
-- references public.exercises ON DELETE RESTRICT — the schema's only non-cascade edge — and the RI
-- triggers on auth.users fire in OID order, cascading into public.exercises (17556) BEFORE
-- public.exercise_entries (17601). Planning read that and predicted a block; the prediction was wrong,
-- because the RESTRICT check is itself an AFTER trigger, queued behind the cascade that removes the
-- referencing rows. "Not deferrable" means "cannot be postponed to COMMIT", not "checked synchronously
-- inside the cascade". That distinction is observed behaviour rather than a documented contract, it
-- was mis-predicted once from the catalogue alone, and deleting explicitly costs three statements.
-- If you are here to "simplify this to a single delete": you would probably be right, and the reason
-- not to is that nobody promised us this ordering.
--
-- `where user_id = caller`, NEVER `is not distinct from`. This function bypasses RLS, so the 38 seeded
-- catalogue rows are protected here by nothing but this predicate. They carry `user_id is null`, and
-- `null = <uuid>` is NULL, so they are never matched. A "null-safe" tidy-up to
-- `where user_id is not distinct from caller` would match every seeded row the first time a null uid
-- reached it and wipe the catalogue for every account. Assertion 3 of the suite is what notices.
--
-- The `revoke` names `public`, and that is the whole reason this line differs from the table template.
-- Supabase's implicit grant on TABLES goes to anon/authenticated; the default EXECUTE grant on a
-- FUNCTION goes to PUBLIC. Revoking from anon and authenticated alone would leave this callable by
-- anybody. Assertion 7 is what notices.

create function public.delete_own_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  removed integer;
begin
  if caller is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'delete_own_account() requires an authenticated caller',
      hint = 'auth.uid() is null outside a PostgREST request carrying a valid JWT.';
  end if;

  -- Workouts first: this cascades to exercise_entries and sets, which is what releases the
  -- `on delete restrict` on any exercise this account created. The reverse order would meet it.
  delete from public.workouts where user_id = caller;

  -- The account's OWN exercises only. See the header: `is not distinct from` here would take the
  -- shared catalogue with it and no policy would stop it.
  delete from public.exercises where user_id = caller;

  delete from auth.users where id = caller;
  get diagnostics removed = row_count;
  if removed = 0 then
    -- Reachable: a replayed call on a token that is still cryptographically valid. Answering
    -- success here would tell a caller their account was deleted when nothing happened.
    raise exception using
      errcode = 'no_data_found',
      message = 'no account matched the caller',
      hint = 'The account was already deleted, or the token names a user that no longer exists.';
  end if;
end;
$$;

comment on function public.delete_own_account() is
  'Deletes the CALLING account and nothing else: no parameters, uid taken from auth.uid(), which '
  'raises when null rather than deleting zero rows and reporting success. security definer because '
  'authenticated holds no privilege on auth.users and must never be given one. Deletes explicitly in '
  'dependency order — a bare delete works (measured 2026-08-15) but relies on AFTER-trigger queue '
  'ordering that is observed rather than contracted.';

revoke all on function public.delete_own_account() from public, anon, authenticated;
grant execute on function public.delete_own_account() to authenticated;

notify pgrst, 'reload schema';
