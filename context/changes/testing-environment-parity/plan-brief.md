# Environment Parity — Plan Brief

> Full plan: `context/changes/testing-environment-parity/plan.md`
> Research: `context/changes/testing-environment-parity/research.md`

## What & Why

Two failure scenarios on the risk map have no test at any layer, because neither is visible from
inside a single commit. **Risk #6**: a migration proven against the empty test project meets real
rows for the first time on production — `db:status` compares migration _histories_, not schemas.
**Risk #7**: the Worker deploys green, serves 200s, and nobody can sign in because its runtime
secrets are absent — which has already happened here once, with CI green throughout.

## Starting Point

`npm run db:status` runs `supabase migration list` against both projects: it answers "which versions
are recorded", never "what did they produce". Nothing has ever compared the two schemas. On the
deploy side, `src/lib/supabase.ts:34-37` returns `null` for absent credentials and every protected
route then redirects — so a healthy deployment and a secret-less one are **indistinguishable to any
unauthenticated GET**. Both credentials are `optional: true`, so the build cannot notice either.

Research measured the ground: every Supabase-CLI route to a schema comparison needs Docker, which
this machine does not have; the Management API with `read_only: true` reaches both projects on a
token `.env` already carries; and the two schemas agree today across 11 aspects, so the gate goes in
green.

## Desired End State

`npm run db:parity` compares both projects — schema **and** the 38 seeded exercises — and answers
with three distinguishable outcomes, where "could not compare" can never read as "they agree".
`npm run db:push` runs it on both sides of a push, warning before and failing after.
`npm run deploy` deploys and then proves the deployed Worker can actually reach its auth provider,
failing with a diagnosis and a recovery command when it cannot.

## Key Decisions Made

| Decision                   | Choice                                           | Why                                                                                                         | Source   |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------- |
| Comparison mechanism       | Management API, `read_only: true`                | Docker closes every CLI route; refusal proven with `25006` plus a positive control                          | Research |
| Where the check runs       | Locally only                                     | `SUPABASE_ACCESS_TOKEN` is account-wide — strictly more powerful than the DB password CI is already refused | Research |
| Parity check placement     | Before **and** after `db:push`                   | Before catches pre-existing drift; after catches a hand-repaired production push. Warn, then fail           | Plan     |
| Smoke depth                | Credential-free probe                            | The `?error=` code after a POST separates four distinct facts; no production account, no sixth secret       | Both     |
| Smoke wiring               | Wrapped `npm run deploy`                         | Makes it unskippable, the way `db:push` has no single-target variant. Deploy stays manual, out of CI        | Plan     |
| On smoke failure           | Diagnose and print recovery; never auto-rollback | The commonest cause is missing secrets, which rollback cannot fix — it would hide a loud failure quietly    | Plan     |
| Catalogue data             | Seeded rows only (`user_id is null`)             | Production has 0 custom exercises, `gymlog-test` has 75 — an unscoped comparison is pure noise              | Plan     |
| `gymlog-test` `site_url`   | Correct it now                                   | It is `http://localhost:3000` — the exact value `lessons.md` records production shipping wrong              | Plan     |
| Mutation proof             | Real DDL on `gymlog-test`, reverted              | A guard you have not mutated may not guard; the narrowed-query proof only tests the comparator              | Plan     |
| `strict: false` protection | Record as a known limit                          | Not one of this phase's two risks; enabling it in a single-maintainer repo is mostly friction               | Plan     |

## Scope

**In scope:** the parity script and its aspects; a row-count floor per aspect; the seeded-catalogue
comparison; an auth-config contract check; correcting `gymlog-test`'s `site_url`; wiring into
`db:push`; the smoke script; a `deploy` wrapper with a pre-flight secret-name check; mutation proofs
for every guard; documentation across five files.

**Out of scope:** any production code change; a GitHub Actions deploy workflow; any new repository
secret; `optional: true` in `astro.config.mjs`; automatic rollback; comparing user data; closing
`strict: false`.

## Architecture / Approach

Two plain `.mjs` scripts under `scripts/`, following `supabase-db.mjs`'s conventions — tolerant env
loading, validate before the network, mask anything credential-shaped.

The parity script is **aspect-driven**: each aspect is a name, a SQL query, and a **minimum expected
row count**. That floor is the load-bearing part — research found one aspect returning zero rows on
both sides and reporting parity it never performed.

The smoke is one POST whose entire signal is the `?error=` code on the redirect: `sign_in_failed`
passes, `not_configured` and `unexpected` fail with different diagnoses, `rate_limited` is
inconclusive rather than failing, and anything else means the probe itself could not be made.

## Phases at a Glance

| Phase                                   | What it delivers                                           | Key risk                                                                                |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. The parity check                     | `npm run db:parity`, aspects with floors, three exit codes | An aspect that matches by returning nothing — the floor exists for this                 |
| 2. Prove the check bites                | Real DDL mutation on `gymlog-test`, reverted               | **Writes DDL to a database CI also uses** — must not run against a live CI job          |
| 3. Auth-config contract                 | `site_url` corrected; the contract pinned                  | Some fields must differ, so this is not an equality check and is easy to get backwards  |
| 4. Wire into `db:push`                  | Warn before, fail after                                    | Blocking on pre-existing drift would block its own repair                               |
| 5. Post-deploy smoke + `npm run deploy` | The gate for risk #7, with a negative control              | **Deploys to production**; a probe missing `Origin` blames the deploy for its own fault |
| 6. Close the gates in the documents     | `test-plan.md` §5 rows become required; §6.9 cookbook      | Documentation that describes a gate nobody can add an aspect to without this plan       |

**Prerequisites:** `.env` with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_TEST_URL`; a
wrangler login with `workers_scripts` (verified present); no CI run in flight during Phase 2.

**Estimated effort:** ~3–4 sessions across six phases; Phases 1 and 5 carry most of the work, Phases
2 and 3 are short but each has a revert step that must not be left half-done.

## Open Risks & Assumptions

- **Phase 2 leaves the test database mutated if the session is interrupted.** The plan carries the
  exact revert statements and `db:parity` names the leftover object, but this is the one window where
  walking away is expensive.
- **The smoke cannot tell which Supabase project the Worker points at.** `SUPABASE_URL` aimed at
  `gymlog-test` would pass identically. Named as a limit, printed with every passing result rather
  than left implied.
- **Each smoke run leaves a row in production's `auth.audit_log_entries`**, which nothing here can
  remove. Accepted at deploy cadence; revisit before it ever becomes scheduled.
- **The probe address must yield `invalid_credentials`, not a provider validation error.** Measured
  in Phase 5 against the test project first; a reserved-domain address could map to `unexpected`.

## Success Criteria (Summary)

- A schema difference between the two projects is reported, naming what differs — proven by making
  one, not by asserting it.
- A deployed Worker that cannot authenticate anybody fails a command instead of serving 200s
  silently — proven by serving one with its credentials withheld.
- Neither gate can report green while blind: an unverifiable comparison and a probe that could not be
  made both exit differently from success.
