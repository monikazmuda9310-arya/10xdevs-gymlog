-- Purpose : the exercise catalogue — a seeded set every account reads, plus a private set each
--           account owns, in ONE table. Establishes the shared-catalogue policy variant, which
--           differs from the row-ownership template in exactly one policy.
-- Affected: new type public.muscle_group; new table public.exercises. No existing object is
--           altered. Destructive operations: none.

-- Exactly six, and the order is deliberate: it is what enum comparison and any future `order by`
-- will use, so it reads the way a body is usually split rather than alphabetically. Adding a
-- seventh later is `alter type ... add value` and rewrites nothing; merging or removing one means
-- re-tagging every exercise and recomputing every historical per-group tonnage figure. That
-- asymmetry is why the owner chose six (context/foundation/prd.md § Open Questions #1).
create type public.muscle_group as enum ('legs', 'back', 'chest', 'shoulders', 'arms', 'core');

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  -- NULLABLE ON PURPOSE, and the null is the whole design: null means "seeded, every signed-in
  -- account reads it"; a value means "private to that account". One table rather than two because
  -- S-03 must hang every set off a SINGLE exercise_id — two tables would force two nullable
  -- foreign keys plus a check constraint on `sets`, the shape that produces a set belonging to no
  -- exercise or to both.
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  muscle_group public.muscle_group not null,
  is_bodyweight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_name_length check (char_length(name) between 1 and 80)
);

comment on column public.exercises.user_id is
  'NULL = seeded catalogue row, readable by every authenticated account and writable by none. '
  'Non-NULL = custom exercise private to that account. See the policies below.';

comment on column public.exercises.is_bodyweight is
  'Permits a set to carry zero or negative (assisted) load (FR-014). Not "never loaded" — a '
  'weighted pull-up is still a bodyweight exercise.';

create trigger exercises_set_updated_at
  before update on public.exercises
  for each row execute function public.set_updated_at();

-- `unique (user_id, name)` would NOT do what it looks like: Postgres treats two NULLs as distinct,
-- so it would happily admit two seeded rows called 'Bench Press'. Two partial indexes express the
-- actual rule. lower() because "bench press" and "Bench Press" are the same exercise to somebody
-- typing on a phone at the rack.
create unique index exercises_seeded_name_key
  on public.exercises (lower(name)) where user_id is null;

create unique index exercises_owner_name_key
  on public.exercises (user_id, lower(name)) where user_id is not null;

-- The catalogue screen filters by group within a caller's visible set. AGENTS.md § Access control
-- requires the query to carry its own filter rather than leaning on the policy predicate to do the
-- filtering — under the Workers Free 10 ms CPU cap a policy-only scan is the documented trap.
create index exercises_user_muscle_group_idx on public.exercises (user_id, muscle_group);

alter table public.exercises enable row level security;

-- Supabase's default privileges grant ALL on new public tables to anon and authenticated. Revoke
-- first, then grant exactly what is allowed.
revoke all on public.exercises from anon, authenticated;
grant select, insert, update, delete on public.exercises to authenticated;

-- THE ONLY POLICY THAT DEPARTS FROM THE TEMPLATE: the shared half plus the private half.
create policy "exercises are selectable when seeded or owned"
  on public.exercises for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

-- The three write policies are the ordinary owner check, unchanged — and that is worth
-- understanding rather than copying. On a seeded row `user_id` is null, so
-- `(select auth.uid()) = user_id` evaluates to NULL, not TRUE, and a policy admits a row only on
-- TRUE. The seeded catalogue is therefore unwritable by everyone WITHOUT being named here.
--
-- Because that protection is a side effect of three-valued logic rather than a stated rule, it is
-- asserted explicitly in tests/integration/exercises-rls.test.ts. Do not "simplify" these with
-- coalesce() or `is not distinct from` — either would hand every account write access to the
-- catalogue every other account reads, and nothing else would notice.
create policy "exercises are insertable by their owner"
  on public.exercises for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "exercises are updatable by their owner"
  on public.exercises for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "exercises are deletable by their owner"
  on public.exercises for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Update and delete are granted although S-02 ships no UI for either. The policy is the guarantee;
-- adding it later — after rows exist — is a migration nobody remembers is needed. The absent
-- screens are scope, not permission. anon gets no policy and no grant.

notify pgrst, 'reload schema';
