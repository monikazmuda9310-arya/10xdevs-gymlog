# Browser layer (test-plan Phase 2) — Plan Brief

> Full plan: `context/changes/testing-browser-layer/plan.md`
> Research: `context/changes/testing-browser-layer/research.md`

## What & Why

Close risks #2, #3 and #4 from `test-plan.md` §2. Two of them are not browser risks at all: the
uncovered code is everything between an inbound request and `locals.user` — `src/middleware.ts` and
`src/lib/supabase.ts` — which executes **zero times in the whole gate today**. The third, hydration,
genuinely needs a browser and is the only part that pays the browser cost.

## Starting Point

Three Vitest projects, sixteen files in `tests/integration/`, and not one test line that touches
`@supabase/ssr`, a cookie, or the middleware — every grep hit is a comment. Every integration suite
hands a handler a hand-built `locals` whose client and user id agree by construction, so a middleware
bug binding the *wrong* identity to a request is invisible to all of them. No browser test could be
written because `astro dev` cannot be re-aimed at `gymlog-test` by any per-process mechanism
(`.dev.vars` is `Object.assign`ed over `process.env`, and Vite applies `process.env` last).

## Desired End State

`npm run test:middleware` drives `onRequest` with real `gymlog-test` session cookies — real identity,
both redirect directions, a forged cookie, a cleared cookie — with production absent from the process
and unreachable from disk. `npm run test:e2e` runs Playwright against the **built** worker, launched
by a script that refuses to start while `dist/server/.dev.vars` exists, and a person completes sign up
→ workout → set → `≈ 112.5 kg 1RM`. Both in CI, inside the existing concurrency group.

## Key Decisions Made

| Decision | Choice | Why | Source |
| -------- | ------ | --- | ------ |
| Overall shape | Option A (fourth Vitest project) first, then Option B (browser vs. built worker) | Owner decision 2026-08-16; A is structural, cheap, and closes the real gap behind #2/#3 | Owner / Research §4 |
| Credential guarantee | Subtractive strip **plus** `vite.envDir` at a credential-free directory | Stripping alone leaves `.env` on disk reachable by `loadEnv`; supplying the right value only wins a precedence contest | Research §2 |
| Layer for #2 and #3 | integration (in-process cookie path), **not** e2e | A browser adds a cookie *jar*, not a cookie; the uncovered lines are drivable in-process | Research §6 |
| `astro dev`, and Option C | Refused outright | Mechanically un-aimable; C's failure mode is silent and identical to a correct run | Owner / Research §4 |
| Deletion vs. assertion of `dist/server/.dev.vars` | Different processes — build script deletes, launcher asserts | An assert that follows its own delete can never fire, and would be indistinguishable from one that passes | `lessons.md` |
| Marks | `t2c-` (middleware), `t2e-` (e2e) | Neither a prefix of, nor prefixed by, any of the fourteen in use, nor each other | Plan |
| Phone-width half of #4 | Carried as a named gap, not planned in | It has no assigned layer anywhere; a green gate must not read as covering it | Test plan §2 |

## Scope

**In scope:** a fourth Vitest project and two suites (identity + session lifecycle); Playwright, a
build/strip script, a refusing launcher, one critical-flow spec; CI wiring; `test-plan.md` §6.3 and a
new §6.7; two `AGENTS.md` corrections.

**Out of scope:** Option C and anything aimed at `astro dev`; Option D (escalation only); phone-width
/ viewport; re-proving RLS at the client-library layer; the `catalogue` island-prop question; the
`gymlog-test` signup rate-limit budget.

## Architecture / Approach

Two independent runners with the same property. The middleware project loads Astro's Vite pipeline
(`getViteConfig`, `configFile: false`) so `astro:middleware` and `astro:env/server` resolve, strips
every `SUPABASE_*`/`GYMLOG_*` variable it is not entitled to, seeds the test pair, and points
`envDir` at an empty directory it refuses to start if anything `.env*` appears in. The browser
harness builds, deletes the emitted `dist/server/.dev.vars`, and starts `wrangler dev` on the build
output from a launcher that asserts that file's absence immediately before every spawn — the built
worker reads its credentials from the workerd env at request time, which is what makes it aimable at
all. In both, being wrong yields an **absent** credential (red on the first step), never a production
one.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Measure the fourth project | Facts: `astro:middleware` resolves; `envDir` binds | If probe (b) or (c) fails, sub-phase A collapses or must be escalated |
| 2. Config + identity boundary (#2) | `npm run test:middleware`; B naming A's id gets nothing, A's row survives | A forged-cookie test that silently tampered nothing |
| 3. Session lifecycle (#3) | Three cookie states, both redirect directions, sign-out round trip | Claiming more than a stateless JWT permits |
| 4. Measure Option B's conditions | Three measured facts about wrangler and the served worker | All three failing ⇒ escalate; #4 becomes a named gap |
| 5. Browser harness | Build → delete → assert → launch, provable by breaking | An absence-assert that can never fire |
| 6. Critical flow (#4) | Sign up → workout → set → `≈ 112.5 kg 1RM`, plus the 1–12 refusal | A locator failure masquerading as a hydration failure |
| 7. Gate, docs, cookbook | Eight-step gate, `AGENTS.md` fixes, `test-plan.md` §6.3 + §6.7 | Documentation that disagrees with what shipped |

**Prerequisites:** `gymlog-test` credentials in `.env`; email confirmation still **off** on
`gymlog-test`; network. Phase 5 adds `@playwright/test` and a Chromium download.
**Estimated effort:** ~4–6 sessions; Phases 1 and 4 are minutes each, Phases 5–6 are the bulk.

## Open Risks & Assumptions

- Phase 1's probe (a) rests on a **reading** of `create-vite.js:214-216`, not a measurement. Fallback
  (restating Astro's own alias) is planned; probes (b)/(c) failing are the shape-changing outcomes.
- Phase 4's three conditions are all read-not-run today. Each has a named fallback; all three failing
  means risk #4 stays uncovered and the owner is asked about Option D.
- `signOut` cannot recall a stateless JWT — the strongest available claim is at the session level, and
  the tests must say so rather than overclaim.
- The `gymlog-test` signup rate limit is unmeasured; the browser suite keeps to one account per run.
- An interrupted run leaks its per-run account: `delete_own_account()` is the cleanup call that did
  not happen. The mark is what makes the leak identifiable.

## Success Criteria (Summary)

- A request carrying account B's real cookie cannot touch account A's training, and A's row reads
  back untouched **as A** — proven through an identity the middleware derived, not one a test built.
- Signing out ends access: returning to a protected route requires authenticating again, checked by
  attempting to read data, across all three cookie states.
- A person completes the whole flow in a real browser and sees a domain-correct estimate — and the
  screen refuses to guess at the far edge of the 1–12 boundary.
