-- Purpose : the training record itself — a workout, the exercises entered under it, and the sets
--           entered under those. Establishes the NESTED-ownership variant of the row-ownership
--           template: every level carries its own user_id AND a composite foreign key to its
--           parent, because the four-policy template alone does not protect a nested record.
-- Affected: new tables public.workouts, public.exercise_entries, public.sets. public.exercises
--           gains an inbound foreign key (nothing about it is altered). Destructive operations:
--           none.
--
-- WHY THE COMPOSITE KEYS EXIST. Every policy in this database is `(select auth.uid()) = user_id`
-- on the row being touched. On a child table that check passes for an account inserting a row with
-- ITS OWN user_id and SOMEBODY ELSE'S parent id — the policy never looks at the parent. The result
-- is a row grafted onto another account's workout: invisible to both parties, and a breach at
-- exactly the level US-04 names. Referencing (parent_id, user_id) -> parent (id, user_id) makes the
-- graft look for a parent owned by the grafter, and not find one. That is why `workouts` and
-- `exercise_entries` carry a `unique (id, user_id)` that looks redundant against their primary key:
-- it is the target the child's composite key needs, and it is cheaper than a trigger.
--
-- THE COMPOSITE KEY MUST STAY THE ONLY FOREIGN KEY TO ITS PARENT. PostgREST builds its embed join
-- from the foreign-key columns and handles composite keys natively, so `workouts?select=*,
-- exercise_entries(*)` resolves through the two-column key with no hint syntax — but only while
-- exactly one path exists. Adding a "clarifying" plain `workout_id references workouts (id)`
-- alongside it creates a second constraint between the same pair of tables and every nested read
-- starts failing with PGRST201, demanding `exercise_entries!<constraint>(...)` at each call site.
-- tests/integration/workout-log-rls.test.ts asserts the graft is refused; nothing asserts this.

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A `date`, not a timestamptz, and the difference is the whole timezone story. The user STATES
  -- the date, so there is nothing to re-project: what happened on the 10th stays on the 10th even
  -- if they change their profile timezone in S-06. The timezone is needed in exactly one place —
  -- computing the default "today" for the form, because 01:00 in Warsaw is still yesterday in UTC.
  -- Week bucketing is then date_trunc('week', performed_on), which Postgres starts on Monday.
  performed_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Rejects the empty string as well as an over-long note, so an untouched note field must arrive
  -- as NULL rather than ''. src/lib/validation/workout-schemas.ts is what normalises it; without
  -- that, a user who never touched the field would meet a constraint violation they cannot act on.
  constraint workouts_note_length check (note is null or char_length(note) between 1 and 500),
  -- Redundant against the primary key by design — see the header. This is what exercise_entries
  -- points its composite key at.
  constraint workouts_id_user_key unique (id, user_id)
);

comment on column public.workouts.performed_on is
  'The training date as the user stated it, in their own calendar. Never derived from an instant, '
  'so changing the profile timezone later cannot move a workout to a different day.';

create table public.exercise_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid not null,
  -- `on delete restrict`, written out rather than left to the default so the next reader sees a
  -- decision instead of an omission: an exercise with logged history cannot be deleted at all. The
  -- PRD guarantees a saved workout is never silently lost, and `cascade` here would destroy
  -- training history sideways, through a catalogue screen. An unused exercise is still deletable.
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercise_entries_workout_owner_fkey
    foreign key (workout_id, user_id) references public.workouts (id, user_id) on delete cascade,
  -- One entry per exercise per workout. Choosing an exercise already in the workout adds a set to
  -- the entry that is there rather than creating a twin, which is what makes "the best estimate of
  -- that entry" (FR-015) mean one thing. The service maps this 23505 to returning the existing row.
  constraint exercise_entries_workout_exercise_key unique (workout_id, exercise_id),
  constraint exercise_entries_id_user_key unique (id, user_id)
);

-- No muscle_group column, and that absence is load-bearing: per-group tonnage is computed from the
-- exercise's CURRENT group, so a later correction applies to history. Snapshotting it here would
-- answer prd.md § Open Questions #2 by accident, in the direction nobody chose.
comment on column public.exercise_entries.exercise_id is
  'The only link to the catalogue. Never snapshot name, muscle_group or is_bodyweight onto an '
  'entry or a set — every derived figure reads the exercise row as it stands today.';

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_entry_id uuid not null,
  reps smallint not null,
  -- The weight AS THE USER TYPED IT, with the unit they typed it in, plus a canonical column
  -- derived from both. That triple is what makes "a weight entered in lb and read back in lb is
  -- the number the user typed" true BY CONSTRUCTION rather than by an argument about precision:
  -- the read-back is the stored value, byte for byte. Comparison and aggregation always use
  -- weight_kg. Negative values are assisted (bodyweight) sets and are legal here; whether the
  -- exercise permits them is checked in the endpoint, because that answer lives in another table.
  weight numeric(7, 3) not null,
  weight_unit public.weight_unit not null,
  -- Unconstrained `numeric` on purpose: a scale here would put a rounding step back into the one
  -- column every record comparison and every future tonnage sum reads, which is the exact thing
  -- the storage decision existed to remove.
  --
  -- This expression is legal ONLY because the enum is never cast. `case weight_unit when 'kg'`
  -- compares the column against a literal the parser folds into a typed constant, and enum
  -- equality is immutable. Writing the same intent as `weight_unit::text = 'kg'` would be REFUSED
  -- at create-table time, because enum_out is STABLE, not immutable. If this ever has to change,
  -- the fallback is a before-insert-or-update trigger, which carries no immutability requirement.
  weight_kg numeric generated always as (
    case weight_unit when 'kg' then weight else weight * 0.45359237 end
  ) stored,
  -- Optional, and excluded from every computation (FR-009): recorded for the human reader only, so
  -- it cannot corrupt a derived number.
  rpe numeric(3, 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sets_reps_range check (reps between 1 and 100),
  constraint sets_weight_range check (weight between -1000 and 2000),
  constraint sets_rpe_range check (rpe is null or rpe between 1 and 10),
  constraint sets_entry_owner_fkey
    foreign key (exercise_entry_id, user_id) references public.exercise_entries (id, user_id) on delete cascade
);

comment on column public.sets.weight_kg is
  'Canonical kilograms, generated. Every comparison, record verdict and tonnage sum reads THIS '
  'column; `weight` is what the user typed and is what is read back to them.';

create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();

create trigger exercise_entries_set_updated_at
  before update on public.exercise_entries
  for each row execute function public.set_updated_at();

create trigger sets_set_updated_at
  before update on public.sets
  for each row execute function public.set_updated_at();

-- Every read carries its own `.eq("user_id", ...)` filter and each of these is what it travels on.
-- AGENTS.md § Access control: the policy is the guarantee, the filter is the index path — without
-- one, a read leans on the policy predicate to do the filtering, which on these tables is a full
-- scan under the Workers Free 10 ms CPU cap.
create index workouts_user_performed_on_idx on public.workouts (user_id, performed_on desc);
create index exercise_entries_user_workout_idx on public.exercise_entries (user_id, workout_id);
create index sets_user_entry_idx on public.sets (user_id, exercise_entry_id);

-- This one is for a slice that does not exist yet. S-04 asks "every set this account has logged
-- for this exercise", which reaches `sets` only through the entries and has nothing to travel on
-- without it. One line now against a migration later.
create index exercise_entries_user_exercise_idx on public.exercise_entries (user_id, exercise_id);

-- ---------------------------------------------------------------------------------------------
-- Access control. The plain row-ownership template from AGENTS.md § Access control, three times
-- over: RLS enabled in the same migration that creates the table, `revoke all` before any grant,
-- one policy per operation, every one `to authenticated`, `(select auth.uid())` never bare (it is
-- evaluated once as an InitPlan instead of once per row), and update carrying both `using` and
-- `with check` — `using` alone would let a caller rewrite someone else's row onto themselves.
--
-- Update and delete are granted although this slice ships no UI for either. The policy is the
-- guarantee; adding it later, after rows exist, is a migration nobody remembers is needed. The
-- absent screens are scope (S-05), not permission. anon gets no policy and no grant anywhere.
-- ---------------------------------------------------------------------------------------------

alter table public.workouts enable row level security;
revoke all on public.workouts from anon, authenticated;
grant select, insert, update, delete on public.workouts to authenticated;

create policy "workouts are selectable by their owner"
  on public.workouts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "workouts are insertable by their owner"
  on public.workouts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "workouts are updatable by their owner"
  on public.workouts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "workouts are deletable by their owner"
  on public.workouts for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.exercise_entries enable row level security;
revoke all on public.exercise_entries from anon, authenticated;
grant select, insert, update, delete on public.exercise_entries to authenticated;

create policy "exercise entries are selectable by their owner"
  on public.exercise_entries for select to authenticated
  using ((select auth.uid()) = user_id);

-- Note what this policy does NOT check: that workout_id belongs to the caller. It cannot — a
-- policy sees only the row in front of it. The composite foreign key above is what refuses the
-- graft, and assertion 4 of tests/integration/workout-log-rls.test.ts is what would notice if
-- somebody ever "simplified" it into a plain `references workouts (id)`.
create policy "exercise entries are insertable by their owner"
  on public.exercise_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "exercise entries are updatable by their owner"
  on public.exercise_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "exercise entries are deletable by their owner"
  on public.exercise_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.sets enable row level security;
revoke all on public.sets from anon, authenticated;
grant select, insert, update, delete on public.sets to authenticated;

create policy "sets are selectable by their owner"
  on public.sets for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "sets are insertable by their owner"
  on public.sets for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "sets are updatable by their owner"
  on public.sets for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "sets are deletable by their owner"
  on public.sets for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
