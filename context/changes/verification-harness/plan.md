# Domain-Rule Verification Harness — Implementation Plan

> Roadmap item: **F-01** (`context/foundation/roadmap.md` § Foundations)
> Change identity: `context/changes/verification-harness/change.md`

## Overview

Wire a unit-test runner into the repository, add a `typecheck` script, and extend the CI gate so
it runs **lint → typecheck → unit tests → build** instead of lint + build. Prove the gate works by
landing the smallest real subject it can catch: the pure one-rep-max helpers and their boundary
tests.

The roadmap's outcome for F-01 is _"a wrong derived number fails the pipeline instead of reaching a
screen."_ A runner with an empty test glob cannot demonstrate that outcome — it produces a green
pipeline that checks nothing, which is the same silent-pass failure mode `AGENTS.md` warns about
for Cloudflare secrets. So this change ships the harness **and** the first rule under it.

## Current State Analysis

Verified against the working tree on 2026-08-09, not assumed.

- **No test runner exists.** `package.json` has `dev`, `build`, `preview`, `astro`, `lint`,
  `lint:fix`, `format`. No `test`, no `typecheck`. `npm ls vitest` → not installed.
- **CI runs lint + build only.** `.github/workflows/ci.yml` — one `ci` job:
  `checkout@v5 → setup-node@v5 (node 22, npm cache) → npm ci → npx astro sync → npm run lint →
npm run build` (build gets `SUPABASE_URL` / `SUPABASE_KEY` from repository secrets).
- **Typechecking already works, it is just not wired.** `@astrojs/check@0.9.9` is already a
  **dependency** (not a devDependency — a pre-existing nit, not worth fixing here). Measured:
  - `npx astro check` → `Result (28 files): 0 errors, 0 warnings, 4 hints`, **exit 0**. The 4 hints
    are `ts(6387)` deprecation notices on `tseslint.config()` in `eslint.config.js`. Hints do not
    fail the command.
  - `npx tsc --noEmit` → **exit 0**, silent. `--listFiles` shows 21 project files (all `.ts`/`.tsx`
    under `src/`, plus `astro.config.mjs`, `eslint.config.js`, `.astro/*.d.ts`). `.astro` files are
    invisible to `tsc`.
  - **Probe (run and reverted):** a deliberate type error in a plain `src/lib/*.ts` file made
    `npx astro check` report `1 error … ts(2322)` and **exit 1**. So `astro check` is a strict
    superset of `tsc --noEmit` here — it catches plain-TS errors _and_ `.astro` errors.
- **Lint is green.** `npm run lint` → exit 0 (with harmless `astro-eslint-parser does not support
projectService` notices). ESLint runs `strictTypeChecked` + `stylisticTypeChecked` +
  `eslint-plugin-prettier`, so any new `.ts` file must be both type-clean and Prettier-clean.
- **`tsconfig.json` already covers everything new.** `include: [".astro/types.d.ts", "**/*"]`,
  `exclude: ["dist"]`, path alias `@/* → ./src/*`. New test files and a root `vitest.config.ts`
  are picked up with **no tsconfig change**.
- **No domain code exists.** `src/lib/` holds `supabase.ts`, `utils.ts`, `config-status.ts`. There
  is no `src/lib/services/`, no `src/types.ts`, no 1RM / tonnage / record function anywhere.
- **Dependency ground truth:** `astro@6.4.8`, `vite@7.3.6` (forced by the root
  `overrides: { "vite": "^7.3.2" }`), `@astrojs/cloudflare@13.5.0`, `typescript@5.9.3`,
  node `v22.14.0`, npm `10.9.2`. `vitest@4.1.10` is current; its `vite` dependency range is
  `^6 || ^7 || ^8` and its `engines.node` is `^20 || ^22 || >=24` — both satisfied, and the root
  `overrides` pin means vitest reuses the single hoisted `vite@7.3.6`.

### Key Discoveries

- `src/lib/config-status.ts:1` imports `astro:env/server`. That virtual module only resolves inside
  Astro's Vite pipeline. **A plain Vitest config cannot import it** — which is a feature here, not a
  limitation: `AGENTS.md` requires the 1RM / tonnage / record calculations to be "plain,
  dependency-free functions", and a plain Vitest config makes any violation fail loudly at import
  time. Escape hatch for later, if a slice must test Astro-coupled code:
  `import { getViteConfig } from "astro/config"`.
- `astro check` type-checks plain `.ts` files (probe above) — so **one** `typecheck` script suffices;
  no need to run both `astro check` and `tsc --noEmit`.
- `.gitattributes` pins `* text=auto eol=lf` and the machine has `core.autocrlf=true`. Every new
  file must be written **LF**; Prettier's default `endOfLine: "lf"` is enforced through
  `eslint-plugin-prettier`, so a CRLF file fails `npm run lint` on every line.
- Pre-commit (`.husky/pre-commit` → `lint-staged`) runs `eslint --fix` on `*.{ts,tsx,astro}` and
  `prettier --write` on `*.{json,css,md}`. `vitest.config.ts` and `*.test.ts` go through
  `eslint --fix`; `package.json` and the docs go through `prettier --write`. Both new file kinds
  must survive that unchanged.
- Formula ground truth, computed with node (these are the exact expected values for the tests):

  | set      | Brzycki `w·36/(37−r)` | Epley `w·(1+r/30)`                               |
  | -------- | --------------------- | ------------------------------------------------ |
  | 100 × 1  | `100` (exact)         | `103.33333333333334` ← **must be pinned to 100** |
  | 100 × 5  | `112.5` (exact)       | `116.66666666666667`                             |
  | 100 × 12 | `144` (exact)         | `140` (exact)                                    |
  | 60 × 8   | `74.48275862068965`   | `76` (exact)                                     |
  | 100 × 37 | `Infinity`            | —                                                |
  | 100 × 40 | `-1200`               | —                                                |

## Desired End State

- `npm test` runs a unit-test suite and exits non-zero when a derived number is wrong.
- `npm run test:watch` gives a local red/green loop.
- `npm run typecheck` runs `astro check` and exits non-zero on any type error, in `.astro` and
  `.ts` alike.
- `.github/workflows/ci.yml` runs lint, typecheck, unit tests and build on every push and PR to
  `main`; breaking the Brzycki divisor turns the pipeline red at the `npm test` step.
- `src/lib/services/one-rep-max.ts` holds the minimal pure 1RM helpers, and
  `src/lib/services/one-rep-max.test.ts` pins their boundaries: 1-rep equality (Epley pinned),
  the 12-rep upper edge, no estimate outside 1–12, zero load, negative (assisted) load.
- `README.md` and `AGENTS.md` no longer claim the pipeline runs "lint + build only".

Verify: `npm run lint && npm run typecheck && npm test && npm run build` all exit 0 locally, and
the GitHub Actions "CI" run for the change is green with the two new steps visible.

## What We're NOT Doing

Out of scope, deliberately — each has an owner elsewhere in the roadmap:

- **Anything touching a database** — no Supabase, no migrations, no RLS, no integration tests. No
  database project exists (roadmap F-03) and there is no local Docker/Supabase stack on this
  machine. Every test in this change is a pure function call.
- **Deployment** — F-02 `smoke-deploy`, awaiting the owner's approval.
- **Playwright / E2E / browser tests** — Faza 3, `/10x-e2e`.
- **Git hooks beyond what exists** — no test-on-commit, no Lefthook. Faza 3.
- **A full test strategy or coverage gate** — `/10x-test-plan` is Faza 3. No
  `@vitest/coverage-v8`, no thresholds, no custom reporters.
- **Tonnage, records, week boundaries, unit conversion helpers** — those belong to S-03, S-04,
  S-05, S-06, S-07, S-08, which extend `src/lib/services/` when they land. This change ships 1RM
  only.
- **`src/types.ts`** — `AGENTS.md` reserves it for shared entity and DTO types. No entity exists
  yet; creating the file for one string union would be premature.
- **Bumping Astro to 7** — `AGENTS.md` forbids it; the Cloudflare adapter build fails
  (`context/changes/bootstrap-verification/verification.md`).
- **Moving `@astrojs/check` from `dependencies` to `devDependencies`** — correct but unrelated
  churn; leave it.

## Implementation Approach

Three phases, each independently verifiable and each safely committable on its own:

1. **Wire the runner.** Vitest + `vitest.config.ts` + three npm scripts. Nothing depends on a test
   existing yet.
2. **Give it something true to guard.** The minimal pure 1RM helpers and their boundary tests, plus
   a hands-on demonstration that mutating the arithmetic turns `npm test` red.
3. **Move the gate.** Extend `ci.yml`, then correct the two documents that assert the old gate.

Order matters: CI must not gain a `npm test` step before a test exists, or the first push is a red
pipeline for a reason unrelated to the change.

### Why Vitest

Vite 7.3.6 is already in the tree (Astro's own bundler). Vitest reuses that Vite instance, so ESM,
TypeScript, and path aliases work with no transform configuration and no Babel. The root
`overrides: { "vite": "^7.3.2" }` forces a single deduplicated Vite. Jest would need a separate
TS transform and a second module-resolution story for a stack that is Vite end to end. Node's
built-in `node:test` would work for pure functions but gives no watch UX and no future path to
component tests. Vitest is the default for this stack; this is not a close call and is not
re-litigated further.

## Critical Implementation Details

**Vitest deliberately does not load the Astro pipeline.** `vitest.config.ts` is a plain Vite config
— it resolves the `@` alias itself and nothing else. Anything imported by a test that transitively
imports `astro:env/server`, `astro:content`, or any other `astro:*` virtual module will fail with
`Failed to resolve import`. That is the intended guardrail: domain logic must stay dependency-free.
If a later slice genuinely needs to test Astro-coupled code, switch that config to
`getViteConfig` from `astro/config` rather than stubbing the virtual module.

**`passWithNoTests` is deliberately NOT set in the config.** If the include glob ever stops matching,
CI must go red rather than pass a suite of zero tests. Phase 1 passes the flag on the command line
once, for the single moment when no test file exists yet.

**No rounding inside the helpers.** The NFR "displayed weights carry at most one decimal place" is a
_presentation_ rule. Business Logic § Units says conversion and rounding "may never move a value far
enough to invent a record or erase one" — so record comparison must happen on the unrounded value.
The helper returns raw arithmetic; whoever renders it rounds.

**Ordering inside Phase 3.** `npx astro sync` must stay in the workflow ahead of `npm run lint`
(type-aware linting needs `.astro/types.d.ts`). `astro check` runs sync internally too — the
duplication costs a few seconds and is not worth removing.

---

## Phase 1: Wire the unit-test runner

### Overview

Install Vitest, add a root config, and add the `test`, `test:watch` and `typecheck` scripts. No test
file yet — this phase proves the runner and the typecheck command are correctly wired and that
neither disturbs lint or build.

### Changes Required

#### 1. Package manifest

**File**: `package.json`

**Intent**: Add the test runner as a devDependency and expose the three commands CI and the
developer will use. `typecheck` needs no new dependency — `@astrojs/check` is already installed.

**Contract**: install with `npm install -D vitest @types/node` (vitest resolves to `4.x`).
`@types/node` is explicit on purpose: `vitest.config.ts` imports `fileURLToPath` from `node:url`,
and today those types resolve only through a transitively hoisted `@types/node` that Vite happens
to pull in. Vitest lists it as an _optional_ peer, so nothing would warn if that hoist changed.
`scripts` gains exactly three keys:

- `"test": "vitest run"` — single pass, non-interactive, CI-safe.
- `"test:watch": "vitest"` — watch mode for local work.
- `"typecheck": "astro check"` — chosen over `tsc --noEmit` because it covers `.astro` files as
  well, and a probe confirmed it also fails on plain-`.ts` type errors.

Do not touch `overrides`, `lint-staged`, or the existing scripts.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repository root, **LF line endings**)

**Intent**: A minimal, Astro-free Vite config that finds the tests and resolves the `@` alias the
same way `tsconfig.json` does.

**Contract**: default-exports `defineConfig` from `vitest/config` with
`test.environment: "node"`, `test.include: ["src/**/*.test.{ts,tsx}"]`, and a `resolve.alias`
entry mapping `@` to `./src`. Globals stay off — tests import `describe` / `it` / `expect` from
`"vitest"` explicitly, which keeps `tsconfig.json` untouched (no `types: ["vitest/globals"]`
needed) and keeps ESLint's `no-undef` story clean. No `passWithNoTests`, no coverage block, no
setup files.

The alias is the one non-obvious line — it must not be a bare relative string, because Vitest
resolves aliases relative to the process CWD:

```ts
resolve: {
  alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
}
```

The file is type-checked (`tsconfig.json` includes `**/*`) and linted with `strictTypeChecked`, so
it must be Prettier-formatted at 120 columns with double quotes and trailing commas.

### Success Criteria

#### Automated Verification

- Vitest installed and deduplicated: `npm ls vitest` prints `vitest@4.x`; `npm ls vite` prints
  several lines (astro, cloudflare, react, tailwind, vitefu all depend on it) and **every one of
  them reads `7.3.6`** — no second version anywhere, and no nested
  `node_modules/vitest/node_modules/vite`. No `ERESOLVE` / `UNMET PEER DEPENDENCY` line.
- Runner is wired: `npm test -- --passWithNoTests` exits 0 (reports "No test files found" — expected,
  this is the only phase where that is acceptable).
- Typecheck script works: `npm run typecheck` prints `0 errors` (4 pre-existing hints are fine) and
  exits 0.
- New files survive the linter: `npm run lint` exits 0.
- Build is undisturbed: `npm run build` exits 0.

#### Manual Verification

- `npm run test:watch` enters watch mode and stays running until interrupted (confirms `test` and
  `test:watch` are not accidentally the same command).

**Implementation Note**: pause after this phase for manual confirmation before starting Phase 2.

---

## Phase 2: First domain rules under the harness

### Overview

Add the minimal pure one-rep-max helpers and the boundary test set that pins them, then demonstrate
by hand that mutating the arithmetic turns `npm test` red. This is what turns "a runner exists" into
"a wrong derived number fails".

**Scope decision recorded here on purpose** — see "Decisions taken without the owner" at the bottom.
The roadmap's F-01 _Risk_ note says "the tests themselves belong to the slices that own the rules".
That is honoured for tonnage, records, week boundaries and units, which are not touched. The 1RM
helpers are the deliberate exception, because F-01's _Outcome_ ("a wrong derived number fails the
pipeline") is unverifiable with zero tests. S-03 and S-06 extend this file; they do not rewrite it.

### Changes Required

#### 1. One-rep-max helpers

**File**: `src/lib/services/one-rep-max.ts` (new; creates `src/lib/services/`)

**Intent**: The single place the estimated-one-rep-max arithmetic lives, as plain functions with no
imports at all — no `astro:*`, no zod, no date library — so they stay directly unit-testable, per
`AGENTS.md` § Conventions.

**Contract**:

- `export type EstimationFormula = "epley" | "brzycki";` — the union stays local to this module for
  now; S-06 may promote it to `src/types.ts` when entity types exist.
- `export const MIN_ESTIMABLE_REPS = 1;` and `export const MAX_ESTIMABLE_REPS = 12;`
- `export function isEstimable(weight: number, reps: number): boolean` — true only when `reps` is an
  integer in `[MIN_ESTIMABLE_REPS, MAX_ESTIMABLE_REPS]` and `weight` is finite and `>= 0`. This is
  the predicate record detection will later use to exclude a set (S-04).
- `export function estimateOneRepMax(weight: number, reps: number, formula: EstimationFormula): number | null`
  — returns `null` whenever `isEstimable` is false (never a fabricated number); otherwise:
  - `reps === 1` → returns `weight` exactly, for **both** formulas. Brzycki yields this naturally;
    Epley must be pinned, or a 100 kg single reports as 103.33.
  - Brzycki → `weight * 36 / (37 - reps)`
  - Epley → `weight * (1 + reps / 30)`
- No rounding, no unit awareness, no I/O, no throwing. Same inputs always yield the same number
  (NFR § determinism).

#### 2. Boundary test set

**File**: `src/lib/services/one-rep-max.test.ts` (new, **LF line endings**)

**Intent**: Pin every boundary `AGENTS.md` calls out for 1RM, so changing the behaviour requires
changing a test and saying so.

**Contract**: `import { describe, expect, it } from "vitest";` — no globals. The subject is imported
**through the alias**, `import { … } from "@/lib/services/one-rep-max";`, not relatively: the alias
is the one non-obvious line in `vitest.config.ts`, and a relative import would leave it exercised by
nothing until S-03 discovers it is broken. Cases, each asserting against the exact values in the
table under "Key Discoveries":

- **1-rep equality**: `estimateOneRepMax(100, 1, "brzycki") === 100` and
  `estimateOneRepMax(100, 1, "epley") === 100`. The Epley case is the canary for the pin — it fails
  with `103.33333333333334` if the pin is removed.
- **Known values inside the range**: Brzycki `100 × 5 → 112.5` exactly; Epley `100 × 5 →
116.66666666666667` (use `toBeCloseTo`); Epley `60 × 8 → 76`; Brzycki `60 × 8 →
74.48275862068965` (`toBeCloseTo`).
- **Upper edge is inclusive**: `reps = 12` returns a number for both formulas (Brzycki `144`,
  Epley `140`, both exact).
- **Outside the range there is no estimate**: `reps = 0`, `reps = 13`, `reps = 37` (Brzycki would
  return `Infinity`) and `reps = 40` (would return `-1200`) all return `null`, for both formulas.
- **Non-integer reps** return `null` (`reps = 2.5`).
- **Zero load**: `estimateOneRepMax(0, 5, …)` returns `0` for both formulas — a bodyweight set is
  recorded honestly, not excluded. See the decision note below.
- **Negative (assisted) load**: `estimateOneRepMax(-20, 5, …)` returns `null` for both formulas, and
  `isEstimable(-20, 5)` is `false` — the hook S-04 uses to keep assisted sets out of record
  detection.
- **Determinism**: the same call twice returns the identical number (NFR § determinism), covering
  the whole 1–12 range in a loop.

### Success Criteria

#### Automated Verification

- Tests pass: `npm test` exits 0 and reports `1 passed` test file with **0 failed** tests.
- The glob actually matched: the `npm test` output names `src/lib/services/one-rep-max.test.ts`
  (guards against a silent zero-test pass).
- Types are clean: `npm run typecheck` prints `0 errors` and exits 0 — this also proves the test
  file itself is type-checked, which is the reason no tsconfig change was needed.
- Lint survives `strictTypeChecked` + Prettier on the two new files: `npm run lint` exits 0.
- Build is undisturbed — test files are never imported by a page, so nothing enters the bundle:
  `npm run build` exits 0.

#### Manual Verification

- **Red proof (arithmetic)**: temporarily change the Brzycki numerator from `36` to `35` in
  `one-rep-max.ts`, run `npm test`, and confirm it fails on the `100 × 5 → 112.5` expectation.
  Revert; `npm test` is green again.
- **Red proof (the pin)**: temporarily remove the `reps === 1` pin, run `npm test`, and confirm the
  Epley single test fails with `103.33333333333334`. Revert; `npm test` is green again.
- Neither revert leaves a trace: `git status --porcelain src/lib/services/one-rep-max.ts` prints
  nothing once the file is committed. (`git diff --stat` is the wrong instrument here — it never
  reports an untracked file, so it would print nothing whether the revert worked or not.)

**Implementation Note**: pause after this phase for manual confirmation before starting Phase 3.

---

## Phase 3: Move the pipeline gate, and correct the documents that describe it

### Overview

Extend `.github/workflows/ci.yml` with typecheck and test steps, then update the two files that
currently assert the old gate. A stale `AGENTS.md` is an active hazard here — it is the file every
future agent reads first.

### Changes Required

#### 1. CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Make the pipeline fail on a wrong derived number and on a type error, not just on a lint
violation or a broken build.

**Contract**: two new `- run:` steps inside the existing single `ci` job, keeping one job and one
`npm ci` (nothing here justifies a matrix or parallel jobs). Final step order:

`npm ci` → `npx astro sync` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`

Rationale for the order: cheapest and most specific feedback first; `npm run build` stays last
because it is the slowest step and the least specific failure. `npm run typecheck` gets the same
`env:` block as `npm run build` (`SUPABASE_URL` / `SUPABASE_KEY` from repository secrets) so it
loads `astro.config.mjs` under identical conditions — both env fields are `optional: true`, so this
is insurance, not a requirement. `npm test` needs no env at all: the code under test imports
nothing.

Keep `npx astro sync` where it is; `npm run lint` is type-aware and needs the generated types.

#### 2. Repository README

**File**: `README.md`

**Intent**: Keep the documented commands and the documented gate true.

**Contract**: § "Available Scripts" gains `npm test`, `npm run test:watch`, `npm run typecheck` with
one-line descriptions. § "CI" — the sentence "GitHub Actions runs lint + build on every push and PR
to `main`" becomes lint, typecheck, unit tests, and build. Leave the build-time-vs-runtime secrets
paragraph exactly as it is; it is still correct and still important.

#### 3. Agent instructions

**File**: `AGENTS.md`

**Intent**: `AGENTS.md` § "Known state" currently reads "CI (`.github/workflows/ci.yml`) runs lint +
build only. Typecheck, unit tests, and the browser test are not wired yet." That becomes false the
moment Phase 3 lands, and it is the first file every agent reads.

**Contract**: three edits, all small:

- § Known state — rewrite that bullet: CI runs lint, typecheck, unit tests and build; the browser
  test is still not wired.
- § Commands — name the two commands README does not otherwise surface for agents:
  `npm test` (single run) / `npm run test:watch`, and `npm run typecheck` (`astro check`, covers
  `.astro` and `.ts`).
- § Testing — add two lines: unit tests run on Vitest and live beside the code as
  `src/**/*.test.ts`; and the harness deliberately does not load Astro's Vite pipeline, so anything
  under test must not import `astro:*` virtual modules.

#### 4. Roadmap baseline

**File**: `context/foundation/roadmap.md`

**Intent**: § Baseline still records "the pipeline … runs lint and build on `main`" and
"**Verification tooling … absent** — there is no unit-test runner … This is what `F-01` exists to
close." Both become false when this change lands, and no skill repairs them: `/10x-archive` only
flips the item's `Status` and appends a `## Done` bullet.

**Contract**: update the two § Baseline bullets ("Deploy / infra" and "Verification tooling") to
describe the gate as it will then be. Leave the F-01 item body, the At-a-glance table and every
other slice alone — the status flip is `/10x-archive`'s job, not this phase's.

Do **not** soften the existing claim that every domain rule has a unit test — instead see the
contradiction noted at the bottom of this plan; the honest fix is landing the remaining tests in
their own slices, not weakening the rule.

### Success Criteria

#### Automated Verification

- The full gate passes locally, in CI order:
  `npm run lint && npm run typecheck && npm test && npm run build` — all four exit 0.
- The workflow parses and the steps are present in order:
  `git grep -n "run:" -- .github/workflows/ci.yml` lists `npm ci`, `npx astro sync`,
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in that order. Use `git grep`,
  not bare `grep` — the project's primary shell is PowerShell, which has no `grep`.
- No document still claims the old gate:
  `git grep -n "lint + build" -- README.md AGENTS.md context/foundation/roadmap.md` returns no
  matches. Note this command **exits 1 on success** (no match is the pass condition), so run it on
  its own — never `&&`-chained behind another check.

#### Manual Verification

- The GitHub Actions "CI" run for this change is green and its step list visibly includes
  `npm run typecheck` and `npm test`.
- **End-to-end red proof (optional, one throwaway commit)**: push a commit that changes the Brzycki
  numerator to `35`, confirm the CI run goes red **at the `npm test` step** (not at lint or build),
  then revert. This is the literal demonstration of the F-01 outcome; run it once if the owner wants
  the gate proven in CI rather than only locally.

---

## Testing Strategy

### Unit Tests

Everything in this change is a unit test of a pure function — that is the whole point of sequencing
F-01 before any database exists.

- 1-rep pinning for both formulas (the highest-visibility wrong number in the product).
- The 12-rep upper edge, inclusive.
- No estimate below 1 or above 12 rep, including the two values where Brzycki misbehaves
  numerically (37 → `Infinity`, 40 → negative).
- Non-integer reps.
- Zero load and negative (assisted) load.
- Determinism across the whole valid range.

### Integration Tests

None. Deferred to F-03 and S-09 — there is no database, no deployed environment, and no local
Supabase stack on this machine.

### Manual Testing Steps

1. `npm run test:watch`, edit a test's expected value, watch it go red, undo, watch it go green.
2. Break the Brzycki numerator (`36 → 35`), run `npm test`, confirm red, revert.
3. Remove the Epley `reps === 1` pin, run `npm test`, confirm red, revert.
4. Introduce a deliberate type error in a `.ts` file, run `npm run typecheck`, confirm exit 1,
   revert. (This is exactly the probe already run during planning; repeating it after the scripts
   land confirms the wiring, not just the tool.)
5. Confirm the GitHub Actions run for the change shows the new steps and is green.

## Performance Considerations

Only CI wall-clock is affected. `astro check` costs roughly 30–45 s (it regenerates types and boots
the Astro language server); `vitest run` over a handful of pure-function tests is under a second.
Both are far cheaper than `npm run build`, and both fail earlier than it does. Nothing here runs in
the Cloudflare Worker, so the 10 ms CPU cap (`AGENTS.md` § Cloudflare traps) is not in play.

## Migration Notes

None — no data, no schema, no deployed state. Rollback is `git revert` of the three commits;
uninstalling Vitest afterwards is optional since it is a devDependency and never enters the bundle.

## Decisions taken without the owner

The planning agent had no access to the owner during this session. Each decision below was made to
avoid stalling, and each is reversible. Items marked **pending owner confirmation** are genuinely
the owner's call.

| #   | Decision                                                                                      | Rationale                                                                                                                                                                                                                                                                  | Status                                                                                 |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Runner is **Vitest 4.x**                                                                      | Vite 7.3.6 already in the tree; zero transform config; single deduplicated Vite thanks to the root `overrides` pin                                                                                                                                                         | Planning agent; expected choice for this stack                                         |
| 2   | `typecheck` = `astro check`, **not** `tsc --noEmit`                                           | Probe proved `astro check` catches plain-`.ts` errors _and_ `.astro` errors and exits 1; `tsc --noEmit` is a strict subset                                                                                                                                                 | Planning agent; evidence-backed                                                        |
| 3   | **Implement the minimal 1RM helpers in this change**, rather than deferring all tests to S-03 | F-01's Outcome is "a wrong derived number fails the pipeline"; with an empty test glob that outcome cannot be demonstrated and CI passes vacuously. Capped at 1RM only                                                                                                     | **Pending owner confirmation** — partially at odds with the roadmap's F-01 _Risk_ note |
| 4   | Zero-weight set → estimate of `0`, not `null`                                                 | Follows from the 1-rep rule (0 kg × 1 rep = 0 kg) and keeps the function total. `AGENTS.md` excludes only _negative_ load from 1RM; zero load is excluded from _tonnage_, which is a different rule. S-03/S-04 may still choose not to display it for bodyweight exercises | **Pending owner confirmation**                                                         |
| 5   | Negative (assisted) load → `null`, and `isEstimable` false                                    | Verbatim from `AGENTS.md`: assisted sets are "excluded from 1RM and from record detection"                                                                                                                                                                                 | Planning agent; restates an existing rule                                              |
| 6   | Helpers do **not** round                                                                      | Rounding must not "invent a record or erase one" (PRD § Business Logic, Units), so comparison happens unrounded and presentation rounds                                                                                                                                    | Planning agent                                                                         |
| 7   | `EstimationFormula` stays in `one-rep-max.ts`, not `src/types.ts`                             | `AGENTS.md` reserves `src/types.ts` for shared entity/DTO types; none exist yet                                                                                                                                                                                            | Planning agent; trivially reversible in S-06                                           |
| 8   | Tests co-located as `src/**/*.test.{ts,tsx}`, globals off, explicit `vitest` imports          | Keeps `tsconfig.json` untouched, keeps ESLint clean, matches Vitest defaults                                                                                                                                                                                               | Planning agent                                                                         |
| 9   | CI stays one job; order lint → typecheck → test → build                                       | Cheapest/most specific feedback first; a matrix would triple cost for a solo three-week project whose stated constraint is time                                                                                                                                            | Planning agent                                                                         |
| 10  | `passWithNoTests` is **not** enabled in the config                                            | A broken include glob must turn CI red, not pass silently                                                                                                                                                                                                                  | Planning agent                                                                         |
| 11  | No coverage gate, no reporters, no test-on-commit hook                                        | `/10x-test-plan` and Faza 3 own these; adding them now spends the scarcest resource on work no user sees                                                                                                                                                                   | Planning agent; matches the roadmap's F-01 scope note                                  |

## Contradictions found against existing documents

Flagged rather than silently worked around:

1. **`AGENTS.md` § Domain rules: "Every one of them has a unit test; do not change behaviour here
   without changing the test and saying so."** This is false today — there are zero tests and zero
   domain functions. After this change it is true for the 1RM rules only. The remaining rules
   (records-are-derived, PR-decided-on-estimate, Monday–Sunday in the user's timezone, zero/negative
   tonnage, unit round-trip, one primary muscle group) still have no test and no implementation.
   They land with S-03…S-08. The rule is retained as written because it is the standard those slices
   must meet — not weakened to match today's reality.
2. **Roadmap F-01 § Risk: "Scope is the runner and the pipeline gate only; the tests themselves
   belong to the slices that own the rules."** Decision 3 above deviates for the 1RM helpers only,
   because F-01's own _Outcome_ line cannot otherwise be verified. Everything else in that note is
   honoured.

   **If the owner rejects the deviation, dropping Phase 2 alone is not a valid fallback** — it
   would ship a permanently red pipeline. `passWithNoTests` is deliberately off (Decision 10), so
   `vitest run` against an empty glob exits 1, and Phase 3 adds `npm test` to the gate. The correct
   contingency is to drop Phase 2 **and** the `npm test` step from Phase 3, leaving Phase 3 to ship
   the typecheck gate only, with the runner installed but ungated until S-03 brings the first test.
   That is strictly worse — it is exactly the vacuous green gate this change exists to prevent —
   which is itself an argument for Decision 3.
3. **`AGENTS.md` § Known state: "CI runs lint + build only."** True at planning time, false after
   Phase 3 — corrected there.
4. **Minor: `@astrojs/check` sits in `dependencies`, not `devDependencies`.** Harmless (Cloudflare
   Workers bundles only what is imported), inherited from the starter, deliberately left alone.

## References

- Roadmap item: `context/foundation/roadmap.md` § Foundations → F-01, and § Baseline →
  "Verification tooling … absent"
- Product contract: `context/foundation/prd.md` § Business Logic ("The rule is only as good as its
  boundaries"), § Non-Functional Requirements (determinism, one decimal place, unit round-trip),
  § US-04 Acceptance Criteria (verify against recorded data)
- Agent rules: `AGENTS.md` § Domain rules that are easy to get wrong, § Conventions
  (`src/lib/services/`, plain dependency-free functions), § Testing, § Known state
- Bootstrap record (why Astro stays at 6.x):
  `context/changes/bootstrap-verification/verification.md`
- Existing pipeline: `.github/workflows/ci.yml`
- Astro-coupled module that must never be imported by a test as things stand:
  `src/lib/config-status.ts:1`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire the unit-test runner

#### Automated

- [x] 1.1 Vitest installed and deduplicated — `npm ls vitest` shows vitest@4.x; every `npm ls vite` line reads 7.3.6, no nested copy, no ERESOLVE — 32ef294
- [x] 1.2 Runner wired — `npm test -- --passWithNoTests` exits 0 — 32ef294
- [x] 1.3 Typecheck script works — `npm run typecheck` prints 0 errors, exits 0 — 32ef294
- [x] 1.4 New files survive the linter — `npm run lint` exits 0 — 32ef294
- [x] 1.5 Build undisturbed — `npm run build` exits 0 — 32ef294

#### Manual

- [x] 1.6 `npm run test:watch` enters and stays in watch mode — c40bc47

### Phase 2: First domain rules under the harness

#### Automated

- [x] 2.1 Tests pass — `npm test` exits 0 with 0 failed — c40bc47
- [x] 2.2 Glob matched — `npm test` output names `src/lib/services/one-rep-max.test.ts` — c40bc47
- [x] 2.3 Types clean including the test file — `npm run typecheck` prints 0 errors — c40bc47
- [x] 2.4 Lint passes on both new files — `npm run lint` exits 0 — c40bc47
- [x] 2.5 Build undisturbed — `npm run build` exits 0 — c40bc47

#### Manual

- [x] 2.6 Red proof (arithmetic) — Brzycki numerator 36→35 fails the 100×5→112.5 test, then reverts green — c40bc47
- [x] 2.7 Red proof (the pin) — removing the reps===1 pin fails the Epley single test with 103.33, then reverts green — c40bc47
- [x] 2.8 No residual change after both reverts — `git status --porcelain src/lib/services/one-rep-max.ts` prints nothing — c40bc47

### Phase 3: Move the pipeline gate, and correct the documents that describe it

#### Automated

- [x] 3.1 Full gate passes locally in CI order — lint, typecheck, test, build all exit 0 — 8b3f529
- [x] 3.2 Workflow steps present and ordered — `git grep -n "run:" -- .github/workflows/ci.yml` — 8b3f529
- [x] 3.3 No document still claims the old gate — `git grep -n "lint + build" -- README.md AGENTS.md context/foundation/roadmap.md` returns nothing (exits 1 on success; do not `&&`-chain) — 8b3f529
- [x] 3.4 Roadmap § Baseline no longer calls verification tooling absent — 8b3f529

#### Manual

- [ ] 3.5 GitHub Actions "CI" run for this change is green and shows the typecheck and test steps
- [ ] 3.6 Optional end-to-end red proof — a commit breaking the Brzycki numerator turns CI red at the `npm test` step, then reverted
