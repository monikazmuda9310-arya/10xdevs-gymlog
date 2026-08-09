# Domain-Rule Verification Harness — Plan Brief

> Full plan: `context/changes/verification-harness/plan.md`
> Roadmap item: `context/foundation/roadmap.md` § F-01

## What & Why

GymLog's whole value proposition is arithmetic the user cannot easily do by hand — estimated 1RM,
weekly tonnage, personal records. Today nothing in the repository can tell whether that arithmetic
is right: there is no test runner, no test, and no type check in the pipeline. This change wires a
unit-test runner in and moves the CI gate from **lint + build** to **lint + typecheck + tests +
build**, so a wrong derived number fails the pipeline instead of reaching a screen.

## Starting Point

Measured, not assumed. `package.json` has no `test` and no `typecheck` script and Vitest is not
installed. `.github/workflows/ci.yml` runs `astro sync → lint → build` in one job. Typechecking
already works — `@astrojs/check` is installed and `npx astro check` currently exits 0 with 0 errors
— it is simply not wired to anything. There is no `src/lib/services/`, no `src/types.ts`, and no
1RM / tonnage / record function anywhere in the codebase.

## Desired End State

`npm test`, `npm run test:watch` and `npm run typecheck` exist and work. The GitHub Actions gate
runs all four checks on every push and PR to `main`. `src/lib/services/one-rep-max.ts` holds the
minimal pure 1RM helpers, and their boundary tests pin the rules that are easiest to get wrong —
so changing the Brzycki divisor, or unpinning Epley at one repetition, turns the pipeline red.

## Key Decisions Made

All decisions were taken by the planning agent (no owner access in this session). Rows marked
**pending confirmation** are genuinely the owner's call.

| Decision                               | Choice                                   | Why                                                                                                             | Status                   |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Test runner                            | Vitest 4.x                               | Vite 7.3.6 is already the bundler; zero transform config, single deduplicated Vite via the root `overrides` pin | Planning agent           |
| Typecheck command                      | `astro check`                            | A probe proved it catches errors in plain `.ts` _and_ `.astro` and exits 1; `tsc --noEmit` is a strict subset   | Planning agent           |
| Does the 1RM code ship here or in S-03 | **Here**, capped at the pure 1RM helpers | A harness with an empty test glob passes vacuously and cannot demonstrate F-01's own stated outcome             | **Pending confirmation** |
| Zero-weight set                        | Estimate is `0`, not "no estimate"       | Follows from the 1-rep rule; `AGENTS.md` excludes only _negative_ load from 1RM, and zero load from _tonnage_   | **Pending confirmation** |
| Rounding                               | None inside the helpers                  | Rounding must never invent or erase a record, so comparison happens unrounded and presentation rounds           | Planning agent           |
| `passWithNoTests`                      | Deliberately not set                     | A broken include glob must turn CI red, not pass a suite of zero tests                                          | Planning agent           |
| CI shape                               | One job; lint → typecheck → test → build | Cheapest, most specific feedback first; a matrix triples cost for a solo three-week project constrained by time | Planning agent           |
| Coverage / hooks / E2E                 | Excluded                                 | Faza 3 and `/10x-test-plan` own these; the roadmap explicitly warns against over-scoping F-01                   | Planning agent           |

## Scope

**In scope:** Vitest + `vitest.config.ts`; `test`, `test:watch`, `typecheck` scripts; two new CI
steps; minimal pure 1RM helpers in `src/lib/services/one-rep-max.ts` with a boundary test set;
correcting `README.md` and `AGENTS.md` where they describe the old gate.

**Out of scope:** anything touching Supabase, a database, migrations or RLS (none exists, and there
is no local Docker stack); deployment (F-02); Playwright/E2E (Faza 3); git hooks (Faza 3); coverage
gates and a full test strategy (`/10x-test-plan`); tonnage, records, week-boundary and unit
helpers (S-03…S-08); bumping Astro to 7 (`AGENTS.md` forbids it).

## Architecture / Approach

A plain `vitest.config.ts` at the repository root — Node environment, `src/**/*.test.{ts,tsx}`
glob, explicit `@ → ./src` alias, globals off. It deliberately does **not** load Astro's Vite
pipeline, so anything importing an `astro:*` virtual module fails loudly at import time. That is
the guardrail, not a limitation: `AGENTS.md` already requires the 1RM / tonnage / record maths to
be plain dependency-free functions, and this makes a violation impossible to miss. If a future
slice must test Astro-coupled code, the escape hatch is `getViteConfig` from `astro/config`.

## Phases at a Glance

| Phase                                         | What it delivers                                                                  | Key risk                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Wire the unit-test runner                  | Vitest, `vitest.config.ts`, three npm scripts                                     | Install resolution: Vitest 4 must reuse the pinned `vite@7.3.6` rather than pulling a second copy     |
| 2. First domain rules under the harness       | `one-rep-max.ts` + boundary tests, plus a hands-on red proof                      | Scope tension with the roadmap's "runner and gate only" note; the zero-weight semantics need a ruling |
| 3. Move the gate, correct the stale documents | Two new CI steps; `README.md` and `AGENTS.md` no longer claim "lint + build only" | `astro check` adds ~30–45 s to CI; a stale `AGENTS.md` misleads every future agent                    |

**Prerequisites:** none. F-01 is the one roadmap item with no blockers — no database, no deployment,
no owner action required to start.
**Estimated effort:** one session, three small commits.

## Open Risks & Assumptions

- **Vitest 4 install not executed at planning time** — but `npm install -D vitest --dry-run` was run
  during plan review: `added 175 packages`, no `ERESOLVE`, no peer warnings, and no `add vite` line,
  so the root `overrides` pin dedupes onto the existing `vite@7.3.6`. `@types/node` is the one
  undeclared requirement and is now installed explicitly in Phase 1.
- **The 1RM scope call may be rejected.** If the owner holds the roadmap's "runner and gate only"
  line, Phase 2 **and** Phase 3's `npm test` step must both go — dropping Phase 2 alone ships a
  permanently red pipeline, because `passWithNoTests` is off and `vitest run` exits 1 on an empty
  glob. The gate would then be typecheck-only until S-03.
- **Zero-weight semantics are a product ruling, not an engineering one.** The plan returns `0`; the
  alternative (`null`, "no estimate for bodyweight work") is equally defensible and cheap to change
  now, expensive once S-04 compares records against it.
- **`AGENTS.md` claims every domain rule has a unit test.** It will be true for 1RM only after this
  change; the remaining six rules stay uncovered until their slices land.
- **`astro check` currently emits 4 pre-existing hints** (deprecated `tseslint.config()` in
  `eslint.config.js`). Hints do not fail the command today; if that default ever changes, the gate
  flips red for an unrelated reason.
- **The test glob is `.test.{ts,tsx}` under `src/`** — a future slice that wants a test elsewhere
  must widen it deliberately.

## Success Criteria (Summary)

- `npm run lint && npm run typecheck && npm test && npm run build` all pass locally, and the
  GitHub Actions run for the change is green with the two new steps visible.
- Breaking the Brzycki numerator (`36 → 35`) or removing the Epley 1-rep pin turns `npm test` red
  with a named, specific failure — the literal demonstration of F-01's outcome.
- No document in the repository still claims the pipeline runs "lint + build only".
