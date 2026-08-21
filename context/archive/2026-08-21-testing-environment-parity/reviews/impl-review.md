<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Environment Parity

- **Plan**: `context/changes/testing-environment-parity/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan)
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION (triaged 2026-08-21 — 3 fixed, 1 dismissed, 1 accepted)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Success criteria re-run (independent of the implementation session)

| Check                       | Result                      |
| --------------------------- | --------------------------- |
| `npm run lint`              | exit 0                      |
| `npm run typecheck`         | 0 errors                    |
| `npm test`                  | 15 files / 249 tests passed |
| `npm run test:render`       | 5 files / 52 tests passed   |
| `npm run test:integration`  | 17 files / 142 tests passed |
| `npm run test:middleware`   | 2 files / 11 tests passed   |
| `npm run build`             | Complete                    |
| `npm run test:e2e`          | 2 passed                    |
| `npm run db:parity`         | exit 0, 13 aspects          |
| `prettier --check` (5 docs) | clean                       |
| smoke vs deployed URL       | PASS, `sign_in_failed`      |

All 42 Progress rows are `[x]` and every row carries a commit SHA.

## Findings

### F1 — The plan's Contract text contradicts the shipped code in two places

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-environment-parity/plan.md:137-139`, `:328`
- **Detail**: Two deviations were made deliberately, announced to the owner at the time, and argued
  in the source — but the plan text was never amended, so the two now disagree.
  1. `plan.md:137` — "An aspect returning fewer than `minRows` **on either** project is a failure of
     the check". Shipped behaviour: below the floor on **both** sides is `UNVERIFIED` (exit 2); on
     **one** side it is real drift and reported as `DIFF` (exit 1). The shipped version is the
     better one — the plan's literal reading would report a project that genuinely lost four views
     as "could not verify", hiding the exact drift the script exists to find.
  2. `plan.md:328` — "The before-check is skipped when `push` has nothing to apply". Shipped
     behaviour: it always runs, because detecting "nothing pending" means parsing the CLI table or
     reconciling filenames against remote history, and a mis-detection silently skips a guard.

  `/10x-archive` freezes this plan as the record. A reader who later compares it against
  `env-parity.mjs` finds two contradictions and no note saying which is authoritative.

- **Fix**: Amend the two Contract lines in place to state the shipped behaviour, each with the
  one-sentence reason, so the archived plan and the code agree.
  - Strength: The plan stays usable as the record. Matches how this repo treats corrected
    assumptions elsewhere — `test-plan.md` § 6.6 rewrites what a document had wrong rather than
    leaving it.
  - Tradeoff: Edits a plan after implementation, which slightly blurs "what was planned" vs "what
    was built" — mitigated by naming them as deviations rather than silently rewriting.
  - Confidence: HIGH — both deviations are already argued at length in the source comments; this is
    copying the reasoning to the second location.
  - Blind spot: None significant.
- **Decision**: FIXED — both Contract lines amended in place and marked as deviations with their reasons

### F2 — Neither mutation proof is reproducible: the tooling was never committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `scripts/` (absent); evidence in `plan.md` § Measurement record P2.0–P2.2, P5.1–P5.2
- **Detail**: The two central claims of this change are that the parity check goes red **naming the
  change**, and that the smoke can report a failing deployment at all. Both were proven by
  measurement — and both were proven with throwaway scripts in a session scratchpad. `git ls-files
scripts/` lists seven files; neither the DDL mutation tool nor the credential-less worker launcher
  is among them.
  **This repo's established pattern is the opposite.** `scripts/e2e-build.mjs` and
  `scripts/e2e-serve.mjs` are split across two processes and both committed _specifically_ so the
  refusal is "provable by planting the file and running the launcher directly" — a check that never
  fires being indistinguishable from one that passes. Here, re-verifying either proof means
  rebuilding the tool from the plan's prose, which nobody will do, so in practice the proofs decay
  into claims.
- **Fix A ⭐ Recommended**: Commit a `scripts/parity-selftest.mjs` that applies a DDL mutation to
  `gymlog-test`, asserts `db:parity` returns `DIFFERS` naming that object, and reverts in a
  `finally` — with the same "literal `gymlog-test` only" refusal the throwaway tool had.
  - Strength: Turns the strongest evidence in this change into something re-runnable, matching the
    e2e launcher precedent. The revert-in-`finally` also fixes the plan's own named risk that an
    interrupted Phase 2 leaves the databases mutated.
  - Tradeoff: A committed script that writes DDL to a shared database is a new hazard surface, and
    it must never be reachable from the gate or from CI.
  - Confidence: MEDIUM — the shape is proven (it ran twice today), but making it safe to commit is
    more than moving the file.
  - Blind spot: Interaction with the `gymlog-test-fixtures` concurrency group has only been managed
    by a human checking `gh run list`; a committed tool would need that check built in.
- **Fix B**: Record the gap explicitly in `test-plan.md` § 6.6 — the proofs were real, the tooling
  is gone, and re-proving means rebuilding from § 6.9.
  - Strength: Honest and free. This repo already names gaps rather than implying coverage.
  - Tradeoff: The proof stays un-re-runnable, and § 6.9's "prove any new aspect by breaking
    something" instruction has no tool behind it.
  - Confidence: HIGH — purely documentation.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `scripts/parity-selftest.mjs` committed; asserts aspect + named object + nothing-else-moved, reverts in a `finally`, refuses a non-`gymlog-test` target, crossed URLs, and an in-flight CI run. Proven able to fail by pointing a fragment at a string that never appears. Wired into test-plan §6.9/§6.6 and AGENTS.md.

### F3 — `npm run deploy` ships without running the gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `scripts/deploy.mjs:52-100`
- **Detail**: The sequence is `astro build` → secret names → `wrangler deploy` → smoke. There is no
  lint, no typecheck, no test run, and no check of git state. `AGENTS.md` § Commands says to run all
  eight gate steps before claiming a change is done, and `main` is branch-protected — but
  `npm run deploy` reads no git state at all, so running it on a dirty feature branch ships that
  branch to production. The new smoke would still pass, because a broken feature does not stop the
  auth provider being reachable: the command would report success over a deployment that never
  passed a single test.
  This is faithful to the plan, which specified exactly this sequence. The plan is what is wrong.
- **Fix A ⭐ Recommended**: Refuse to deploy when the working tree is dirty or `HEAD` is not on
  `main`, with an explicit override flag.
  - Strength: Cheap, catches the realistic mistake (deploying mid-work), and leans on branch
    protection — which already guarantees anything on `main` passed `ci` — instead of re-running ten
    minutes of checks locally.
  - Tradeoff: An override flag exists, so it is a speed bump rather than a wall; and it assumes the
    local `main` is not behind the remote.
  - Confidence: MEDIUM — the rule is right, but `strict: false` on branch protection (a named limit
    in `test-plan.md` § 5) means a merged commit was not necessarily green against its final base.
  - Blind spot: Whether the owner ever deliberately deploys a branch — no such case is recorded.
- **Fix B**: Run the full eight-step gate inside `npm run deploy` before building.
  - Strength: Strongest possible guarantee; nothing untested can reach production.
  - Tradeoff: Adds roughly ten minutes and two network suites to every deploy, duplicating what CI
    already did on the PR. A slow deploy command invites people to bypass it with `wrangler deploy`,
    which is exactly the habit this change set out to remove.
  - Confidence: HIGH on the mechanics, LOW that it survives contact with daily use.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `deploy.mjs` now reads git state before building and refuses a dirty tree or a non-`main` HEAD, with `--allow-dirty` / `--allow-branch` as separate overrides so each guard is independently waivable and independently testable. Both refusals proven. README documents them.

### F4 — Criterion 5.6's evidence does not distinguish localhost from the deployed URL

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Progress row 5.6
- **Detail**: 5.6 reads "`npm run deploy` end to end, **and the deployed URL still signs a real
  account in**". The first half is recorded in P5.5 with a version ID. For the second half, a dev
  server on `localhost:4321` was started at the owner's request and the confirmation was "I signed
  in, everything works", without naming which target. Both point at the same production Supabase, so
  a localhost sign-in looks identical and proves less: it exercises local code, not the deployed
  Worker — which is the entire distinction risk #7 turns on. The row is checked; the evidence may be
  for the wrong target.
- **Fix**: Sign in once at `https://gymlog.10x-astro-starter.workers.dev/auth/signin` and confirm
  the session cookie is `sb-<production-ref>-auth-token` — which also closes the one gap the smoke
  prints on every pass (it cannot tell which project the Worker points at).
- **Decision**: DISMISSED — the owner confirmed on 2026-08-21 that the sign-in was performed against the deployed URL, not localhost. Criterion 5.6 stands as checked.

### F5 — `eslint.config.js` changed without appearing in the plan

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `eslint.config.js` (+3 lines)
- **Detail**: `URLSearchParams` added to the `scripts/**` globals, needed because the smoke posts a
  form body. Not named in any phase's "Changes Required". Benign and arguably required by the
  config's own design — its comment says the globals list is deliberately explicit because "what
  these scripts are allowed to reach is part of what they are", so extending it consciously is the
  intended way to use it, and the addition carries a comment saying why. Recorded for completeness
  rather than as a problem.
- **Fix**: None needed.
- **Decision**: ACCEPTED — no change. The addition matches the config's own design (an explicit globals list, meant to be extended consciously) and carries a comment saying why.

## Scope guardrails — all respected

Every item in the plan's "What We're NOT Doing" holds: no deploy workflow in GitHub Actions, no
`SUPABASE_ACCESS_TOKEN` or `CLOUDFLARE_API_TOKEN` in CI, no automatic rollback, no production
account or sixth repository secret, no change to `optional: true` in `astro.config.mjs`,
`strict: false` left alone and recorded as a limit, and no comparison of user data (the catalogue
aspect is scoped to `user_id is null`).

## Safety notes — no findings

- Every parity query is sent with `read_only: true`, and the refusal was measured (`25006`) with a
  positive control. The endpoint runs as `supabase_read_only_user`, not `postgres`.
- Project refs and the access token are masked before any output, including inside provider error
  text — verified by forcing an HTTP 400 and seeing `Invalid project ref: <gymlog-test>`.
- `deploy.mjs` prints secret **names** only, never values.
- The smoke sends no credential of any kind and needs no account.
- Targets are derived from `SUPABASE_URL` / `SUPABASE_TEST_URL` rather than configured, so no
  variable can aim the comparison at a third project.
