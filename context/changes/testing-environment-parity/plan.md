# Environment Parity — Implementation Plan

## Overview

Two gates that the eight-step CI gate cannot see by construction: a **schema-and-catalogue parity
check** between `gymlog` and `gymlog-test` (risk #6), and a **post-deploy smoke** against the public
URL (risk #7). Both are marked "required after §3 Phase 5" in `context/foundation/test-plan.md` §5
and neither exists today.

No production code changes. Two scripts, wiring into `db:push` and a new `deploy`, one out-of-repo
configuration correction, and the documentation that makes all of it findable.

## Current State Analysis

**Risk #6.** `npm run db:status` runs `supabase migration list --db-url` once per project
(`scripts/supabase-db.mjs:139-151`). It compares **which migration versions are recorded**, never
what they produced. Two documented paths let the histories agree while the schemas do not: the
dashboard SQL editor writes no history row, and a production push that fails after the test push
succeeded is repaired by hand, outside the wrapper's sight.

**Risk #7.** `src/lib/supabase.ts:34-37` returns `null` when either credential is absent;
`src/middleware.ts:23-36` turns that into `locals.user = null` and a redirect. Both credentials are
`optional: true` in `astro.config.mjs:19-20`, so the build succeeds without them. Probed against the
live URL on 2026-08-21: `/` and `/auth/signin` answer `200`, `/dashboard` and `/records` answer
`302 → /auth/signin`. **Every one of those four lines would read identically with the secrets
removed.** `infrastructure.md:175-181, 193` records that this project has already been deployed once
in exactly that state, with CI green throughout.

**What the research settled** (`context/changes/testing-environment-parity/research.md`):

- Every Supabase-CLI route to a schema comparison is closed — `supabase db dump --db-url` fails with
  `failed to run docker`. No `docker`, no `pg_dump`, no `psql`, no Postgres driver.
- `POST /v1/projects/{ref}/database/query` with `read_only: true` works against both projects on
  `SUPABASE_ACCESS_TOKEN`, which `.env` already carries. The refusal was proven (`25006`) with a
  positive control beside it. It runs as `supabase_read_only_user`, not `postgres`.
- The two schemas agree today across 11 aspects, and the seeded catalogue agrees too: 38 rows,
  identical digest.
- **`gymlog-test` holds 75 custom exercises; production holds 0.** Comparing `exercises` wholesale
  would report a 75-row difference that is entirely correct. The `user_id is null` filter is what
  makes the catalogue comparison mean anything.

## Desired End State

- `npm run db:parity` compares both projects and answers with three distinguishable outcomes: they
  agree, they differ (naming what differs), or **the comparison could not be made** — the third
  never readable as the first.
- `npm run db:push` runs that comparison **before** and **after**, with different consequences.
- `npm run deploy` deploys and then proves the deployed Worker can reach its auth provider, failing
  loudly with a diagnosis and a recovery command when it cannot.
- `gymlog-test`'s `site_url` no longer points at a port nothing serves.
- Every rule above is written where a reader will meet it, and the two `test-plan.md` §5 rows move
  from "required after §3 Phase 5" to required.

### Key Discoveries

- `scripts/supabase-db.mjs:96-98` — `maskCredentials`, the printing discipline to copy.
- `scripts/e2e-build.mjs:10-15` and `scripts/e2e-serve.mjs:88-98` — the delete/assert split, and why
  a guard that cannot fire is indistinguishable from one that passes.
- `scripts/e2e-serve.mjs:76-86` — a guard ordered so it cannot pass for the wrong reason: the build
  output must exist **before** its credential file is asserted absent.
- `scripts/e2e-serve.mjs:24-27` — Astro's `security.checkOrigin` answers `403` to a form POST with no
  `Origin` header, which reads exactly like an absent credential. **The smoke is a `fetch` probe and
  must set it.**
- `src/lib/validation/auth-schemas.ts:27-33` — sign-in validates only that the password is non-empty,
  so a random probe password reaches the provider. The email must pass `isValidEmail`.
- `src/lib/validation/auth-errors.ts:43-61` — `rate_limited` is checked before identity codes;
  unmapped provider errors become `unexpected` and are logged server-side.
- `wrangler rollback [version-id]` exists in the installed wrangler 4.120.0.

## What We're NOT Doing

- **No deploy workflow in GitHub Actions.** That needs `CLOUDFLARE_API_TOKEN` in repository secrets,
  which hands every merge the ability to overwrite production — the property `AGENTS.md` § Environment
  deliberately refused to the database. Deploy stays manual.
- **No `SUPABASE_ACCESS_TOKEN` in CI.** It is account-wide and can run arbitrary SQL against
  production through the endpoint this plan uses read-only. It is strictly more powerful than the
  database password CI is already refused.
- **No automatic rollback** on a failed smoke (§ Phase 5 for why).
- **No production account, no sixth repository secret, no inbox.** The smoke is credential-free.
- **No change to `optional: true`** in `astro.config.mjs`. Making the credentials required would fail
  the build in CI, which supplies them, and would not change what a deployed Worker does when its
  runtime secrets are missing.
- **Not closing `strict: false`** on branch protection — recorded as a known limit instead.
- **No comparison of user data.** Only rows the migrations put there.

## Implementation Approach

One script per gate, each a plain `.mjs` under `scripts/`, following `supabase-db.mjs`'s conventions:
load `.env` tolerantly, validate before touching the network, mask anything that could carry a
credential, and report per target with a banner.

The parity script is **aspect-driven**: each aspect is a name, a SQL query, and a **minimum expected
row count**. The floor is the load-bearing part — research found `information_schema.role_table_grants`
returning zero rows on both sides and reporting parity it never performed. Without a floor, an aspect
whose query silently stops matching reports green forever.

The smoke is a single POST whose entire signal is the `?error=` code on the redirect. Four codes,
four different facts (`research.md` § Detailed Findings 9).

## Critical Implementation Details

**`Origin` is not optional on the smoke's POST.** `security.checkOrigin` is on by default for
`output: "server"`, so a form-encoded POST without it is refused `403` before any handler runs —
which looks exactly like a broken deployment and is the probe's own fault
(`scripts/e2e-serve.mjs:24-27`, measured as P4.4 during the `testing-browser-layer` change).

**A failed API call must not be able to look like agreement.** Both projects must have answered every
aspect before any digest is compared; an exception anywhere exits with the "could not compare" code,
never with "they agree". This is the same ordering discipline as `e2e-serve.mjs:76-86`.

**The catalogue comparison is scoped to `user_id is null` or it is noise.** Production has 0 custom
exercises and `gymlog-test` has 75; an unscoped comparison reports a 75-row difference every time.

## Phase 1: The parity check

### Overview

A standalone `npm run db:parity` that compares both projects across schema aspects and the seeded
catalogue, with a row-count floor on every aspect and three distinguishable outcomes.

### Changes Required:

#### 1. The parity script

**File**: `scripts/env-parity.mjs` (new)

**Intent**: Compare `gymlog` and `gymlog-test` across a fixed list of aspects, report per aspect, and
exit with a code that distinguishes agreement from difference from inability to compare. Modelled on
`scripts/supabase-db.mjs` for env loading, target ordering and credential masking.

**Contract**:

- Reads `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL` and `SUPABASE_TEST_URL`; derives each project ref
  from its URL hostname exactly as `productionProjectRef()` does (`supabase-db.mjs:186-204`), so the
  targets cannot be configured to anything else. Fails with a named variable when one is absent.
- Every query is sent with `read_only: true`. Nothing in this script may write.
- **Aspect shape**: `{ name, sql, minRows }`. An aspect returning fewer than `minRows` on either
  project is a **failure of the check**, reported distinctly from a difference — the message must say
  the aspect could not be verified, not that the projects disagree.
- **Aspects** — the eleven from `research.md` § Detailed Findings 4, with `grants` re-sourced from
  `pg_class.relacl` rather than `information_schema.role_table_grants` (which returns nothing to
  `supabase_read_only_user`), plus one new aspect:
  - `seeded_catalogue` — `public.exercises` where `user_id is null`, projecting `name`,
    `muscle_group` and `is_bodyweight`, ordered by name. `minRows: 38`. **The `user_id is null`
    predicate is load-bearing**: without it the check reports production's 0 custom exercises against
    the test project's 75.
- Compares sorted row sets per aspect. On a difference, prints the rows present on one side only,
  both directions, capped — a report that says only "differs" sends the reader back to the console.
- **Exit codes**: `0` agree · `1` at least one aspect differs · `2` the comparison could not be made
  (missing variable, HTTP failure, an aspect below its floor). The three must be distinguishable by
  a caller, because Phase 4 treats them differently.
- Prints no token and no connection string. Reuse `maskCredentials`'s discipline
  (`supabase-db.mjs:96-98`).

#### 2. The npm script

**File**: `package.json`

**Intent**: Expose the check as `db:parity`, beside the three existing `db:*` scripts.

**Contract**: `"db:parity": "node scripts/env-parity.mjs"`.

### Success Criteria:

#### Automated Verification:

- `npm run db:parity` exits `0` and reports every aspect as agreeing
- Every aspect reports a row count at or above its floor; no aspect reports `0`
- `grants` reports 9 relations on both projects, not 0 — the regression research caught
- `seeded_catalogue` reports 38 on both, and the 75 custom rows on `gymlog-test` appear nowhere
- With `SUPABASE_ACCESS_TOKEN` withheld, the script exits `2` and names the variable — not `0`
- `npm run lint` passes
- `npx prettier --check scripts/env-parity.mjs package.json` passes

#### Manual Verification:

- The output of a full run names each aspect and its row counts, and is readable without consulting
  the source
- No token, project ref or connection string appears in the output of a successful run or of a
  forced failure

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Prove the check bites

### Overview

`lessons.md` § "A guard you have not mutated may not guard" and § "A mutation that fails for the
WRONG REASON has not confirmed the guard": make a real schema change on `gymlog-test`, confirm the
check goes red **naming that change**, and revert.

### Changes Required:

#### 1. The measurement record

**File**: `context/changes/testing-environment-parity/plan.md` (this file, § Measurement record)

**Intent**: Record what was applied, what the check said, and that the revert restored agreement —
so the proof survives the session rather than living in a transcript.

**Contract**: A `## Measurement record` section at the foot of this plan carrying, per mutation: the
SQL applied, the exact aspect and rows the check reported, and the `db:parity` exit code before,
during and after.

### Success Criteria:

#### Automated Verification:

- Before mutating: `npm run db:parity` exits `0`
- With a column added to `gymlog-test`: exits `1`, the `columns` aspect reports the difference, and
  the printed row **names that column**
- With an RLS policy altered on `gymlog-test`: exits `1` and the `policies` aspect names it — one
  structural aspect and one access-control aspect, because they are different query shapes
- After reverting both: `npm run db:parity` exits `0` again and every aspect is back at its Phase 1
  row count

#### Manual Verification:

- No CI run was in flight against `gymlog-test` during the mutation — the `gymlog-test-fixtures`
  concurrency group was checked with `gh run list` before starting and after reverting
- The revert is confirmed by re-reading the catalogue, not only by the check going green: a check
  that passes because both sides were mutated would look identical
- `npm run db:status` still reports identical migration histories — the mutation was applied outside
  the migration system on purpose and must have left no history row behind on either project

**Implementation Note**: this phase writes DDL to a database CI also uses. Do not start it while a CI
run is active, and do not leave the session between the mutation and the revert. Pause for manual
confirmation before Phase 3.

---

## Phase 3: The auth-config contract, and the correction it needs first

### Overview

"The two projects agree" is not one claim. The schema is comparable by equality; the auth
configuration is not — some fields **must** differ. Correct `gymlog-test`'s `site_url` first, then
pin the contract.

### Changes Required:

#### 1. Correct the test project's redirect configuration

**File**: none — Supabase project configuration for `gymlog-test`

**Intent**: `site_url` is `http://localhost:3000` and `uri_allow_list` is empty. That is the exact
value `lessons.md` § "`site_url` shipped wrong and no test could see it" records production shipping
with — a Next.js port inherited from the starter, which nothing in this project serves. It is inert
only while confirmation is off there.

**Contract**: `site_url` becomes `http://localhost:4321`, the port `astro dev` serves;
`uri_allow_list` covers `http://localhost:4321/**` and `http://localhost:8788/**` (the e2e harness
port, `scripts/e2e-serve.mjs:38`). Applied through the Management API `PATCH /v1/projects/{ref}/config/auth`
or the dashboard, and **read back afterwards** — this is configuration no file in the repository can
see.

#### 2. The auth-config aspect

**File**: `scripts/env-parity.mjs`

**Intent**: Add a contract check over `/v1/projects/{ref}/config/auth` for both projects. Unlike
every schema aspect, this asserts a **relationship**, not equality.

**Contract**: three assertions, each failing with its own sentence:

- `mailer_autoconfirm` is `false` on `gymlog` (confirmation ON) and `true` on `gymlog-test`
  (confirmation off). **Differing is the pass condition**; equal in either direction is the failure,
  and the message must say which direction, because the two consequences are opposite
  (`README.md` § Email confirmation).
- `gymlog`'s `site_url` equals the deployed origin plus `/auth/signin`, and its `uri_allow_list`
  contains the deployed host.
- `gymlog-test`'s `site_url` is a `localhost` URL — not a specific port. Pinning the exact port would
  turn an `astro.config` change into a false alarm; what matters is that it is not pointing at a
  public host.
- Runs under the same `2` exit code as the schema aspects when the config cannot be read.

### Success Criteria:

#### Automated Verification:

- `npm run db:parity` exits `0` with the auth-config aspect included and passing
- Reading `gymlog-test`'s config back shows `site_url: http://localhost:4321` and a non-empty
  `uri_allow_list`
- Temporarily asserting the wrong direction for `mailer_autoconfirm` makes the check exit `1` with a
  message naming which project is wrong — then reverted
- `npm run test:integration` still passes; `auth-flows.test.ts`'s first assertion is unaffected,
  because `mailer_autoconfirm` was not touched
- `npm run lint` and `npx prettier --check` pass

#### Manual Verification:

- The deployed origin used by the `site_url` assertion is read from one place that Phase 5's smoke
  will also read, so the two cannot disagree about what "the deployed URL" means

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Wire parity into `db:push`

### Overview

Two checks with two different meanings. Before the push: "did the two agree when we started?" After:
"did this push leave them agreeing?" `lessons.md` records that a check outside the gate rots, which
is why this does not stay a command to remember.

### Changes Required:

#### 1. The push wrapper

**File**: `scripts/supabase-db.mjs`

**Intent**: Run the parity comparison around `push`, with different consequences either side.

**Contract**:

- **Before** the test push: run the comparison and **warn without blocking** on exit `1`. Pre-existing
  drift is not a reason to refuse a migration, and refusing would make the only tool that could
  reveal the drift the tool that blocks its repair. The warning must say plainly that the difference
  predates this push.
- **After** both pushes succeed: run it again and **fail the command** on exit `1`, naming the
  aspects that differ. This is the failure the wrapper is blind to today — a production push that
  fails and is repaired by hand.
- Exit `2` from either call (could not compare) **fails the after-check and warns on the before-check**.
  An unverifiable after-state must not read as success.
- The before-check is skipped when `push` has nothing to apply, so an idempotent re-run stays cheap.
- Import the comparison as a function rather than spawning the script, so a non-zero exit cannot be
  swallowed by a shell layer.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` with nothing pending completes, runs the after-check, and exits `0`
- With drift planted on `gymlog-test` (Phase 2's recipe), `npm run db:push` **warns** before and
  **fails** after, with different wording each time — then reverted
- With `SUPABASE_ACCESS_TOKEN` withheld, `npm run db:push` fails on the after-check rather than
  reporting success
- `npm run db:status` output is unchanged — this phase touches `push` only
- `npm run lint` and `npx prettier --check scripts/supabase-db.mjs` pass

#### Manual Verification:

- The two messages are distinguishable at a glance in a real terminal; a reader can tell "this was
  already broken" from "your push broke it" without reading the source

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: The post-deploy smoke, and a deploy that runs it

### Overview

The one gate that needs something deployed. A single POST whose `?error=` code says whether the
Worker can reach its auth provider — and a negative control proving the assertion can fail.

### Changes Required:

#### 1. The smoke script

**File**: `scripts/deploy-smoke.mjs` (new)

**Intent**: POST deliberately-invalid credentials to a target's `/api/auth/signin` and read the code
on the redirect. Proves the whole chain from workerd env through the runtime secrets to Supabase
auth, with no account anywhere.

**Contract**:

- Target base URL from `argv[2]`, defaulting to the deployed origin. Same single source as Phase 3's
  `site_url` assertion.
- `POST {base}/api/auth/signin`, `application/x-www-form-urlencoded`, `redirect: "manual"`, **with an
  `Origin` header equal to the target origin** — without it `security.checkOrigin` answers `403` and
  the probe blames the deployment for its own omission (`scripts/e2e-serve.mjs:24-27`).
- Body: a well-formed random address that passes `isValidEmail`, and a random non-empty password.
  Sign-in validates no minimum length (`auth-schemas.ts:27-33`), so nothing is rejected before
  reaching the provider.
- Reads the `Location` header's `error` parameter and maps it:

  | Code                  | Exit | Meaning reported                                                            |
  | --------------------- | ---- | --------------------------------------------------------------------------- |
  | `sign_in_failed`      | `0`  | Runtime secrets present and valid; the provider was reached                 |
  | `not_configured`      | `1`  | Runtime secrets **absent** — `wrangler secret put` for both variables       |
  | `unexpected`          | `1`  | Secrets present but the provider refused them — wrong key or wrong project  |
  | `rate_limited`        | `3`  | **Inconclusive**, not a failure: per-IP throttling, possibly self-inflicted |
  | anything else / `403` | `2`  | The probe could not be made — includes the missing-`Origin` case            |

- **`rate_limited` must not fail the command.** It is a fact about the caller's IP, not about the
  deployment; treating it as failure makes the smoke report a broken deploy for running twice.
- On a failing code, prints the diagnosis and the recovery command — `npx wrangler secret put …` for
  `not_configured`, `npx wrangler rollback` for the rest — but **takes no action**.
- **Two limits printed with a passing result**, so nobody reads more into it than it says: it cannot
  tell which Supabase project the Worker is pointed at, and it proves the auth provider is reachable,
  not that a real account can complete a session.

#### 2. The deploy wrapper

**File**: `scripts/deploy.mjs` (new) and `package.json`

**Intent**: Make the smoke unskippable by putting it in the same command as the deploy — the same
property `db:push` gets from having no single-target variant.

**Contract**: `npm run deploy` runs `npm run build`, then `wrangler deploy`, then the smoke against
the deployed origin. A non-zero smoke exit fails the command; exit `3` (rate-limited) prints an
inconclusive verdict and **does not** fail. `wrangler deploy` stays in `.claude/settings.json`'s
`ask` list, so the wrapper still prompts.

#### 3. Verify the secret names before deploying

**File**: `scripts/deploy.mjs`

**Intent**: `wrangler secret list --name gymlog` is cheap and catches the most common cause of
`not_configured` before a version is published rather than after.

**Contract**: Before `wrangler deploy`, assert both `SUPABASE_URL` and `SUPABASE_KEY` are listed;
refuse with the `wrangler secret put` commands if either is missing. **Necessary, not sufficient** —
a secret holding the wrong project's URL lists identically, which is why the smoke still runs after.

### Success Criteria:

#### Automated Verification:

- Against the deployed URL, `node scripts/deploy-smoke.mjs` exits `0` and reports `sign_in_failed`
- **The negative control**: `npm run test:e2e`'s build, then `scripts/e2e-serve.mjs` launched with
  the three test credentials **withheld**, then the smoke against `http://localhost:8788` — must
  report `not_configured` and exit `1`. This is what proves the passing assertion can fail
- **The `Origin` control**: the same probe with the header removed reports the `403` branch and exits
  `2`, not `1` — a probe fault must not be reported as a deployment fault
- `wrangler secret list --name gymlog` lists both names
- `npm run lint` and `npx prettier --check` pass

#### Manual Verification:

- `npm run deploy` end to end against production: build, secret-name check, deploy, smoke, all green,
  and the deployed URL still signs a real account in through a browser
- The passing output states its two limits, so a reader does not take it for more than it proves
- The failure output for `not_configured` names `wrangler secret put` and does **not** suggest
  rollback — rolling back reaches a version with the same missing secrets

**Implementation Note**: this phase deploys to production. Pause for manual confirmation before
Phase 6.

---

## Phase 6: Close the gates in the documents

### Overview

Both `test-plan.md` §5 rows say "required after §3 Phase 5". This is that phase.

### Changes Required:

#### 1. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Move both gates to required, close Phase 5's row, and write the cookbook entry that makes
the next author able to add an aspect without reading this plan.

**Contract**:

- §3 row 5 → `complete`, with the change folder named.
- §5: the two rows' "Required?" cells become `required`, with `where` naming `db:push` and
  `npm run deploy`.
- A new §6.9 "Adding a parity aspect or a deploy check", carrying: the aspect shape and **why every
  aspect needs a row-count floor**; the `user_id is null` scoping and the 0-vs-75 measurement that
  forces it; `read_only: true` and the `supabase_read_only_user` identity; the three exit codes; the
  `Origin` requirement; and `rate_limited` being inconclusive.
- §6.6: a "Phase 5 — Environment parity (complete, 2026-08-21)" note recording what was wrong in this
  document before it was measured — the `grants` aspect that compared nothing, and
  `infrastructure.md`'s vacuous mitigation.
- The `strict: false` observation as a named limit under §5's branch-protection paragraph.

#### 2. The agent rules

**File**: `AGENTS.md`

**Intent**: A reader deciding how to compare the projects must not re-derive the Docker wall, and a
reader adding an aspect must meet the floor rule where the other database rules live.

**Contract**: In § Commands, a `db:parity` row in the command table and a short block covering: the
Docker wall and why the Management API is the path; `read_only: true`; the row-count floor as a
rule; and that `db:push` now checks either side. In § Cloudflare traps, that the missing-secret
failure now has a check and where it lives.

#### 3. The README

**File**: `README.md`

**Intent**: The scripts table and the CI section both claim to list what exists.

**Contract**: `db:parity` and `deploy` in § Available Scripts; a § Deployment rewrite pointing at
`npm run deploy` rather than the two bare commands, stating that the smoke is credential-free and
what it does and does not prove.

#### 4. The lessons

**File**: `context/foundation/lessons.md`

**Intent**: Two findings here are general, not local to this phase.

**Contract**: Two entries in the established Context / Problem / Rule / Applies-to shape:

- **"A comparison that returns nothing on both sides reports agreement it never checked"** — the
  `role_table_grants` measurement, generalised to any differential check.
- **"A probe whose own omission looks like the failure it tests for"** — the missing `Origin` header
  producing a `403` indistinguishable from an absent credential, and the vacuous
  `infrastructure.md` mitigation as a second instance in the same phase.

#### 5. The risk register correction

**File**: `context/foundation/infrastructure.md`

**Intent**: Line 293's mitigation is disproved. Leaving it invites the next reader to implement it.

**Contract**: The mitigation cell records that the banner check was measured vacuous on 2026-08-21
and names what replaced it, rather than being silently overwritten.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check` passes on all five documents
- No file in `context/foundation/` still describes the parity or smoke gate as pending
- The full gate passes: `npm run lint` → `typecheck` → `test` → `test:render` → `test:integration` →
  `test:middleware` → `build` → `test:e2e`
- `npm run db:parity` exits `0` and `npm run db:push` completes with both checks green

#### Manual Verification:

- §6.9 is sufficient to add a new aspect without opening this plan — checked by writing one aspect
  from §6.9 alone and discarding it
- The `lessons.md` entries name the measurement, not just the rule

---

## Testing Strategy

This change adds no application code, so its own correctness is established by mutation rather than
by a suite.

**Mutation proofs, each one a success criterion above:**

| What is proven                         | How                                                              | Phase |
| -------------------------------------- | ---------------------------------------------------------------- | ----- |
| The parity check reports drift         | real DDL on `gymlog-test`, structural and access-control, revert | 2     |
| An unverifiable comparison ≠ agreement | withhold `SUPABASE_ACCESS_TOKEN`, expect exit `2`                | 1, 4  |
| The auth contract can fail             | assert the wrong `mailer_autoconfirm` direction, revert          | 3     |
| The after-check blocks                 | plant drift, run `db:push`, watch it fail after succeeding       | 4     |
| The smoke can report failure           | serve the built worker with credentials withheld                 | 5     |
| A probe fault ≠ a deploy fault         | drop the `Origin` header, expect exit `2` not `1`                | 5     |

**Regression surface**: `scripts/supabase-db.mjs` is the only existing file with behaviour changes.
`db:status` and `db:types` must be unaffected, which their own success criteria assert.

## Performance Considerations

The parity check makes roughly a dozen HTTPS round trips per project against the Management API — a
few seconds, run at push and deploy time only, never per commit. The aspect queries read catalogue
tables on schemas of this size and are not a load concern on either project. The smoke is one
request.

## Migration Notes

Nothing is migrated. One out-of-repo configuration value changes (`gymlog-test`'s `site_url`); its
previous value is recorded in `research.md` § Detailed Findings 12 should it need restoring.

Phase 2 applies DDL to `gymlog-test` outside the migration system and reverts it in the same phase.
If a session is interrupted between the two, `npm run db:parity` names the leftover object and
`npm run db:status` confirms no history row was written — the revert is a plain `drop` / `alter`, and
this plan's § Measurement record carries the exact statements.

## Decisions Taken

| Question                          | Decision                                                              | Where it came from              |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| Comparison mechanism              | Management API, `read_only: true`                                     | research (Docker wall measured) |
| Parity check placement            | Before **and** after `db:push`; warn then fail                        | planning                        |
| Where it runs                     | Locally only; `SUPABASE_ACCESS_TOKEN` never reaches CI                | research + planning             |
| Smoke depth                       | Credential-free probe, no production account                          | research + planning             |
| Smoke wiring                      | Wrapped `npm run deploy`, deploy stays manual                         | planning                        |
| On smoke failure                  | Diagnose and print recovery; never auto-rollback                      | planning                        |
| `gymlog-test` `site_url`          | Corrected in Phase 3, then pinned loosely (localhost, not a port)     | planning                        |
| Catalogue data                    | Seeded rows only, `user_id is null`                                   | planning                        |
| Mutation proof                    | Real DDL on `gymlog-test`, reverted                                   | planning                        |
| `strict: false` branch protection | Recorded as a known limit; not changed                                | planning                        |
| Audit-log cost of the smoke       | Accepted at deploy cadence; must not become a cron without revisiting | research open Q2                |

## References

- Research: `context/changes/testing-environment-parity/research.md`
- Risk map and gates: `context/foundation/test-plan.md` §2, §5, §3 row 5
- The wrapper to extend: `scripts/supabase-db.mjs`
- The launcher pattern to copy: `scripts/e2e-serve.mjs:76-98`
- The disproved mitigation: `context/foundation/infrastructure.md:293`

## Measurement record

> Filled in as phases land. Each entry names what was done, what was observed, and what it proves.

- **P1.0** — (Phase 1, 2026-08-21) baseline `db:parity`: **exit 0**, 12 aspects, all agreeing.
  `columns` 77/77 · `constraints` 22/22 · `indexes` 15/15 · `rls_enabled` 5/5 · `policies` 19/19 ·
  `views` 4/4 · `triggers` 12/12 · `functions` 4/4 · `enums` 3/3 · `grants` **9/9** (0/0 under the
  rejected `information_schema` source) · `migrations` 10/10 · `seeded_catalogue` 38/38.
- **P1.1** — (Phase 1) the FLOOR guard proven by mutation: `views.minRows` raised 4 → 99 produced
  `UNVERIFIED views prod=4 test=4` and **exit 2**, with the aspect NOT reported as agreeing. Reverted.
  The one-sided floor branch remains unexecuted and says so in the source.
- **P1.2** — (Phase 1) credential guards: `SUPABASE_ACCESS_TOKEN=` → exit 2 naming the variable;
  `SUPABASE_TEST_URL=` → exit 2 naming the variable; a forced HTTP 400 answered
  `Invalid project ref: <gymlog-test>` — the provider's own error text masked, and
  `Nothing was compared` printed beside it.
- **P2.0** — (Phase 2, 2026-08-21) STRUCTURAL mutation on gymlog-test:
  `alter table public.exercises add column parity_probe_marker text`. `db:parity` → **exit 1**,
  `DIFF columns prod=77 test=78`, printed row
  `gymlog-test only: exercises.parity_probe_marker :: text null=YES default=- generated=-`.
  **Only that aspect went red**, so the failure is for its own reason rather than a blanket one.
- **P2.1** — (Phase 2, 2026-08-21) ACCESS-CONTROL mutation on gymlog-test:
  `create policy parity_probe_noop on public.exercises for select to authenticated using (false)`
  — permissive, so it is OR-ed with the existing select policy and widens nothing. `db:parity` →
  **exit 1**, `DIFF policies prod=19 test=20`, printed row
  `exercises | parity_probe_noop | SELECT | authenticated | using=false | check=-`.
  The predicate is in the compared string, so the aspect sees policy BODIES, not just names.
- **P2.2** — (Phase 2, 2026-08-21) revert confirmed three independent ways.
  (a) `db:parity` → exit 0, all 12 aspects back at their P1.0 counts, exactly.
  (b) A direct catalogue read on BOTH projects: `parity_probe_marker` column 0, `parity_probe_noop`
  policy 0, seeded exercises 38 — which also rules out the green-because-both-sides-were-mutated
  case, since production never held either object.
  (c) `db:status`: ten migration versions on each project, identical, and **no new version row**
  from the DDL — the mutation left no history behind, which is the hazard AGENTS.md names for the
  dashboard SQL editor.
  `npm run test:integration` afterwards: 17 files, 142 tests passed. No CI run was in flight at
  any point (`gh run list`: latest 32464522837, completed 08:43Z; mutations ran ~12:2xZ).
  The mutation tool refuses any target but the literal `gymlog-test` and refuses when
  SUPABASE_TEST_URL resolves to production — both refusals fired before first use. It lives in the
  scratchpad and is deliberately not committed: env-parity.mjs must stay incapable of writing.
- **P3.0** — (Phase 3) `gymlog-test` auth config before and after the correction, read back.
- **P4.0** — (Phase 4) `db:push` with drift planted: before-warning text, after-failure text.
- **P5.0** — (Phase 5) smoke against the deployed URL: code and exit.
- **P5.1** — (Phase 5) negative control: credentials withheld, code and exit.
- **P5.2** — (Phase 5) `Origin` control: header dropped, code and exit.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The parity check

#### Automated

- [x] 1.1 `npm run db:parity` exits 0 and reports every aspect as agreeing — 13aab56
- [x] 1.2 Every aspect reports a row count at or above its floor; no aspect reports 0 — 13aab56
- [x] 1.3 `grants` reports 9 relations on both projects, not 0 — 13aab56
- [x] 1.4 `seeded_catalogue` reports 38 on both; the 75 custom rows appear nowhere — 13aab56
- [x] 1.5 With `SUPABASE_ACCESS_TOKEN` withheld, the script exits 2 and names the variable — 13aab56
- [x] 1.6 `npm run lint` passes — 13aab56
- [x] 1.7 `npx prettier --check scripts/env-parity.mjs package.json` passes — 13aab56

#### Manual

- [x] 1.8 Full-run output names each aspect and its row counts, readable without the source — 13aab56
- [x] 1.9 No token, project ref or connection string appears in success or forced-failure output — 13aab56

### Phase 2: Prove the check bites

#### Automated

- [x] 2.1 Before mutating, `npm run db:parity` exits 0
- [x] 2.2 Column added to `gymlog-test`: exits 1, `columns` aspect names that column
- [x] 2.3 RLS policy altered on `gymlog-test`: exits 1, `policies` aspect names it
- [x] 2.4 After reverting both: exits 0, every aspect back at its Phase 1 row count

#### Manual

- [x] 2.5 No CI run was in flight against `gymlog-test`, checked before and after
- [x] 2.6 Revert confirmed by re-reading the catalogue, not only by the check going green
- [x] 2.7 `npm run db:status` reports identical histories — no history row was written

### Phase 3: The auth-config contract

#### Automated

- [ ] 3.1 `npm run db:parity` exits 0 with the auth-config aspect included and passing
- [ ] 3.2 `gymlog-test` config reads back as `http://localhost:4321` with a non-empty allow list
- [ ] 3.3 Wrong `mailer_autoconfirm` direction makes the check exit 1 naming the project; reverted
- [ ] 3.4 `npm run test:integration` still passes
- [ ] 3.5 `npm run lint` and `npx prettier --check` pass

#### Manual

- [ ] 3.6 The deployed origin has one definition, shared with Phase 5's smoke

### Phase 4: Wire parity into `db:push`

#### Automated

- [ ] 4.1 `npm run db:push` with nothing pending runs the after-check and exits 0
- [ ] 4.2 With drift planted, `db:push` warns before and fails after, with different wording
- [ ] 4.3 With `SUPABASE_ACCESS_TOKEN` withheld, `db:push` fails on the after-check
- [ ] 4.4 `npm run db:status` output is unchanged
- [ ] 4.5 `npm run lint` and `npx prettier --check scripts/supabase-db.mjs` pass

#### Manual

- [ ] 4.6 The two messages are distinguishable at a glance in a real terminal

### Phase 5: The post-deploy smoke

#### Automated

- [ ] 5.1 Against the deployed URL, the smoke exits 0 reporting `sign_in_failed`
- [ ] 5.2 Negative control: built worker served with credentials withheld reports `not_configured`, exit 1
- [ ] 5.3 `Origin` control: header dropped reports the 403 branch and exits 2, not 1
- [ ] 5.4 `wrangler secret list --name gymlog` lists both names
- [ ] 5.5 `npm run lint` and `npx prettier --check` pass

#### Manual

- [ ] 5.6 `npm run deploy` end to end, and the deployed URL still signs a real account in
- [ ] 5.7 Passing output states its two limits
- [ ] 5.8 `not_configured` failure names `wrangler secret put` and does not suggest rollback

### Phase 6: Close the gates in the documents

#### Automated

- [ ] 6.1 `npx prettier --check` passes on all five documents
- [ ] 6.2 No file in `context/foundation/` still describes either gate as pending
- [ ] 6.3 The full eight-step gate passes
- [ ] 6.4 `npm run db:parity` exits 0 and `npm run db:push` completes with both checks green

#### Manual

- [ ] 6.5 §6.9 is sufficient to add an aspect without opening this plan, checked by writing one
- [ ] 6.6 The `lessons.md` entries name the measurement, not just the rule
