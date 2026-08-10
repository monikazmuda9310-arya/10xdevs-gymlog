# Exercise Catalogue Implementation Plan

> Roadmap item: **S-02** (`context/foundation/roadmap.md` § Slices)
> Change identity: `context/changes/exercise-catalogue/change.md`

## Overview

Give the user something to log against. Today the database holds exactly one table — `profiles` —
so there is no way to name a lift, which means S-03 (the north star) cannot start. This slice adds
the exercise catalogue: 38 seeded exercises readable by every signed-in account, plus a private
catalogue each account can add to, with exactly one primary muscle group and a bodyweight flag per
exercise.

**This slice's hard part is not the CRUD — it is the access-control shape.** Every table so far has
been "this row belongs to one account". This one is "these rows belong to everybody, and those rows
belong to one account", in a single table, and getting it wrong in the permissive direction lets one
account write into the shared catalogue every other account reads.

## Current State Analysis

Measured against the working tree on 2026-08-10, not recalled.

### What exists

- **One table**: `public.profiles`, created by
  `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql`. It establishes the
  pattern this slice copies and departs from: `revoke all` then explicit grants, one policy per
  operation, all `to authenticated`, `(select auth.uid())` never bare, and a deliberate absence of
  a delete path where deletion would be wrong.
- **Two enums already**: `public.weight_unit` and `public.estimation_formula`. A third enum is
  therefore the established way to express a closed set, not a novelty.
- **`public.set_updated_at()`** exists and is reusable — a new table gets its `updated_at` trigger
  for one line, no new function.
- **`src/types.ts`** derives every entity type from the generated `Database` type and never restates
  a field list by hand. It also carries the compile-time assertion pattern (`MutuallyAssignable` +
  `Assert`) that F-03's review proved must return `false` rather than `never`.
- **The S-01 validation stack** (`src/lib/validation/auth*.ts`): rules in an import-free module,
  zod schemas server-side only, and — the part this slice must copy — **a redirect carries a message
  code, never text**. The forms are `client:load` islands, so anything they import ships to the
  browser.
- **`src/middleware.ts`** guards `PROTECTED_ROUTES` and `AUTH_ROUTES`. A new signed-in-only page is
  one array entry, not a per-page check.
- **`tests/integration/`** holds two suites against `gymlog-test`, both asserting against re-read
  rows rather than status codes.

### What is missing

There is no `exercises` table, no muscle-group type, no service layer for anything but the 1RM
calculation, no page other than `/dashboard`, and no shadcn component beyond `button.tsx`.

### Decisions this slice inherits and must not re-open

Settled by the owner on 2026-08-10, recorded in `context/foundation/prd.md` § Open Questions #1:

- **Six muscle groups**: `legs`, `back`, `chest`, `shoulders`, `arms`, `core`. Glutes and a
  biceps/triceps split were declined.
- **A multi-joint lift is filed under the group the lifter programmes it for**, not its primary
  anatomical mover. Deadlift → `back`, Romanian Deadlift → `legs`. That pair looks like a bug and is
  the rule working correctly.
- **The seed is exactly 38 exercises**, listed with groups and bodyweight flags in the PRD.

## Desired End State

- A signed-in user opens `/exercises` and sees the 38 seeded exercises, filterable by muscle group
  and searchable by name.
- They can add their own exercise with a name, one of the six groups, and a bodyweight flag; it
  appears in their catalogue and in nobody else's.
- **No account can write to the shared catalogue, and no account can see another account's custom
  exercises** — enforced in the database, proven by a test that re-reads as the other account.
- The schema is ready for S-03 to hang `sets` off a single `exercise_id`.

Verify: the five-command gate exits 0; the new integration suite proves both halves of the
visibility rule against persisted state; and `/exercises` on the deployed URL shows 38 exercises to
a signed-in account and redirects a signed-out one.

## What We're NOT Doing

- **Editing or deleting a custom exercise.** Deliberately deferred, and the reason is concrete
  rather than laziness: changing an exercise's muscle group rewrites every historical per-group
  tonnage figure it contributed to (PRD Open Question 2), and **there is no tonnage yet** — it
  arrives in S-07/S-08. A warning that says "this will change numbers you have already seen" cannot
  be written, let alone tested, before those numbers exist. The delete path has the same shape once
  sets reference exercises. Both belong to the slice where the consequence is observable.
- **A `glutes` group, or splitting `arms`.** Declined on 2026-08-10; revisit only with real training
  data showing the `legs` bar swamped by hip thrusts.
- **Full-text search, trigram indexes, or fuzzy matching.** A catalogue is 38 rows plus whatever one
  person adds. `ilike` on an indexed column is the right tool at this scale and stops being it at a
  scale this product does not have.
- **Exercise images, video links, equipment tags, or per-exercise notes.** None appears in FR-011 to
  FR-014.
- **Reordering, favouriting, or archiving exercises.** No requirement.
- **A shadcn component sweep.** Two or three primitives get added as needed; redesigning the UI is
  not this slice's job any more than it was S-01's.
- **Deciding Open Question 2** beyond the schema-level consequence stated below. The UI decision
  waits for the slice that can show it.

## Implementation Approach

Five phases, ordered so the access-control boundary is proven **before** any data is seeded into it
and long before a screen renders it. The failure this ordering guards against is a permissive policy
discovered after 38 shared rows already exist and a page already reads them.

1. **The table and its policies**, with the integration suite that proves both visibility halves.
2. **The seed**, once there is a proven boundary to seed into.
3. **The service layer and the create endpoint.**
4. **The screen**: browse, filter, search, add.
5. **Truth up the documents.**

### Critical Implementation Details

**The visibility rule is one table with a nullable owner, and that is a departure from the AGENTS.md
template — a deliberate one.** `user_id is null` means "seeded, everybody reads it"; a non-null
`user_id` means "private to that account". The alternative — two tables — was rejected because S-03
must hang every set off a **single** `exercise_id` foreign key; two tables would force two nullable
foreign keys plus a check constraint on `sets`, which is the kind of shape that produces a set
belonging to no exercise or to two.

**The write policies need no special case for the shared rows, and this is worth understanding
rather than copying.** `with check ((select auth.uid()) = user_id)` on a row whose `user_id` is
`null` evaluates to `null`, not `true` — and a policy admits a row only on `true`. So the ordinary
owner-check already makes the seeded rows unwritable by anyone, without naming them. The same holds
for `using` on update and delete. **Because that protection is a side effect of three-valued logic
rather than an explicit rule, it must be asserted explicitly in the test suite** — a future
migration that "helpfully" adds `coalesce(user_id, auth.uid())` anywhere would silently open the
shared catalogue to writes, and nothing else would notice.

**Do not store the muscle group on a set when S-03 arrives.** Per-group tonnage must be computed
from the exercise's current group, which is what makes a correction apply to history — consistent
with the domain rule that records are derived from surviving sets and never stored as trophies. This
is the schema-level half of Open Question 2, and it is decided here because S-03's schema depends on
it; the user-facing half (whether to warn before a correction) waits for tonnage to exist.

**`unique` over a nullable column does not do what it looks like.** Postgres treats two `null`s as
distinct, so `unique (user_id, name)` would not stop two seeded rows called "Bench Press". Two
partial unique indexes express the actual rule: one over `lower(name)` where `user_id is null`, one
over `(user_id, lower(name))` where it is not. `lower()` because "bench press" and "Bench Press" are
the same exercise to a person typing on a phone.

## Phase 1: The table and its access-control boundary

### Overview

The schema, the policies, the generated types, and the test that proves the boundary — before any
data exists to be protected.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<timestamp>_create_exercises_with_shared_catalogue.sql` (new)

**Intent**: Create the muscle-group enum and the `exercises` table, and enable RLS in the same
migration that creates the table — `AGENTS.md` is explicit that a table without RLS is a defect, not
a follow-up.

**Contract**:

- `create type public.muscle_group as enum ('legs', 'back', 'chest', 'shoulders', 'arms', 'core');`
  — exactly six, in that order. The order is what `enum` comparison and any future `order by` will
  use, so it is chosen to read as a body does rather than alphabetically.
- `public.exercises` with: `id uuid primary key default gen_random_uuid()`;
  `user_id uuid references auth.users (id) on delete cascade` — **nullable, and that nullability is
  the feature**; `name text not null`; `muscle_group public.muscle_group not null`;
  `is_bodyweight boolean not null default false`; `created_at` / `updated_at timestamptz not null
default now()`; a length check on `name` (1–80 characters).
- `on delete cascade` on `user_id`: deleting an account takes its custom exercises with it, which is
  what S-09 needs. Seeded rows have no owner and survive.
- The `updated_at` trigger reuses the existing `public.set_updated_at()`.
- Two partial unique indexes over `lower(name)`, as described in § Critical Implementation Details.
- An index on `(user_id, muscle_group)` — the catalogue screen filters by group within a caller's
  visible set, and `AGENTS.md` requires the query to carry its own filter rather than leaning on the
  policy predicate under the 10 ms CPU cap.
- RLS enabled; `revoke all from anon, authenticated`; `grant select, insert, update, delete to
authenticated`. **Four policies, all `to authenticated`, `(select auth.uid())` never bare:**
  - select: `using (user_id is null or (select auth.uid()) = user_id)` — the shared half and the
    private half, and the only policy that differs from the template.
  - insert: `with check ((select auth.uid()) = user_id)` — unchanged from the template, and see
    § Critical Implementation Details for why that already forbids writing a seeded row.
  - update: `using` **and** `with check`, both `((select auth.uid()) = user_id)`.
  - delete: `using ((select auth.uid()) = user_id)`.
  - The update and delete pair are granted even though this slice ships no UI for them: the policy
    is the guarantee, and adding the policy later — after rows exist — is a migration nobody will
    remember is needed. The absent UI is scope, not permission.
- A comment on `user_id` stating the null convention in the schema itself, where the next reader
  meets it.
- `notify pgrst, 'reload schema';` — the existing migration ends this way and the schema cache is
  otherwise stale.

#### 2. Apply and regenerate

**Files**: `src/db/database.types.ts` (generated — never hand-edited)

**Intent**: Get the schema onto both projects and the types back into the repository.

**Contract**: `npm run db:push` (test project first, then production — there is deliberately no
single-target push), then `npm run db:types`, then `npm run db:status` to confirm the two histories
match.

#### 3. Shared types

**File**: `src/types.ts`

**Intent**: Expose the new entity through the same derived-from-schema discipline as `Profile`.

**Contract**: `Exercise`, `ExerciseInsert`, `ExerciseUpdate` derived from
`Database["public"]["Tables"]["exercises"]`, and `MuscleGroup` from
`Database["public"]["Enums"]["muscle_group"]`. Also export a `MUSCLE_GROUPS` tuple of the six values
for iteration in the UI, with a compile-time assertion that the tuple and the enum union agree —
using the `MutuallyAssignable` + `Assert` pattern already in this file, which F-03's review proved
must resolve to `false` rather than `never` on mismatch. Without the assertion, adding a seventh
group to the database would leave a filter UI silently missing it.

#### 4. The boundary test

**File**: `tests/integration/exercises-rls.test.ts` (new)

**Intent**: Prove both halves of the visibility rule against persisted state, before there is a seed
or a screen to hide a defect behind.

**Contract**: same shape as `profiles-rls.test.ts` — two accounts from `GYMLOG_TEST_PASSWORD`,
publishable key only, throw rather than skip on a missing variable, run-unique values, restore in a
`finally`. Assertions, each paired with a re-read as the row's owner where it is a negative:

1. An account's own custom exercise is readable by that account.
2. **It is not readable by the other account** — and the other account re-reading its own catalogue
   still sees its own row, so the check is not vacuous.
3. A seeded row (one inserted for the test with `user_id = null`, or the real seed once Phase 2
   lands) **is readable by both** accounts.
4. **An account cannot insert a row with `user_id = null`** — the shared-catalogue write. Assert the
   error, then re-read the shared set and assert the count is unchanged.
5. **An account cannot insert a row owned by the other account.**
6. **An account cannot update a seeded row** — attempt it, then re-read as a different account and
   assert the name is untouched.
7. **An account cannot delete a seeded row**, re-read to confirm it survives.
8. An account can update and delete **its own** row — without this, 4–7 would pass against a
   catalogue nobody can use.
9. An anonymous client has no read path at all: `data` is null and the error code is `42501`.

Assertion 4 is the one that earns its place: it asserts a protection that exists only as a side
effect of `null` comparison, and it is the tripwire for anyone "simplifying" the insert policy.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies to both projects and `npm run db:status` shows identical histories.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- `npm run test:integration` exits 0 and reports **three** files.
- The generated types carry the new table:
  `git grep -n "muscle_group" -- src/db/database.types.ts` returns matches.
- RLS is on and the policy count is four, read from the database rather than the dashboard:
  `select relrowsecurity from pg_class where relname = 'exercises';` returns `t`, and
  `select count(*) from pg_policies where tablename = 'exercises';` returns `4`.

#### Manual Verification:

- Read the migration as the agent planning S-03 tomorrow: is it obvious why `user_id` is nullable
  and what that null means, without reading this plan?

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Seed the 38 exercises

### Overview

The catalogue's content, as a migration, once there is a proven boundary to put it behind.

### Changes Required:

#### 1. The seed migration

**File**: `supabase/migrations/<timestamp>_seed_exercise_catalogue.sql` (new)

**Intent**: Insert the 38 exercises the owner settled on, as shared rows.

**Contract**: a single `insert into public.exercises (user_id, name, muscle_group, is_bodyweight)`
with `null` as `user_id` for every row, taking the names, groups and flags **verbatim** from
`context/foundation/prd.md` § Open Questions #1. `on conflict do nothing` against the partial unique
index, so re-applying the migration to a database that already has it is a no-op rather than an
error — the two projects are pushed separately and a re-run must be safe.

Do not re-derive the assignments. In particular Deadlift is `back` and Romanian Deadlift is `legs`;
that pair is correct and is the clearest demonstration of the assignment rule. Hip Thrust is `legs`.
Dip is `chest`. Face Pull is `shoulders`. Push-Up and Plank carry `is_bodyweight = true` even though
nobody assists them, because the flag is what permits a zero load and a plank logged at weight 0
must not be a validation error.

#### 2. Seed coverage assertion

**File**: `tests/integration/exercises-rls.test.ts` (extend)

**Intent**: Prove the seed landed and is visible to an ordinary account — the property the whole
shared-catalogue design exists for.

**Contract**: two assertions. The count of rows with `user_id is null` visible to a signed-in
account is **38**; and grouping those by `muscle_group` yields the expected distribution
(`legs` 9, `back` 7, `chest` 7, `shoulders` 5, `arms` 6, `core` 4). The per-group counts are what
catch a row assigned to the wrong group in a copy-paste, which a bare total would not.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies to both projects; `npm run db:status` shows identical histories.
- `npm run test:integration` exits 0 with the seed assertions passing.
- Re-running `npm run db:push` is a no-op rather than a duplicate-key error.
- The full gate exits 0.

#### Manual Verification:

- Spot-check five assignments against the PRD table by querying the database, not the dashboard.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: The service layer and the create endpoint

### Overview

Reading the catalogue and adding to it, server-side, with the validation discipline S-01 established.

### Changes Required:

#### 1. The service

**File**: `src/lib/services/exercises.ts` (new)

**Intent**: One place that knows how to read and write the catalogue, so a page and an endpoint
cannot drift in how they query it. `AGENTS.md` puts business logic in `src/lib/services/`.

**Contract**: functions taking an already-built Supabase client (never building one — the middleware
hands one on via `context.locals.supabase`, which S-01's review established as the rule):

- `listExercises(supabase, { search?, muscleGroup? })` → the caller's visible catalogue, seeded and
  own, ordered by name. **Carries `.eq`/`.ilike` filters explicitly** rather than leaning on the RLS
  predicate to filter — `AGENTS.md` § Access control is explicit that the policy is the guarantee and
  the query is the index path.
- `createExercise(supabase, userId, input)` → inserts an owned row and returns it.
- Search is `ilike` with the term escaped for `%` and `_`, so a user searching for "100%" gets a
  literal match rather than a wildcard.

#### 2. Validation

**File**: `src/lib/validation/exercise.ts` (new)

**Intent**: Validate the create input with zod before it reaches Supabase, and keep the rules in one
place shared with the form.

**Contract**: mirrors the S-01 split exactly — an import-free module of rules and message codes that
the hydrated form may import, and the zod schema in a server-only sibling. Rules: name trimmed,
1–80 characters, muscle group one of the six (derived from `MUSCLE_GROUPS`, not restated),
`isBodyweight` a boolean defaulting to false. **New message codes are added to the existing
`AUTH_MESSAGES`-style catalogue pattern, not invented ad hoc** — a redirect or a response carries a
code and the page resolves it, because S-01's review found that passing prose through a query string
turns any page into a phishing kit.

#### 3. The endpoint

**File**: `src/pages/api/exercises/index.ts` (new)

**Intent**: Create a custom exercise.

**Contract**: `POST`, `export const prerender = false`, reads `context.locals.supabase` and
`context.locals.user`; 401-equivalent behaviour if there is no user (the middleware already protects
the page, but an endpoint is reachable directly and must not rely on that). Validates with the
schema, calls the service, and on the duplicate-name unique violation (`23505`) returns the
project's "you already have an exercise with that name" code rather than the provider's text.
Response shape is JSON — this endpoint is called from a React island, not a form post, so the
`formData()` constraint that binds the auth endpoints does not apply here. Say so in a comment: the
next reader will have S-01's `formData()` rule in mind.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- Unit tests cover the validation boundaries: empty name, an 81-character name, a name that is only
  whitespace, an unknown muscle group, and the `%`/`_` escaping in search.
- No provider prose escapes: `git grep -n "error.message" -- src/pages/api/exercises/` returns
  nothing (exits 1 on success — run it alone).
- A scripted POST with a valid session creates a row; a second POST with the same name returns the
  duplicate code, not a 500.

#### Manual Verification:

- A POST from a signed-out session does not create a row — verified by re-reading the table, not by
  the status code.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: The catalogue screen

### Overview

The first screen in this product that is not authentication. Browse, filter, search, add.

### Changes Required:

#### 1. The page

**File**: `src/pages/exercises.astro` (new)

**Intent**: Server-render the catalogue for the signed-in account.

**Contract**: reads `Astro.locals.supabase` and calls the service; passes the result to the island.
Astro component for the page shell and layout, React only where interaction lives — `AGENTS.md`
§ Conventions. Empty state when a search returns nothing, distinct from the (impossible after
Phase 2, but cheap) empty-catalogue state.

#### 2. Route protection

**File**: `src/middleware.ts`

**Intent**: `/exercises` is training data and belongs behind authentication.

**Contract**: add `"/exercises"` to `PROTECTED_ROUTES`. One array entry — not a per-page check.

#### 3. The island

**Files**: `src/components/exercises/ExerciseCatalogue.tsx`, `ExerciseForm.tsx` (new)

**Intent**: Filtering, searching and adding, without a round trip per keystroke.

**Contract**: the list is filtered client-side over the already-rendered catalogue — it is tens of
rows, so a server round trip per keystroke would be slower and would spend Worker CPU the free plan
caps at 10 ms. Group filter is the six values from `MUSCLE_GROUPS`, never a hand-written list. The
add form posts JSON to the endpoint, shows the returned message for a code, and prepends the new
exercise on success without a page reload. Reuse `FormField` and `SubmitButton` from
`src/components/auth/` rather than writing new inputs — they already carry the error and pending
states this form needs.

#### 4. A way in

**File**: `src/pages/dashboard.astro`

**Intent**: The screen must be reachable.

**Contract**: a link to `/exercises`. Nothing more — the dashboard's redesign is not this slice.

### Success Criteria:

#### Automated Verification:

- The full five-command gate exits 0.
- `/exercises` is protected: `git grep -n "exercises" -- src/middleware.ts` returns the entry.
- Signed out, a request for `/exercises` returns 302 to `/auth/signin` — verified by a scripted
  request against the dev server, the same way S-01 verified its redirects.

#### Manual Verification:

- Signed in, `/exercises` lists 38 exercises; the group filter narrows correctly and the counts
  match the seed distribution.
- Search finds "bench" case-insensitively and finds nothing for a nonsense term, showing the empty
  state rather than a blank area.
- Adding an exercise makes it appear immediately, and it is still there after a reload.
- Adding a second exercise with the same name shows the duplicate message, not a crash.
- The screen is usable one-handed on a phone-width viewport — the persona logs from the rack.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Truth up the documents

### Overview

Three documents describe a database with one table and a product with no screens beyond auth.

### Changes Required:

#### 1. Agent instructions

**File**: `AGENTS.md`

**Intent**: Record the shape a later slice would otherwise copy wrongly.

**Contract**: § Access control gains the **shared-catalogue variant** of the table template: when a
table holds both shared and owned rows, `user_id` is nullable, only the select policy differs, and
the write policies need no special case because `auth.uid() = null` is `null` rather than `true` —
with the warning that this protection is invisible unless asserted, and that
`tests/integration/exercises-rls.test.ts` is where it is asserted. § Known state gains the second
and third tables and the enum.

#### 2. Repository README

**File**: `README.md`

**Intent**: The route table stops at `/dashboard`.

**Contract**: add `/exercises` to the routes table.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: § Baseline describes the data layer as one table.

**Contract**: rewrite the Backend/API bullet — three tables, the shared-catalogue policy shape, the
seeded catalogue. Leave the S-02 item's `Status` alone; that belongs to `/10x-implement` and
`/10x-archive`.

### Success Criteria:

#### Automated Verification:

- The shared-catalogue policy shape is documented:
  `git grep -n "shared" -- AGENTS.md` returns a match in § Access control.
- Markdown stays Prettier-clean: `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md`
  exits 0.
- The whole gate is still green.

#### Manual Verification:

- Read `AGENTS.md` § Access control as the agent planning S-03 tomorrow: is it obvious when to use
  the plain template and when the shared variant, and what breaks if the insert policy is
  "simplified"?

**Implementation Note**: This is the final phase. After it passes, the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit tests

`src/lib/validation/exercise.test.ts` — the create-input boundaries: empty and whitespace-only
names, the 80/81-character edge, an unknown muscle group, and the `%`/`_` escaping in the search
term. Pure functions, no `astro:*` imports, so `npm test` stays hermetic.

### Integration tests

`tests/integration/exercises-rls.test.ts` — the access-control boundary and the seed. The suite's
centre of gravity is the four negative assertions, each paired with a re-read as a caller entitled
to see the row: a caller told "nothing happened" while the write landed is the failure mode US-04
names.

**One assertion earns its place beyond the obvious**: that an account cannot insert a row with
`user_id = null`. It protects the shared catalogue through a property nobody wrote down — that
`auth.uid() = null` is `null`, and a policy admits only `true`. A later migration that introduces
`coalesce` or `is not distinct from` into that policy would open the shared catalogue to every
account, and this is the only thing that would say so.

### Manual testing steps

1. Signed out, request `/exercises` — redirected to `/auth/signin`.
2. Signed in, `/exercises` lists 38; each group filter's count matches the seed distribution.
3. Search "bench" — case-insensitive matches; search "zzzz" — empty state, not a blank area.
4. Add an exercise — appears immediately, survives a reload.
5. Add it again — duplicate message, no crash.
6. Sign in as a second account — the first account's custom exercise is absent, the 38 are present.
7. Phone-width viewport: the list and the add form are usable one-handed.

## Performance Considerations

Nothing here approaches the Workers Free 10 ms CPU cap, and the two places it could have are handled
deliberately: filtering and search run **client-side** over a catalogue of tens of rows rather than a
round trip per keystroke, and the list query carries its own `user_id`/`muscle_group` filters so the
planner uses the index instead of leaning on the RLS predicate to scan. The rule that per-group
tonnage must be aggregated in Postgres rather than looped in the Worker belongs to S-07/S-08; this
slice only makes sure the column it groups by exists and is indexed.

## Migration Notes

- **Two migrations, both additive.** No column is dropped, no data is rewritten, nothing existing
  changes shape. `profiles` is untouched.
- **The seed is idempotent** (`on conflict do nothing` against the partial unique index), so pushing
  to the second project — or re-running after a failure — cannot duplicate rows.
- **Deleting an account cascades to its custom exercises** and leaves the seeded catalogue intact.
  S-09 inherits that; it needs no extra cleanup for this table.
- **S-03 depends on a decision taken here**: sets reference `exercise_id` only and never snapshot the
  muscle group, so a later correction applies to history. If S-03 denormalizes the group onto a set,
  Open Question 2 is answered by accident, in the direction nobody chose.
- **Adding a seventh muscle group later** is `alter type ... add value`, which is cheap and does not
  rewrite rows. Removing or merging one is not: it means re-tagging every exercise and recomputing
  every historical per-group figure. That asymmetry is why six was chosen.

## Decisions

Taken during planning on 2026-08-10. **The owner asked for the plan to be written autonomously while
away from the machine**, so the six below were decided by the planner rather than in conversation.
Each states what would have to be true for it to be wrong, so they can be overturned on evidence
rather than re-argued.

| #   | Decision                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **One table with a nullable `user_id`**, not two tables                  | S-03 must hang every set off a single `exercise_id`. Two tables force two nullable foreign keys and a check constraint on `sets` — the shape that produces a set belonging to no exercise or to both. Wrong if S-03 turns out never to reference the seeded catalogue directly, which the PRD gives no reason to expect.                                                      |
| 2   | **Muscle group as a Postgres enum**, not a lookup table                  | Two enums already exist (`weight_unit`, `estimation_formula`), the set is closed at six by an owner decision, and an enum makes the generated TypeScript union exact. Wrong if groups ever become user-editable — which the taxonomy decision explicitly rejected.                                                                                                            |
| 3   | **Edit and delete shipped as policies but not as UI**                    | The policy is the guarantee and adding it after rows exist is a migration nobody remembers. The UI waits because a muscle-group correction rewrites historical per-group tonnage (Open Question 2) and tonnage does not exist until S-07 — the warning cannot be written or tested yet.                                                                                       |
| 4   | **Per-group tonnage will be computed from the exercise's current group** | Consistent with the domain rule that records are derived from surviving sets, never stored as trophies. This is the schema half of Open Question 2 and is decided now only because S-03's schema depends on it. Wrong if the owner decides a correction must apply forward only — in which case S-03 needs a snapshot column, which is why the decision cannot wait for S-07. |
| 5   | **Client-side filtering and search**                                     | A catalogue is tens of rows. A round trip per keystroke would be slower and would spend CPU the free plan caps at 10 ms. Wrong once a catalogue reaches thousands of rows, which one person adding their own lifts will not produce.                                                                                                                                          |
| 6   | **`ilike` with escaped wildcards, no trigram or full-text index**        | Right tool at this scale; a trigram index on 38 rows is cost with no benefit. Wrong at a scale this product does not have.                                                                                                                                                                                                                                                    |

## Open Risks & Assumptions

- **The insert policy protects the shared catalogue by accident of three-valued logic.** It is
  correct, but nothing in the policy text says "seeded rows are read-only". Assertion 4 of the
  integration suite is the only thing standing between a well-meaning simplification and one account
  writing into every other account's catalogue. If that assertion is ever deleted as redundant, the
  protection becomes invisible again.
- **The seed distribution assertion hard-codes six counts.** Adding a seeded exercise later means
  updating the test — deliberate. A seed that changes silently is a catalogue nobody decided on.
- **Decision 4 binds S-03.** If it is overturned after S-03 ships, the fix is a data migration, not
  a code change.
- **`npm run db:push` writes to production.** Both migrations are additive and the seed is
  idempotent, but this is the first slice that puts _content_ into the production database rather
  than structure. A wrong seed is a delete statement away from correct, but it is still a write.
- **Two enums plus a table means `db:types` must run**, and nothing enforces it — the known gap
  recorded in `STATE.md` § Ryzyka #5. A push without a regenerate type-checks against the old types.

## References

- Roadmap item: `context/foundation/roadmap.md` § Slices → S-02
- Product contract: `context/foundation/prd.md` § FR-011, FR-012, FR-013, FR-014, § Open Questions #1
  (the taxonomy, the assignment rule, and the 38-exercise seed table)
- Agent rules: `AGENTS.md` § Access control (the table template this slice departs from), § Domain
  rules (the six groups and the assignment rule), § Conventions, § Testing, § Cloudflare traps
- The policy shape this slice copies: `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql`
- The integration-suite shape this slice copies: `tests/integration/profiles-rls.test.ts`
- The validation shape this slice copies: `src/lib/validation/auth.ts` and its server-only siblings,
  plus `context/archive/2026-08-10-account-access/reviews/impl-review.md` § F1 for why a message code
  travels instead of message text

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The table and its access-control boundary

#### Automated

- [x] 1.1 `npm run db:push` applies to both projects; `npm run db:status` shows identical histories — aa5eb7a
- [x] 1.2 Gate green — lint, typecheck, unit tests, build all exit 0 — aa5eb7a
- [x] 1.3 `npm run test:integration` exits 0 and reports three files — aa5eb7a
- [x] 1.4 Generated types carry the new table — `git grep -n "muscle_group" -- src/db/database.types.ts` — aa5eb7a
- [x] 1.5 RLS on and exactly four policies, read from the database (`pg_class.relrowsecurity`, `pg_policies`) — aa5eb7a

#### Manual

- [x] 1.6 The migration makes the nullable-`user_id` convention obvious without reading the plan — aa5eb7a

### Phase 2: Seed the 38 exercises

#### Automated

- [x] 2.1 `npm run db:push` applies to both projects; histories identical — 2268295
- [x] 2.2 Seed assertions pass — 38 shared rows, and the per-group distribution 9/7/7/5/6/4 — 2268295
- [x] 2.3 Re-running `npm run db:push` is a no-op, not a duplicate-key error — 2268295
- [x] 2.4 Full gate exits 0 — 2268295

#### Manual

- [x] 2.5 Five assignments spot-checked against the PRD table by querying the database — 2268295

### Phase 3: The service layer and the create endpoint

#### Automated

- [x] 3.1 Gate green — lint, typecheck, unit tests, build all exit 0 — 3ce603c
- [x] 3.2 Unit tests cover the validation boundaries and the `%`/`_` search escaping — 3ce603c
- [x] 3.3 No provider prose escapes — `git grep -n "error.message" -- src/pages/api/exercises/` returns nothing — 3ce603c
- [x] 3.4 A scripted POST creates a row; a duplicate name returns the duplicate code, not a 500 — verified in Phase 4 through the browser form instead (201 on create, the duplicate message on retry, including a case-only difference) — 8dab0a4

#### Manual

- [x] 3.5 A POST from a signed-out session creates no row, verified by re-reading the table — 3ce603c

### Phase 4: The catalogue screen

#### Automated

- [x] 4.1 Full five-command gate exits 0 — 8dab0a4
- [x] 4.2 `/exercises` is in `PROTECTED_ROUTES` — 8dab0a4
- [x] 4.3 Signed out, `/exercises` returns 302 to `/auth/signin` — 8dab0a4

#### Manual

- [x] 4.4 Signed in, `/exercises` lists 38 and each group filter's count matches the seed — 8dab0a4
- [x] 4.5 Search is case-insensitive; a nonsense term shows the empty state — 8dab0a4
- [x] 4.6 A added exercise appears immediately and survives a reload — 8dab0a4
- [x] 4.7 A duplicate name shows the duplicate message, not a crash — 8dab0a4
- [x] 4.8 A second account sees the 38 but not the first account's custom exercise — 8dab0a4
- [x] 4.9 The screen is usable one-handed at phone width — 8dab0a4

### Phase 5: Truth up the documents

#### Automated

- [x] 5.1 The shared-catalogue policy shape is documented in `AGENTS.md` § Access control
- [x] 5.2 Markdown Prettier-clean across the three documents
- [x] 5.3 Gate still green

#### Manual

- [x] 5.4 `AGENTS.md` § Access control makes clear when to use the plain template and when the shared variant
