-- Purpose : one row per authenticated account, holding the preferences every derived
--           number depends on (training-week timezone, weight unit, estimation formula).
--           Establishes the row-ownership policy shape every later table copies.
-- Affected: new types public.weight_unit, public.estimation_formula; new table
--           public.profiles; new functions public.set_updated_at, public.handle_new_user;
--           new trigger on auth.users. Destructive operations: none.

create type public.weight_unit as enum ('kg', 'lb');
create type public.estimation_formula as enum ('epley', 'brzycki');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Europe/Warsaw',
  weight_unit public.weight_unit not null default 'kg',
  estimation_formula public.estimation_formula not null default 'brzycki',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_timezone_length check (char_length(timezone) between 1 and 64)
);

comment on column public.profiles.timezone is
  'IANA zone the training week (Monday-Sunday) is evaluated in. Validated in the application layer.';

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Supabase's default privileges grant ALL on new public tables to anon and authenticated.
-- Revoke first, then grant exactly what is allowed: an implicit grant is how a delete path
-- or an anonymous read path arrives without anybody deciding on it.
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy "profiles are selectable by their owner"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles are insertable by their owner"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles are updatable by their owner"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy and no delete grant, deliberately: deleting a profile row while the
-- account survives leaves a live account with no timezone. Account deletion is S-09 and
-- removes the auth.users row, which cascades. anon gets no policy at all.

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

notify pgrst, 'reload schema';
