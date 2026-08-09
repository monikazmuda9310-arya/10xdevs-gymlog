<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Domain-Rule Verification Harness

- **Plan**: `context/changes/verification-harness/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE
- **Findings**: 1 critical, 6 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | WARNING |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

11/11 paths ✓ · 9/9 symbols ✓ · brief↔plan ✓ · Progress↔Phase contract ✓ (3 phases, 16 steps, 1:1, no
stray checkboxes) · blast radius: 0 code importers (docs only).

Codebase verification was run inline rather than via a sub-agent (no delegation was requested, and every
claim was checkable directly). Measured on this machine, 2026-08-09:

| Plan claim                                        | Result                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npx astro check` → 28 files, 0 errors, 4 hints, exit 0 | **Confirmed** (26.6 s wall)                                                                                    |
| `astro check` fails on a plain-`.ts` error, exit 1 | **Confirmed and strengthened** — probe on an *unimported* new `src/lib/*.ts` → `Result (29 files): 1 error`, exit 1 |
| `npx tsc --noEmit` → exit 0                       | **Confirmed** (4.9 s, 21 files — strict subset of the 28)                                                     |
| `vitest@4.1.10`, vite `^6\|\|^7\|\|^8`, node `^20\|\|^22\|\|>=24` | **Confirmed** via `npm view`                                                                                   |
| Vitest install resolves without ERESOLVE and reuses one Vite | **Confirmed** via `npm install -D vitest --dry-run`: `added 175 packages`, `add vitest 4.1.10`, **no `add vite` line** |
| `astro@6.4.8`, `vite@7.3.6` (overridden), `typescript@5.9.3`, node 22.14.0, npm 10.9.2 | **Confirmed**                                                                                                  |
| `"lint + build"` appears only in `README.md` and `AGENTS.md` | **Confirmed** — but see F5                                                                                     |
| `package.json` / `package-lock.json` are Prettier-clean | **Confirmed** (`prettier --check` passes) — lint-staged will be a no-op                                        |

## Findings

### F1 — Dropping Phase 2 turns CI permanently red, not "unproven"

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: § Contradictions found #2 · § Decisions #3 and #10 · plan-brief § Open Risks
- **Detail**: The plan offers a fallback if the owner rejects the 1RM scope deviation: "drop Phase 2 and
  accept that the gate ships unproven until S-03". The brief spells the same fallback out as "`npm test`
  passes with zero tests". Both are false against the plan's own Decision 10, which deliberately does **not**
  set `passWithNoTests`: with no test file, `vitest run` exits 1, so Phase 3's `npm test` step makes every
  push to `main` red. The plan already knows this — § Implementation Approach says "CI must not gain a
  `npm test` step before a test exists, or the first push is a red pipeline" — and then forgets it in the
  contingency. As written the escape hatch is a trap.
- **Fix A ⭐ Recommended**: Keep Phase 2, and rewrite the contingency to say that rejecting Decision 3 means
  Phase 3's `npm test` step is deferred to S-03 as well (Phase 3 ships typecheck only).
  - Strength: Preserves the only sequencing that satisfies F-01's Outcome line, and keeps every landed step
    honest; the gate is never green-but-empty and never red-for-nothing.
  - Tradeoff: The scope deviation stands, so the roadmap Risk note stays partially unhonoured.
  - Confidence: HIGH — the failure mode is a documented Vitest default and the plan states the rule itself.
  - Blind spot: None significant.
- **Fix B**: Keep the fallback but pair it with `npm test -- --passWithNoTests` in the CI step until the
  first real test lands.
  - Strength: Phase 3 can ship independently of the scope ruling.
  - Tradeoff: Ships exactly the silent-pass gate the Overview argues against, and the flag has to be
    remembered and removed later — the same class of latent defect as the Cloudflare secret trap.
  - Confidence: HIGH — mechanically correct, strategically weak.
  - Blind spot: Nothing forces the flag's removal; no phase owns it.
- **Decision**: PENDING

### F2 — Success criterion 1.1 states an output `npm ls vitest vite` cannot produce

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 § Success Criteria · Progress 1.1
- **Detail**: The criterion demands "exactly one `vite@7.3.6`". Measured on the current tree, `npm ls vite`
  already prints **7** lines containing `vite@7.3.6` (one real, six `deduped` / `overridden`), because Vite is
  a transitive dependency of `astro`, `@astrojs/cloudflare`, `@astrojs/react`, `@tailwindcss/vite` and
  `vitefu`. A correct install will therefore fail the criterion as written, and the implementer must either
  waste time on a non-problem or wave the check through.
- **Fix**: Restate as: every `vite@` line reads `7.3.6` (`deduped` / `overridden` are expected), no second
  version appears, and `node_modules/vitest/node_modules/vite` does not exist; `npm ls vitest` prints
  `vitest@4.1.10` with no `ERESOLVE` / `UNMET PEER DEPENDENCY`.
- **Decision**: PENDING

### F3 — Success criterion 2.8 (`git diff --stat` on a new file) cannot produce the stated output

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 § Manual Verification · Progress 2.8
- **Detail**: "`git diff --stat src/lib/services/one-rep-max.ts` shows only the intended new-file content."
  `git diff` never reports untracked files, so before the phase commit the command prints nothing; after the
  commit, with a clean revert, it also prints nothing. There is no state in which it shows "the intended
  new-file content", so the check as written can neither pass nor fail meaningfully.
- **Fix**: Replace with `git status --porcelain src/lib/services/one-rep-max.ts` expecting **empty output**
  after both red proofs are reverted (pre-commit: expect `?? …` and confirm the file content by reading it).
- **Decision**: PENDING

### F4 — Criterion 3.2 uses bare `grep`, which the project's primary shell does not have

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 § Automated Verification · Progress 3.2 and 3.3
- **Detail**: This machine runs PowerShell as the primary shell (`CLAUDE.md` env). `grep` is not on PATH
  there — only inside Git Bash. `git grep` (criterion 3.3) *is* available in both, so 3.3 is portable and 3.2
  is not. Secondary point on 3.3: `git grep` exits **1** when there are no matches, which is the criterion's
  success condition, so it must not be chained behind `&&` or run under `set -e`.
- **Fix**: Change 3.2 to `git grep -n "run:" -- .github/workflows/ci.yml` (verified: lists the `- run:` lines
  in file order and matches nothing else — `runs-on:` does not contain `run:`), and add a parenthetical to 3.3
  noting the exit-1-on-no-match.
- **Decision**: PENDING

### F5 — The stale-document sweep stops at README/AGENTS; the roadmap keeps asserting the old gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3 § Changes Required · Desired End State
- **Detail**: Phase 3 corrects `README.md` and `AGENTS.md` on exactly the argument that a stale document is
  "an active hazard". The same hazard is left standing two files over:
  `context/foundation/roadmap.md:92` — "**Verification tooling … absent** — there is no unit-test runner …
  The pipeline runs lint and build only" — and `:90` — "the pipeline … runs lint and build on `main`". Both
  become false the moment Phase 3 lands. No skill will repair them: `/10x-archive` closes only the item's
  `Status` field and appends a `## Done` bullet, and explicitly "never rewrites the roadmap beyond closing the
  one matched item" (`.claude/skills/10x-archive/SKILL.md:228`). The plan's own References section cites the
  Baseline line it is about to falsify.
- **Fix**: Add `context/foundation/roadmap.md` § Baseline to Phase 3's edit list — rewrite the "Verification
  tooling" bullet to present tense and drop "lint and build only" from the Deploy/infra bullet — and extend
  criterion 3.3 to `git grep -n "lint + build" -- README.md AGENTS.md` plus
  `git grep -n "lint and build only" -- context/foundation/roadmap.md`.
- **Decision**: PENDING

### F6 — The `@` alias is the plan's self-declared risky line and nothing in the change exercises it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 § Vitest configuration · Phase 2 § Boundary test set
- **Detail**: The plan calls `resolve.alias` "the one non-obvious line" and explains carefully why it must be
  absolute. But `one-rep-max.ts` is specified to have **no imports at all**, and `one-rep-max.test.ts` imports
  it relatively. So every success criterion in Phases 1–3 passes with a broken or absent alias, and the defect
  first appears in S-03. An untested config line that the plan itself flags as easy to get wrong is the
  clearest example in this change of a check that proves nothing.
- **Fix A ⭐ Recommended**: Have the test file import through the alias —
  `import { estimateOneRepMax } from "@/lib/services/one-rep-max";` — so criterion 2.1 fails loudly if the
  alias is wrong.
  - Strength: Zero extra code, zero extra runtime, and converts an unverified line into a covered one; also
    exercises the alias under `astro check`, which resolves it through `tsconfig.json` paths independently.
  - Tradeoff: The test no longer demonstrates the plain relative-import path (immaterial — Vitest resolves
    relative imports with no configuration).
  - Confidence: HIGH — `tsconfig.json` already maps `@/*` → `./src/*`, so both resolvers agree.
  - Blind spot: None significant.
- **Fix B**: Drop `resolve.alias` from `vitest.config.ts` entirely and add it in the first slice that needs it.
  - Strength: Strictly leaner; nothing unproven ships.
  - Tradeoff: S-03 has to touch `vitest.config.ts`, and the "aliases are CWD-relative" trap gets rediscovered
    by whoever hits it.
  - Confidence: MED — correct, but throws away a researched detail the plan already paid for.
  - Blind spot: None significant.
- **Decision**: PENDING

### F7 — `@types/node` is required by `vitest.config.ts` and declared by nobody

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 § Vitest configuration · § Current State Analysis
- **Detail**: The prescribed alias line imports `fileURLToPath` from `node:url`. Those types come only from
  `@types/node`, which is **not** a declared dependency of this project. It resolves today purely because
  `vite@7.3.6` drags `@types/node@25.6.2` and npm hoists it to `node_modules/@types/`, and because
  `astro/tsconfigs/base.json` sets no `types` array so TypeScript auto-includes everything under
  `node_modules/@types`. Vitest lists `@types/node` as an **optional** peer, so nothing will warn. Any future
  hoist or dedupe change breaks `npm run typecheck` and `npm run lint` with `Cannot find module 'node:url'`,
  for a reason no one will connect back to this change.
- **Fix**: Make Phase 1's install `npm install -D vitest @types/node` and list `@types/node` in the package
  manifest contract.
- **Decision**: PENDING

### F8 — Contract branches with no pinning test, and the zero-load record consequence goes unrecorded

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 § One-rep-max helpers · § Boundary test set · § Decisions #4
- **Detail**: Two small gaps.
  (a) `isEstimable` is specified as true only when `weight` is "finite and `>= 0`", but the test list pins
  only zero load, negative load and non-integer reps. `NaN` and `Infinity` weights (and `Infinity` reps) are
  contract branches with no test, in the one module whose whole purpose is to prove that the contract is
  pinned — and `AGENTS.md` asserts "every one of them has a unit test".
  (b) Decision 4 is correct (see below), but its downstream consequence is not written down: because
  `estimateOneRepMax(0, r) === 0` **and** `isEstimable(0, r) === true`, a zero-load set is *eligible* for
  record detection carrying the value `0`. That is benign (the first bodyweight set sets a 0 baseline and no
  later zero-load set can exceed it, so no false record is announced) — but S-04 will have to rediscover it if
  it is not stated here.
- **Fix**: Add `NaN` / `Infinity` weight cases to the boundary test set, and add one sentence to Decision 4
  recording the record-detection consequence for S-04.
- **Decision**: PENDING

### F9 — The glob promises `.tsx` tests the configuration cannot run

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 § Vitest configuration · § Decisions #8
- **Detail**: `test.include: ["src/**/*.test.{ts,tsx}"]` invites component tests, while
  `environment: "node"` with no `jsdom` / `happy-dom` and no setup file means any `.tsx` test that renders
  will fail at the first DOM access. The plan explicitly excludes component testing from scope.
- **Fix**: Narrow the glob to `src/**/*.test.ts` now; the slice that needs component tests widens it and adds
  an environment in the same change.
- **Decision**: PENDING

### F10 — Phase 3 duplicates commands across README and AGENTS.md, against AGENTS.md's own framing

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 § Repository README · § Agent instructions
- **Detail**: `AGENTS.md` § Commands is structured as "Scripts … : @README.md" followed by "**Two things
  README does not cover**". Phase 3 adds `npm test` / `test:watch` / `typecheck` to README § Available
  Scripts **and** to AGENTS.md § Commands, so AGENTS.md would then list things README does cover — the exact
  duplication the section was written to avoid, and the first step toward the drift Phase 3 exists to repair.
- **Fix**: In AGENTS.md, leave § Commands pointing at README (the two exceptions stay as they are) and put the
  agent-specific facts in § Testing only: unit tests run on Vitest as `src/**/*.test.ts`, and the harness does
  not load Astro's Vite pipeline so anything under test must not import `astro:*`.
- **Decision**: PENDING

## Coordinator questions — explicit answers

**1. The scope deviation (Decision 3) — sound, keep it.** F-01's *Outcome* is the operative acceptance
sentence ("a wrong derived number fails the pipeline instead of reaching a screen"), and the *Risk* note's
"runner and gate only" reads in context as a guard against over-scoping into a full test strategy — the same
sentence continues "Over-scoping this into a full test strategy would spend the scarcest resource on work no
user ever sees", which the plan honours (no coverage gate, no reporters, no hooks, no E2E). Two pure
functions and two constants are not a test strategy. Decisive technical point: with `passWithNoTests` off
(Decision 10), the "runner only" reading does not produce an unproven-but-green gate, it produces a red one
(F1). Collision risk with S-03 is low — S-03 owns UI, persistence and the formula preference; it imports
`estimateOneRepMax(weight, reps, formula)`, which is the signature it needs. The one piece of genuine creep is
framing `isEstimable` as "the predicate record detection will later use (S-04)": design justified by a
consumer two slices out. Keep the function (it is how the range rule is expressed and it is needed internally),
drop the forward reference.

**2. Zero-weight semantics (Decision 4) — `0` is right, and the PRD backs it more strongly than the plan
claims.** `prd.md` § Business Logic, "Zero and negative load": a zero-load set "adds nothing to tonnage; it is
still recorded, and its repetitions still count as work done", whereas "an assisted set carries negative load
and **is excluded from both estimates and record detection**". Exclusion from estimation attaches to negative
load only. `US-02` § Acceptance Criteria enumerates the exclusions exhaustively — "Sets excluded from
estimation — over twelve repetitions, or assisted with a negative load" — and zero is not among them.
Returning `null` for zero load would contradict the PRD. The plan cited `AGENTS.md`; it should cite the US-02
AC line, which is the stronger and less ambiguous authority. Nothing in the PRD was missed. The unrecorded
consequence is the record-detection eligibility noted in F8(b). Note also that `FR-014` puts a *bodyweight
flag* on the exercise (landing in S-02), so any decision to hide a `0` estimate is a presentation decision
belonging to S-02/S-03 — the plan's "S-03/S-04 may still choose not to display it" is directionally correct.

**3. Vitest install feasibility — verified, no blocker.** `npm install -D vitest --dry-run` against the real
tree: `added 175 packages, and changed 1 package`, no `ERESOLVE`, no peer warnings. `add vitest 4.1.10` plus
the seven `@vitest/*` packages; **no `add vite` line**, confirming the root `overrides: { "vite": "^7.3.2" }`
dedupes vitest onto the existing `vite@7.3.6`. `npm view vitest`: `dependencies.vite`
`^6.0.0 || ^7.0.0 || ^8.0.0`, `engines.node` `^20 || ^22 || >=24` — satisfied by node 22.14.0. The only
undeclared requirement the install surfaces is `@types/node` (F7). The single "changed" package is
`@img/sharp-freebsd-wasm32`, unrelated optional-dependency churn.

**4. `typecheck` = `astro check` — the claim holds and the choice is right.** I reproduced it and went one
step further than the plan's probe: the plan's probe put the error in `src/lib/config-status.ts`, which pages
already import, so it did not prove that a *new, unimported* file is checked — which is exactly what criterion
2.3 asserts about the test file. Probe run here on a throwaway unimported `src/lib/__probe_delete_me.ts`:
`Result (29 files): 1 error … ts(2322)`, **exit 1**. The mechanism is `@astrojs/check` →
`AstroCheck.linter.getRootFileNames()`, which is driven by `tsconfig.json`'s `include: ["**/*"]`, not by the
import graph. So criterion 2.3 is sound. On cost: `astro check` 26.6 s, `tsc --noEmit` 4.9 s. `astro check`
covers **28** files, `tsc` covers **21** — the delta is the 10 `.astro` files, and nothing else in the
pipeline type-checks them (`astro build` transpiles, it does not check; ESLint's Astro parser is not a type
checker). Adding `tsc --noEmit` would buy 0 files for 5 s. **Keep `astro check` alone** — the plan's Decision
2 is correct on the evidence. Confirmed harmless side notes: default `minimumFailingSeverity` is `error`, so
the four `ts(6387)` hints exit 0; `astro check` runs its own type generation (13.9 s of the 26.6 s), so the
standalone `npx astro sync` step is duplicated work — but it must stay, because `npm run lint` runs first and
is type-aware.

**5. Windows breakage — one real defect, plus two the plan already handles.** The defect is criterion 3.2's
bare `grep -n` (F4): PowerShell is the primary shell here and has no `grep`; `git grep` does work in both
shells and is the drop-in fix. Line endings are handled correctly — `.gitattributes` `* text=auto eol=lf`
overrides `core.autocrlf=true`, and the plan explicitly requires LF for both new files; verified that
`.prettierrc.json` sets no `endOfLine`, so Prettier's `"lf"` default applies through
`eslint-plugin-prettier`. The husky/lint-staged path is safe: `.husky/pre-commit` is `npx lint-staged`;
`vitest.config.ts` and `one-rep-max.test.ts` route to `eslint --fix`, and `package.json` /
`package-lock.json` route to `prettier --write` — I verified both are already Prettier-clean
(`prettier --check` passes), so the install's lockfile rewrite will not produce a spurious reformat diff.

**6. Success-Criteria verifiability — 13 of 16 stand, 3 are defective.** Defective: **1.1** (F2 — states an
`npm ls` output the command provably cannot produce; measured 7 `vite@7.3.6` lines, not one), **2.8** (F3 —
`git diff --stat` on a new/clean file prints nothing in every reachable state), **3.2** (F4 — command
unavailable in the project's primary shell). Everything else is runnable and produces the stated output; 1.3
and 2.3 were confirmed against the live tree, and 3.3 is correctly scoped (`"lint + build"` really does occur
only at `README.md:171` and `AGENTS.md:140`) with the caveat that the command exits 1 on the success
condition, and with the coverage gap in F5.

## Bottom line

Not ready for `/10x-implement` as written — but it is close, and the gap is editorial, not architectural.
This is an unusually well-grounded plan: the Current State Analysis was measured rather than assumed, and
every claim I could independently reproduce, reproduced. The approach is right, the phasing is right, the
scope call is defensible, and Architectural Fitness passes cleanly.

Fix before implementing: **F1** (the contingency path as written ships a permanently red pipeline), and the
three unverifiable Success Criteria **F2 / F3 / F4** — a criterion whose command cannot produce its stated
output silently converts a gate into a formality, which is the exact failure this change exists to eliminate.
**F5** and **F7** are one-line edits worth taking in the same pass. **F6** is worth two minutes of thought;
Fix A costs nothing. F8–F10 can ride along or be skipped.

With F1–F5 and F7 applied, this reaches SOUND.
