# Account-Owned Persistence Baseline — Plan Brief

> Full plan: `context/changes/owned-persistence-baseline/plan.md`
> Roadmap item: **F-03** (`context/foundation/roadmap.md` § Foundations)

## What & Why

GymLog has a deployed app, working auth and two hosted Supabase projects — and not one application
table. This change creates the first one, `profiles`, and uses it to establish the row-ownership
policy shape that every later table must copy: RLS enabled in the same migration that creates the
table, granular per-operation policies, and a check that proves the boundary by reading the stored
rows back rather than by trusting the status code a caller sees. It also settles how migrations get
applied at all on a machine with no container runtime — roadmap Open Question 3, which gates every
data-bearing slice after this one.

## Starting Point

Two Supabase projects are provisioned and verified: `gymlog` (production, ref
`cdzybmwxtefhbanfytna`) and `gymlog-test` (ref `nfmrwvevntbzulsmrmel`), both Central EU, free plan,
email confirmation off. `.env` carries six keys — a URL, publishable key and session-pooler database
URI for each — and **both database URIs authenticate** (`supabase migration list --db-url …` exits 0
with an empty history against each). The production URL and key are also in `.dev.vars`, the Worker's
runtime secrets and GitHub's repository secrets, and signup → dashboard → signout → signin was
verified against the deployed URL. But `supabase/` holds only `config.toml`, there is no
`supabase/migrations/`, and there is no Docker — so the working method for schema changes does not
exist yet, and neither database has a table.

## Desired End State

Every account automatically gets exactly one profile row carrying the timezone its training week is
evaluated in, its weight unit and its estimation formula. The database — not request code — makes
that row unreachable from any other account, and a Vitest suite in CI proves it by signing in as two
real accounts **in the test project** and re-reading the rows. `npm run db:push` / `db:types` /
`db:status` work from both shells on this machine with no Docker and no `supabase login`, with
`db:push` applying every migration to both databases in one command so they cannot drift, and the
deployed Worker visibly reads the new table in production.

## Key Decisions Made

| Decision                          | Choice                                                                      | Why (1 sentence)                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| How migrations are applied        | `supabase db push --db-url <session-pooler URI>` from `.env`                | Measured today: needs no Docker, no login and no link — and the free-plan direct host is IPv6-only, which this machine cannot reach.             |
| How many databases                | **Two projects**: `gymlog` (production) and `gymlog-test` (CI)              | Owner decision, 2026-08-09: CI holds no production credential at all, so a runaway test cannot reach the owner's training data.                  |
| How they stay in sync             | One `npm run db:push` applies to both, test first                           | Splitting costs a drift risk; the answer is that there is no supported way to advance one database and forget the other.                         |
| Where the connection strings live | `.env` as `SUPABASE_DB_URL` / `SUPABASE_TEST_DB_URL`, via a Node wrapper    | No shell interpolation is portable across PowerShell, `cmd.exe` and `sh`, and the CLI refuses to read the URL from the environment.              |
| Profile columns                   | timezone + weight unit + estimation formula now, not deferred to S-06       | S-03 (the north star) needs a unit and a formula and does not depend on S-06; the UPDATE policy also needs a writable column to be demonstrable. |
| Row creation                      | `security definer` trigger on `auth.users` + a backfill                     | Guarantees a row however the account is created, instead of putting a write in every request's hot path under a 10 ms CPU cap.                   |
| Delete                            | No delete policy and no delete grant on `profiles`                          | Deleting a profile while the account survives leaves a live account with no timezone; account deletion is S-09 and cascades from `auth.users`.   |
| Grants                            | `revoke all from anon, authenticated`, then grant exactly what is allowed   | Supabase grants ALL on new public tables by default — that is how an anonymous read path arrives without anyone deciding on it.                  |
| The check                         | Vitest integration suite against `gymlog-test`, publishable key only, in CI | A guardrail nobody remembers to run is not a guardrail; `service_role` would bypass the very thing under test.                                   |
| Migrations from CI                | No — applied by hand from the machine                                       | Otherwise a merge could rewrite the schema of the database that also serves production.                                                          |

## Scope

**In scope:** the migrations directory and the first migration; `public.profiles` keyed to
`auth.users`; RLS + per-operation policies in the same migration; automatic profile creation;
generated database types and a typed client; an integration check asserting against stored rows; one
read-only profile value on the existing dashboard to prove the deployed instance is connected;
document corrections.

**Out of scope:** workouts, exercises, sets, records, tonnage (S-02+); the sign-in/sign-up UI (S-01);
a preferences screen (S-06); Playwright/E2E (Faza 3); the adversarial multi-table proof and account
deletion (S-09); seeding the exercise catalogue; applying migrations from CI; preview deploys or a
third environment; automated structural diffing between the two projects; any `service_role` key.

## Architecture / Approach

Two hosted Postgres databases with the **same** schema: `gymlog` serves development and the deployed
Worker, `gymlog-test` serves CI and the integration check. Schema changes travel as SQL files in
`supabase/migrations/`, applied by hand through the Supabase CLI over the IPv4 session pooler — to
the test database first, then production, in a single `npm run db:push`, with each database's remote
migration-history table doing the bookkeeping and `npm run db:status` printing both so divergence is
visible in one command. TypeScript learns the schema from a committed file generated from
production, so CI never needs database credentials. Access control lives entirely in Postgres
policies; the application holds only the publishable key, which is exactly what the integration
check uses so that what it proves is what a real client experiences.

## Phases at a Glance

| Phase                                | What it delivers                                               | Key risk                                                                                 |
| ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Connect the toolchain             | `db:status` / `db:push` / `db:types` addressing both databases | Small: both connections already authenticate; what is unproven is the wrapper            |
| 2. The profiles migration            | Table, enums, RLS, three policies, trigger, backfill — in both | The trigger on `auth.users` may be refused — a failure breaks signup; contingency spec'd |
| 3. Types and typed client            | `src/db/database.types.ts`, `src/types.ts`, typed client       | Generated file may need a lint exemption                                                 |
| 4. The persisted-state check         | 8-assertion isolation suite against `gymlog-test` + CI step    | Shared fixture rows across runs — reset in `beforeAll`, plus a CI concurrency group      |
| 5. Prove it on the deployed instance | Dashboard renders the account's own profile value (production) | Small overlap with S-01's future rework of that page                                     |
| 6. Truth up the documents            | README, AGENTS.md, roadmap, deploy plan corrected              | None — but four documents are currently false without it                                 |

**Prerequisites:** F-02 (done); both Supabase projects (done); both database URIs in `.env` and
proven (done, 2026-08-09). Phase 1 no longer stops for the owner. Remaining owner actions:
`.env` / `.env.example` edits and generating `GYMLOG_TEST_PASSWORD` — the implementer's file tools
are denied both files.
**Estimated effort:** ~2–3 sessions across 6 phases; Phase 2 and Phase 4 carry nearly all the thinking.

## Open Risks & Assumptions

- The `auth.users` trigger may be refused by the hosted project. Fallback (`ensureProfile()` called
  from the auth endpoints, never from middleware) needs no schema change, because the INSERT policy
  already permits it, and is fully specified in Phase 2 § Contingency.
- Two projects can drift. Mitigated structurally — one push applies to both, test first — and
  detectably via `db:status`; the residual case is a production push that fails after the test push
  succeeded, which the wrapper reports in those words.
- CI no longer keeps the **production** project awake, so free-tier auto-pause after ~1 week idle is
  a slightly more live risk than before; it breaks the deployed URL silently rather than turning CI
  red.
- The free plan's second project slot is now consumed by `gymlog-test`.
- Defaults `Europe/Warsaw` / `kg` / `brzycki` are the planning agent's call, pending the owner —
  a UTC default would silently misplace a late-Sunday session into the wrong training week.
- Nothing detects generated-type drift automatically; regenerating after a migration is a discipline,
  not a gate.

## Success Criteria (Summary)

- Signing in as one account and asking the database for every profile row returns exactly one row —
  their own — while a second account signed in against the same table sees exactly one different row.
- An attempt by one account to change or delete another's row leaves the stored row byte-for-byte
  unchanged when its owner reads it back, and CI fails if that ever stops being true.
- A schema change can be written, applied to both databases and type-generated on this machine with
  no Docker, in three commands.
