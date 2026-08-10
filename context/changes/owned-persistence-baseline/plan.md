# Account-Owned Persistence Baseline — Implementation Plan

> Roadmap item: **F-03** (`context/foundation/roadmap.md` § Foundations)
> Change identity: `context/changes/owned-persistence-baseline/change.md`

## Overview

Give the project a database schema for the first time, and make the row-ownership guarantee
structural rather than aspirational: a `profiles` table keyed to `auth.users`, with RLS enabled and
granular per-operation, per-role policies written **in the same migration that creates the table**,
plus a check that proves the boundary by reading the stored rows back — not by reading a status code.

This change also settles the working method that every later data slice inherits, because the
machine has no container runtime and none is wanted: **how migrations are applied and how a
data-touching check runs, against hosted projects, with no local database stack.** That is
roadmap Open Question 3, and it is answered here with commands that were verified on this machine
rather than recalled from memory.

**There are two Supabase projects, by owner decision taken 2026-08-09**: `gymlog` (production, the
one the deployed Worker serves) and `gymlog-test` (the one CI and the integration check write to).
Every migration is applied to both by a single `npm run db:push`, which is what keeps them from
drifting. The review that preceded this revision argued for one project; its objection and the
mitigation are recorded in Decision 11.

Nothing about workouts, exercises, sets, records or tonnage lands here. What lands is the shape they
all copy.

## Current State Analysis

Verified against the working tree and against the live network on 2026-08-09. Everything in this
section was measured, not assumed.

### The environments already exist; the schema does not

**Two Supabase projects, both verified today.** Both are Central EU (Frankfurt), free plan, with
email confirmation **off** and signup enabled — `GET /auth/v1/settings` returned 200 for each.

| Project       | Role                              | Ref                    | URL                                        |
| ------------- | --------------------------------- | ---------------------- | ------------------------------------------ |
| `gymlog`      | production; the deployed Worker   | `cdzybmwxtefhbanfytna` | `https://cdzybmwxtefhbanfytna.supabase.co` |
| `gymlog-test` | CI and the integration check only | `nfmrwvevntbzulsmrmel` | `https://nfmrwvevntbzulsmrmel.supabase.co` |

- `.env` now carries **six** keys: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL` (production) and
  `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY`, `SUPABASE_TEST_DB_URL` (test). `.dev.vars`, the Worker
  runtime secrets and the GitHub repository secrets still carry the **production** pair only;
  `gh secret list` shows exactly `SUPABASE_URL`, `SUPABASE_KEY`. Phase 4 adds three more repository
  secrets, all pointing at the test project.
- **`.env` and `.env.example` are outside the implementer's reach.** `.gitignore` covers `.env`, and
  `.claude/settings.json` denies agent file tools `Read(./.env)` and `Read(./.env.*)` — which
  includes `.env.example`. Every step in this plan that changes either file is therefore an **owner
  action**, marked as such where it appears.
- Both keys are **new-format publishable keys** (`sb_publishable_…`), not legacy `anon` JWTs. They
  pass through `@supabase/ssr` and `@supabase/supabase-js` opaquely
  (`context/deployment/deploy-plan.md` § Stage 2).
- Auth works end to end against `https://gymlog.10x-astro-starter.workers.dev` (production project):
  signup → dashboard 200 → signout → dashboard 302 → signin → dashboard 200.
- `supabase/` contains **only** `config.toml` and `.gitignore`. There is no `supabase/migrations/`
  directory and not one application table **in either project**. `config.toml` still carries the
  starter's `project_id = "10x-astro-starter"`, which has never been linked to anything.
- One throwaway account exists in the **production** project's `auth.users` from the deployment
  check: `smoke-1786276093721@gymlog-test.dev`. It cannot be deleted without a `service_role` key
  (`deploy-plan.md`). The test project's `auth.users` is empty — which is why the isolation
  assertion below must be non-vacuous **by construction** rather than by relying on that third row.

### The toolchain

- Supabase CLI **2.113.0**, a devDependency (`supabase@^2.23.4`), reachable as `npx supabase`.
  **Not logged in** — `npx supabase projects list` fails with `LegacyPlatformAuthRequiredError`.
- No Docker, and none wanted. `npx supabase start`, `supabase db reset`, `supabase db diff` and
  `supabase test db` are all permanently unavailable.
- Vitest 4.x is wired (`vitest.config.ts`, `include: ["src/**/*.test.{ts,tsx}"]`, no
  `passWithNoTests`). `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all exist and
  CI gates on all four (`.github/workflows/ci.yml`, single `ci` job).
- ESLint 9 flat config, `strictTypeChecked` + `stylisticTypeChecked` + `eslint-plugin-prettier`.
  Ignores come from `.gitignore` via `includeIgnoreFile` — there is no separate `.eslintignore`.
- `tsconfig.json` includes `**/*`, alias `@/* → ./src/*`. New files anywhere are type-checked with
  no config change.

### The decisive measurements — how migrations get applied here

Four probes, run today:

| Probe                                                                     | Result                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase db push --dry-run --db-url postgresql://…@127.0.0.1:1/postgres` | `Connecting to remote database…` then `ECONNREFUSED`. **No Docker check, no login check, no link check** — `--db-url` is a complete, standalone path. |
| `SUPABASE_DB_URL=… supabase db push --dry-run` (flag omitted)             | `LegacyProjectNotLinkedError: Cannot find project ref`. **The CLI does not read the URL from the environment** — it must be a flag.                   |
| `nslookup db.cdzybmwxtefhbanfytna.supabase.co`                            | **AAAA only** — `2a05:d014:8ef:5900:…`. No A record.                                                                                                  |
| `curl -6 telnet://db.cdzybmwxtefhbanfytna.supabase.co:5432`               | **`Could not resolve host`** — this machine has no usable IPv6 route. The direct connection is unusable here.                                         |
| `curl telnet://aws-1-eu-central-1.pooler.supabase.com:5432`               | **`Connected`** over IPv4 (then times out waiting for a Postgres startup packet, which is the correct behaviour for a raw probe).                     |

`supabase db push`, `supabase migration up`, `supabase migration list` and `supabase gen types` all
accept `--db-url`. So a single connection string unblocks **migrations and type generation
together**, with no `supabase login`, no `SUPABASE_ACCESS_TOKEN`, no `supabase link`, and no Docker.

**Both connection strings are already proven.** `SUPABASE_DB_URL` and `SUPABASE_TEST_DB_URL` are
session-pooler URIs on `aws-0-eu-central-1.pooler.supabase.com:5432`, and
`npx supabase migration list --db-url …` **exits 0 against each**, reporting an empty migration
history. Authentication, host selection and network path are settled facts, not Phase 1 unknowns —
Phase 1 is reduced accordingly (see its Overview). What is still unproven is the **wrapper**, which
does not exist yet.

### Key Discoveries

- **The free-plan direct database host is IPv6-only, and this machine has no IPv6.** Any instruction
  of the form `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` will fail here. The
  working address is the **session-mode Supavisor pooler**, port **5432** (not 6543 — transaction
  mode is unsuitable for DDL), username `postgres.<project-ref>`. Both `aws-0-eu-central-1` and
  `aws-1-eu-central-1` resolve; only one serves a given project, so the string must be **copied from
  the dashboard's Connect dialog, not constructed**. As it happens both projects landed on
  `aws-0-eu-central-1`, but that is an observation about these two, not a rule to construct from.
- **The password must be percent-encoded** in the URI — `supabase db push --help` says so verbatim.
- **`db push --db-url` still maintains the remote migration-history table** (`supabase_migrations.schema_migrations`),
  so skipping `link` costs nothing in bookkeeping. Applying SQL by hand in the dashboard SQL editor
  is the option that _does_ cost bookkeeping — it leaves history out of sync and needs
  `supabase migration repair --status applied <version>` afterwards.
- **npm scripts cannot interpolate a shell variable portably here.** `$VAR` is empty in `cmd.exe`,
  `%VAR%` is literal in `sh`, and the primary shell on this machine is PowerShell. The CLI's own
  entry point is a plain JS file — `node_modules/supabase/dist/supabase.js` (verified: the package's
  `bin` field is `{"supabase":"dist/supabase.js"}`) — so a ~30-line Node wrapper can spawn it with
  `process.execPath` and no shell at all, which also sidesteps Node's post-CVE-2024-27980 refusal to
  spawn `.cmd` shims without `shell: true`.
- **The isolation assertion must be non-vacuous by construction, not by census.** An earlier draft
  leaned on the backfilled `smoke-…@gymlog-test.dev` row to guarantee the table held more rows than
  any one account could see. That row lives in the **production** project and is scheduled for
  deletion (`deploy-plan.md`), while the check now runs against the **test** project, whose
  `auth.users` starts empty — so the premise is false twice over. The replacement, from review
  finding F3: assert that **A sees exactly 1 row, B sees exactly 1 row, and the two ids differ**.
  Those three facts together prove the table holds ≥ 2 rows and that each client sees only its own,
  with no dependency on any third account.
- **`src/lib/supabase.ts` returns `null` when credentials are missing and `src/middleware.ts`
  silently sets `locals.user = null`.** That is the documented silent-failure mode (`AGENTS.md`
  § Cloudflare traps). Every verification step below therefore asserts on data, never on a 200.
- **The middleware already builds a Supabase client on every request and throws it away.** Reusing
  it via `locals` costs nothing and avoids a second client construction per request, which matters
  under the Workers Free 10 ms CPU cap.
- `.gitattributes` pins `* text=auto eol=lf` and the machine has `core.autocrlf=true`. New `.sql`,
  `.ts` and `.mjs` files must be LF. Having the type-generation wrapper write the file itself
  guarantees this on Windows, where a shell `>` redirect would not.

## Desired End State

- `supabase/migrations/<timestamp>_create_profiles_with_row_ownership.sql` exists and is applied to
  **both** hosted projects, tracked in both remote migration histories.
- `public.profiles` holds exactly one row per `auth.users` row, created automatically for every new
  account, carrying the account's training-week timezone, weight unit and estimation formula.
- RLS is enabled on it, with per-operation policies scoped `to authenticated`, `anon` revoked
  outright, and no delete path. This is the shape recorded in `AGENTS.md` for every later table.
- `npm run db:push`, `npm run db:status` and `npm run db:types` work from PowerShell and from Git
  Bash, with no Docker and no `supabase login`. `db:push` and `db:status` address **both** projects
  in one invocation — test first, then production — so the two schemas cannot drift through
  forgetfulness. `db:types` reads the production schema, which is the schema of record.
- `src/db/database.types.ts` is generated and committed; `src/lib/supabase.ts` returns a
  `SupabaseClient<Database>`; `src/types.ts` exposes the `Profile` entity type.
- `npm run test:integration` signs in as two separate accounts **against the `gymlog-test` project**
  and proves — **by reading the stored rows back as their owner** — that neither can read, update,
  insert for or delete the other's row, that an anonymous caller can read nothing, and that an owner
  _can_ update their own row (the check that keeps the suite from passing vacuously against a
  deny-everything table). CI runs it, against the test project only; it never authenticates to
  production.
- The deployed Worker, which serves the **production** project, renders the signed-in account's own
  profile value, so "connected to the deployed instance" is demonstrated rather than asserted.
- `README.md`, `AGENTS.md`, `context/foundation/roadmap.md` and
  `context/deployment/deploy-plan.md` no longer contain statements this change makes false.

Verify: `npm run lint && npm run typecheck && npm test && npm run build` exit 0;
`npm run db:status` shows the migration in the Local and Remote columns of **both** project tables;
`npm run test:integration` passes; and signing in at the deployed URL shows the profile value.

## What We're NOT Doing

Each of these has an owner elsewhere in the roadmap. Naming them is how this change stays a
foundation instead of becoming the product.

- **Workouts, exercise entries, sets, records, tonnage** — S-02 onward. No second table lands here.
- **The sign-in / sign-up UI and the post-sign-in redirect** — S-01. The one page touched here
  (`dashboard.astro`) gains a single read-only value and nothing else.
- **A preferences screen** — S-06 owns _choosing_ the unit, formula and timezone. This change creates
  the columns and their defaults; it builds no form, no API route, no service.
- **Playwright / E2E / browser tests** — Faza 3, `/10x-e2e`.
- **The adversarial cross-account proof at every level of the record, and account deletion** — S-09.
  The check here is deliberately scoped to one table; S-09 repeats it across three.
- **Applying migrations from CI.** Deliberate: it would put database-owner connection strings in
  GitHub secrets and let any merge rewrite the schema of the database the owner trains against.
  Migrations are applied by hand from the machine, to both projects at once. See "Decisions taken
  without the owner".
- **A third environment, or preview deploys.** `context/foundation/infrastructure.md` recommends a
  separate Supabase project for preview URLs; `gymlog-test` is that project when previews arrive.
  Wiring the previews themselves is not this change.
- **Any automated schema comparison between the two projects.** The guarantee is procedural — one
  command pushes both — plus `db:status`, which prints both histories side by side. A structural
  diff would need `supabase db diff`, which needs Docker.
- **A `service_role` key anywhere** — not in `.env`, not in CI, not in the Worker. The isolation
  check must run with the same publishable key a real client holds, or it proves nothing. The cost is
  that the two fixture accounts cannot be deleted programmatically; S-09 cleans them up.
- **Seeding data** (`supabase/seed.sql`) — the seeded exercise catalogue is S-02, and its taxonomy is
  still an open roadmap question.
- **Bumping Astro to 7** — `AGENTS.md` forbids it.

## Implementation Approach

Six phases, ordered so that the tooling every later phase leans on is built and proven first, and so
that each phase is independently committable.

1. **Connect the toolchain** to both hosted databases and prove the wrapper _before_ any SQL exists.
2. **The migration** — table, enums, RLS, policies, profile-creation trigger, backfill.
3. **Types** — generate, commit, and make the client typed so the types are actually load-bearing.
4. **The persisted-state check** — the guardrail's proof, wired into CI.
5. **Prove it on the deployed instance** — the roadmap's outcome says "development, the pipeline and
   the deployed instance"; the first two are covered by phases 1–4, this covers the third.
6. **Truth up the documents** that this change falsifies.

Phase 1 stands alone on purpose, but it is **no longer owner-blocked**: the owner has already
provisioned both projects and placed all six keys in `.env`, and both connection strings were proven
today with `supabase migration list --db-url …` (exit 0, empty history). What Phase 1 now builds and
proves is the **wrapper** — the piece that turns two connection strings into three portable commands
and pushes both databases in one go. Its gate (`npm run db:status` prints two empty histories, one
per project) makes a wiring failure unambiguous instead of surfacing later as a confusing migration
error.

### The working method, decided (roadmap Open Question 3)

**Chosen: `supabase db push --db-url <session-mode pooler URI>`, with the URIs in `.env` and a Node
wrapper supplying them as flags — applied to the test project and then to production, in one
command.**

| Option                                                               | Verdict                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`--db-url` (chosen)**                                              | Verified working path to the CLI, against **both** projects today. No login, no access token, no keyring, no Docker. Two secrets, stored where the project already stores secrets. Same flag serves `gen types` and `migration list`, so one mechanism covers every database operation.              |
| `supabase login` (browser device flow) + `link` + `db push --linked` | Works, but needs **two** owner actions (a browser login and the database password at link time), stores the password in an OS keyring that CI and a fresh clone cannot see, and adds a login that expires. Kept as the documented fallback if the owner prefers not to place the password in `.env`. |
| `SUPABASE_ACCESS_TOKEN` instead of interactive login                 | Solves only the _login_ half. `db push` still needs the database password. Strictly more moving parts than `--db-url` for the same result. Not used.                                                                                                                                                 |
| Dashboard SQL editor, by hand                                        | Works, and is the emergency path. But it does not write `supabase_migrations.schema_migrations`, so the next `db push` re-applies everything; recovering needs `supabase migration repair`. Fallback only, documented in `AGENTS.md`.                                                                |
| Local stack (`supabase start`)                                       | Impossible. No Docker, and none wanted.                                                                                                                                                                                                                                                              |

### Two databases, one push (the drift answer)

The owner's decision to run a separate `gymlog-test` project buys isolation and costs a new failure
mode: a migration applied to one database and forgotten on the other. The review named this as the
strongest argument against splitting — Decision 12's drift detector only works while CI points at
the real schema. **The mitigation is that the two schemas are never advanced separately.**

- `npm run db:push` applies every pending migration to **`gymlog-test` first, then `gymlog`**, in one
  invocation. There is no supported way to push only one; forgetting is not an available mistake.
- **Test first, production second, deliberately.** A migration that fails — bad SQL, a refused
  trigger, a lock timeout — fails on the disposable database, and production is never touched. The
  wrapper stops on a non-zero exit from the first push and does not start the second.
- **If the second push fails**, the databases are genuinely divergent for as long as it takes to fix,
  and the wrapper says so in those words, naming which database is ahead. The recovery is to re-run
  `npm run db:push`: `db push` applies only what the remote history table says is pending, so the
  test push reports "up to date" and the production push applies the missing migration. Hand-editing
  either history, or applying the SQL through the dashboard editor, is not the recovery — that is how
  `supabase migration repair` becomes necessary.
- `npm run db:status` prints **both** histories, labelled. Divergence is therefore visible in one
  command, which is the check to run before believing anything about either schema.
- Types are generated from **production**. It is the schema of record; the test project is its copy.

**How a check avoids disturbing the owner's real training data:** two independent guarantees, and it
only needs one of them. The check authenticates to `gymlog-test` with `SUPABASE_TEST_URL` /
`SUPABASE_TEST_KEY` and has no credential for production at all — not in `.env`, not in CI. And
within that project it signs in as two fixture accounts it owns and touches only rows belonging to
them, which the RLS policy this change installs is what makes structurally true. If that policy ever
breaks, the check fails, which is the point.

## Critical Implementation Details

**The trigger on `auth.users` is the single riskiest line in this change.** Creating a trigger in the
`auth` schema is the pattern Supabase documents, and `postgres` normally has the privilege on a
hosted project — but it is granted, not guaranteed, and a failure here is not cosmetic: a broken
`handle_new_user` makes every signup return `Database error saving new user`. Three mitigations are
built into the design: the function body is a single `insert … on conflict do nothing` that cannot
raise, it is `security definer` with `set search_path = ''` and fully-qualified names, and the
INSERT policy is written such that the application-side fallback (upsert the profile on first
authenticated request) needs **no schema change** if the trigger cannot be created at all. That
fallback is now fully pre-specified — file, function signature and call sites — in Phase 2
§ "Contingency", so hitting it is a decision already taken rather than an improvisation against a
broken signup. Pushing test-first means this risk is discovered on `gymlog-test`, whose signup
nobody depends on, before production sees the statement.

**Order inside the migration matters.** `enable row level security` must come before the policies,
the `revoke`/`grant` pair must come before the policies are relied on, and the backfill `insert`
must come after the table exists but is unaffected by RLS because it runs as the migration role.

**`(select auth.uid())`, not bare `auth.uid()`, inside every policy.** The subselect is evaluated
once as an InitPlan instead of once per row. On a single-row profile lookup it is irrelevant; on the
workout and set tables that copy this shape it is the difference between a scan and a lookup, and
under a 10 ms CPU cap that is not a micro-optimisation.

**The unit suite must stay hermetic.** `vitest.config.ts`'s include glob is `src/**`, and the
integration suite lives in `tests/integration/` — so `npm test` cannot pick it up and no edit to the
existing config is needed. Keep it that way: a network-dependent test inside `npm test` would make
the F-01 gate flaky and untrustworthy.

---

## Phase 1: Connect the toolchain to both hosted databases

### Overview

Establish and prove the one command path that every later phase depends on. Nothing schema-related
happens here; the phase succeeds when the CLI can talk to **both** hosted databases through the
wrapper and reports an empty migration history for each.

**This phase is smaller than it was.** The credential work it originally gated on is done: both
Supabase projects exist, all six keys are in `.env`, and both session-pooler URIs were proven today
with `npx supabase migration list --db-url …` (exit 0, empty history, against each). What remains is
tooling — the wrapper, the scripts, the lint scope and two cosmetic files — and re-confirming the
same result _through the wrapper_, which is new and therefore unproven.

### Changes Required:

#### 1. Owner action — already completed, recorded here so it is not re-litigated

**Status: DONE (2026-08-09). Nothing to ask for.** Both connection strings are present in `.env` and
authenticate.

`.env` carries six keys — `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL` for `gymlog`, and
`SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY`, `SUPABASE_TEST_DB_URL` for `gymlog-test`. Both `*_DB_URL`
values are **session-pooler** URIs (not Direct connection, not Transaction pooler) of the shape
`postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.

The rules that produced them, recorded because they apply again to any future project or password
rotation — and because each is an **owner action**, since `.env` is denied to the implementer's file
tools:

- **Copy the URI from the dashboard's Connect dialog; do not build it.** `aws-0-…` and `aws-1-…`
  both resolve and only one serves a given project.
- **Percent-encode the password** if it contains `@ : / ? # [ ] %` or a space. The CLI requires it.
- The direct-connection URI (`db.<ref>.supabase.co`) is **not** an acceptable substitute: it is
  IPv6-only and this machine cannot resolve it (measured above).
- Neither password is ever committed, echoed into a terminal transcript, or written into a commit
  message or a plan file.

_The `link` fallback is no longer relevant_ and is not offered: it stores one project's password in
an OS keyring, and this change needs two databases addressed in a single command.

#### 2. CLI wrapper

**File**: `scripts/supabase-db.mjs` (new, **LF**)

**Intent**: Pass the connection strings to the Supabase CLI as flags, from `.env`, without depending
on shell variable interpolation — which differs between PowerShell, `cmd.exe` and `sh`, and which the
CLI cannot work around because it does not read `SUPABASE_DB_URL` from the environment (measured).
It also owns the two-database contract: one invocation addresses both projects, so they cannot drift.
And it owns writing the generated types file, so the output is LF on Windows.

**Contract**: `node scripts/supabase-db.mjs <status|push|types>`.

- Loads `.env` via `process.loadEnvFile()` inside a `try`/`catch` — CI has no `.env` and must fall
  through to the real environment.
- Resolves two targets: `test` → `SUPABASE_TEST_DB_URL`, `production` → `SUPABASE_DB_URL`. Exits 1
  with a clear message naming **which** variable is unset if either is missing for the verb being
  run. **Never prints either URL.** The CLI's own connection-error text names host, user and database
  but **not** the password (verified), so inherited stdio is safe and needs no masking; the only
  output the wrapper handles itself is the `types` verb's captured stdout, which it writes to a file
  and never echoes.
- Spawns the CLI with no shell at all, to dodge Node's refusal to spawn `.cmd` shims:
  `spawnSync(process.execPath, [<supabase bin>, ...args], …)`. Resolve `<supabase bin>` with
  `createRequire(import.meta.url).resolve("supabase/package.json")` and its `bin` field rather than
  hardcoding `node_modules/supabase/dist/supabase.js`, so a hoisted or workspace install still works;
  fail with a clear message if it cannot be resolved.
- Verb → behaviour:
  - `status` → `migration list --db-url <url>` for **each** target, stdio inherited, each preceded by
    a one-line banner naming the target (`— gymlog-test —`, `— gymlog (production) —`). Both always
    run, even if the first fails, because the point of `status` is to compare them. Exit code is
    non-zero if **either** failed.
  - `push` → `db push --db-url <url>` for **`test` first, then `production`**, stdio inherited, same
    banners. **Stops if the test push fails** — production is not touched, and the message says so.
    If the production push fails _after_ the test push succeeded, exit non-zero with an explicit
    divergence message: `gymlog-test` is ahead of `gymlog`, re-run `npm run db:push` once fixed (it
    is idempotent — the test push will report "up to date"), and do not apply SQL by hand.
  - `types` → `gen types typescript --db-url <SUPABASE_DB_URL> --schema public` against
    **production only**, stdout **captured** and written to `src/db/database.types.ts` with `\n` line
    endings. Production is the schema of record; `db:status` is what proves the test project matches.
- Propagates the child's exit code (the highest non-zero, where two children ran).

#### 3. Package scripts

**File**: `package.json`

**Intent**: Give the three database operations stable names that CI, the plan's success criteria and
`AGENTS.md` can all refer to.

**Contract**: three new `scripts` keys, no new dependency (`supabase` and `prettier` are already
devDependencies):

- `"db:status": "node scripts/supabase-db.mjs status"` — both projects, labelled
- `"db:push": "node scripts/supabase-db.mjs push"` — both projects, test first
- `"db:types": "node scripts/supabase-db.mjs types && prettier --write src/db/database.types.ts"`
  — production only. `&&` chaining in an npm script is portable across `cmd.exe` and `sh`; a `>`
  redirect is not, which is why the wrapper writes the file and only the formatting is chained.

There is deliberately **no** `db:push:test` or `db:push:prod`. Making single-target pushes easy is
exactly how the two schemas drift; recovery from a half-applied push is re-running `db:push`, which
is idempotent per database.

#### 4. Lint scope

**File**: `eslint.config.js`

**Intent**: Keep an ops script out of a type-checked lint configuration built for application code.
`eslint .` picks up `.mjs`, and `baseConfig` applies `strictTypeChecked` with `projectService` to
every file it sees.

**Contract**: add a global ignores entry for `scripts/**` alongside `includeIgnoreFile(gitignorePath)`.
Do not weaken any rule to accommodate the script.

#### 5. Example environment and local project id

**Files**: `.env.example` (**owner action**), `supabase/config.toml`

**Intent**: Make the new variables discoverable without leaking them, and stop `config.toml` from
claiming to be a different project.

**Contract**: `.env.example` gains commented placeholders for the four keys it does not already
document — `SUPABASE_DB_URL=`, `SUPABASE_TEST_URL=`, `SUPABASE_TEST_KEY=`, `SUPABASE_TEST_DB_URL=`
(and, from Phase 4, `GYMLOG_TEST_PASSWORD=`) — each with a one-line comment naming the project it
belongs to and, for the two DB URLs, the session-pooler shape, with **no real values**. **This is an
owner action**: `.claude/settings.json` denies the implementer's file tools `Read(./.env.*)`, which
matches `.env.example`, so the implementer can neither read nor edit it. The implementer's job is to
hand the owner the exact block to paste and to verify afterwards with `git diff -- .env.example`
(diff output is not blocked, and the file contains no real values).

`supabase/config.toml` — `project_id` becomes `"gymlog"`. That field only namespaces a local Docker
stack we will never run, so the edit is cosmetic; it is included because a stale `10x-astro-starter`
in the file every future agent reads is a trap, not a decoration. Change nothing else in that file.

### Success Criteria:

#### Automated Verification:

- Both connections work and both histories are empty: `npm run db:status` exits 0 and prints **two**
  labelled `Local | Remote | Time (UTC)` tables — `gymlog-test` and `gymlog` — each with **no rows**.
- The wrapper fails loudly, not silently, and names the right variable: with `SUPABASE_TEST_DB_URL`
  unset (run the wrapper directly with the variable cleared from the child environment, so `.env`
  need not be moved), `npm run db:status` exits non-zero with a message naming
  `SUPABASE_TEST_DB_URL`; repeat for `SUPABASE_DB_URL`.
- Neither secret is tracked: `git check-ignore -v .env` prints a `.gitignore` match, and
  `git status --porcelain` shows no `.env`.
- `.env.example` carries placeholders and no values: `git grep -n "SUPABASE_TEST_DB_URL" -- .env.example`
  matches, and `git grep -nE "pooler\.supabase\.com|sb_publishable_" -- .env.example` returns nothing
  (exits 1 on success — run it alone, never `&&`-chained).
- Lint, typecheck, unit tests and build are undisturbed: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build` all exit 0.

#### Manual Verification:

- The two `db:status` tables are visibly labelled and visibly distinct, so a future divergence is
  readable at a glance rather than inferred.
- No terminal output, commit message or plan file contains either password. (The cross-shell check
  lives in Phase 3, on `db:types` — the verb whose behaviour actually differs between shells.)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: The profiles migration — table, RLS, policies, trigger

### Overview

The first migration in the project's history, and the template for every one that follows. It creates
the table, turns RLS on in the same file, writes per-operation policies, guarantees a profile row
exists for every account, and backfills the accounts that already exist.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_profiles_with_row_ownership.sql` (new, **LF**)

**Intent**: Create `public.profiles` with the preferences every derived number in the product depends
on, and make ownership a property of the database rather than of request code.

**Contract**: generate the filename with `npx supabase migration new create_profiles_with_row_ownership`
so the UTC timestamp matches the `AGENTS.md` convention. The SQL is reproduced in full because it is
the shape every later table copies — the policy block in particular is the artifact, not an
illustration.

```sql
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
```

Notes the implementer must not "tidy away":

- `on conflict (id) do nothing` in `handle_new_user` is not defensive noise. It is what makes a retried
  signup incapable of failing, and a raising trigger on `auth.users` breaks signup entirely.
- No `execute` revoke on either function. It was considered and rejected: both return `trigger`, so
  PostgREST cannot call them, and revoking risks the trigger for no gain.
- No `force row level security`. It would subject the table owner to the policies too, which breaks
  the dashboard table editor — the owner's only remaining window into their own data.
- `enum` types rather than `text` + `CHECK` because the generated TypeScript then carries
  `"kg" | "lb"` instead of `string`, in a codebase whose entire risk is getting a domain value wrong.
  The precedent is narrow: enums for closed sets fixed by the PRD; the muscle-group taxonomy (S-02),
  whose contents are still an open roadmap question, should be a lookup table, not an enum.

#### 2. Contingency — if the `auth.users` trigger is refused

Pre-specified so that hitting it is a decision already taken rather than an improvisation against a
broken signup. **Trigger condition**: `db push` refuses `create trigger on_auth_user_created`, or the
manual signup check below returns `Database error saving new user`.

**Action, in order:**

1. Remove the `create trigger on_auth_user_created` statement (and, if the CLI refused it outright,
   `create function public.handle_new_user`) from the migration file **before** it is pushed to
   production; if the test push already applied it, add a follow-up migration dropping the trigger.
   Everything else in the migration — including the backfill and the INSERT policy — stays.
2. **File**: `src/lib/services/profiles.ts` (new). Export
   `ensureProfile(supabase: SupabaseClient<Database>, userId: string): Promise<void>` — a single
   `await supabase.from("profiles").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true })`.
   No schema change is needed: the INSERT policy `with check ((select auth.uid()) = id)` plus the
   `insert` grant already permit an authenticated client to create exactly its own row.
3. **Call sites**: `src/pages/api/auth/signin.ts` and `src/pages/api/auth/signup.ts`, after a
   successful auth call, with the session's user id. Both already construct a client and already hold
   the session.
4. **Explicitly not `src/middleware.ts`.** The middleware runs on every request, and Decision 5's
   whole argument for a trigger is the Workers Free 10 ms CPU cap — moving the write from "once per
   account" to "once per request" is the failure that argument exists to prevent. Once per sign-in is
   the compromise; the hot path stays read-only.
5. **Phase 4 fixture bootstrap** gains one line: after each fixture account signs in (or signs up),
   call `ensureProfile(client, userId)` before the assertions run, since no trigger will have created
   the row.
6. Phase 5's dashboard needs no change — it already renders a fallback for a missing row — but note
   that under this contingency a missing value means "ensureProfile did not run", not "no data yet".

`AGENTS.md` § Conventions puts business logic in `src/lib/services/`, so this file is where it would
have gone anyway; nothing about the contingency is off-pattern.

### Success Criteria:

#### Automated Verification:

- The migration applies to **both** databases: `npm run db:push` exits 0, reports the migration file
  by name **twice** — once under the `gymlog-test` banner, once under `gymlog` — and the test push
  precedes the production one.
- It is recorded remotely in both: `npm run db:status` shows the timestamp in **both** the `Local`
  and `Remote` columns of **both** project tables.
- Re-running is a no-op: a second `npm run db:push` exits 0 and reports no pending migrations for
  either project (proves the history tables are being maintained, which the dashboard SQL-editor path
  would not do).
- The file is LF: `git add` it, then `git ls-files --eol -- supabase/migrations` prints `w/lf` for it.
- Nothing in the app broke: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.

#### Manual Verification:

- In the **production** dashboard table editor, `public.profiles` shows **one row per existing
  account**, including `smoke-1786276093721@gymlog-test.dev` — the backfill worked.
- In the **`gymlog-test`** dashboard table editor, `public.profiles` exists and is **empty** — that
  project has no accounts yet, which is correct, and Phase 4's fixture bootstrap will populate it.
- Every row that exists reads `Europe/Warsaw` / `kg` / `brzycki`.
- The RLS shield icon on `public.profiles` shows RLS **enabled**, with three policies listed, in
  **both** dashboards. Checking only production would leave the check itself running against an
  unprotected table.
- **The trigger works end to end**: sign up a fresh throwaway account at the deployed URL (production
  project), then confirm a new `profiles` row appeared for it. The test project's trigger is
  exercised independently by Phase 4's fixture bootstrap. If signup instead fails with
  `Database error saving new user`, the trigger is the cause — take the Contingency above.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Generated types, a typed client, and the first entity type

### Overview

Make the schema visible to TypeScript, and make the generated types load-bearing rather than
decorative by having the Supabase client consume them.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts` (new, generated, **committed**)

**Intent**: Give every later slice compile-time knowledge of the schema. Committed rather than
generated at build time because CI has no database credentials and must not gain any.

**Contract**: produced only by `npm run db:types`, which reads the **production** schema; never
hand-edited. (If `db:status` shows the two projects at different versions, fix that first — types
generated while divergent describe neither database.) It lives in `src/db/` — not
`src/lib/` — so that a generated file is never mistaken for hand-written code, and not in
`src/types.ts`, which `AGENTS.md` reserves for hand-written entity and DTO types. It must export
`Database` and its `Enums` must include `weight_unit` and `estimation_formula`. If the generated file
fails `strictTypeChecked` lint, add it to the `eslint.config.js` ignores — do **not** hand-edit
generated output to satisfy a lint rule.

#### 2. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: A client that knows the schema, so a misspelt column is a build failure rather than a
runtime `null`.

**Contract**: import `Database` from `@/db/database.types` and parameterise
`createServerClient<Database>(…)`. The return type becomes `SupabaseClient<Database> | null`. The
`null`-on-missing-credentials behaviour is unchanged — it is load-bearing (`AGENTS.md` § Cloudflare
traps) and must not be "fixed" here.

#### 3. Entity types

**File**: `src/types.ts` (new)

**Intent**: The `AGENTS.md` convention location for shared entity and DTO types, which F-01
deliberately deferred until an entity existed. One now does.

**Contract**: derive rather than restate — `Profile`, `ProfileInsert`, `ProfileUpdate` as aliases of
`Database["public"]["Tables"]["profiles"]["Row" | "Insert" | "Update"]`, plus `WeightUnit` and
`EstimationFormula` from `Database["public"]["Enums"]`. No hand-written field lists: a hand-copied
type that drifts from the schema is worse than no type.

### Success Criteria:

**Run `git add src/db/database.types.ts` before the three git-based criteria below.** This is not
optional bookkeeping: the file is untracked when it is first generated, and on an untracked file
`git status --porcelain` always prints `??` (so "empty" can never happen), `git grep` searches
nothing and exits 1, and — worst — `git ls-files --eol` prints **no output and exits 0**, a gate that
reports success while verifying nothing about line endings. Phase 2's criterion 2.4 already stages
before checking; Phase 3 does the same.

#### Automated Verification:

- Generation works and is reproducible: `npm run db:types` exits 0; then, with the file staged,
  running it a second time leaves `git diff --stat -- src/db/database.types.ts` **empty** (the
  regenerated bytes match what was staged).
- The schema is actually in the file: with the file staged,
  `git grep -n "profiles" -- src/db/database.types.ts` returns matches, and
  `git grep -n "brzycki" -- src/db/database.types.ts` returns the enum members.
- The generated file is LF: with the file staged, `git ls-files --eol -- src/db/database.types.ts`
  prints `w/lf` — and prints a line at all, which is itself part of the check.
- The types are load-bearing: `npm run typecheck` exits 0, and a deliberate typo in the table name in
  `src/lib/supabase.ts`'s generic (reverted afterwards) makes it exit 1.
- `npm run lint`, `npm test`, `npm run build` all exit 0.

#### Manual Verification:

- **Cross-shell**: run `npm run db:types` from **both** PowerShell and Git Bash and confirm the file
  is byte-identical (`git diff -- src/db/database.types.ts` empty on the second run) and still
  `w/lf`. This is the verb the wrapper exists for — it captures stdout, writes a file with explicit
  `\n`, and chains `&& prettier --write` through the npm script runner, which is exactly the
  combination that is not portable as a raw shell command. `db:status` and `db:push` only inherit
  stdio and behave identically in both shells.
- `src/types.ts` contains no hand-written column list — every member is derived from `Database`.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: The check that asserts against stored rows

### Overview

The phase this whole change exists for. A Vitest suite, separate from the hermetic unit suite, that
signs in as two real accounts **against the `gymlog-test` project** and proves the ownership boundary
by reading the stored rows back as their owner — never by trusting a status code. It holds no
production credential, so "it might touch the owner's training data" is not a risk it can carry.

### Changes Required:

#### 1. Integration runner

**File**: `vitest.integration.config.ts` (new, root, **LF**)

**Intent**: A second Vitest project for tests that are deliberately not hermetic, kept strictly apart
from `npm test` so the F-01 gate stays fast and offline.

**Contract**: `include: ["tests/integration/**/*.test.ts"]` — outside `src/`, so the existing
`vitest.config.ts` cannot match it and needs no edit. `environment: "node"`, the same
`resolve.alias` `@ → ./src` mapping, `fileParallelism: false` (one shared pair of fixture accounts),
and generous `testTimeout` / `hookTimeout` (network + auth round trips). **No `passWithNoTests`** —
a glob that stops matching must go red, per the F-01 precedent.

Environment loading is the one non-obvious part: Vitest does not read `.env`, and CI supplies real
environment variables that must win over the file.

```ts
try {
  process.loadEnvFile(); // CI has no .env; the real environment is the source there
} catch {
  /* no .env — fall through to process.env */
}
// …
env: { ...process.env },
```

**Do not use `loadEnv`.** It is not exported by `vitest/config` (verified: that module exports only
`configDefaults`, `coverageConfigDefaults`, `defaultBrowserPort`, `defaultExclude`, `defaultInclude`,
`defineConfig`, `defineProject`, `mergeConfig`), and the `vite` package that does export it appears in
`package.json` only inside `overrides` — it resolves today purely by npm hoisting it out of `astro`,
which is precisely the latent-undeclared-dependency defect the previous review caught as `@types/node`.
`process.loadEnvFile()` is available on Node 22.14.0, is already the mechanism the Phase 1 wrapper
uses, and — measured — **does not override variables already present in the environment**, which is
exactly the precedence wanted. One mechanism, zero new dependencies.

#### 2. The isolation check

**File**: `tests/integration/profiles-rls.test.ts` (new, **LF**)

**Intent**: Prove US-04 and `AGENTS.md` § "Access control is a hard guardrail" on the one table that
exists — against persisted state, at the level the database enforces it.

**Contract**: `createClient<Database>` from `@supabase/supabase-js` (already a dependency), pointed at
`SUPABASE_TEST_URL` with `SUPABASE_TEST_KEY` — the **test project's publishable key only**; never
`service_role` (a check that bypasses RLS proves nothing) and never the production URL or key (the
suite must be incapable of reaching production, not merely disinclined to).

_Fixtures._ Two accounts in the **`gymlog-test`** project, `rls-owner-a@gymlog-test.dev` and
`rls-owner-b@gymlog-test.dev`, password from `GYMLOG_TEST_PASSWORD`. `beforeAll` signs each in and
falls back to `signUp` if sign-in fails, so the suite bootstraps itself once and reuses the accounts
forever instead of accumulating junk users. (Email confirmation is off on that project — verified —
so the sign-up path yields a usable session immediately.) Emails are hardcoded (not secret) and
prefixed so S-09 can find them. Each client is constructed with `persistSession: false` and
`autoRefreshToken: false`. The suite **throws** in `beforeAll` if `SUPABASE_TEST_URL`,
`SUPABASE_TEST_KEY` or `GYMLOG_TEST_PASSWORD` is missing — it must never skip its way to green.

_Fixture reset, in `beforeAll`, after both sign-ins._ Each client updates **its own** row back to the
defaults — `{ timezone: "Europe/Warsaw", weight_unit: "kg", estimation_formula: "brzycki" }` scoped
`.eq("id", <own user id>)` — using only the UPDATE policy this migration installs. This is not
tidiness. Without it, a run that dies between assertion 7's write and its restore leaves a fixture
row holding a test value **permanently**, and every later run — local and CI — fails assertion 1 for
a reason unrelated to the code under test, repairable only by hand-written SQL. The reset makes the
suite self-healing and makes assertion 1 test a known state rather than an inherited one. The cost is
that a broken UPDATE policy now surfaces in setup rather than in assertion 7, with a less specific
message; that is the better trade. The reset is an `update`, never an `upsert`: it affects zero rows
if no row exists, so it cannot manufacture the row assertion 1 is there to find — the trigger, not
the setup, is still what has to have created it. (Under the Phase 2 contingency, the bootstrap also
calls `ensureProfile(client, userId)` here, **before** the reset, because no trigger will have
created the row; that is the one configuration in which assertion 1 proves the fallback rather than
the trigger, and the assertion's name should say so if the contingency is taken.)

_Assertions._ Each is independent and restores anything it changes:

1. **The trigger fired** — A reads its own row: exactly one, `id` equals A's user id, defaults are
   `Europe/Warsaw` / `kg` / `brzycki` (guaranteed by the `beforeAll` reset).
2. **RLS filters, and is not merely on — proven by construction** — as A, an **unfiltered**
   `select *` returns **exactly one** row; as B, an **unfiltered** `select *` returns **exactly one**
   row; and the two rows' `id`s **differ**. Those three facts together prove the table holds at least
   two rows _and_ that each client sees only its own — so if RLS were disabled, or the SELECT policy
   widened, the first two would return ≥ 2 and the suite goes red. This replaces the earlier form,
   which depended on a third account existing in the same database: that account lives in production,
   is scheduled for deletion, and is not in the test project at all. Non-vacuity must not rest on a
   row nobody owns.
3. **Naming the identifier directly gets nothing** — as A, `select … eq("id", B.userId)` returns zero
   rows (US-04 verbatim).
4. **A cross-account update does not land** — as A, `update({ timezone: "America/New_York" }).eq("id", B.userId).select()`
   returns zero rows; then **as B**, re-read B's row and assert `timezone` and `updated_at` are
   unchanged. The second half is the persisted-state assertion; the first half alone would be a
   status-code check.
5. **`WITH CHECK` holds** — as A, insert a row with a random UUID: rejected with Postgres code
   **`42501`** (`expect(error?.code).toBe("42501")`). The random UUID is deliberate: inserting B's id
   could fail on the primary key (`23505`) and prove nothing about the policy.
6. **There is no delete path** — as A, delete A's own row: `expect(error?.code).toBe("42501")` (with
   no DELETE grant PostgREST raises; it does **not** silently affect zero rows), then re-read as A and
   assert the row is still there. Then as A, delete B's row — same `42501` — and re-read as B: still
   there.
7. **The owner can still write, and the write is this run's** — as A, update A's own `timezone` to a
   **run-unique** value (`` `Test/Run-${runId}` `` where `runId` is generated once per run from a
   timestamp plus a random suffix; the column has a 1–64 length check and, by Decision 9, no IANA
   validity check, so this is legal), read it back as A, and assert the stored value equals what
   _this run_ wrote — not merely "something other than the default", which a stale value from a
   previous crashed run would also satisfy. **Restore `Europe/Warsaw` in a `finally`**, so an assertion
   failure still leaves the fixture clean; the `beforeAll` reset is the backstop for the cases a
   `finally` cannot cover (process kill, timeout at the wrong moment). Without this assertion, 3–6
   would all pass against a table nobody can use.
8. **No unauthenticated read path** — a client built from the test project's publishable key with no
   session gets `data === null` (**not** `[]` — with `revoke all … from anon`, PostgREST returns an
   error and no rows, so `expect(data).toBeNull()`) and `expect(error?.code).toBe("42501")` from
   `select * from profiles` (NFR § "no unauthenticated read path to any training data").

#### 3. Script and pipeline

**Files**: `package.json`, `.github/workflows/ci.yml`, `.env.example` (**owner action**)

**Intent**: Make the guardrail run without anyone remembering to run it. A check that only runs by
hand is not a guardrail — the F-01 lesson.

**Contract**: `"test:integration": "vitest run --config vitest.integration.config.ts"`. CI gains one
step between `npm test` and `npm run build`, with `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` and
`GYMLOG_TEST_PASSWORD` in its `env:` block — **not** `SUPABASE_URL` / `SUPABASE_KEY`, which stay
where they are on the `typecheck` and `build` steps. All three are new repository secrets; the
existing production pair is untouched.

- `SUPABASE_TEST_URL` = `https://nfmrwvevntbzulsmrmel.supabase.co`, `SUPABASE_TEST_KEY` = the test
  project's publishable key. Set with `gh secret set` (`gh` is already authenticated; `gh secret list`
  currently shows only `SUPABASE_URL` and `SUPABASE_KEY`).
- `GYMLOG_TEST_PASSWORD` is a fresh random password the **owner** generates and places in `.env`
  (the implementer's file tools cannot write `.env`), then sets with
  `gh secret set GYMLOG_TEST_PASSWORD`. It is never the password of any real account and never
  reused from production.
- `.env.example` gains a commented `GYMLOG_TEST_PASSWORD=` placeholder — owner action, as in Phase 1.

**Concurrency guard.** Add at workflow level in `ci.yml`:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: false
```

`fileParallelism: false` serialises files _within_ a run and does nothing across runs; two overlapping
pipeline runs would share the same two fixture rows, and run X's assertion 7 (A's timezone mutated)
would race run Y's assertion 1 (A's timezone must be the default). `cancel-in-progress: false`
matters as much as the group: cancelling a run mid-suite is exactly how a fixture row gets left
holding a test value. Two residual gaps, both accepted because the `beforeAll` reset makes them
self-repairing rather than fatal: a local run concurrent with a CI run, and a `pull_request` run
(`refs/pull/N/merge`) concurrent with a `push` run on `main` (`refs/heads/main`), which are different
refs and therefore different groups.

Two consequences, both accepted deliberately: CI writes to `gymlog-test` and never authenticates to
production, so the blast radius of a bad test is a project with no real data in it; and CI traffic
keeps **the test project** from auto-pausing after ~1 week of inactivity — while production no longer
gets that free heartbeat, which is now a live risk (see Open risks).

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` exits 0 and reports **8 passing** test cases in one file. (If the
  implementer splits assertion 6's two halves into separate `it()` blocks, update this number in the
  same commit rather than letting the criterion drift.)
- It fails loudly without credentials: run it with `GYMLOG_TEST_PASSWORD` cleared from the child
  environment; the run exits non-zero with a message naming the missing variable — it does **not**
  report "0 tests" or skip. Repeat with `SUPABASE_TEST_URL` cleared.
- It never touches production: `git grep -nE "SUPABASE_URL|SUPABASE_KEY" -- tests/ vitest.integration.config.ts`
  returns nothing (exits 1 on success — run it alone, never `&&`-chained).
- It is not in the unit suite: `npm test` output does **not** name `profiles-rls.test.ts`, and still
  exits 0 with no network access.
- `npm run lint` and `npm run typecheck` exit 0 with the new files present.
- The pipeline step exists in order: `git grep -n "run:" -- .github/workflows/ci.yml` lists
  `npm ci`, `npx astro sync`, `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run test:integration`, `npm run build`.
- The concurrency guard exists: `git grep -n "cancel-in-progress" -- .github/workflows/ci.yml`
  returns a match, and the group is `ci-${{ github.ref }}`.

#### Manual Verification:

- The GitHub Actions run for this change is green and its step list visibly includes
  `npm run test:integration`.
- The two fixture accounts appear once each in the **`gymlog-test`** dashboard's Auth users list —
  the suite bootstraps them once and does not create a new pair per run — and **neither appears in
  the production project's** Auth users list.
- After a run, both fixture rows read `Europe/Warsaw` / `kg` / `brzycki` in the `gymlog-test` table
  editor: assertion 7's `finally` restored what it wrote.
- **Red proof — safe form, on the test project only.** In the **`gymlog-test`** SQL editor run
  `create policy "tmp_red_proof" on public.profiles for select to authenticated using (true);`, run
  `npm run test:integration`, and confirm it fails on assertion 2 (A's unfiltered select returns 2
  rows, not 1). Then run `drop policy "tmp_red_proof" on public.profiles;` and re-run to confirm
  green. Three properties make this acceptable where the earlier form was not: it runs on a project
  with no real data and no public traffic; **RLS itself is never switched off**, so writes and deletes
  stay protected throughout and an interrupted revert leaves a widened read on two fixture rows
  rather than an unprotected table; and production is untouched. **Never** `alter table … disable row
level security` — not on either project. The suite is meaningful without this proof too, because
  assertion 2 is non-vacuous by construction.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Prove the deployed instance reads the database

### Overview

F-03's outcome names three environments — development, the pipeline, and the deployed instance.
Phases 1–4 cover the first two. This one covers the third with the smallest honest demonstration: the
existing protected page renders a value that can only have come from the new table, read under the
signed-in account's own session.

**The deployed Worker serves the production project.** Its runtime secrets are `SUPABASE_URL` and
`SUPABASE_KEY` for `gymlog`, and nothing in this phase changes that. The Phase 4 fixture accounts do
**not** exist here — they were created in `gymlog-test` — so the manual checks below use fresh
throwaway accounts signed up at the deployed URL, which also re-exercises the production trigger.

### Changes Required:

#### 1. The client on `locals`

**Files**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: The middleware already builds a Supabase client per request and discards it. Pages need
one. Building a second per request is waste under a 10 ms CPU cap, and it would duplicate the
cookie-plumbing that is easy to get subtly wrong.

**Contract**: `App.Locals` gains `supabase: SupabaseClient<Database> | null` (import the type; do not
restate it). The middleware assigns the client it already created — including the `null` case, which
must stay `null` rather than throw, because that is the documented missing-credentials behaviour. No
change to `PROTECTED_ROUTES` and no new redirect logic; that is S-01's.

#### 2. Dashboard reads the profile

**File**: `src/pages/dashboard.astro`

**Intent**: Demonstrate an end-to-end read of an application table through RLS from the deployed
Worker — the only thing that distinguishes "the database is connected" from "the credentials are set".

**Contract**: select the signed-in account's own `timezone` via `Astro.locals.supabase` and render it
beside the existing email line. Use `.maybeSingle()`, not `.single()`, and render a plain fallback
when the row is absent — a missing profile must read as a missing value, not a 500. No query filter
by user id is needed and none should be added: the point is that **RLS** returns exactly one row.
Everything else on the page, including the sign-out form, is untouched. S-01 will rework this page;
this addition is deliberately one value.

#### 3. Redeploy

**Intent**: Put the change on the public URL so the manual check below is meaningful.

**Contract**: `npm run build && npx wrangler deploy`. No secret changes — the Worker already holds
the production `SUPABASE_URL` and `SUPABASE_KEY`, and nothing here adds a runtime variable.
`SUPABASE_DB_URL`, `SUPABASE_TEST_DB_URL`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` and
`GYMLOG_TEST_PASSWORD` must **never** be added as Worker secrets: the running application has no
business holding a database password, and no business being able to reach the test project.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build` all
  exit 0.
- `npm run build` succeeds _without_ either `*_DB_URL` present — the application must not have
  acquired a build-time dependency on the database. Verify by running the build with both variables
  cleared from the child environment, or by confirming the CI build (which has no such secret) is
  green.
- The Worker holds no test-project or database secret: `npx wrangler secret list` names
  `SUPABASE_URL` and `SUPABASE_KEY` and nothing else.
- The Worker deploys: `npx wrangler deploy` exits 0 and prints a new version id.

#### Manual Verification:

- Sign up a fresh throwaway account at `https://gymlog.10x-astro-starter.workers.dev/auth/signup`
  (this is the same signup that proves the production trigger in Phase 2, and may be the same
  account) and confirm `/dashboard` renders `Europe/Warsaw` alongside the account's email.
- Change that account's `timezone` to a distinguishable value in the **production** dashboard table
  editor, reload `/dashboard`, and confirm the page renders the new value — i.e. the page is reading
  the row, not printing a constant. Restore it afterwards.
- Sign up a second throwaway account and confirm the same page renders **its own** row while the
  first account's value is unchanged — the value is per-account. (Two accounts is the honest form of
  this check; the Phase 4 fixtures cannot serve it because they live in `gymlog-test`.)
- Signed out, `/dashboard` still redirects to `/auth/signin`.
- These throwaway accounts accumulate in the production project's `auth.users` and cannot be deleted
  without a `service_role` key. Keep it to two, name them recognisably (`dash-<timestamp>@gymlog-test.dev`),
  and hand them to S-09 along with the existing smoke account.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 6: Truth up the documents this change falsifies

### Overview

Four documents currently assert things that stop being true the moment Phase 2 lands. `AGENTS.md` and
`README.md` are the first files a new agent reads; a stale one is an active hazard, not a tidiness
issue.

### Changes Required:

#### 1. Agent instructions

**File**: `AGENTS.md`

**Intent**: Record the working method and the policy template so the next slice copies the right
shape without rediscovering any of it.

**Contract**: five edits.

- § Commands — `npm run db:status` / `db:push` / `db:types` and `npm run test:integration`, plus the
  standing rule: **there is no local database stack and none is wanted; every migration and every
  data-touching check runs against a hosted project via `--db-url`.** State the two-project shape
  plainly: `gymlog` is production and serves the deployed Worker; `gymlog-test` is what CI and the
  integration check write to; **`npm run db:push` applies every migration to both, test first**, so
  there is no supported way to advance one and forget the other, and `npm run db:status` prints both
  histories so divergence is one command away from being visible. Name the dashboard SQL editor as an
  emergency-only path requiring `supabase migration repair --status applied <version>` afterwards,
  **on whichever database it was used against**.
- § Access control — add the canonical table template every later table copies: `enable row level
security` in the creating migration; `revoke all … from anon, authenticated` then grant exactly the
  operations allowed; one policy per operation, each `to authenticated`, each
  `using ((select auth.uid()) = user_id)` and, for insert/update, the matching `with check`; the
  subselect form is required, not stylistic. Add one sentence on the query side: **the policy is the
  guarantee, an explicit `.eq("user_id", user.id)` in the query is the index path — later tables carry
  both.** Without it, every table copying this shape relies on the policy predicate to do the
  filtering, which on `workouts` and `sets` is a full scan under the 10 ms CPU cap — the exact trap
  § Cloudflare traps warns about, and the reason the policies use `(select auth.uid())` at all.
  (`profiles` itself is the one table where the unfiltered read is honest, because it is a single-row
  primary-key lookup and the demonstration in Phase 5 is precisely that RLS returns one row.)
- § Testing — unit tests stay hermetic in `src/**/*.test.ts`; integration checks that touch stored
  data live in `tests/integration/` under a separate Vitest config, run against **`gymlog-test`
  only** with its publishable key, and must assert against re-read rows. Note the fixture discipline:
  reset fixture rows in `beforeAll`, write run-unique values, restore in a `finally`.
- § Environment — the six `.env` keys and which project each belongs to; that `.env` and
  `.env.example` are denied to agent file tools and are owner-edited; and that no test-project or
  database credential ever becomes a Worker secret.
- § Known state — CI now runs lint, typecheck, unit tests, the integration check (against
  `gymlog-test`), and build.

**Expected diff noise, not caused by this change**: `npx prettier --check AGENTS.md` **fails today**
on two pre-existing lines that use `*surviving*` / `*down*` where Prettier wants `_surviving_` /
`_down_`. lint-staged rewrites them on the first commit that touches the file, so criterion 6.4 will
pass — but the two-line reformat will appear in this change's diff. Expect it; do not chase it.

#### 2. Repository README

**File**: `README.md`

**Intent**: § "Supabase Configuration" currently says _"No database tables or migrations are required
— this project uses Supabase Auth's built-in `auth.users` table only"_ and walks the reader through
`npx supabase start` with Docker. Both are false for this project as of this change, and the second
would send someone down a path this machine cannot follow.

**Contract**: replace the Docker-first local-setup section with the hosted-project workflow (the six
`.env` keys, `npm run db:push`, `npm run db:types`), delete the "no tables or migrations are
required" sentence, and add the three `db:*` scripts plus `test:integration` to § "Available
Scripts" and the new step to § "CI". Document the two projects in a small table — which one the
Worker serves, which one CI writes to — and state that `db:push` targets both. List the repository
secrets accurately: `SUPABASE_URL`, `SUPABASE_KEY` (build-time, production) plus `SUPABASE_TEST_URL`,
`SUPABASE_TEST_KEY`, `GYMLOG_TEST_PASSWORD` (integration check, test project). Keep the
build-time-vs-runtime secrets paragraph exactly as it is — it is still correct and still the most
important paragraph in the file.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: § Baseline's **Data** bullet says "no schema … not one application table", and Open
Question 3 is answered by this change.

**Contract**: rewrite the Data bullet (one table, migrations directory, RLS enforced and proven, in
two hosted projects); note in the Auth bullet that row-ownership enforcement now exists; and rewrite
Open Question 3 to record the decision — hosted-only, `--db-url` session pooler, **two projects with
a single push that applies to both**, integration checks against `gymlog-test` and confined by RLS —
with a pointer to this plan. Add the S-02 revisit trigger from Decision 11. Leave the F-03 item's
`Status` alone — that is `/10x-implement`'s and `/10x-archive`'s to move.

#### 4. Deploy plan

**File**: `context/deployment/deploy-plan.md`

**Intent**: § Rollback says _"Once migrations exist this stops being true — a Worker rollback does not
roll back a schema change. Revisit this section when the first migration lands."_ It just landed.

**Contract**: add the schema-rollback rule: there are no down migrations; a schema mistake is undone
by a **new forward migration** (`drop trigger on_auth_user_created on auth.users;` → `drop function`s
→ `drop table public.profiles;` → `drop type`s), applied through `npm run db:push` so that **both**
databases are rolled forward together; and `npx wrangler rollback` reverts code only, on production
only. State the ordering constraint plainly: deploy code that tolerates the old schema first, or
accept a window where the two disagree. Add one line on the second database: `gymlog-test` is not a
backup and holds no recoverable data — it is a schema mirror, and a rollback that fixes production
must be pushed to it too or the next `db:status` will show divergence.

### Success Criteria:

#### Automated Verification:

- No document still denies the schema:
  `git grep -n "No database tables or migrations are required" -- README.md` returns nothing (this
  command exits 1 on success — run it alone, never `&&`-chained).
- `git grep -n "no schema" -- context/foundation/roadmap.md` returns nothing (this command also exits
  1 on success — run it alone, never `&&`-chained).
- The new commands are documented: `git grep -n "db:push" -- README.md AGENTS.md` returns matches in
  both.
- Both projects are documented: `git grep -n "gymlog-test" -- README.md AGENTS.md` returns matches in
  both.
- Markdown stays Prettier-clean (lint-staged runs `prettier --write` on `*.md` at commit):
  `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md context/deployment/deploy-plan.md`
  exits 0. Note that it **fails before this phase** on two pre-existing `AGENTS.md` lines
  (`*surviving*` / `*down*`); that reformat is expected diff noise, not a regression.
- The whole gate is still green: `npm run lint && npm run typecheck && npm test && npm run build`.

#### Manual Verification:

- Read `AGENTS.md` § Access control as if you were the agent implementing S-02 tomorrow: is the
  policy template copy-pasteable onto a `workouts` table without further questions, **including the
  `.eq("user_id", …)` index-path sentence**? If not, it is not finished.

**Implementation Note**: This is the final phase. After it passes, the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit Tests

None added. Everything this change introduces is schema and access control, which a pure function
test cannot observe. The existing hermetic suite must keep passing untouched — that is itself a
success criterion in four of the six phases.

### Integration Tests

`tests/integration/profiles-rls.test.ts`, described in full in Phase 4. The design rules that matter:

- **Against `gymlog-test` only.** The suite is given `SUPABASE_TEST_URL` / `SUPABASE_TEST_KEY` and no
  production credential at all, locally or in CI. It cannot reach production even by mistake.
- Two real accounts, publishable key only, no `service_role` anywhere.
- Every negative assertion is paired with a **re-read as the row's owner** — the failure US-04 warns
  about is a caller that sees a friendly error while the write silently landed.
- One positive assertion (owner can update their own row) exists purely so the suite cannot pass
  against a table nobody can use, and it writes a **run-unique** value so a stale value from a
  crashed run cannot masquerade as a successful write.
- **Non-vacuity is structural, not circumstantial.** A sees exactly 1 row, B sees exactly 1 row, the
  ids differ — no dependency on a third account existing in the database.
- **Shared fixtures are reset, not assumed.** `beforeAll` restores both rows to the defaults; every
  mutation restores in a `finally`; `ci.yml` carries a `concurrency` group so two pipeline runs
  cannot interleave over the same two rows.

### Manual Testing Steps

1. Sign up a fresh throwaway account at the deployed URL (production); confirm a `profiles` row
   appears for it in the production dashboard within seconds (the trigger).
2. Signed in as that account, `/dashboard` shows `Europe/Warsaw`; change the row's timezone in the
   table editor, reload, and confirm the page follows the row.
3. Sign up a second throwaway account; the same page shows its own row while the first is unchanged.
4. Sign out; `/dashboard` redirects to `/auth/signin`.
5. Confirm `npm run db:status` shows the same migration version in both projects' Remote columns.
6. Optional, owner-approved, **on `gymlog-test` only**: add a permissive
   `for select … using (true)` policy in the SQL editor, watch `npm run test:integration` fail on the
   unfiltered-select assertion, drop the policy, watch it pass. RLS is never switched off.

## Performance Considerations

A profile read is a single primary-key lookup returning one row, so it costs the Worker one network
round trip and no meaningful CPU. Nothing here approaches the Workers Free 10 ms cap.

Two decisions in this change exist because of that cap and pay off later, not now: the Supabase client
is built once per request in middleware rather than per page, and every policy uses
`(select auth.uid())` so the check is an InitPlan rather than a per-row call. When S-07 and S-08 add
weekly rollups, those must be aggregated in Postgres — `AGENTS.md` § Cloudflare traps — and this
change adds nothing that would tempt an implementer to loop over rows in the Worker.

## Migration Notes

- **Every migration goes to both databases, test first.** `npm run db:push` applies pending
  migrations to `gymlog-test` and then to `gymlog`. There is no supported single-target push, because
  the only way two schemas drift is by advancing one of them alone.
- **A failed test push stops the run**, and production is never touched. This is the reason for the
  ordering: a bad migration is discovered on the database nobody depends on.
- **A failed production push leaves the two divergent**, with test ahead. The wrapper says so
  explicitly. Recovery is to fix the migration and re-run `npm run db:push` — `db push` applies only
  what each remote history table reports as pending, so the test push will report "up to date" and
  the production push will apply the missing version. Do not hand-apply the SQL to catch production
  up: that is how `supabase migration repair` becomes necessary.
- **`npm run db:status` is the drift check.** It prints both histories; the same version must appear
  in the Remote column of both. Run it before believing anything about either schema, and after any
  interrupted push.
- **There are no down migrations.** Supabase's migration model is forward-only. A mistake is undone by
  a new migration that drops what the old one created, in reverse dependency order — and that new
  migration also goes to both databases.
- **A Worker rollback does not roll back the schema.** `npx wrangler rollback` reverts code only, on
  production only. `gymlog-test` is a schema mirror, not a backup: it holds no recoverable data.
- **The backfill is idempotent** (`on conflict (id) do nothing`), so re-running the migration against
  a database that already has it is harmless — though `db push` will not re-run it anyway once the
  history table records it. On `gymlog-test` it backfills nothing, because that project has no
  accounts until the Phase 4 fixtures sign up.
- **If the migration is ever applied by hand through the dashboard SQL editor**, that database's
  remote history table will not know about it and the next `db push` will try to re-apply it — to
  that database only, which is itself a way to become divergent. Recover with
  `npx supabase migration repair --status applied <version>` against the affected database, then
  confirm with `npm run db:status`.

## Decisions

Most of these were taken by the planning agent without access to the owner, to avoid stalling; items
still marked **pending owner confirmation** are genuinely the owner's call and each is cheap to
reverse. Rows marked **Owner decision** were taken by the owner directly, with the trade-offs in
front of them, and are not open for re-litigation by an implementer — where a review disagreed, the
dissent is recorded alongside rather than deleted.

| #   | Decision                                                                                                                                                                                                                                                       | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Migrations applied via `supabase db push --db-url <session pooler URI>`; no `login`, no `link`, no Docker                                                                                                                                                      | Measured on this machine: `--db-url` needs neither Docker nor auth; the CLI ignores `SUPABASE_DB_URL` from the environment; the direct host is IPv6-only and unresolvable here while the pooler answers on IPv4                                                                                                                                                                                                                                                                          | Planning agent; evidence-backed, and since confirmed against **both** databases (`migration list` exit 0). Answers roadmap Open Question 3                                                                                                   |
| 2   | The connection strings live in `.env` as `SUPABASE_DB_URL` and `SUPABASE_TEST_DB_URL`                                                                                                                                                                          | `.env` is already the project's gitignored secret store; the CLI keyring via `link` is invisible to a fresh clone, needs a browser login, and holds one project — this change addresses two in one command                                                                                                                                                                                                                                                                               | **Confirmed by owner 2026-08-09** — both values are in `.env` and authenticate; `.env` is owner-edited only                                                                                                                                  |
| 3   | `profiles` carries `timezone`, `weight_unit` and `estimation_formula` now, not in S-06                                                                                                                                                                         | S-03 (the north star) needs a canonical unit and a formula to render an estimate and does **not** depend on S-06; the UPDATE policy needs a writable column to be demonstrable at all; all three are `not null default`, so S-06 does zero data migration                                                                                                                                                                                                                                | Planning agent; S-06 keeps ownership of the UI that changes them                                                                                                                                                                             |
| 4   | Defaults `Europe/Warsaw`, `kg`, `brzycki`                                                                                                                                                                                                                      | The owner is in Poland and a UTC default would put a Monday-01:00 Warsaw session in the previous week — exactly the bug the week rule exists to prevent. Brzycki satisfies the 1-rep rule without a pin                                                                                                                                                                                                                                                                                  | **Pending owner confirmation** — a product default, one line to change                                                                                                                                                                       |
| 5   | Profile rows created by a `security definer` trigger on `auth.users`, plus a backfill                                                                                                                                                                          | Guarantees a row however the account is created (app, dashboard, test bootstrap); the alternative puts a write in the hot path of every request under a 10 ms CPU cap. Application-side upsert is retained as the fallback, and needs no schema change                                                                                                                                                                                                                                   | Planning agent; the fallback is fully specified in Phase 2 § Contingency (`ensureProfile` in `src/lib/services/profiles.ts`, called from the auth endpoints, **never** from middleware — the middleware is what the 10 ms argument protects) |
| 6   | **No DELETE policy and no delete grant** on `profiles`                                                                                                                                                                                                         | A user deleting their profile while the account survives leaves a live account with no timezone. Account deletion is S-09 and removes the `auth.users` row, which cascades                                                                                                                                                                                                                                                                                                               | Planning agent; the four-policy shape is still what data tables copy                                                                                                                                                                         |
| 7   | `revoke all … from anon, authenticated` before granting                                                                                                                                                                                                        | Supabase's default privileges grant ALL on new public tables. Absence of a policy denies, but an unnoticed implicit grant is how an anonymous read path arrives without anyone deciding on it                                                                                                                                                                                                                                                                                            | Planning agent                                                                                                                                                                                                                               |
| 8   | Postgres `enum` types for unit and formula                                                                                                                                                                                                                     | Generated TypeScript carries `"kg" \| "lb"` instead of `string`. Narrow precedent: enums for closed sets fixed by the PRD only — the muscle-group taxonomy (S-02) is still an open question and should be a lookup table                                                                                                                                                                                                                                                                 | Planning agent                                                                                                                                                                                                                               |
| 9   | Timezone validity is **not** enforced by a CHECK constraint                                                                                                                                                                                                    | The immutable `timezone(text, timestamp)` trick raises an error rather than returning false and reads ambiguously against a column of the same name. Length check in the database, IANA validation in the application (S-06's zod)                                                                                                                                                                                                                                                       | Planning agent                                                                                                                                                                                                                               |
| 10  | Generated types committed at `src/db/database.types.ts`; entity aliases in `src/types.ts`                                                                                                                                                                      | CI has no database credentials and must not gain any. `src/db/` marks the file as generated; `AGENTS.md` reserves `src/types.ts` for hand-written entity/DTO types, which now derive from the generated ones                                                                                                                                                                                                                                                                             | Planning agent; generated from the **production** schema, which is the schema of record                                                                                                                                                      |
| 11  | **Two Supabase projects**: `gymlog` (production, serves the Worker) and `gymlog-test` (CI and the integration check). The check gets `SUPABASE_TEST_URL` / `SUPABASE_TEST_KEY` / `GYMLOG_TEST_PASSWORD` as repository secrets and **no** production credential | CI never authenticates to the database the owner trains against, so the blast radius of a bad or runaway test is a project holding no real data. `context/foundation/infrastructure.md` already recommends a separate Supabase project for preview URLs, so the second project is the one previews will want anyway                                                                                                                                                                      | **Owner decision, 2026-08-09.** The plan review argued the opposite — see the dissent and mitigation in the two rows below                                                                                                                   |
| 11a | _Review dissent, recorded not deleted_: the review recommended **one** project                                                                                                                                                                                 | Its argument: schema drift between test and production is a more likely source of false green than shared data is — CI would prove RLS on a table that is not the table serving users — and Decision 12's drift detector works only while CI points at the real schema. It also costed a second password, a second `SUPABASE_DB_URL`, a doubled push, and the free plan's only spare project slot; against that, a blast radius of two preference rows confined by the policy under test | Recorded. Overruled by the owner. The review's own condition — **revisit at S-02**, when CI starts writing workout rows rather than two preference rows — is adopted and is S-09's to carry out                                              |
| 11b | Drift is prevented mechanically, not by discipline: `npm run db:push` applies to **both**, test first                                                                                                                                                          | This is the direct answer to the dissent. There is no supported way to push one database and forget the other; a failed test push stops before production is touched; a failed production push exits non-zero naming the divergence; and `npm run db:status` prints both histories so the check is one command. `db:types` reads production, so stale-type risk is unchanged from the one-project design                                                                                 | Planning agent, implementing the owner's decision safely                                                                                                                                                                                     |
| 12  | Migrations are **not** applied from CI                                                                                                                                                                                                                         | It would require database-owner connection strings in GitHub secrets and let any merge rewrite the schema of the database the owner trains against. With the split, CI no longer doubles as the drift detector for production — Decision 11b's single push and `db:status` take over that job                                                                                                                                                                                            | Planning agent; the trade the review flagged, paid for explicitly                                                                                                                                                                            |
| 13  | A ~40-line Node wrapper (`scripts/supabase-db.mjs`) instead of raw npm scripts                                                                                                                                                                                 | No portable shell interpolation exists across PowerShell / `cmd.exe` / `sh`, the CLI will not read the URL from the environment, `.cmd` shims cannot be spawned without a shell, the wrapper guarantees LF on the generated types file, and it is the only place the "both databases, test first" rule can live                                                                                                                                                                          | Planning agent; `scripts/**` excluded from the type-checked lint config                                                                                                                                                                      |
| 14  | The deployed dashboard renders one profile value                                                                                                                                                                                                               | F-03's outcome includes "connected to … the deployed instance". Secrets being set proves the credentials, not the connection. One rendered value is the smallest honest proof and is not S-01's or S-06's work                                                                                                                                                                                                                                                                           | **Pending owner confirmation** — the only user-visible change in this change                                                                                                                                                                 |
| 15  | `supabase/config.toml` `project_id` → `"gymlog"`                                                                                                                                                                                                               | Cosmetic (it namespaces a local Docker stack that will never run), but a file claiming to be `10x-astro-starter` is a trap for the next agent                                                                                                                                                                                                                                                                                                                                            | Planning agent                                                                                                                                                                                                                               |
| 16  | The red proof keeps a mutation test but never touches the RLS flag: add then drop a permissive `for select … using (true)` policy, **on `gymlog-test` only**                                                                                                   | `alter table … disable row level security` has an asymmetric failure mode — an interrupted revert leaves reads _and_ writes open on the table whose whole purpose is to make "a table without RLS is a defect" structural. The permissive-policy form keeps RLS on and writes protected, and running it on a project with no real data and no public traffic is what makes it acceptable at all                                                                                          | Owner approved a red proof; form chosen by the planning agent from review finding F3                                                                                                                                                         |
| 17  | `.env` and `.env.example` are **owner-edited**; the implementer never touches either                                                                                                                                                                           | `.claude/settings.json` denies agent file tools `Read(./.env)` and `Read(./.env.*)`, and `.env.example` matches the second pattern. This is a property of the harness, not a preference — steps that need those files must be handed to the owner or they silently cannot be done                                                                                                                                                                                                        | Environment fact, recorded 2026-08-09                                                                                                                                                                                                        |

## Open risks

- **The trigger on `auth.users` may be refused.** `postgres` is granted trigger rights on hosted
  projects, but it is a grant, not a guarantee, and the failure mode is severe: signup returns
  `Database error saving new user`. Detection is the Phase 2 manual check (sign up a throwaway
  account, against production; the test project's trigger is exercised by the Phase 4 bootstrap).
  **Fallback, needing no schema change**: drop the trigger and call `ensureProfile()` from the auth
  endpoints — fully specified in Phase 2 § Contingency, because a mitigation without a file and a
  function signature is not a mitigation. Cost: a write on a cold path instead of a guarantee, and
  one extra line in the Phase 4 fixture bootstrap.
- **The session-pooler hostname is not knowable from here.** `aws-0-` and `aws-1-` both resolve; only
  the dashboard knows which serves a given project. Now retired for these two projects — both URIs
  were copied from the dashboard and both authenticate — but it applies again to any future project,
  which is why the rule stays written down as "copy, do not construct".
- **Schema drift between the two projects** is the cost of the owner's two-project decision and the
  review's main objection to it. Mitigated structurally (one push applies to both, test first) and
  detectably (`db:status` prints both histories), not by discipline. The residual case is a
  production push that fails after the test push succeeded: the databases are then genuinely
  divergent until someone re-runs `npm run db:push`, and the wrapper's exit message is what makes
  that loud rather than quiet.
- **CI no longer keeps the production project awake.** Free-tier projects auto-pause after ~1 week
  idle, and the previous design happened to neutralise that by having CI touch production on every
  run. Now CI keeps only `gymlog-test` awake. Production's heartbeat is the owner signing in, plus
  the manual checks in Phases 2 and 5 — `context/foundation/infrastructure.md`'s risk register
  already carries this row with an "H/H" rating, and this change makes it slightly more live, not
  less. A paused production project would not turn CI red; it would break the deployed URL silently.
- **The free plan's second project slot is now consumed.** `gymlog-test` occupies the slot a preview
  environment would want. Not a conflict in practice — `infrastructure.md` recommends pointing
  previews at exactly this kind of separate project — but it means a third environment is not
  available without paying.
- **Two database passwords now exist**, both only in `.env` and both invisible to the implementer.
  Rotation is an owner action, and rotating one without the other produces a `db:push` that fails
  halfway.
- **Nothing detects generated-type drift automatically.** If someone pushes a migration and forgets
  `npm run db:types`, typecheck still passes against stale types. Accepted for now; a CI regenerate-
  and-diff step would need a database password in GitHub secrets, which decision 12 rejects.

## Contradictions found against existing documents

1. **`README.md`: "No database tables or migrations are required — this project uses Supabase Auth's
   built-in `auth.users` table only."** False from Phase 2 onward. Corrected in Phase 6.
2. **`README.md` § "First-time setup (local, no cloud project needed)"** instructs the reader to
   install Docker and run `npx supabase start`. That path does not exist on this machine and is not
   wanted. Corrected in Phase 6.
3. **`context/foundation/roadmap.md` § Baseline, Data: "no schema … not one application table."**
   False from Phase 2 onward. Corrected in Phase 6.
4. **`context/deployment/deploy-plan.md` § Rollback: "Once migrations exist this stops being true …
   Revisit this section when the first migration lands."** An instruction addressed to exactly this
   change. Honoured in Phase 6.
5. **`AGENTS.md` § Known state: "CI runs lint + build only"** was already corrected by F-01; the
   remaining claim that "the browser test is not wired" stays true — the integration check added here
   is not a browser test.
6. **`supabase/config.toml` `project_id = "10x-astro-starter"`** contradicts every other document,
   all of which call the project GymLog. Corrected in Phase 1.
7. **This plan's own earlier text** asserted "one database serves development, CI and production" and
   leaned on the production smoke account to make the isolation assertion non-vacuous. Both were made
   false by the owner's two-project decision of 2026-08-09 and are corrected throughout; see
   § Revision history.

## References

- Roadmap item: `context/foundation/roadmap.md` § Foundations → F-03; § Baseline → Data; § Open
  Roadmap Questions → 3
- Product contract: `context/foundation/prd.md` § US-04 (verify against recorded data), § Access
  Control (ownership enforced, not hidden), § Non-Functional Requirements (no cross-account reach, no
  unauthenticated read path), § Business Logic → Week boundaries and Units
- Agent rules: `AGENTS.md` § Access control is a hard guardrail, § Domain rules that are easy to get
  wrong, § Conventions (migration naming, `src/lib/services/`, `src/types.ts`), § Cloudflare traps
- Deployment record, including the publishable-key finding and the throwaway smoke account:
  `context/deployment/deploy-plan.md` § Stage 2
- The review this revision answers: `context/changes/owned-persistence-baseline/reviews/plan-review.md`
  (findings F1–F10; its one-project recommendation is recorded as dissent in Decision 11a)
- Separate-Supabase-project guidance and the auto-pause risk row:
  `context/foundation/infrastructure.md` § Preview deploys, § Risk register
- Plan shape and the "red proof" / anti-vacuous-gate precedent:
  `context/archive/2026-08-09-verification-harness/plan.md`
- Current auth wiring this change extends: `src/lib/supabase.ts`, `src/middleware.ts`,
  `src/pages/api/auth/{signin,signup,signout}.ts`, `src/pages/dashboard.astro`
- Projects: `gymlog` — `cdzybmwxtefhbanfytna` / `https://cdzybmwxtefhbanfytna.supabase.co`;
  `gymlog-test` — `nfmrwvevntbzulsmrmel` / `https://nfmrwvevntbzulsmrmel.supabase.co`. Both Central
  EU (Frankfurt), free plan, email confirmation off, signup enabled (verified 2026-08-09).

## Revision history

### 2026-08-09 — review findings F1–F10 applied, and the owner's two-project decision

**Owner decision (Part B).** GymLog now runs **two** Supabase projects: `gymlog` (production) and
`gymlog-test`. The integration check authenticates only to the test project; CI gains
`SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` and `GYMLOG_TEST_PASSWORD` and holds no production database
credential. Migrations go to **both** databases through a single `npm run db:push`, test first, which
is the direct answer to the review's strongest objection (Decision 12's drift detector disappears
when CI stops pointing at the real schema). Decision 11 records the choice, 11a the review's dissent
verbatim in substance, 11b the mitigation, and the review's condition — revisit at S-02, when CI
starts writing workout rows — is adopted. Phase 1's scope shrank: both connection strings were proven
today (`supabase migration list --db-url …`, exit 0, empty history on each), so the phase now builds
and proves the wrapper rather than gating on a credential the owner has already supplied.

**Review findings applied.**

| Finding | Change                                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | Phase 4 gains a `beforeAll` fixture reset after sign-in, a run-unique write in assertion 7 restored in a `finally`, and a `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: false }` block in `ci.yml`                                      |
| F2      | Phase 3's git-based criteria are prefixed with `git add src/db/database.types.ts` (as 2.4 already did); 3.1 restated as `git diff --stat` empty once staged                                                                                                |
| F3      | Assertion 2 is self-proving (A sees 1, B sees 1, ids differ); the production RLS-disable proof is gone. A red proof survives in the safe form — add then drop a permissive `for select … using (true)` policy, on the test project, RLS never switched off |
| F4      | The trigger fallback gains a file, a signature and call sites: `ensureProfile()` in `src/lib/services/profiles.ts`, called from `signin.ts` / `signup.ts`, explicitly **not** middleware, plus one line in the Phase 4 bootstrap (Phase 2 § Contingency)   |
| F5      | `loadEnv` is gone — `try { process.loadEnvFile(); } catch {}` plus `env: { ...process.env }`, with the measured precedence recorded and the undeclared `vite` dependency avoided                                                                           |
| F6      | The wrapper's "masks the URL out of child-process error text" requirement is dropped as impossible under `stdio: "inherit"` and unnecessary (the CLI error text carries host/user/database, never the password)                                            |
| F7      | The cross-shell check moved from `db:status` to `db:types` (Phase 3 manual) — the verb that captures stdout, writes a file and chains `prettier`                                                                                                           |
| F8      | Assertions 6 and 8 pinned to `error?.code === "42501"`, with `data === null` (not `[]`) on the anonymous read                                                                                                                                              |
| F9      | Phase 6 records that `prettier --check` already fails on two pre-existing `AGENTS.md` lines; 6.2 carries 6.1's exit-1 note                                                                                                                                 |
| F10     | The `AGENTS.md` policy template gains the index-path sentence: the policy is the guarantee, `.eq("user_id", …)` is the index path — later tables carry both                                                                                                |

**Consequences swept through the plan, beyond the findings themselves**: the isolation suite's
non-vacuity no longer depends on the production smoke account (which is in the wrong database now);
Phase 5's manual checks use throwaway accounts signed up at the deployed URL, because the Phase 4
fixtures live in `gymlog-test` and cannot sign in to production; Open risks records that CI no longer
keeps production awake and that the free plan's spare project slot is consumed; and `.env` /
`.env.example` are marked **owner actions** throughout, because `.claude/settings.json` denies both
to the implementer's file tools.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Connect the toolchain to both hosted databases

#### Automated

- [x] 1.1 Both connections work and both histories are empty — `npm run db:status` exits 0 and prints two labelled `Local | Remote | Time (UTC)` tables with no rows — f7fc08b
- [x] 1.2 Wrapper fails loudly and names the right variable — with `SUPABASE_TEST_DB_URL` cleared, then with `SUPABASE_DB_URL` cleared, `npm run db:status` exits non-zero naming the missing one — f7fc08b
- [x] 1.3 Neither secret is tracked — `git check-ignore -v .env` matches, `git status --porcelain` shows no `.env` — f7fc08b
- [x] 1.4 `.env.example` documents the new keys and holds no values — `git grep -n "SUPABASE_TEST_DB_URL" -- .env.example` matches, `git grep -nE "pooler\.supabase\.com|sb_publishable_" -- .env.example` returns nothing — f7fc08b
- [x] 1.5 Gate undisturbed — `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exit 0 — f7fc08b

#### Manual

- [x] 1.6 The two `db:status` tables are visibly labelled and distinct, so divergence is readable at a glance — f7fc08b
- [x] 1.7 No terminal output, commit message or plan file contains either database password — f7fc08b

### Phase 2: The profiles migration — table, RLS, policies, trigger

#### Automated

- [x] 2.1 Migration applies to both databases — `npm run db:push` exits 0 and names the migration file twice, `gymlog-test` before `gymlog` — ccbb8ad
- [x] 2.2 Recorded remotely in both — `npm run db:status` shows the timestamp in Local and Remote of both project tables — ccbb8ad
- [x] 2.3 Re-running is a no-op — a second `npm run db:push` reports no pending migrations for either project — ccbb8ad
- [x] 2.4 Migration file is LF — `git add` it, then `git ls-files --eol -- supabase/migrations` prints `w/lf` — ccbb8ad
- [x] 2.5 Gate undisturbed — `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exit 0 — ccbb8ad

#### Manual

- [x] 2.6 Production backfill worked — one `profiles` row per existing account, including the smoke account — ccbb8ad
- [x] 2.7 `public.profiles` exists and is empty in `gymlog-test` — that project has no accounts yet — ccbb8ad
- [x] 2.8 Every existing row reads `Europe/Warsaw` / `kg` / `brzycki` — ccbb8ad
- [x] 2.9 RLS enabled on `public.profiles` with three policies listed in both dashboards — ccbb8ad
- [x] 2.10 Trigger works — a fresh signup at the deployed URL produces a new `profiles` row in production — ccbb8ad

### Phase 3: Generated types, a typed client, and the first entity type

#### Automated

- [x] 3.1 Generation reproducible — after `git add src/db/database.types.ts`, a second `npm run db:types` leaves `git diff --stat -- src/db/database.types.ts` empty — abe0499
- [x] 3.2 Schema present in the file — with it staged, `git grep -n "profiles"` and `git grep -n "brzycki"` in `src/db/database.types.ts` return matches — abe0499
- [x] 3.3 Generated file is LF — with it staged, `git ls-files --eol -- src/db/database.types.ts` prints a line, and that line reads `w/lf` — abe0499
- [x] 3.4 Types are load-bearing — `npm run typecheck` exits 0, and a deliberate table-name typo makes it exit 1 (reverted) — abe0499
- [x] 3.5 `npm run lint`, `npm test`, `npm run build` all exit 0 — abe0499

#### Manual

- [x] 3.6 Cross-shell — `npm run db:types` from PowerShell and from Git Bash produces a byte-identical, still-`w/lf` file — abe0499
- [x] 3.7 `src/types.ts` contains no hand-written column list — every member derives from `Database` — abe0499

### Phase 4: The check that asserts against stored rows

#### Automated

- [x] 4.1 `npm run test:integration` exits 0 with 8 passing test cases in one file — 34d7cca
- [x] 4.2 Fails loudly without credentials — missing `GYMLOG_TEST_PASSWORD`, then missing `SUPABASE_TEST_URL`, exits non-zero naming it; does not skip or report 0 tests — 34d7cca
- [x] 4.3 Never touches production — `git grep -nE "SUPABASE_URL|SUPABASE_KEY" -- tests/ vitest.integration.config.ts` returns nothing — 34d7cca
- [x] 4.4 Not in the unit suite — `npm test` output does not name `profiles-rls.test.ts` and still exits 0 offline — 34d7cca
- [x] 4.5 `npm run lint` and `npm run typecheck` exit 0 with the new files present — 34d7cca
- [x] 4.6 Pipeline step present and ordered — `git grep -n "run:" -- .github/workflows/ci.yml` lists `npm run test:integration` between `npm test` and `npm run build` — 34d7cca
- [x] 4.7 Concurrency guard present — `git grep -n "cancel-in-progress" -- .github/workflows/ci.yml` matches and the group is `ci-${{ github.ref }}` — 34d7cca

#### Manual

- [x] 4.8 GitHub Actions run is green and shows the `npm run test:integration` step — 34d7cca
- [x] 4.9 Exactly two fixture accounts exist in the `gymlog-test` Auth users list after several runs, and neither exists in production — 34d7cca
- [x] 4.10 Both fixture rows read `Europe/Warsaw` / `kg` / `brzycki` after a run — assertion 7 restored what it wrote — 34d7cca
- [x] 4.11 Owner-approved red proof on `gymlog-test` only — a temporary permissive `for select … using (true)` policy fails assertion 2; dropping it turns the suite green. RLS is never disabled — 34d7cca

### Phase 5: Prove the deployed instance reads the database

#### Automated

- [x] 5.1 Full gate green — lint, typecheck, unit tests, integration check, build all exit 0 — 4b0b346
- [x] 5.2 No build-time database dependency — `npm run build` succeeds with both `*_DB_URL` cleared, and the CI build is green — 4b0b346
- [x] 5.3 Worker holds no database or test-project secret — `npx wrangler secret list` names only `SUPABASE_URL` and `SUPABASE_KEY` — 4b0b346
- [x] 5.4 Worker deploys — `npx wrangler deploy` exits 0 and prints a new version id — 4b0b346

#### Manual

- [x] 5.5 A fresh throwaway account signed up at the deployed URL sees `Europe/Warsaw` on `/dashboard` beside its email — 4b0b346
- [x] 5.6 Changing that row's timezone in the production table editor changes the rendered value; restored afterwards — 4b0b346
- [x] 5.7 A second throwaway account renders its own row while the first is unchanged — the value is per-account — 4b0b346
- [x] 5.8 Signed out, `/dashboard` still redirects to `/auth/signin` — 4b0b346
- [x] 5.9 Throwaway accounts kept to two, named recognisably, and handed to S-09 with the smoke account — 4b0b346

### Phase 6: Truth up the documents this change falsifies

#### Automated

- [x] 6.1 README no longer denies the schema — `git grep -n "No database tables or migrations are required" -- README.md` returns nothing (exits 1 on success; do not `&&`-chain) — 87f980c
- [x] 6.2 Roadmap Baseline updated — `git grep -n "no schema" -- context/foundation/roadmap.md` returns nothing (exits 1 on success; do not `&&`-chain) — 87f980c
- [x] 6.3 New commands documented — `git grep -n "db:push" -- README.md AGENTS.md` returns matches in both — 87f980c
- [x] 6.4 Both projects documented — `git grep -n "gymlog-test" -- README.md AGENTS.md` returns matches in both — 87f980c
- [x] 6.5 Markdown Prettier-clean — `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md context/deployment/deploy-plan.md` exits 0 — 87f980c
- [x] 6.6 Gate still green — `npm run lint && npm run typecheck && npm test && npm run build` — 87f980c

#### Manual

- [x] 6.7 `AGENTS.md` § Access control policy template is copy-pasteable onto a `workouts` table without further questions, including the `.eq("user_id", …)` index-path sentence — 87f980c
