<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Account-Owned Persistence Baseline

- **Plan**: `context/changes/owned-persistence-baseline/plan.md`
- **Scope**: all six phases (51/51 Progress items complete)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION → all findings fixed 2026-08-10
- **Findings**: 0 critical, 6 warnings, 2 observations

## Verdicts

| Dimension          | Verdict |
| ------------------ | ------- |
| Plan Adherence     | WARNING |
| Scope Discipline   | WARNING |
| Safety & Quality   | WARNING |
| Architecture       | PASS    |
| Pattern Consistency| WARNING |
| Success Criteria   | PASS    |

**Clean bills of health, verified line by line:** the migration's policy block is correct on every
axis (RLS in the creating migration, `revoke` before `grant`, grant set and policy set agreeing
exactly, UPDATE carrying both `using` and `with check`, `(select auth.uid())` throughout, both
functions `set search_path = ''` and schema-qualified, FK cascade as defence in depth). No SQL
injection surface. No hardcoded secrets. Nothing added scales with data volume inside the Worker.
All eight integration assertions match the plan's semantics. Nothing from "What We're NOT Doing"
was violated. Production isolation holds in CI: no production database credential exists there,
and neither Vitest config can match the other's files.

## Findings

### F1 — The integration suite is handed every `.env` key, including production's

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.integration.config.ts:10,31
- **Detail**: `process.loadEnvFile()` loads all eight keys into the config process and
  `env: { ...process.env }` forwards the lot to the test environment — including `SUPABASE_DB_URL`
  and the account-wide `SUPABASE_ACCESS_TOKEN`. Nothing in the suite reads them, so this is a
  weakened invariant rather than a live bug, but the suite's own header claims it is *incapable* of
  reaching production. CI is unaffected (it supplies only the three test values), so the local and
  CI blast radii differ — the opposite of what the comment asserts.
- **Fix**: build the `env` object from an explicit allowlist of `SUPABASE_TEST_URL`,
  `SUPABASE_TEST_KEY`, `GYMLOG_TEST_PASSWORD` instead of spreading `process.env`.
  - Strength: makes the file enforce the sentence its sibling test's header makes.
  - Tradeoff: none — the suite reads nothing else.
  - Confidence: HIGH — the three variables are the only ones `required()` asks for.
  - Blind spot: None significant.
- **Decision**: FIXED — env allowlist in vitest.integration.config.ts

### F2 — The concurrency group does not cover the race its comment describes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:14-16
- **Detail**: `group: ci-${{ github.ref }}` resolves to `refs/heads/main` for pushes and
  `refs/pull/<n>/merge` for pull requests, so a PR run and a push run — or two different PRs — land
  in different groups and execute concurrently against the same two fixture rows in `gymlog-test`.
  The plan anticipated this and recorded it as an accepted residual gap; the comment written into
  `ci.yml` does not, and reads as though the guard is complete.
- **Fix A ⭐ Recommended**: use a constant group (`gymlog-test-fixtures`) so every run serialises.
  - Strength: closes the gap outright rather than documenting it; with `cancel-in-progress: false`
    already set, runs queue rather than cancel, so nothing is lost.
  - Tradeoff: all CI runs serialise, not just the integration step. On a solo repository with a
    ~70-second pipeline this is not felt.
  - Confidence: HIGH — behaviour of a constant concurrency group is unambiguous.
  - Blind spot: if this repository ever gains several contributors, queueing could become visible.
- **Fix B**: keep the ref-scoped group and correct the comment to state the residual gap.
  - Strength: matches what the plan actually decided; zero behaviour change.
  - Tradeoff: leaves a real interleaving reachable, repaired only by the `beforeAll` reset.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — constant concurrency group gymlog-test-fixtures

### F3 — A malformed connection string could reach stderr through the CLI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/supabase-db.mjs:66-73,80,88
- **Detail**: The wrapper's own paths never print the URL — verified. But it passes the string to a
  child with `stdio: "inherit"`, and the CLI's *parse*-failure path echoes what it could not parse.
  The plan verified the CLI's *connection*-error text carries host/user/database but not the
  password; the parse path was not verified. A password containing an unencoded `@`, `#` or `/` —
  precisely the mistake `.env.example` warns about — is the trigger.
- **Fix**: validate with `new URL(url)` inside `urlFor()` before spawning, failing with a message
  that names only the variable.
  - Strength: keeps the guarantee inside the one file that claims to own it, and catches the
    percent-encoding mistake earlier and more clearly than the CLI does.
  - Tradeoff: none.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — URL validated in urlFor() before any spawn; capture() also masks child stderr

### F4 — The most security-sensitive file in the repository is excluded from lint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.js:77
- **Detail**: `ignores: ["scripts/**", ...]` removes the file that handles database passwords and
  spawns processes against production from linting entirely. The stated reason — it is outside the
  type-checked TypeScript project — is a type-checking problem with a narrower fix than a blanket
  ignore.
- **Fix**: replace the `scripts/**` ignore with a dedicated block that keeps the core rules and
  drops only the type-aware ones (`tseslint.configs.disableTypeChecked`, `projectService: false`).
  Keep the `database.types.ts` ignore — that rationale is sound.
  - Strength: restores lint coverage where it matters most without weakening any rule elsewhere.
  - Tradeoff: a few lines of config.
  - Confidence: MEDIUM — the exact incantation may need one iteration against this flat config.
  - Blind spot: None significant.
- **Decision**: FIXED — scripts/** linted with type-aware rules disabled instead of ignored

### F5 — The plan was never amended for the deviations taken during implementation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: context/changes/owned-persistence-baseline/plan.md:43-45,230,370
- **Detail**: The plan still specifies `gen types --db-url`, still records `SUPABASE_ACCESS_TOKEN`
  as "Not used", and still says `.env` carries six keys; it carries eight. Two CLI flags added
  during implementation (`--yes`, `--output-format text`) appear only in a code comment. The
  deviations are well documented in `AGENTS.md`, `README.md`, `.env.example`, roadmap OQ3 and the
  commit messages, so no agent is misled — but the plan is the artifact an S-02 planner will read
  for "how are migrations done here".
- **Fix**: add a dated entry to the plan's `## Revision history` recording all four deviations and
  their reasons.
  - Strength: keeps the change's own record truthful without rewriting decided history.
  - Tradeoff: none.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — 2026-08-10 entry added to the plan Revision history

### F6 — Three statements this change falsified survived Phase 6

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: AGENTS.md:90-91; context/foundation/roadmap.md:90,92,141
- **Detail**: `AGENTS.md` still describes the gate as "lint → typecheck → test → build" in the
  sentence that claims to give CI's order; CI now runs five steps. The roadmap says twice that the
  pipeline "runs lint, typecheck, unit tests and build", and its F-03 **Unknowns** bullet still
  says the migration method "needs deciding" — three sections above where the same document records
  the decision as taken. Phase 6's contract named other bullets specifically, so these fall outside
  its letter but squarely inside its stated intent.
- **Fix**: sweep the four lines.
  - Strength: Phase 6 exists precisely to stop a stale document being an active hazard.
  - Tradeoff: none.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — AGENTS.md gate sentence and three roadmap lines swept

### F7 — `EstimationFormula` is declared twice and nothing keeps the two in step

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/types.ts:18 vs src/lib/services/one-rep-max.ts:9
- **Detail**: `src/types.ts` derives the union from the Postgres enum; `one-rep-max.ts` hand-writes
  `"epley" | "brzycki"`. They agree today. Add a third formula to the enum and `src/types.ts`
  widens silently while `estimateOneRepMax` keeps the narrower parameter — either a confusing
  compile error or, if someone reaches for `as`, a new formula falling through to the Epley branch
  and producing a wrong number the user will believe. The duplication itself is required:
  `AGENTS.md` keeps the calculation module dependency-free so it stays unit-testable.
- **Fix**: add a compile-time assertion in `src/types.ts` that the two unions are mutually
  assignable.
  - Strength: turns a silent widening into a build failure, at zero runtime cost, without making
    `one-rep-max.ts` import anything.
  - Tradeoff: two lines of type-level code that need a comment explaining why they exist.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — compile-time assertion in src/types.ts, mutation-tested

### F8 — The dashboard read discards its error

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:9
- **Detail**: Only `data` is destructured. A PostgREST failure, a revoked grant or a schema-cache
  miss renders identically to a genuinely absent row — the page shows "not set" and nothing records
  that the read failed. This is the same silent-failure class `AGENTS.md` § Cloudflare traps warns
  about, arriving through a second door. `maybeSingle()` and the `?? { data: null }` guard are both
  correct; only the dropped error is the issue.
- **Fix**: destructure `error` and `console.warn` when it is non-null, so a failed read is
  distinguishable from an unset value in Workers logs.
- **Decision**: FIXED — error destructured and warned in dashboard.astro

## Not findings, recorded so they are not re-raised

- **Inline query in `dashboard.astro` rather than `src/lib/services/`** — proportionate for one
  demonstration `select`, and the unfiltered read is correct for `profiles` specifically. The
  moment a page reads `workouts` or `sets`, the service module and the `.eq("user_id", …)` index
  path both become required (`AGENTS.md` § Access control).
- **`--yes` on the production push** — deliberate: a single command addressing two databases cannot
  stop for an interactive prompt, and test-first ordering is the real safety mechanism. Recorded in
  F5 rather than treated as a defect.
- **`!(verb in VERBS)` walks the prototype chain** in `scripts/supabase-db.mjs` — `hasOwn` would be
  tighter; dev-only script, no impact.
- **Fork pull requests** cannot see the secrets, so the integration step fails rather than skips.
  Correct trade for a solo repository ("must never skip its way to green").
