---
date: 2026-08-21T11:08:17+02:00
researcher: Monika Zmuda
git_commit: 2ca99594cd6040722143d4684bd18e666cbc73c5
branch: testing-environment-parity
repository: monikazmuda9310-arya/10xdevs-gymlog
topic: "Environment parity — proving the two projects agree, and that a deploy can still sign somebody in"
tags: [research, codebase, schema-parity, post-deploy-smoke, supabase, cloudflare, ci]
status: complete
last_updated: 2026-08-21
last_updated_by: Monika Zmuda
---

# Research: Environment parity (test-plan §3 Phase 5, risks #6 and #7)

**Date**: 2026-08-21T11:08:17+02:00
**Researcher**: Monika Zmuda
**Git Commit**: `2ca99594cd6040722143d4684bd18e666cbc73c5`
**Branch**: `testing-environment-parity`
**Repository**: `monikazmuda9310-arya/10xdevs-gymlog`

## Research Question

Phase 5 of `context/foundation/test-plan.md` §3 asks for two gates that §5 marks "required after §3
Phase 5":

- **schema parity between projects** — catching "two databases believed identical that are not" (risk #6)
- **post-deploy smoke** — catching "a green deploy that cannot authenticate anybody" (risk #7)

What mechanism can answer each on this machine, what does the repository already have, and what does
a plan have to be told before it is written?

## Summary

**Both gates are buildable, and the mechanism for each is now measured rather than assumed.**

1. **Every Supabase-CLI route to a schema comparison is closed.** `supabase db dump --db-url` fails
   with `failed to run docker. Docker Desktop is a prerequisite` — measured today. This is the same
   wall `db:types` already hit and worked around (`scripts/supabase-db.mjs:170-176`), and this
   machine has no `docker`, no `pg_dump`, no `psql`, and no Postgres driver in `node_modules`.
2. **The Management API is the aimable path.** `POST /v1/projects/{ref}/database/query` with
   `{ read_only: true }` runs SQL against **both** projects using `SUPABASE_ACCESS_TOKEN`, which
   `.env` already carries for `db:types`. No Docker, no driver, `fetch` only.
3. **The two schemas agree today**: 11 aspects compared, **0 drift**. The gate can be added without
   first repairing anything.
4. **One aspect matched by comparing nothing, and that is the sharpest finding here.**
   `information_schema.role_table_grants` returned **0 rows on both sides** and was reported as
   parity. The API runs as `supabase_read_only_user`, which is not a member of `anon` /
   `authenticated`, so that view hides every grant. Grants are load-bearing for this project's access
   control. **Every aspect needs a non-empty row-count floor**, or the check reports parity it never
   performed.
5. **The post-deploy smoke proposed in `infrastructure.md` is vacuous, and this is now proven.** The
   2026-08-08 mitigation reads: "fetches `/auth/signin` and asserts the 'Supabase not configured'
   banner is absent". `messageForCode(null)` returns `null` (`src/lib/validation/auth.ts:114-119`),
   so a bare GET renders **no banner in either case** — the check passes exactly as well when the
   secrets are missing. Do not implement it as written.
6. **The discriminator is the `?error=` code after a POST**, not the GET. Four outcomes, four
   different facts about the deployment (§ Detailed Findings 9).
7. **A new drift was found in a dimension the schema check would never see**: `gymlog-test` has
   `site_url: http://localhost:3000` and an **empty** `uri_allow_list`. Harmless today, and the same
   wrong value `lessons.md` records production shipping with in S-01.

### Scope decisions taken with the owner, 2026-08-21

| Question                         | Decision                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| How far the smoke goes           | **Credential-free probe.** POST deliberately-invalid credentials, require `?error=sign_in_failed`. No production account, no sixth secret. |
| Where the parity check runs      | **Locally, before `db:push`.** `SUPABASE_ACCESS_TOKEN` never reaches CI.                                                                   |
| What "the projects agree" covers | **Schema _and_ auth config**, the latter as a contract check rather than an equality check.                                                |

## Detailed Findings

### 1. What `db:status` actually compares — risk #6's anchor, confirmed

`npm run db:status` runs `supabase migration list --db-url <url>` once per project
(`scripts/supabase-db.mjs:139-151`). That is a comparison of **which migration versions are
recorded**, not of what they produced. Risk #6's "Must challenge" column already says this; the code
confirms it exactly.

Two ways the histories can agree while the schemas do not, both documented in this repository:

- **The dashboard SQL editor** does not write `supabase_migrations.schema_migrations` (`AGENTS.md`
  § Commands). DDL applied there changes one schema and leaves the history identical.
- **A partially-applied push.** `push` runs test first and production second
  (`scripts/supabase-db.mjs:153-183`); a production failure is reported loudly, but any manual repair
  afterwards is outside the wrapper's sight.

The committed types are generated from **production only**, through the Management API with
`--project-id` (`scripts/supabase-db.mjs:186-232`). So `src/db/database.types.ts` describes `gymlog`,
and nothing in the repository has ever compared it against `gymlog-test`.

### 2. The Docker wall — every CLI route to a schema comparison is closed (measured)

```
$ supabase db dump --db-url <gymlog-test> --schema public -f out.sql
Dumping schemas from remote database...
failed to run docker. Docker Desktop is a prerequisite for local development.
exit: 1        (out.sql written, 0 bytes)
```

Measured 2026-08-21 against `gymlog-test`. Also confirmed absent on this machine: `docker`,
`pg_dump`, `psql`. `node_modules` contains no `pg`, no `postgres`, no driver of any kind — the only
database client in the dependency tree is `@supabase/supabase-js`, which speaks PostgREST and cannot
read `pg_catalog`.

**This closes `db diff`, `db dump` and `db pull` in one stroke** — the CLI runs `pg_dump` inside a
container regardless of `--db-url`. It is the same constraint `db:types` met, and
`scripts/supabase-db.mjs:170-176` already records the workaround for it in a comment.

### 3. The Management API is the one aimable path (measured)

```
POST https://api.supabase.com/v1/projects/{ref}/database/query
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
{ "query": "...", "read_only": true }
```

- Works against **both** projects: `201 [{"tables":9}]` for each (5 tables + 4 views — matching
  `AGENTS.md` § Known state).
- **`read_only: true` genuinely refuses writes**, and the refusal was proven rather than trusted: a
  no-op `update public.profiles set timezone = timezone where false` answered
  `400 ... ERROR: 25006: cannot execute UPDATE in a read-only transaction`, while a positive control
  (`select 1`) under the identical flag answered `201`. The probe write was chosen so that it would
  have been harmless even if the flag had been decorative.
- **It runs as `supabase_read_only_user`**, not `postgres` — confirmed with
  `select current_user, session_user`. That is defence in depth beyond the flag, and it is also what
  causes finding 5 below.

Note this is **not** the hazard `AGENTS.md` warns about under "The dashboard SQL editor is an
emergency path only". That warning is about **DDL** applied outside the migration system. A read-only
`select` over `pg_catalog` records nothing and changes nothing.

### 4. The two schemas agree today — 11 aspects, 0 drift

Measured 2026-08-21, digests over sorted row sets:

| Aspect      | Source                                                     | prod  | test  | Result            |
| ----------- | ---------------------------------------------------------- | ----- | ----- | ----------------- |
| columns     | `information_schema.columns` incl. `generation_expression` | 77    | 77    | OK                |
| constraints | `pg_constraint` + `pg_get_constraintdef`                   | 22    | 22    | OK                |
| indexes     | `pg_indexes.indexdef`                                      | 15    | 15    | OK                |
| rls_enabled | `pg_class.relrowsecurity` / `relforcerowsecurity`          | 5     | 5     | OK                |
| policies    | `pg_policies` incl. `qual` and `with_check`                | 19    | 19    | OK                |
| views       | `pg_class.reloptions` + `md5(pg_get_viewdef)`              | 4     | 4     | OK                |
| triggers    | `pg_get_triggerdef`                                        | 12    | 12    | OK                |
| functions   | `proname`, `prosecdef`, `md5(prosrc)`                      | 4     | 4     | OK                |
| enums       | `pg_type` + `pg_enum` labels in sort order                 | 3     | 3     | OK                |
| grants      | `information_schema.role_table_grants`                     | **0** | **0** | **see finding 5** |
| migrations  | `supabase_migrations.schema_migrations`                    | 10    | 10    | OK                |

Three of these carry guarantees `AGENTS.md` names explicitly and that a history comparison is blind
to: `generation_expression` (the `weight_kg` column and `0.45359237`), `reloptions` (which is where
`security_invoker = true` lives), and `prosecdef` (which is what makes the access-control trigger a
trigger rather than a `security definer` bypass).

### 5. The `grants` aspect matched by comparing nothing — the sharpest finding

`information_schema.role_table_grants` returns only grants where the current user is grantor,
grantee, or a member of the grantee role. `supabase_read_only_user` is none of those for `anon` or
`authenticated`, so the view answers **zero rows** — on both projects. The comparison then succeeded
by comparing two empty lists.

`pg_class.relacl` does not depend on the caller's role memberships and sees all nine relations:

```
exercise_entries  postgres=arwdDxtm/postgres  service_role=arwdDxtm/postgres  authenticated=arwd/postgres
daily_tonnage     postgres=arwdDxtm/postgres  service_role=arwdDxtm/postgres  authenticated=r/postgres
profiles          postgres=arwdDxtm/postgres  service_role=arwdDxtm/postgres  authenticated=arw/postgres
```

Identical on both projects. Note `anon` appears **nowhere** — which is the visible half of the table
template's "revoke before granting" rule, and precisely the thing worth watching for drift.

**The rule this produces for the plan**: every aspect query carries a **minimum expected row count**,
and the check fails when an aspect returns fewer. This is the same failure class the repository has
already named twice — `{ impact: [] }` read as reassurance (`AGENTS.md` § Known state), and "a route
that ALWAYS fails satisfies a failure assertion perfectly" (`test-plan.md` §6.2). A parity check
whose query silently stops returning rows reports green forever.

### 6. The comparator can report a difference — proven without writing to any database

Per `lessons.md` § "A guard you have not mutated may not guard", the reporter was made to fail.
Nothing was written: the production-side query was narrowed to pretend `sets.rpe` does not exist.

```
mutated comparison: DIFF (comparator reports)  prod=76 test=77
   test-only: sets.rpe
```

**This proves the comparator and its reporting, not that a real schema change surfaces.** The
stronger mutation — apply a DDL change to `gymlog-test`, watch the check go red, revert — writes to a
database CI also uses, and belongs in the plan with two cautions: it must be `gymlog-test` only, and
it must not run while a CI run holds the `gymlog-test-fixtures` concurrency group.

### 7. Risk #7 — what a missing secret does, and why no GET can see it

The chain, all of it deliberate and commented as such:

- `src/lib/supabase.ts:34-37` — `createClient` returns `null` when either variable is absent. The
  comment above it says "Do not 'fix' it into a throw."
- `src/middleware.ts:23-30` — a null client sets `locals.user = null`.
- `src/middleware.ts:32-36` — every protected route then redirects to `/auth/signin`.
- `astro.config.mjs:19-20` — both variables are `optional: true`, which is why the build succeeds
  without them.

**A healthy deployment and a secret-less one are indistinguishable to an unauthenticated GET.**
Probed against the live URL today:

```
/              200  (4702B)
/auth/signin   200  (9105B, password field present)
/dashboard     302 -> /auth/signin
/records       302 -> /auth/signin
```

Every one of those four lines would read identically with the secrets removed. That is risk #7 stated
exactly.

### 8. The mitigation proposed in `infrastructure.md` does not work

`context/foundation/infrastructure.md:293` (risk register, H×H row, 2026-08-08):

> add a post-deploy smoke check that fetches `/auth/signin` and asserts the "Supabase not configured"
> banner is absent

**It passes in the broken case.** `src/pages/auth/signin.astro:8` renders
`messageForCode(Astro.url.searchParams.get("error"))`, and `src/lib/validation/auth.ts:114-119`
returns `null` for an absent code. With no `?error=` in the URL there is no banner to be absent — so
the assertion holds whether or not the Worker has credentials. It is an absence-assertion with no
positive control, which `test-plan.md` §6.3 already forbids for e2e and which applies with equal
force here.

`not_configured` is reachable only from the **POST** branch, `src/pages/api/auth/signin.ts:29-32`.

### 9. The `?error=` code is the discriminator — four codes, four different facts

`src/pages/api/auth/signin.ts:34-38` and `src/lib/validation/auth-errors.ts:43-61`:

| Code on the redirect | What it means about the deployment                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sign_in_failed`     | The Worker reached Supabase and got a genuine identity refusal. **Secrets present and valid.**               |
| `not_configured`     | `locals.supabase` was null. **Runtime secrets absent** — risk #7 realised.                                   |
| `unexpected`         | The provider answered something unmapped — a wrong key or URL lands here, and it is logged server-side.      |
| `rate_limited`       | Per-IP throttling (`error.status === 429`). **Not a deployment failure**, and a repeated smoke can cause it. |

So the chosen probe — POST an address with no account and a random password, require
`sign_in_failed` — proves the whole chain from workerd env to Supabase auth, with no production
account.

**Two limits to write into the plan rather than discover later.** It cannot tell **which** project
the Worker is pointed at: `SUPABASE_URL` aimed at `gymlog-test` would answer `sign_in_failed` just as
happily. And `rate_limited` must be treated as inconclusive rather than as failure, or the smoke
reports a broken deploy for running twice.

### 10. A `fetch` POST without `Origin` is answered 403 — already measured here

`scripts/e2e-serve.mjs:24-27`:

> Astro's `security.checkOrigin` is on by default for `output: "server"`, so a form-encoded POST
> carrying no `Origin` header is answered `403` before it reaches a handler — which reads exactly
> like an absent credential (P4.4). A real browser sends `Origin` itself, so Playwright is
> unaffected; a `fetch` probe must set it.

The smoke is a `fetch` probe. Without an `Origin` header it gets a 403 that looks like a broken
deployment and is the probe's own fault. This is written down; it does not need re-deriving.

### 11. Out-of-repo configuration — what is readable and what is not

| Thing                                                   | Readable how                                         | Verdict                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Email confirmation, `site_url`, `uri_allow_list`        | Management API `/v1/projects/{ref}/config/auth`      | **Automatable**                                                                           |
| Worker runtime secret **names**                         | `wrangler secret list --name gymlog`                 | **Automatable** — verified on the current OAuth token (`workers_scripts (write)` present) |
| Worker runtime secret **values**                        | nothing                                              | Never readable — only an HTTP probe proves them                                           |
| Branch protection                                       | `gh api repos/:owner/:repo/branches/main/protection` | **Automatable**                                                                           |
| Whether a confirmation email arrives and its link works | a human clicking                                     | **Stays manual** (`lessons.md` § "Verify with a script that attacks" reserves this class) |

`wrangler secret list` output today:

```
[ { "name": "SUPABASE_KEY", "type": "secret_text" },
  { "name": "SUPABASE_URL", "type": "secret_text" } ]
```

**Necessary, not sufficient**: a secret holding the wrong project's URL lists identically.

### 12. Auth-config drift found — real, latent, and invisible to a schema check

| Field            | `gymlog`                                                   | `gymlog-test`               |
| ---------------- | ---------------------------------------------------------- | --------------------------- |
| Confirm email    | **ON**                                                     | off                         |
| `site_url`       | `https://gymlog.10x-astro-starter.workers.dev/auth/signin` | **`http://localhost:3000`** |
| `uri_allow_list` | deployed host + `http://localhost:4321/**`                 | **(empty)**                 |
| `disable_signup` | false                                                      | false                       |

The first row is the deliberate difference `AGENTS.md` § Environment and `README.md` both document,
and `auth-flows.test.ts`'s first assertion defends.

The second and third are not documented anywhere. **`http://localhost:3000` is the exact value
`lessons.md` § "`site_url` shipped wrong and no test could see it" records production shipping
with** — a Next.js port inherited from the starter, which nothing in this project serves (dev is
4321, the e2e harness 8788). It is inert **only** because `gymlog-test` has confirmation off and
therefore sends no links. The day anybody turns confirmation on there — which `auth-flows.test.ts`
exists to catch — the links point at a dead port.

**This is why the auth-config check is a contract check, not an equality check.** Some fields must
differ; the claim is "`mailer_autoconfirm` differs in the documented direction, and production's
`site_url` equals the deployed origin", not "the two projects match".

### 13. Branch protection reads back, with one property worth naming

```
enforce_admins: true
required_status_checks: { contexts: ["ci"], strict: false }
```

`enforce_admins: true` is the load-bearing half, as `test-plan.md` §5 says. **`strict: false` is not
currently written down anywhere**: "require branches to be up to date before merging" is off, so a PR
whose `ci` passed against an older `main` can still merge. Worth stating as a known limit; turning it
on is a separate decision with a real cost (every PR needs a rebase when `main` moves).

### 14. Patterns this phase should reuse rather than reinvent

- **The delete/assert split.** `scripts/e2e-build.mjs:10-15` deletes and does not assert;
  `scripts/e2e-serve.mjs:88-98` asserts and does not delete, immediately before every launch. The
  reasoning is that an assertion which cannot fire is indistinguishable from one that passes.
- **`scripts/supabase-db.mjs` conventions**: resolve the CLI from its own `bin` field; validate
  before touching the network; **mask credentials in anything printed** (`maskCredentials`,
  lines 96-98); never echo a connection string. A parity script prints schema text and must not print
  a token.
- **Ordering a guard so it cannot pass for the wrong reason.** `e2e-serve.mjs:76-86` requires the
  build output to exist _before_ asserting the credential file is absent — otherwise "absent" is
  satisfied by there having been no build. A parity check needs the same shape: prove both projects
  answered before comparing digests, or an API failure looks like agreement.
- **The CI concurrency group** (`.github/workflows/ci.yml:19-22`) is keyed on the shared
  `gymlog-test` rows and is joined by _living in the `ci` job_, not by being in the workflow file.

## Code References

- `scripts/supabase-db.mjs:139-151` — `status` runs `migration list` per project; the history comparison
- `scripts/supabase-db.mjs:153-183` — `push`, test-first, with the divergence message
- `scripts/supabase-db.mjs:170-176` — why `--project-id` replaced `--db-url` for type generation: no container runtime
- `scripts/supabase-db.mjs:96-98` — `maskCredentials`, the printing discipline to copy
- `scripts/e2e-serve.mjs:24-27` — `checkOrigin`: a form POST with no `Origin` is 403
- `scripts/e2e-serve.mjs:46-62` — the subtractive strip and its allowlist
- `scripts/e2e-serve.mjs:76-98` — the ordered guard: build exists, then credentials absent
- `scripts/e2e-build.mjs:10-15` — why delete and assert live in different processes
- `src/lib/supabase.ts:32-37` — `createClient` returns null on absent credentials, deliberately
- `src/middleware.ts:23-36` — null client to `locals.user = null` to redirect
- `src/pages/api/auth/signin.ts:29-32` — the only branch that emits `not_configured`
- `src/pages/api/auth/signin.ts:34-38` — provider error to a neutral code
- `src/lib/validation/auth-errors.ts:43-61` — `rate_limited` before identity codes; `unexpected` is logged
- `src/lib/validation/auth.ts:114-119` — `messageForCode(null)` is `null`: the vacuity in finding 8
- `src/pages/auth/signin.astro:8` — where that null becomes "no banner"
- `astro.config.mjs:19-20` — both credentials `optional: true`, which is why the build passes without them
- `.github/workflows/ci.yml:19-22` — the concurrency group and why it is keyed on nothing branch-shaped

## Architecture Insights

- **"The two projects agree" is three claims, not one**: the schema, the auth configuration, and the
  runtime secrets of the thing serving them. Only the first is what risk #6 names, and only the first
  is comparable by equality.
- **This repository's recurring failure shape appears twice more in this phase.** A check that passes
  because it examined nothing: the `grants` aspect returning zero rows, and the proposed
  GET-the-banner smoke. Both are the `{ impact: [] }` pattern in a new costume. Every gate this phase
  adds needs an answer to "what would make this report green while blind?".
- **The gate boundary is a credential boundary.** `SUPABASE_ACCESS_TOKEN` is account-wide and can run
  arbitrary SQL against production through the same endpoint this research used read-only. It is
  strictly more powerful than the database password that `AGENTS.md` § Environment already refuses to
  give CI. That is why the parity check is local — the rule is not merely preserved, it would be
  violated more severely by the CI variant than by the thing it was written about.
- **Nothing in the per-commit gate can see either risk, by construction.** Risk #6 needs both
  databases; risk #7 needs a deployment. Both gates therefore sit outside the eight-step gate, which
  is what §5 already says by placing them at "pre-push" and "after deploy".

## Historical Context (from prior changes)

- `context/foundation/lessons.md` § "A slice that ends in a screen needs a deployment phase" — S-02
  left 38 exercises in production with no route to reach them; every criterion passed. The rule it
  produced is that the check that matters is a request against the public address.
- `context/foundation/lessons.md` § "`site_url` shipped wrong and no test could see it" — the value
  was `http://localhost:3000`, caught only by a human clicking a real confirmation link. **The same
  value is sitting on `gymlog-test` right now** (finding 12).
- `context/foundation/lessons.md` § "A guard you have not mutated may not guard" and § "A mutation
  that fails for the WRONG REASON has not confirmed the guard" — together they set the bar for
  finding 6: not merely red, but red for the reason the criterion names.
- `context/foundation/lessons.md` § "Verify with a script that attacks, not by asking the owner to
  read code" — which is why the manual list here should shrink to the one item only a human can do:
  click a real confirmation link.
- `context/foundation/infrastructure.md:175-181, 193` — "Secrets fail open, not closed", and the
  record that this project **has already been deployed once without the Worker secrets set**, with CI
  green throughout. Risk #7 is a repeat, not a hypothetical.
- `context/foundation/infrastructure.md:293` — the risk-register mitigation this research disproves
  (finding 8).
- `context/archive/2026-08-16-testing-browser-layer/` — where the `.dev.vars` hazard, the
  request-time credential resolution and the `checkOrigin` measurement were established.

## Related Research

- `context/archive/2026-08-16-testing-browser-layer/research.md` — env resolution in dev vs the built
  worker; the measurement that makes the built worker aimable
- `context/archive/2026-08-09-verification-harness/` — the earliest "prove the guard fires" work
- `context/changes/bootstrap-verification/verification.md` — the Astro 7 / Cloudflare adapter record

## Open Questions

1. **Does a real DDL change surface in the comparison?** Finding 6 proves the reporter, not the
   subject. The plan must apply a change to `gymlog-test`, watch the check go red _naming that
   change_, and revert — coordinated against the `gymlog-test-fixtures` concurrency group.
2. **Is the credential-free smoke's audit-log cost acceptable at the intended cadence?** Each run
   leaves a row in `auth.audit_log_entries` on production, which `public.delete_own_account()` cannot
   remove and which `README.md` already documents as surviving account deletion. Cheap once per
   deploy; different if it ever becomes a cron.
3. **Should `gymlog-test`'s `site_url` be corrected as part of this phase, or recorded and left?** It
   is inert while confirmation is off. Correcting it is a two-minute change that removes a trap;
   leaving it means the auth-config check has a known-failing row on its first run.
4. **What is the run-order relationship between the parity check and `db:push`?** Checking _before_ a
   push proves the two agreed beforehand; checking _after_ proves the push produced agreement. These
   catch different failures and the plan should say which one the gate is.
5. **`strict: false` on branch protection** (finding 13) — record as a known limit, or close it? Out
   of scope for the two named risks, but discovered here and undocumented.
