# AGENTS.md — GymLog

Guidance for AI agents working in this repository. Source of truth; `CLAUDE.md` points here.

GymLog is a training log: the user records workouts (date, exercises, sets of reps × weight) and
the app derives estimated one-rep max, weekly tonnage, and personal records. Product contract:
`context/foundation/prd.md`.

## Domain rules that are easy to get wrong

These are not style preferences. Getting any of them wrong produces a number the user will
believe and that will be false. **Every one of them has a unit test; do not change behaviour here
without changing the test and saying so.**

- **1RM estimates are valid for 1–12 repetitions only.** Outside that range, show no estimate —
  never a fabricated one — and exclude the set from record detection. Brzycki (`w × 36 / (37 − r)`)
  divides by zero at 37 reps and goes negative beyond.
- **At exactly 1 repetition the estimate equals the weight lifted.** Brzycki yields this
  naturally; Epley (`w × (1 + r/30)`) does not — it returns `1.033 × w` — so Epley must be pinned
  at `r == 1`.
- **The 1RM formula has exactly TWO implementations and they must agree.** `estimateOneRepMax` in
  `src/lib/services/one-rep-max.ts`, and the `case` expression inside `public.set_estimates`
  (`20260811143000_derive_personal_records_from_surviving_sets.sql`). The SQL copy exists because the
  records list walks every set the account has ever logged, which cannot run in the Worker under the
  10 ms CPU cap. This is the same hazard as `0.45359237` below and **weaker**, because a constant can
  be grepped and a `case` expression cannot: assertion 4 of `tests/integration/personal-records.test.ts`
  is the only thing that would notice them drifting apart. Do not delete it as redundant.
  - **In SQL, `reps::numeric / 30` needs the cast.** `reps` is `smallint`, so `reps / 30` is integer
    division and evaluates to `0` across the entire 1–12 range — Epley silently degenerates to
    `estimate = weight`, with plausible numbers and a green pipeline. Brzycki is safe only by
    accident, which is worse: the defect would surface only for accounts that switch formula.
  - **The two formulas cross at exactly 10 repetitions** (`36/27` and `1 + 10/30` are both `4/3`).
    A set of ten reads identically under either, so it proves nothing about the formula toggle —
    and it is the first thing to suspect when somebody reports that switching does nothing.
- **Records are derived, never stored as trophies.** A record is always the best _surviving_ set,
  recomputed when the underlying sets change. A record may therefore go _down_ after an edit or
  delete, and the user is warned by how much before confirming. Never write a record row that can
  outlive the set that justifies it.
  - Since S-04 they are derived by two views — `public.set_estimates` and
    `public.personal_records` — and **nothing is stored**, which is what keeps S-06's formula change
    a re-derivation instead of a contradiction. See § Access control → the derived-view variant.
  - **The two records have different exclusion rules, deliberately** (owner, 2026-08-10). The
    estimate record takes sets of 1–12 repetitions with `weight_kg > 0`; the heaviest-weight record
    takes **every** set with `weight_kg > 0`, at any repetition count, because "heaviest ever
    handled" is a fact about the load rather than an estimate. US-02's "sets outside the range never
    trigger a record" governs the save-time **announcement**, of which there is exactly one, on the
    estimate record.
- **A personal record is decided on estimated 1RM**, not raw weight. The heaviest absolute weight
  is tracked separately as a second, distinct record.
- **A training week is Monday–Sunday in the user's own timezone** (stored on their profile), not
  UTC. A Sunday-evening session belongs to that week.
- **Zero-weight sets contribute reps but no tonnage. Negative-weight (assisted) sets are excluded
  from 1RM and from record detection**, and contribute zero — never a negative amount — to tonnage.
  - **A zero or negative load requires the exercise's `is_bodyweight` flag** (FR-014). A plank at 0
    is honest; a squat at 0 is a typo that would silently zero out a week's tonnage. **This rule
    cannot be a check constraint** — the answer lives in `exercises.is_bodyweight`, a different
    table, and copying the flag onto the set would be the snapshot forbidden above. It is therefore
    enforced in the endpoint, which already loads the entry to verify ownership, and pre-checked by
    the form through the same `isWeightAllowed` in `src/lib/validation/workout.ts`. One definition,
    two callers.
- **Unit round-trip is exact.** A weight entered in lb and read back in lb must be the number the
  user typed. Rounding or conversion must never create or erase a record.
  - **The storage shape is what makes that true, not a precision argument.** `sets` holds `weight`
    exactly as typed, `weight_unit` as it was typed in, and a **generated** `weight_kg` derived from
    both. Read `weight` for anything shown back to the user; read `weight_kg` for every comparison
    and every total. **Never write `weight_kg`** — Postgres refuses a non-DEFAULT value for a
    generated column, and the generated types cannot express that, so they list it as optional on
    Insert.
  - **The conversion factor `0.45359237` has exactly two copies and they must agree**: the
    generated column in `20260811005248_create_workout_log_with_row_ownership.sql` and `KG_PER_LB`
    in `src/lib/services/set-display.ts`. A third, rounder one written elsewhere makes two answers
    possible for the same set.
  - **The stored unit comes from `profiles.weight_unit` on the server, never from a request body.**
    A client that could name the unit could store `100` marked as pounds while the user typed
    kilograms, and every figure derived from `weight_kg` would be wrong afterwards.
- **Every exercise has exactly one primary muscle group**, so per-group tonnage sums exactly to
  the week's total. Never invent weighted multi-group splits.
  - **The groups are exactly six: `legs`, `back`, `chest`, `shoulders`, `arms`, `core`** (owner,
    2026-08-10). Do not add a seventh without asking — glutes and a biceps/triceps split were
    both considered and declined. Adding one later is cheap; merging or removing one means
    re-tagging every exercise and rewriting every historical per-group figure.
  - **A multi-joint lift is filed under the group the lifter has in mind when they programme it**,
    not under its primary anatomical mover. So **deadlift → `back`** (not `legs`), pull-up →
    `back`, dip → `chest`, overhead press → `shoulders`, squat → `legs`, row → `back`, skull
    crusher → `arms`. The rule exists because the per-group chart's only job is to show whether a
    real training week is unbalanced, and people plan in splits: filing the deadlift anatomically
    makes `back` read as neglected for someone who trains it on pull day. Reasoning and the two
    rejected alternatives: `context/foundation/prd.md` § Open Questions #1.

## Access control is a hard guardrail

No account may reach another account's workouts, exercise entries, or sets — including by naming
an identifier directly. This is enforced in the database, not only in the UI.

- **Enable RLS on every new table in the same migration that creates it**, with granular
  per-operation, per-role policies. A table without RLS is a defect, not a follow-up.
- Tests for this must assert against **persisted state**, not just the response status code.

### The table template — copy this, do not improvise

Established by `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql` and
proven by `tests/integration/profiles-rls.test.ts`. Every data-bearing table copies it, with
`user_id` in place of `profiles`' `id`:

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
- **`(select auth.uid())`, never bare `auth.uid()`.** The subselect is evaluated once as an
  InitPlan instead of once per row. This is required, not stylistic — see § Cloudflare traps.
- **UPDATE needs both `using` and `with check`.** `using` alone lets a caller rewrite someone
  else's row onto themselves.
- **Grant only what the table actually allows.** `profiles` has _no_ delete policy and _no_ delete
  grant on purpose: deleting it while the account survives leaves a live account with no timezone.
  Copy the delete pair for tables where deletion is a real operation.
- **The policy is the guarantee; `.eq("user_id", user.id)` in the query is the index path.** Later
  tables carry **both**. Without the explicit filter, every read leans on the policy predicate to
  do the filtering, which on `workouts` and `sets` is a full scan under the 10 ms CPU cap — the
  exact trap § Cloudflare traps warns about. (`profiles` is the one table where the unfiltered read
  is honest, because it is a single-row primary-key lookup and the dashboard's demonstration is
  precisely that RLS returns one row.)

### The shared-catalogue variant — when some rows belong to everybody

`public.exercises` holds two kinds of row in one table: a **seeded catalogue** every signed-in
account reads and none may write, and **custom rows** private to their owner. The difference is one
nullable column, and **only the select policy changes**:

```sql
user_id uuid references auth.users (id) on delete cascade,  -- NULL = seeded, shared

create policy "<t> are selectable when seeded or owned" on public.<t>
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
```

The insert, update and delete policies stay **exactly** as the template above — and understanding
why is the point of this section. On a seeded row `user_id` is null, so `(select auth.uid()) =
user_id` evaluates to `NULL`, not `TRUE`, and **a policy admits a row only on `TRUE`**. The ordinary
owner check therefore makes the shared rows unwritable by everyone without ever naming them.

- **That protection is invisible in the policy text**, which is what makes it dangerous. Anyone
  "simplifying" the insert policy with `coalesce(user_id, auth.uid())` or `is not distinct from`
  hands every account write access to the catalogue every other account reads, and no other test
  would notice. `tests/integration/exercises-rls.test.ts` assertion 4 exists solely to fail when
  that happens. **Do not delete it as redundant.**
- **`unique (user_id, name)` does not work on a nullable owner.** Postgres treats two `NULL`s as
  distinct, so it would admit two seeded rows with the same name. Use two partial unique indexes —
  one `where user_id is null`, one `where user_id is not null` — over `lower(name)`, since a name
  differing only in case is the same exercise to somebody typing on a phone.
- **Use this variant only when rows are genuinely shared.** `workouts`, `exercise_entries` and
  `sets` are not: their `user_id` is `not null` and they take the plain template — plus the
  composite key in the next section, because they hang off each other.

### The nested-ownership variant — when a row hangs off another owned row

**The four-policy template does not protect a nested record, and nothing in the policy text says
so.** Every policy here reads `(select auth.uid()) = user_id` **on the row in front of it and
nothing else**. So an account inserting an `exercise_entries` row with **its own** `user_id` and
**somebody else's** `workout_id` passes the insert policy — the policy never looks at the parent —
and the result is a row grafted onto another account's workout, invisible to both of them.

That is not theoretical. Replacing the key below with a plain `references workouts (id)` in
`gymlog-test` let account B attach a row to account A's workout, and **the row persisted**:
restoring the key failed until it was deleted by hand.

A trigger would close it. A **composite foreign key** closes it declaratively, and is what this
repository uses:

```sql
-- parent: redundant against the primary key, and present solely as the child's FK target
unique (id, user_id)

-- child: carries its own user_id AND references the parent BY OWNER
foreign key (workout_id, user_id) references public.workouts (id, user_id) on delete cascade
```

The graft now looks for a parent row owned by the grafter and does not find one. `sets` does the
same against `exercise_entries (id, user_id)`. The duplicate index on the parent is the price and it
is cheap.

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

### The derived-view variant — when the read is a view rather than a table

`public.set_estimates` and `public.personal_records` (S-04) derive personal records from the sets
that survive. A view has **no RLS of its own**: it is protected — or not — by which role its
underlying relations are checked as.

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
  safe ones. There is no error and no warning; the rows simply arrive.
- **Only `select` is granted.** A view over aggregates is not writable and nothing should imply it is.
- **The flag is per view and is NOT inherited — but the two views here are not equally protected by
  it, and that was measured rather than assumed.** Removing it from `set_estimates` leaks
  immediately and assertion 2 of `tests/integration/personal-records.test.ts` fails. Removing it
  from `personal_records` alone changes nothing observable, because every row that view emits is
  drawn through `set_estimates`, whose own flag hands the decision back to the real caller partway
  down the chain. **No assertion can catch that second case** — `authenticated` has no `pg_class`
  access through PostgREST. The flag stays anyway: point `personal_records` at `public.sets`
  directly — an edit somebody will plausibly make "for performance" — and it becomes the only thing
  standing between one account and another's log. Treat it as a tripwire for a human reviewer.
- **The explicit `.eq("user_id", …)` still belongs on every read of a view**, for the reason it
  belongs on a table: the policy is the guarantee, the filter is the index path.
- **Generated types make every view column nullable.** `supabase gen types` cannot prove not-null
  through a view. Narrow once, in the service (`src/lib/services/records.ts`), so the accident stays
  out of the endpoints and the pages.
- **A view is the shape that keeps a derived number from being stored, and that is the point.**
  There is no record column, no record row and no cache anywhere: delete the set behind a record and
  the next read simply returns a different one, with no write and nothing to invalidate. So whoever
  builds editing and deleting **recomputes by re-reading, never by patching a stored figure** — and
  the warning US-02 requires ("what will this record fall to") is the runner-up of the same ranking
  `/api/sets` already asks for, not a new number to keep. Adding an `estimated_1rm` or a
  `personal_records` table would undo this and turn S-06's formula change from a re-derivation into
  a lie. See § Domain rules → "Records are derived, never stored as trophies".

## Commands

Scripts, local Supabase setup, and deploy steps: @README.md

The gate, in the order CI runs it: `npm run lint` → `npm run typecheck` → `npm test` →
`npm run test:integration` → `npm run build`. Run all five before claiming a change is done —
the integration check needs network and the test project's credentials, so it is the one that
fails first on a fresh clone. `npm run typecheck` is
`astro check`, which covers `.astro` and `.ts` alike; `npm test` is a single non-interactive
Vitest run, `npm run test:watch` is the local loop.

**There is no local database stack and none is wanted.** Every migration and every data-touching
check runs against a hosted project through `--db-url`. There are **two** projects: `gymlog` is
production and is what the deployed Worker serves; `gymlog-test` is what CI and the integration
check write to.

| Command                    | What it does                                                            |
| -------------------------- | ----------------------------------------------------------------------- |
| `npm run db:status`        | prints **both** migration histories, labelled — this is the drift check |
| `npm run db:push`          | applies every pending migration to **both**, `gymlog-test` first        |
| `npm run db:types`         | regenerates `src/db/database.types.ts` from the **production** schema   |
| `npm run test:integration` | the RLS check against `gymlog-test`; never runs inside `npm test`       |

- **There is deliberately no single-target push.** Advancing one schema and forgetting the other is
  the only way the two drift, so forgetting is not an available mistake. If the production push
  fails after the test push succeeded, the wrapper says so by name; the recovery is to fix the
  cause and re-run `npm run db:push`, which is idempotent per database.
- **The dashboard SQL editor is an emergency path only.** It does not write
  `supabase_migrations.schema_migrations`, so the next `db push` re-applies everything. Recover
  with `npx supabase migration repair --status applied <version>` **against whichever database it
  was used on**, then confirm with `npm run db:status`.
- **`supabase gen types --db-url` needs a container runtime**, which this machine does not have.
  `db:types` therefore goes through the Management API with `--project-id`, authenticated by
  `SUPABASE_ACCESS_TOKEN`. The project ref is derived from `SUPABASE_URL`, so types cannot be
  generated from anything but production.
- `src/db/database.types.ts` is **generated and exempt from ESLint**. Never hand-edit it — not even
  to satisfy a lint rule. Change the schema and regenerate.
- **Since S-04 `db:types` also emits the `Views` block, and every view column comes back `T | null`**
  — Postgres cannot guarantee not-null through a view and the generator will not guess. That is not
  a defect to work around with assertions; narrow it once in the service that reads the view.

Two things README does not cover:

- `npx astro sync` — regenerate types. Run it after changing `astro.config.mjs` or any content
  schema, otherwise type errors will be stale and misleading.
- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and
  `prettier --write` on `*.{json,css,md}`. A commit that fails lint will not land.

## Architecture

Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase auth + shadcn/ui, deployed to Cloudflare.

**Rendering**: `output: "server"` — every page is server-rendered by default. API routes must
export `const prerender = false`.

**Auth wiring** (already built by the starter — read it before adding to it):

- `src/lib/supabase.ts` — Supabase SSR client via `@supabase/ssr`, cookie-based sessions. Reads
  `SUPABASE_URL` / `SUPABASE_KEY` through `astro:env/server` (declared in `astro.config.mjs`
  under `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user onto
  `context.locals.user`, and guards **two** lists. `PROTECTED_ROUTES` sends a request with no user
  to `/auth/signin`; `AUTH_ROUTES` sends a request that _has_ a user away from `/auth/signin` and
  `/auth/signup` to `/dashboard`. **Route protection lives here in both directions**, never in
  per-page checks. `/auth/confirm-email` is deliberately in neither list: with confirmation on,
  `signUp` returns no session, so somebody who has just signed up is not authenticated and the
  guard would never fire on them — bouncing them off the page that explains what to do next would
  be actively unhelpful.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`. **Every one validates through the
  shared schema before touching Supabase, and no provider error text ever reaches a response.** They
  read `context.locals.supabase` — the client the middleware already built — rather than calling
  `createClient` a second time.
  - `src/lib/validation/auth.ts` is the single definition of each credential rule
    (`MIN_PASSWORD_LENGTH`, `MAX_EMAIL_LENGTH`, `MAX_PASSWORD_LENGTH`, `isValidEmail`) **and of
    `AUTH_MESSAGES`, the catalogue of every sentence an auth screen can show**. It **imports
    nothing**, on purpose: both auth forms are `client:load` islands, so everything reachable from
    it is bundled for the browser. Measured — moving the zod schemas into it costs ~59 KB.
  - **The redirect carries a message CODE, never text.** `?error=sign_in_failed`, resolved by
    `messageForCode()` on the page. Passing prose through the query string turns every auth page
    into a phishing kit: `?error=Account+locked.+Call+500-123-456` rendered as a genuine system
    message on our own domain. Not XSS — React escapes it — which is exactly why it was easy to
    miss. An unrecognised code resolves to the generic message, never to the visitor's own words.
  - `src/lib/validation/auth-schemas.ts` builds the zod schemas _from_ those rules and turns
    `FormData` into a parse result carrying a code. **Server-only.** Nothing hydrated may import it.
  - `src/lib/validation/auth-errors.ts` maps a Supabase `AuthError` onto one of those codes,
    matching on `error.code` rather than on its prose (the prose changes between releases; the codes
    are the contract). Every sign-in _identity_ failure collapses to `sign_in_failed`; rate limiting
    is reported honestly because Supabase throttles per IP, not per address, so it is not an
    account-existence oracle. **Validation failures are NOT routed through it** — "password is too
    short" is caused by the user and must stay specific, or the form becomes unusable.
  - `src/lib/validation/auth-outcomes.ts` holds `signUpDestination()` — where a _successful_ signup
    is sent. It is a separate, unit-tested function because the decision is load-bearing and one
    line long: **it reads `session`, never `user`.** With confirmation on, Supabase returns an
    obfuscated `user` and no session, so reading `user` sends unconfirmed accounts to `/dashboard`,
    where the middleware bounces them back — an endless loop on production that a green pipeline
    cannot see. There is a mutation test pinning exactly that.
- **`signup.ts` branches on whether `signUp` returned a session**, which is the real outcome. Do not
  reintroduce a config flag, an env var or `import.meta.env.DEV` for this — all three can disagree
  with what the Supabase project is set to right now, and that is exactly the bug S-01 removed.
- Pages: `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/pages/dashboard.astro`.
  `confirm-email.astro` is unconditional: it is reached only when a confirmation email is genuinely
  on its way.

## Conventions

- **Path alias** `@/*` → `./src/*`.
- **Astro components for static content and layout; React only where interactivity is needed.**
- **Tailwind classes**: use `cn()` from `@/lib/utils`. Never concatenate class strings by hand.
- **shadcn/ui** lives in `src/components/ui/` ("new-york" variant). Add with
  `npx shadcn@latest add [name]`.
- **API routes** export uppercase `GET` / `POST`; validate every input with zod.
- **Migrations**: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- **React**: no Next.js directives (`"use client"` and friends). Hooks go in
  `src/components/hooks/`.
- **Business logic** goes in `src/lib/services/`, shared entity and DTO types in `src/types.ts`.
  Keep the 1RM / tonnage / record calculations in plain, dependency-free functions so they stay
  directly unit-testable.

## Testing

- **Unit tests are the primary defence for the domain rules above.** Cover the boundaries
  explicitly: 1-rep sets, the 12-rep edge, zero and negative loads, kg↔lb round-trip, week
  boundaries across timezones.
- **Unit tests run on Vitest and live beside the code** as `src/**/*.test.ts` (`vitest.config.ts`
  at the repository root). Import the subject through the `@/` alias, and import `describe` / `it` /
  `expect` from `"vitest"` — globals are off on purpose.
- **The harness deliberately does not load Astro's Vite pipeline.** Anything under test must not
  import an `astro:*` virtual module (`astro:env/server` and friends) — it will fail to resolve.
  That is the guardrail that keeps the domain calculations plain and dependency-free.
- **Integration checks that touch stored data live in `tests/integration/`**, under
  `vitest.integration.config.ts`, run by `npm run test:integration` — never by `npm test`, whose
  include glob is `src/**` so it cannot match them. Keep it that way: a network-dependent test
  inside `npm test` makes the whole gate flaky and untrustworthy.
  - They run against **`gymlog-test` only**, with that project's publishable key. Never a
    `service_role` key — a check that bypasses RLS proves nothing — and never a production
    credential, so the suite is _incapable_ of reaching production rather than merely disinclined.
  - **Assert against re-read rows.** Every negative assertion is paired with a read back as the
    row's owner: the failure mode worth catching is a caller told "nothing happened" while the
    write landed.
  - **Fixture discipline**: reset the fixture rows in `beforeAll`, write run-unique values, restore
    in a `finally`. Shared rows plus an interrupted run is how a suite starts failing for reasons
    unrelated to the code, repairable only by hand-written SQL.
  - **Auth flows are covered in `tests/integration/auth-flows.test.ts`**, which creates its own
    account per run (`s01-signup-<run>@gymlog-test.dev`) rather than reusing the RLS suite's
    `rls-owner-a/b` — a signup test must own the account it asserts about. Two of its assertions
    look redundant and are not:
    - **"a fresh signup returns a session"** is the tripwire for email confirmation being switched
      on for the wrong project. It is the only automated signal that would catch it; the other
      outcome — production left unprotected — is silent.
    - **"an address with no account is indistinguishable from a wrong password"** compares the
      provider's `status`, `code` _and_ `message` across both cases. Asserting only that both fail
      would pass against a real account-existence oracle sitting underneath a neutral message.
- **E2E locators**: `getByRole` / `getByLabel` / `getByText` first. `getByTestId` only when
  accessibility attributes are genuinely ambiguous. Never CSS selectors, XPath, or DOM structure.
- **Never `page.waitForTimeout()`.** Wait on state: `toBeVisible()`, `waitForURL()`,
  `waitForResponse()`.
- **Every test is independent**: its own setup, action, assertion, and cleanup. Use unique ids
  (timestamp suffix) so parallel runs and re-runs cannot collide.
- DOM snapshots are the default for E2E; vision is a supplement for visual-only risks. For pixel
  regression prefer deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel).

## Environment

Node version, secrets and deployment: @README.md. **Never commit a real key** — `.env` and
`.dev.vars` are gitignored and must stay that way.

`.env` carries **eight** keys. Which project each belongs to matters more than the values:

| Key                                      | Project       | Used by                                      |
| ---------------------------------------- | ------------- | -------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_KEY`           | `gymlog`      | the app, locally and deployed                |
| `SUPABASE_DB_URL`                        | `gymlog`      | `db:push` / `db:status` only                 |
| `SUPABASE_ACCESS_TOKEN`                  | account-wide  | `db:types` only                              |
| `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` | `gymlog-test` | the integration check                        |
| `SUPABASE_TEST_DB_URL`                   | `gymlog-test` | `db:push` / `db:status` only                 |
| `GYMLOG_TEST_PASSWORD`                   | `gymlog-test` | the integration check's two fixture accounts |

- **`.env` is owner-edited.** Agent file tools are denied `Read(./.env)` in `.claude/settings.json`,
  so any step that needs a new key must be handed to the owner or it silently cannot be done.
  `.env.example` is _not_ denied and documents every key with placeholders.
- **No test-project credential and no database URL ever becomes a Worker secret.** The Worker holds
  exactly `SUPABASE_URL` and `SUPABASE_KEY`. A running application has no business holding a
  database password, and no business being able to reach the test project.
- Repository secrets are five: the production pair (build-time) plus `SUPABASE_TEST_URL`,
  `SUPABASE_TEST_KEY` and `GYMLOG_TEST_PASSWORD` for the integration step. **CI never holds a
  production database credential** — migrations are applied by hand from the machine, deliberately,
  so no merge can rewrite the schema the owner trains against.
- **Supavisor caches credentials after a database password rotation.** For a few minutes the _old_
  password still works while the _new_ one is rejected (`SQLSTATE 28P01`). Both signals at once
  look exactly like "the owner did not confirm the reset" and it is not that. Poll every 60 s
  before concluding anything.

### The two projects differ on email confirmation, deliberately

**`gymlog` has Confirm email ON. `gymlog-test` has it OFF.** This is the concrete return on running
two projects, and making them uniform in either direction breaks something:

- **Turning it OFF for `gymlog`** lets anybody create an account on an address they do not own —
  the thing FR-001 and US-04 exist to prevent.
- **Turning it ON for `gymlog-test`** breaks `npm run test:integration` immediately, because
  `signUp` stops returning a session and both suites depend on bootstrapping accounts without an
  inbox. `auth-flows.test.ts`'s first assertion exists to fail loudly the moment this happens.

Read the current state instead of trusting this paragraph — no dashboard needed:

```bash
node -e "process.loadEnvFile();const t=process.env.SUPABASE_ACCESS_TOKEN;const r=v=>new URL(process.env[v]).hostname.split('.')[0];(async()=>{for(const[l,v]of[['gymlog','SUPABASE_URL'],['gymlog-test','SUPABASE_TEST_URL']]){const c=await(await fetch('https://api.supabase.com/v1/projects/'+r(v)+'/config/auth',{headers:{Authorization:'Bearer '+t}})).json();console.log(l,'Confirm email:',c.mailer_autoconfirm===false?'ON':'off')}})()"
```

`mailer_autoconfirm: false` means confirmation is **on** — the field names the bypass, not the
feature.

**`site_url` is the trap that no test can see.** It is where Supabase sends a user after they click
a confirmation link, and it lives in project config, not in this repository. It shipped as
`http://localhost:3000` — a Next.js port from the starter template, which `astro dev` does not even
use — and stayed wrong until a human clicked a real link during S-01. The failure is silent in
exactly the worst way: **the account is confirmed correctly, the database looks right, every test
passes, and the user sees "site unreachable" and concludes the signup failed.** It is now
`https://gymlog.10x-astro-starter.workers.dev/auth/signin`, with `uri_allow_list` covering that host
and `http://localhost:4321/**`. If the deployed URL ever changes, this must change with it, and the
only way to verify is to click a real link.

Line endings are LF, pinned by `.gitattributes`. Do not disable this: the machine has
`core.autocrlf=true`, and without the pin every file checks out as CRLF and prettier fails all
1022 lines of the repository.

## Cloudflare traps

Deployment target is Cloudflare **Workers**, not Pages: `@astrojs/cloudflare` v13 dropped Pages
support, and `wrangler.jsonc` declares a Workers Static Assets project. The deploy command is
`wrangler deploy`; `wrangler pages deploy` does not read this config shape.

- **Missing secrets fail silently, not loudly.** `src/lib/supabase.ts` returns `null` when
  `SUPABASE_URL` / `SUPABASE_KEY` are absent, and `src/middleware.ts` then sets
  `locals.user = null`. The app builds, deploys, serves 200s, and nobody can sign in. GitHub
  repository secrets are **build-time only** — the Worker needs its own
  `wrangler secret put`. No pipeline can catch this; check it by signing in against the
  deployed URL.
- **`astro dev` already runs the real workerd runtime** (adapter v13 bundles
  `@cloudflare/vite-plugin`). Do not add a `wrangler dev` step — it is legacy for this stack, and
  `platformProxy` was removed.
  - **It reads its Supabase credentials from `.dev.vars`, which points at PRODUCTION, and a
    process-env override does not displace them.** So the dev server cannot be aimed at
    `gymlog-test`, and any scripted check that signs in and writes rows would be writing them into
    the database the owner trains against. Verify write paths by calling the exported handlers from
    an integration suite instead (`tests/integration/workout-endpoints.test.ts` is the pattern);
    reserve the dev server for read-only probes and for a human clicking through.
- Adapter v13 also removed `Astro.locals.runtime` and `cloudflareModules`, and flipped
  `imageService` to default `cloudflare-binding`. Guidance written for v12 or earlier is wrong.
- **The Workers Free plan caps CPU at 10 ms per invocation** — a hard kill (Error 1102), not a
  throttle. Weekly tonnage and per-muscle-group rollups must be aggregated in Postgres, not
  looped over every set inside the Worker. Doing it in the Worker passes in week one and fails
  once the log grows.

## Known state

- **Astro is held at 6.x.** Astro 7 resolves the four outstanding `npm audit` advisories but its
  build fails against the Cloudflare adapter (`Could not find the prerender entry point`),
  reproduced on 7.1.6 and 7.2.0. Do not "helpfully" bump it; see
  `context/changes/bootstrap-verification/verification.md` for the full record.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the integration check (against
  `gymlog-test`) and build, in that order, on every push and PR to `main`. It carries a
  `concurrency` group so two runs cannot race the shared fixture rows. The browser test is not
  wired yet.
- **Five tables exist.**
  - `public.profiles` — one row per account, created by a trigger on `auth.users` and backfilled.
  - `public.exercises` — the catalogue: **38 seeded rows** with `user_id is null`, readable by every
    account and writable by none, plus custom rows private to their owner (see § Access control →
    the shared-catalogue variant).
  - `public.workouts` → `public.exercise_entries` → `public.sets` — the training record, three
    levels deep, added by S-03. Every one carries its own `user_id` **and** a composite foreign key
    to its parent's `(id, user_id)` (see § Access control → the nested-ownership variant).
    `performed_on` is a `date` the user states, not an instant; `exercise_id` carries
    `on delete restrict`, so **an exercise with logged history can no longer be deleted at all** —
    whoever builds catalogue editing will meet that.
  - Reachable at `/workouts` and `/workouts/[id]`, written through `/api/workouts`,
    `/api/exercise-entries` and `/api/sets`.
- **Two views, added by S-04** — the first database objects here that are not tables.
  `public.set_estimates` is one row per set with its estimated 1RM under the row owner's own
  formula; `public.personal_records` is one row per exercise the account has logged, with the best
  estimate and the heaviest weight, each backed by the set that still holds it. Both
  `security_invoker = true` (see § Access control → the derived-view variant), both read-only, and
  **neither stores anything**. Read at `/records` and by `/api/sets`, which returns the record
  verdict beside the set it just saved. An exercise logged only at zero load still gets a row, with
  both records null, so the screen can say why rather than omitting a lift the user logged.
- **Three enums**: `weight_unit`, `estimation_formula`, and `muscle_group` — the last with exactly
  six values, pinned in both directions by `MUSCLE_GROUPS` in `src/types.ts` and a compile-time
  assertion. Add a seventh to the database without adding it there and the build fails, rather than
  the group existing in storage and silently missing from every filter on screen.
