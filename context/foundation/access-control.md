# Access control — the templates

**This file is the expansion of `AGENTS.md` § Access control.** That section states the guarantee
and names the five shapes; this one holds the SQL to copy and the reason each line is there.

**Read it before writing any migration that creates a table or a view.** `AGENTS.md` is loaded every
session and this file is not, which is the whole point of the split — but it also means an agent who
improvises a policy set has skipped the only document that would have stopped them. The five shapes
below are not interchangeable: the plain template alone is a defect at depth 2, and a view left
unmarked hands every account's training to every account.

**Four of them are declarative and the fifth is not.** The last one is a trigger, which means the
enforcement is invisible in the table definition a reader inspects first — that is its whole cost,
and it is why it is written down here rather than left to be found.

Citations elsewhere in the repository of the form "`AGENTS.md` § Access control → the derived-view
variant" mean the correspondingly named section **here**; the headings are unchanged so those
pointers still resolve. The one part of that section that did **not** move is "A zero-row UPDATE or
DELETE is a SUCCESS" — it governs every handler rather than every migration, so it stays in
`AGENTS.md`.

### The table template — copy this, do not improvise

Established by `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql`, proven by
`tests/integration/profiles-rls.test.ts`. Every data-bearing table copies it, with `user_id` in place
of `profiles`' `id`:

```sql
alter table public.<t> enable row level security;

-- Supabase grants ALL on new public tables to anon and authenticated by default. Revoke first,
-- then grant exactly what is allowed: an implicit grant is how a delete path or an anonymous
-- read path arrives without anybody deciding on it.
revoke all on public.<t> from anon, authenticated;
grant select, insert, update, delete on public.<t> to authenticated;

create policy "<t> are selectable by their owner" on public.<t>
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "<t> are insertable by their owner" on public.<t>
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "<t> are updatable by their owner" on public.<t>
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);
create policy "<t> are deletable by their owner" on public.<t>
  for delete to authenticated using ((select auth.uid()) = user_id);
```

- **One policy per operation, each `to authenticated`.** `anon` gets no policy and no grant.
- **`(select auth.uid())`, never bare `auth.uid()`.** The subselect is evaluated once as an InitPlan
  instead of once per row. Required, not stylistic — see § Cloudflare traps.
- **UPDATE needs both `using` and `with check`.** `using` alone lets a caller rewrite someone else's
  row onto themselves.
- **Grant only what the table actually allows.** `profiles` has _no_ delete policy and _no_ delete
  grant on purpose: deleting it while the account survives leaves a live account with no timezone.
  Copy the delete pair for tables where deletion is a real operation.
- **The policy is the guarantee; `.eq("user_id", user.id)` in the query is the index path.** Later
  tables carry **both**. Without the explicit filter, every read leans on the policy predicate to do
  the filtering, which on `workouts` and `sets` is a full scan under the 10 ms CPU cap. (`profiles`
  is the one table where the unfiltered read is honest: a single-row primary-key lookup whose whole
  demonstration is that RLS returns one row.)

### The shared-catalogue variant — when some rows belong to everybody

`public.exercises` holds two kinds of row in one table: a **seeded catalogue** every signed-in
account reads and none may write, and **custom rows** private to their owner. One nullable column is
the difference, and **only the select policy changes**:

```sql
user_id uuid references auth.users (id) on delete cascade,  -- NULL = seeded, shared

create policy "<t> are selectable when seeded or owned" on public.<t>
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
```

The insert, update and delete policies stay **exactly** as the template above. On a seeded row
`user_id` is null, so `(select auth.uid()) = user_id` evaluates to `NULL`, not `TRUE`, and **a policy
admits a row only on `TRUE`** — the ordinary owner check therefore makes the shared rows unwritable
by everyone without ever naming them.

- **That protection is invisible in the policy text**, which is what makes it dangerous. Anyone
  "simplifying" the insert policy with `coalesce(user_id, auth.uid())` or `is not distinct from`
  hands every account write access to the catalogue every other account reads, and no other test
  would notice. `tests/integration/exercises-rls.test.ts` assertion 4 exists solely to fail when
  that happens. **Do not delete it as redundant.**
- **`unique (user_id, name)` does not work on a nullable owner.** Postgres treats two `NULL`s as
  distinct, so it would admit two seeded rows with the same name. Use two partial unique indexes —
  one `where user_id is null`, one `where user_id is not null` — over `lower(name)`, since a name
  differing only in case is the same exercise to somebody typing on a phone.
- **Use this variant only when rows are genuinely shared.** `workouts`, `exercise_entries` and `sets`
  are not: their `user_id` is `not null` and they take the plain template — plus the composite key
  below, because they hang off each other.

### The nested-ownership variant — when a row hangs off another owned row

**The four-policy template does not protect a nested record, and nothing in the policy text says
so.** Every policy reads `(select auth.uid()) = user_id` **on the row in front of it and nothing
else**. So an account inserting an `exercise_entries` row with **its own** `user_id` and **somebody
else's** `workout_id` passes the insert policy — the policy never looks at the parent — and the
result is a row grafted onto another account's workout, invisible to both. Not theoretical: it was
reproduced against `gymlog-test` and the grafted row persisted (`lessons.md`).

A trigger would close it. A **composite foreign key** closes it declaratively, and is what this
repository uses:

```sql
-- parent: redundant against the primary key, and present solely as the child's FK target
unique (id, user_id)

-- child: carries its own user_id AND references the parent BY OWNER
foreign key (workout_id, user_id) references public.workouts (id, user_id) on delete cascade
```

The graft now looks for a parent row owned by the grafter and does not find one. `sets` does the
same against `exercise_entries (id, user_id)`. The duplicate index on the parent is the price.

- **The composite key must be the ONLY foreign key between each pair of tables.** PostgREST builds
  its embed from the foreign-key columns and handles composite keys natively, so
  `select("*, exercise_entries(...)")` resolves with no hint syntax — **but only while exactly one
  path exists.** A well-meant plain `workout_id references workouts (id)` added later "for clarity"
  creates a second constraint between the same pair, and every nested read starts failing with
  `PGRST201`, demanding `exercise_entries!<constraint_name>(…)` at each call site. The migration
  says so in a comment; no test would catch it before the pages did.
- **The tripwire is assertion 4 of `tests/integration/workout-log-rls.test.ts`** — account B, using
  its own `user_id`, attempting to attach an entry to account A's workout. It is the only thing in
  the repository that would notice a migration "simplifying" the composite key away. **Do not
  delete it as redundant**, for the same reason as `exercises-rls` assertion 4.
- **Copy this for every future nested table.** The plain template alone is a defect at depth 2.
- **It does not transfer to a reference INTO the shared catalogue** — `exercise_entries.exercise_id`
  is exactly that, and it is closed by the trigger variant below rather than by a key.

### The access-control-trigger variant — the exception to "nested ownership is closed by a key"

Use it when a row references a table under a **select policy** and the composite key above cannot
express the check. There is exactly one such reference here:
`exercise_entries.exercise_id references public.exercises (id)`, closed by
`supabase/migrations/20260815090000_scope_exercise_entries_to_visible_exercises.sql`.

**Why a composite key cannot do it, and this is the part everyone gets wrong.** The obvious move is
`foreign key (exercise_id, user_id) references public.exercises (id, user_id)`, and the reason it
fails has **nothing to do with policies**: a foreign key does not evaluate them, and FK checks bypass
RLS. The obstacle is `MATCH SIMPLE` matching. FK matching is **equality**, and `NULL = NULL` is not
`TRUE` — so a referencing tuple whose `user_id` is `not null` can never match a referenced row whose
`user_id` is `null`, and the 38 seeded catalogue rows are exactly those null-owner rows. Every
account would lose the shared catalogue. **Do not repeat the policy explanation here**; "a policy
admits a row only on `TRUE`" is the § shared-catalogue variant's rule and does not apply to keys.

```sql
create function public.<t>_require_visible_<parent>() returns trigger
language plpgsql
security invoker              -- the whole design; see below
set search_path = ''          -- so the body schema-qualifies everything
as $$
begin
  -- Bare existence query: RLS supplies the predicate, so the check IS the select policy.
  if not exists (select 1 from public.<parent> where id = new.<parent>_id) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = format('<parent> %s is not available to this account', new.<parent>_id);
  end if;
  return new;
end;
$$;

create trigger <t>_<parent>_must_be_visible
  before insert or update of <parent>_id on public.<t>
  for each row execute function public.<t>_require_visible_<parent>();
```

- **`security definer` silently disables it, and it is the reflex for trigger functions.** The
  function would then run as `postgres`, which owns every table here and is not subject to their
  policies, so the existence query finds **every** row and the trigger admits everything while
  looking exactly as it does now. This repository already has a `security definer` trigger
  (`public.handle_new_user`), which is why `invoker` is written out rather than left to the SQL
  default. Assertions 1 and 2 of `tests/integration/account-boundary.test.ts` are what fail when it
  changes — and the failure is **byte-identical** to removing the trigger altogether.
- **`update of <col>` as well as `insert`.** Where the table carries an UPDATE policy, re-pointing a
  row the caller owns is the same hazard through a second door. Dropping that clause leaves the
  insert assertion green and only the update one red.
- **Raise `foreign_key_violation` (`23503`), and keep the constraint name OUT of the message.**
  `src/pages/api/exercise-entries/index.ts` maps a 23503 onto `404`, choosing between
  `workout_not_found` and `exercise_not_found` by whether the message contains
  `exercise_entries_workout_owner_fkey`. Raising 23503 therefore lands on the answer an absent row
  already gets — no existence oracle, and **no application change at all**. A `BEFORE` trigger fires
  ahead of constraint checks, so from the moment it exists it is the trigger, not the plain key, that
  raises for a genuinely missing row too: `workout-endpoints`' "tells a missing exercise apart from a
  workout that is not the caller's" and `account-boundary` assertion 7 both depend on that message
  rule. Assertion 7 is what fails (as `500 unexpected`) if the code changes.
- **The check is evaluated for the CALLER, not for the row's owner — so it means "the row's owner
  can see it" only while the table's INSERT/UPDATE policy pins `user_id` to `auth.uid()`.** A
  `before row` trigger fires ahead of the RLS `with check`, so `new.user_id = auth.uid()` is not yet
  established when the function runs. On `exercise_entries` the two always coincide, because the
  insert policy pins `user_id` immediately afterwards and refuses `42501` otherwise — but that means
  this shape's guarantee rests on a policy in a different file. **Write that dependency down
  wherever you use this shape**, and do NOT close it by adding an owner term to the query: that
  restates the select policy in a second place, which is the one thing the bare existence query
  exists to prevent.
- **Hand a NULL reference back to the `NOT NULL` constraint** — `if new.<parent>_id is null then
  return new; end if;` — because `NOT NULL` is enforced after `before row` triggers, so without it
  the function answers a question it was not asked, with an empty id in the message.
- **It binds `authenticated` and nothing else, and say so wherever you rely on it.** `postgres` and
  `service_role` bypass RLS, so the visibility check admits anything on those paths — migrations and
  service-role tooling can still create the hazard row. A `before` trigger also validates **nothing
  already stored**, so count the violating rows before writing the migration rather than assuming
  zero. Both projects were counted on 2026-08-15 and answered zero.
- **Prefer a declarative shape when one exists.** The alternative that would work here — a generated
  sentinel owner key on both tables plus a check constraint — was weighed and rejected on cost (two
  new columns, a backfill, a value every caller must supply, and a sentinel uuid meaning "shared"
  that somebody will read as a real account). `context/changes/cross-account-isolation/plan.md`
  § Mechanism records it, so "lost on cost after being weighed" is not confused with "never
  considered".

### The derived-view variant — when the read is a view rather than a table

A view has **no RLS of its own**: it is protected — or not — by which role its underlying relations
are checked as.

```sql
create view public.<v> with (security_invoker = true) as select ...;

-- Same order as a table: revoke before granting. PostgreSQL's TABLES default privileges cover
-- VIEWS, so Supabase's implicit grant reaches them too.
revoke all on public.<v> from anon, authenticated;
grant select on public.<v> to authenticated;
```

- **Without `security_invoker = true` a view executes as its OWNER.** Migrations run as `postgres`,
  which owns every table here, and a table owner is not subject to its own RLS. So an unmarked view
  hands **every account's training to every account**, through a route that reads exactly like the
  safe ones. No error, no warning; the rows simply arrive.
- **Only `select` is granted.** A view over aggregates is not writable and nothing should imply it is.
- **The flag is per view and is NOT inherited. Which kind of protection it provides is decided by
  what the view READS, not by where it sits** — of the four here, three flags are guards and one is a
  tripwire:
  - **Guards** — `set_estimates`, `daily_tonnage` and `daily_exercise_tonnage` read base tables
    directly, so removing the flag leaks immediately. Pinned by assertion 2 of
    `tests/integration/personal-records.test.ts`, assertion 7 of
    `tests/integration/weekly-tonnage.test.ts`, assertion 7 of
    `tests/integration/tonnage-breakdown.test.ts` respectively.
  - **Tripwire** — `personal_records` draws every row through `set_estimates`, whose own flag hands
    the decision back to the real caller partway down the chain, so removing its flag changes nothing
    observable and **no assertion can catch it** (`authenticated` has no `pg_class` access through
    PostgREST). The flag stays anyway: point `personal_records` at `public.sets` directly — an edit
    somebody will plausibly make "for performance" — and it becomes the only thing standing between
    one account and another's log. Treat it as a tripwire for a human reviewer.
- **The explicit `.eq("user_id", …)` still belongs on every read of a view**, for the reason it
  belongs on a table: the policy is the guarantee, the filter is the index path.
- **Generated types make every view column nullable** — `supabase gen types` cannot prove not-null
  through a view. Narrow once, in the service (`src/lib/services/records.ts`), so the accident stays
  out of the endpoints and the pages.
- **A view is the shape that keeps a derived number from being stored, and that is the point.** There
  is no record column, no record row and no cache: delete the set behind a record and the next read
  returns a different one, with no write and nothing to invalidate. So whoever builds editing and
  deleting **recomputes by re-reading, never by patching a stored figure** — and the warning US-02
  requires ("what will this record fall to") is the runner-up of the same ranking `/api/sets` already
  asks for, not a new number to keep. Adding an `estimated_1rm` or a `personal_records` table would
  undo this and turn the formula switch into a lie.
