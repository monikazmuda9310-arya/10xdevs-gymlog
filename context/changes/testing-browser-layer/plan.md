# Browser layer (test-plan rollout Phase 2) — Implementation Plan

> Risks: #2, #3, #4 from `context/foundation/test-plan.md` §2.
> Research (ground truth, wins over the test plan where they disagree):
> `context/changes/testing-browser-layer/research.md`.
> Owner scope decision, 2026-08-16: **Option A first, then Option B** (research §4). Not re-litigated here.

## Overview

Close the two things this repository cannot currently see. **First**, everything between an inbound
HTTP request and `locals.user` — `src/middleware.ts` and `src/lib/supabase.ts` — which executes
**zero times in the entire gate today** (research:849-851, 603-618). That is the real gap behind
risks #2 and #3, and it needs a cookie, not a browser. **Second**, hydration: every island in the
product is `client:load` (research:630), and a screen that renders perfectly and does nothing passes
all three existing runners. That is risk #4, and it is the only part that earns the browser cost.

Both halves must be **structurally incapable of reaching `gymlog`** in the sense
`vitest.integration.config.ts:15-24` already achieves: production absent from the process and
unreachable from disk, so that being wrong produces an **absent** credential (a red first step) and
never a **production** credential (a silent write into the owner's real training log).

## Current State Analysis

**What exists.** Three Vitest projects that cannot see each other's files: `npm test` (`src/**`,
hermetic), `npm run test:integration` (`tests/integration/**`, real network to `gymlog-test`),
`npm run test:render` (`tests/render/**`, Astro container, `configFile: false`). Sixteen files in
`tests/integration/` (fifteen suites plus `fixture-preferences.ts`). CI runs six steps in order with
`concurrency: gymlog-test-fixtures` at **workflow** level (`.github/workflows/ci.yml:18-20`).

**What does not exist, and this is the whole phase.** No test line in this repository touches
`@supabase/ssr`, a cookie, or `src/middleware.ts` — every grep hit is a comment
(research:599-601). Every integration suite hands a handler a **hand-built** `locals`
(`workout-mutations-rls.test.ts:73-83`: `{ supabase: client, user: { id: owner.userId } }`), so the
client and the user id **agree by construction**. A middleware bug that binds the *wrong* identity to
a request is invisible to all fifteen. `resolve()` (`src/pages/api/_shared/mutation-route.ts:42-58`)
never checks ownership — it takes `user.id` from `context.locals` **as given**. Everything downstream
is exactly as correct as a step nothing executes.

**Why no browser test could be written before.** `astro dev` cannot be re-aimed by any per-process
mechanism: `@astrojs/cloudflare` does `Object.assign(process.env, parseEnv(".dev.vars"))` in
`astro:config:done` (`index.js:292-303`) and Vite's `loadEnv` applies `process.env` **last**
(`vite/.../config.js:9417-9418`), so `.dev.vars` — which names production — beats a shell variable,
`.env`, and `.env.<mode>` alike. In dev the value is then **inlined** into `astro:env/server`
(`vite-plugin-env.js:84-88,151-155`), so the workerd env is never consulted.

**The opening, proven not inferred.** At **build** time Astro emits a runtime lookup instead
(`dist/server/chunks/server_Cs1d2reD.mjs:146-165`: `let SUPABASE_URL = _internalGetSecret(...)`),
resolved from the workerd env at request time. Whoever supplies that env decides the project.
**But `npm run build` also writes production's credentials to `dist/server/.dev.vars`**
(`@cloudflare/vite-plugin/dist/index.mjs:83194-83201`) and `wrangler`/`astro preview` read
`.dev.vars` **relative to the config file's directory** — so the build output is aimed at production
by default, via a file no test author would think to look at.

## Desired End State

- A fourth Vitest project, `npm run test:middleware`, driving `onRequest` with **real
  `gymlog-test` session cookies**, proving: the identity the middleware derives, both redirect
  directions, and that a request naming another account's identifier returns no data while that
  account's row reads back untouched **as its owner**. Production is absent from the process (the
  subtractive strip) **and** unreachable from disk (`vite.envDir` at a credential-free directory that
  the config refuses to start if anything `.env*` appears in).
- `npm run test:e2e`: Playwright against the **built** worker, launched from a script that strips the
  environment, seeds the `gymlog-test` pair, and **refuses to start** if `dist/server/.dev.vars`
  exists. A person completes sign up → create a workout → log a set → **see `≈ 112.5 kg 1RM`**.
- Both runners in `.github/workflows/ci.yml`, inside the existing workflow-level concurrency group.
- `test-plan.md` §6.3 written, a new §6.7 for the middleware project, and the two `AGENTS.md`
  corrections research raised (research:891-901) landed.

Verify: `npm run lint && npm run typecheck && npm test && npm run test:render && npm run
test:integration && npm run test:middleware && npm run build && npm run test:e2e` — all green, and
each new suite proven by the mutation named in its phase.

### Key Discoveries

- **`astro:middleware` is a plain Vite alias, not a virtual module.** `create-vite.js:214-216` maps
  `astro:middleware` → `astro/virtual-modules/middleware.js`, whose `defineMiddleware` is
  `(fn) => fn` (`core/middleware/defineMiddleware.js`). This is read, **not measured** — Phase 1
  measures it (`lessons.md` § "reading the catalogue is still not measuring").
- **The env guarantee has to be subtractive.** `vitest.integration.config.ts:19-24` deletes the wrong
  value from the process after deliberately loading it. Every option that merely *supplies* the right
  value wins a precedence contest and loses silently when a flag is forgotten (research:963-966).
- **`getUser()`, not `getSession()`** (`middleware.ts:23-27`) — the former validates against the auth
  server. That single line is what a forged cookie must be aimed at.
- **`signOut` cannot recall a stateless JWT** — `account-boundary.test.ts:449` states this precisely.
  The claim available is at the **session** level, and the cleared-cookie test must say so.
- **The estimate is a number only for 1–12 reps at positive load** (`WorkoutDetail.tsx:545-562`); the
  three alternatives occupy the same slot. Defaults are `kg` + `brzycki`
  (`20260810063450_…:13-15`), so 5 × 100 kg ⇒ `100 × 36 / (37 − 5)` = **112.5**.
- **There is no sign-out control on `/workouts` or `/workouts/[id]`** — only `Topbar.astro:16-20`
  (landing) and `dashboard.astro:307-314`, a plain form POST needing no hydration (research:699-704).
- **Marks in use**, re-derived by `grep -rn "const MARK" tests/integration/` plus the two literals
  (`exercises-rls.test.ts:94` → `s02-`, `auth-flows` → `s01-signup-`/`s01-absent-`):
  `s01-signup-`, `s01-absent-`, `s02-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`,
  `s05m-`, `s06-`, `s07-`, `s08-`, `s09d-`, `s09i-`. This plan takes **`t2c-`** and **`t2e-`**:
  neither is a prefix of, nor prefixed by, any of those or each other.
- **Research corrections 9 and 10 have already landed in code** since research was written —
  `account-boundary.test.ts:57-63` now lists twelve marks including `s02-` and says "re-derive it",
  and `:80-85` retracts the obsolete "nothing can delete an `auth.users` row" premise. Nothing to do.

## What We're NOT Doing

- **Option C** (`.dev.vars.test` + `CLOUDFLARE_ENV`) and **anything aimed at `astro dev`**. Owner
  decision; mechanically justified at research:432-442 and 161-166.
- **Option D** (a second deployed Worker). Held in reserve only as the escalation path if Phase 4's
  measurements all fail; it needs a Cloudflare API token in CI, which cuts against this repository's
  by-hand deploy stance, and `npx wrangler deploy` is in the `ask` list (`.claude/settings.json:50`).
- **Risk #4's phone-width half.** "The control is unusable at a phone width" has **no assigned layer
  anywhere in the test plan**, and this phase does not quietly add one. It is a named gap in
  `test-plan.md` §2 and stays one. No viewport assertion, no responsive check, no implication of
  coverage.
- **Re-proving RLS.** Cross-account reads/writes at the client-library layer are already covered by
  fifteen suites. What is new here is that the identity comes from a **cookie the middleware
  resolved**, not from a hand-built `locals`.
- **`catalogue` as an island prop on `/workouts/[id]`** (research:706-712, Open Question 5). Out of
  scope; the e2e spec must not become the thing that silently ratifies the current shape.
- **The signup rate-limit budget on `gymlog-test`** (research Open Question 4). Not measured here;
  Phase 6 keeps the browser suite to **one** account per run to avoid growing it.
- **Visual/pixel regression, accessibility auditing, snapshot tests.** `test-plan.md` §7.

## Implementation Approach

Seven sub-phases, ordered by cost × signal. The two cheapest are measurements that decide whether the
expensive ones are aimed correctly (`lessons.md` § "the cheapest step in a plan is often the one
deciding whether the expensive ones are aimed correctly, and it is the first one dropped").

| # | Sub-phase | Kind | Risk | Cost |
| - | --------- | ---- | ---- | ---- |
| 1 | Measure that a fourth Vitest project can resolve `astro:middleware` and that `envDir` binds | measurement | — | minutes |
| 2 | The fourth project + the cookie→identity boundary suite | test (integration) | #2 | small |
| 3 | The session-lifecycle suite: three cookie states, both directions | test (integration) | #3 | small |
| 4 | Measure Option B's three conditions | measurement | — | small |
| 5 | The browser harness: build → delete → assert → launch | infrastructure | #4 | medium |
| 6 | The critical-flow spec | test (e2e) | #4 | medium |
| 7 | CI wiring, gate documentation, and the test-plan §6 cookbook | docs/CI | — | small |

**Sub-phase A** = phases 1–3. **Sub-phase B** = phases 4–6. Phase 7 closes both.

## Critical Implementation Details

**The strip must run at config-module top level, before `getViteConfig` is evaluated.** Astro's
env-loader runs `loadEnv(mode, config.vite.envDir ?? root, "")` during config resolution, and in
serve mode the result is **inlined** into `astro:env/server` (`vite-plugin-env.js:151-155`). Config
top-level code executes first, so a strip placed there is seen by the inlining; a strip inside a
`setupFiles` would be too late.

**A `.env` on disk is a second door and `envDir` is what closes it.** Stripping `process.env` alone
is not enough for a runner that loads Astro's Vite pipeline: `loadEnv` reads `.env*` from the env
directory as well. Pointing `envDir` at a directory holding no `.env*` is what makes the guarantee
subtractive rather than a precedence bet.

**Deletion and assertion of `dist/server/.dev.vars` must live in different processes.** If the
launcher deletes the file and then asserts its absence, the assertion can never fire — a hook that
never fires and a hook that passes are the same observation (`lessons.md`). The **build script**
deletes; the **launcher** only asserts and refuses. That makes the refusal provable by planting the
file and running the launcher directly, which Phase 5 does.

**An ordinary `npm run build` re-creates the file.** The assert runs immediately before every launch,
never once at setup (research:426-428).

**Cookie chunking.** `@supabase/ssr` may split the session cookie into `sb-<ref>-auth-token.0`, `.1`.
Any test that forges or replays a cookie must reassemble chunks, and must carry a **positive control**
— the same reassemble-and-re-encode path with the original claims still authenticates — or a tamper
that silently missed is indistinguishable from a tamper that was correctly rejected
(`lessons.md` § "A mutation that fails for the WRONG REASON has not confirmed the guard").

---

## Phase 1: Measure that the fourth project is possible

### Overview

Not a test. Three probes decide whether sub-phase A exists in the shape the owner approved. Research
established the mechanism by **reading installed source**; this phase converts that into a fact.

### Changes Required:

#### 1. A throwaway probe config and probe test

**File**: `vitest.middleware.config.ts` (first draft), `tests/middleware/probe.test.ts` (deleted at
the end of the phase)

**Intent**: establish, in the runner itself, that (a) a module importing `astro:middleware` loads and
`onRequest` is callable, (b) `astro:env/server` reports the value seeded into `process.env` before
the config was evaluated, and (c) `vite.envDir` genuinely binds — i.e. an `.env` placed in the named
directory is what `loadEnv` reads, and the repository root's `.env` is not.

**Contract**: config built with `getViteConfig({ test: { environment: "node", include:
["tests/middleware/**/*.test.ts"] } }, { configFile: false, output: "server", env: { schema: {
SUPABASE_URL, SUPABASE_KEY — both `access: "secret", optional: true` } }, vite: { envDir:
<tests/middleware/no-env> } })`, mirroring `vitest.render.config.ts:24-45`. Probe (c) is run
**twice** and the difference is the measurement: once with a decoy `tests/middleware/no-env/.env`
containing `SUPABASE_URL=https://decoy.invalid` and `process.env.SUPABASE_URL` unset (expect the
decoy to be reported — proving the directory is read), once with `process.env` seeded (expect the
seeded value to win, per `config.js:9417-9418`). Delete the decoy afterwards.

### Success Criteria:

#### Automated Verification:

- The probe suite runs: `npx vitest run --config vitest.middleware.config.ts`
- `import { onRequest } from "@/middleware"` resolves and `typeof onRequest === "function"`
- With `process.env.SUPABASE_URL` seeded from `SUPABASE_TEST_URL`, `astro:env/server` reports that
  value inside the worker
- With the decoy `.env` present and `process.env.SUPABASE_URL` unset, `astro:env/server` reports
  `https://decoy.invalid` — the directory is genuinely the one being read
- The decoy file is removed and the probe test deleted before the phase closes

#### Manual Verification:

- The result is written into this plan's "Measurement record" section below, with the date, whether
  it passed, and — if it failed — which fallback the phase took

**If probe (a) fails**, take fallback 1: add `resolve.alias` mapping `astro:middleware` →
`astro/virtual-modules/middleware.js`, which is a restatement of Astro's own alias
(`create-vite.js:214-216`), not a test double. Record it as a restatement in the config comment.
**If probe (b) fails** — near-impossible, `tests/render/` already depends on it — sub-phase A
collapses: risks #2 and #3 move into the browser spec in Phase 6, at real cost (a browser gives a
cookie *jar*, not a cookie, and the identity assertions become harder to isolate), and that cost is
recorded in `test-plan.md` §2 rather than absorbed silently. **If probe (c) fails**, `envDir` does
not bind and the disk hole cannot be closed structurally — do **not** proceed on the strip alone;
escalate to the owner, because the remaining shape is convention.

**Implementation Note**: pause after this phase for the owner to confirm the measurement result
before Phase 2 builds on it.

---

## Phase 2: The fourth Vitest project, and the cookie → identity boundary (risk #2)

### Overview

Land the config as a permanent, self-defending artefact, and the first suite that ever binds an
identity to a request in a test.

### Changes Required:

#### 1. The config

**File**: `vitest.middleware.config.ts`

**Intent**: a fourth project whose guarantee is the integration config's, extended one step to close
the `.env`-on-disk hole. Top-level: `process.loadEnvFile()` in a `try`; the same subtractive strip as
`vitest.integration.config.ts:19-24`; then seed `SUPABASE_URL`/`SUPABASE_KEY` from the test pair
**after** the strip.

**Contract**: `include: ["tests/middleware/**/*.test.ts"]`, `fileParallelism: false`,
`testTimeout: 30_000`, `hookTimeout: 60_000`, `env: { ...process.env }`, no `passWithNoTests`, `@`
alias — matching the two existing non-hermetic configs. Two additions that carry the guarantee and
must not be trimmed:

1. `vite.envDir` → `tests/middleware/no-env/` (holding only `.gitkeep`);
2. a load-time `readdirSync(envDir)` that **throws** if any entry matches `/^\.env/`, so somebody
   dropping a credentials file there is a loud failure rather than a silent re-aim.

The header comment must state, in the file: this project exists for the one question the other three
cannot ask — *what identity does a real cookie produce?* — and that the strip plus `envDir` together
are what make production **absent** rather than **unaimed-at**.

#### 2. The credential-free env directory

**File**: `tests/middleware/no-env/.gitkeep`

**Intent**: a committed, empty directory that exists solely to be `envDir`.

**Contract**: a `README` line inside the `.gitkeep` is not possible; put the explanation in the config
comment and in `.gitignore` — add `tests/middleware/no-env/.env*` to `.gitignore` so an accidental
file there can never be committed even if the config guard is bypassed.

#### 3. Test harness helpers

**File**: `tests/middleware/_shared/context.ts`

**Intent**: build the slice of `APIContext` `onRequest` actually reads, and record what it writes.

**Contract**: `middlewareContext({ url, cookieHeader })` returning `{ context, cookiesWritten,
redirectedTo }` where `request` is a real `Request` carrying a real `Cookie` header, `cookies` is a
recording `AstroCookies` double (`set(name, value, options)` collected), `redirect(path)` returns
`new Response(null, { status: 302, headers: { Location: path } })`, `locals` starts `{}`, and `next`
is a spy returning a marker `Response`. **The seam must be named in the file**: real are the `Cookie`
header parse, `createServerClient`, the `auth.getUser()` round trip, `locals` derivation and the two
route arrays; doubled are `AstroCookies` and `redirect`, because `astro`'s package exports do not
expose them (checked: no `./dist/*` export).

#### 4. The boundary suite

**File**: `tests/middleware/cookie-identity.test.ts`

**MARK**: `t2c-`. **No `LIKE` sweep anywhere in this project** — accounts are per-run and removed
through `delete_own_account()` on the client that owns them, so no suite in `tests/middleware/` may
delete by prefix. Two per-run accounts, `t2c-a-<run>@` and `t2c-b-<run>@gymlog-test.dev`, created by
`signUp` with `GYMLOG_TEST_PASSWORD`, torn down in `afterAll` via
`client.rpc("delete_own_account")` — the shape `account-deletion.test.ts:189-195` established.
**Never** `rls-owner-a/b@` or any `s09i-` address.

**Assertions**:

1. **The middleware binds the right identity.** Sign in as A and as B with `@supabase/supabase-js`,
   turn each session into a real `Cookie` header, run `onRequest` for `/dashboard` with each, and
   assert `locals.user.id` is that account's id and `locals.supabase` is non-null.
   *Behavior asserted*: the derivation at `middleware.ts:23-30`, the only production call site of
   `createClient` (`:18`). *Regression caught*: a middleware that puts the wrong user — or a cached
   user — on `locals`; invisible to all fifteen integration suites, which pass a client and an id
   that agree by construction (research:603-618). *Source*: research:849; `middleware.ts:18,23-30`.
   *Anti-pattern avoided*: asserting only that `locals.user` is truthy.
2. **A forged cookie does not become an identity.** Reassemble A's session cookie (chunked or not),
   rewrite the `sub` claim to B's user id, re-encode, and send it. Assert `locals.user` is `null` and
   `/dashboard` answers 302 → `/auth/signin`. **Positive control in the same test**: the identical
   reassemble/re-encode path with the original claims still yields `locals.user.id === A`.
   *Regression caught*: `getUser()` "optimised" into `getSession()` — faster, cookie-payload-trusting,
   and it would hand B's id to A's session. *Boundary case*: this is the third cookie state
   (invalid), the one `test-plan.md` §2 row #3 names as dangerous because it can behave silently like
   a valid one. *Anti-pattern avoided*: a tamper that missed and a tamper that was rejected are the
   same observation without the positive control.
3. **B naming A's identifier gets nothing, and A's row survives.** With `locals` **derived by the
   middleware from B's cookie** (not hand-built), drive `PATCH /api/workouts/[id]` and then
   `DELETE /api/workouts/[id]` against A's workout id. Assert `404` + body `{ code:
   "workout_not_found" }` for both, then **read the workout back as A** with A's own client and
   assert `performed_on` and `note` are exactly what A wrote and the row still exists.
   *Regression caught*: a zero-row update/delete reported as success — the exact failure
   `test-plan.md` §2 names ("under RLS a zero-row write reports success"). *Source*:
   `mutation-route.ts:42-58` (`resolve()` never checks ownership; it trusts `locals`),
   `workouts/[id]/index.ts:31,55`; pattern from `workout-mutations-rls.test.ts:149-157,176-188`.
   *Anti-pattern avoided*: asserting the status code only.
4. **The read path answers the same way and leaks nothing.** With B's derived `locals`, drive
   `GET /api/sets/[id]/impact` against a set of A's. Assert `404` + `set_not_found` and that the
   serialized body contains **neither** A's set id nor A's exercise id. *Boundary/error case*: a
   malformed `[id]` (not a uuid) must also answer `404`, never `500` — `UUID_PATTERN` at
   `mutation-route.ts:53`, because a 500 is a different fact about the system than a 404.
   *Anti-pattern avoided*: asserting "no data" by status alone when the body is what would leak.

### Success Criteria:

#### Automated Verification:

- `npm run test:middleware` passes (new script: `vitest run --config vitest.middleware.config.ts`)
- `npm run lint` and `npm run typecheck` pass with the new files
- The suite is **repeatable**: run it twice in a row, both green, no leftover `t2c-` accounts
- `npm test` still matches only `src/**` and `npm run test:integration` only
  `tests/integration/**` — the new glob overlaps neither

#### Manual Verification:

- **Prove assertion 1 by breaking it**: temporarily hardcode `context.locals.user = { id: <A's id> }`
  in `middleware.ts`; assertion 1 must go red for B. Revert.
- **Prove assertion 2 by breaking it**: temporarily swap `getUser()` for `getSession()`; assertion 2
  must go red (the forged `sub` becomes `locals.user.id`). If it does **not** go red, the assertion
  is decoration and must be re-derived before this phase closes (`lessons.md` § "A guard you have not
  mutated may not guard"). Revert.
- **Prove the `envDir` guard by breaking it**: drop an empty `.env` into `tests/middleware/no-env/`
  and confirm the config throws with the message it carries. Remove it.
- Confirm in the Supabase dashboard that no `rls-owner-*` or `s09i-*` account or row was touched.

**Implementation Note**: pause after this phase for manual confirmation of the three mutation proofs
before Phase 3.

---

## Phase 3: The session lifecycle — three cookie states, both directions (risk #3)

### Overview

Signing out ends access; returning to a protected route requires authenticating again **before any
data is shown**. The redirect is the cheap half; the data read is the claim.

### Changes Required:

#### 1. The session suite

**File**: `tests/middleware/session-lifecycle.test.ts`

**MARK**: `t2c-` (same project rule: no `LIKE` sweeps). Its own per-run account,
`t2c-session-<run>@gymlog-test.dev`, with its own workout carrying a run-unique note — because this
suite deliberately ends its account's session, which no other assertion may inherit
(the reason `account-boundary.test.ts:65-68` gives for its third account).

**Assertions**:

1. **Valid cookie → the page is reached, and its data is reachable.** `onRequest` for `/workouts`
   with a live cookie: `next()` is called, no redirect, `locals.user.id` is the account. Then drive a
   real read with that derived `locals` and assert the account's own workout note comes back.
   *Why it is here*: it is the positive control the other two states are measured against; without
   it, "no data" proves nothing about whether data was ever obtainable.
2. **Cleared cookie → redirect AND no data.** Drive `POST /api/auth/signout` with the live derived
   `locals`, capture the `Set-Cookie` values `setAll` wrote onto the recording double, and **replay
   those exact values as the next request's `Cookie` header**. Assert: 302 → `/auth/signin` for
   `/workouts`, `locals.user` is `null`, and a read attempted with that `locals` returns the account's
   workout **not at all**. *Behavior asserted*: the `setAll` → next-request-`getAll` round trip
   (`supabase.ts:14-25`), which nothing has ever executed. *Regression caught*: a sign-out that
   redirects while leaving a usable session cookie behind. *Source*: `signout.ts:3-12`;
   research:547-550. *Anti-pattern avoided*: asserting the destination URL without attempting a data
   read. **Precision required in the test's own comment**: an access token is a stateless JWT and
   `signOut` cannot recall one — the claim here is at the **session** level, in the words
   `account-boundary.test.ts:449` already uses.
3. **Absent cookie → redirect, and `next()` is never called.** `/workouts/<uuid>` with no `Cookie`
   header at all. *Boundary case*: assert the **prefix** semantics — `/workouts/<id>` is protected by
   the single `/workouts` entry (`middleware.ts:7`, research:517-518) — and assert `next` was not
   invoked, because "redirected" and "rendered then redirected" are different facts.
4. **The reverse direction.** A signed-in request for `/auth/signin` and `/auth/signup` answers
   302 → `/dashboard`; a signed-in request for `/auth/confirm-email` does **not** redirect.
   *Regression caught*: `/auth/confirm-email` being "tidied" into `AUTH_ROUTES`, which would bounce
   somebody off the page explaining what to do next (`middleware.ts:9-14`). *Anti-pattern avoided*:
   testing only the direction that keeps people out.
5. **No credentials → `locals.user` is null and every protected route redirects.** Run one case with
   `astro:env/server` reporting absent credentials, asserting `createClient` returns `null`
   (`supabase.ts:9-11`) and `middleware.ts:28-30` takes the null branch. *Why this is a guard and not
   decoration*: it is the documented silent-failure mode of a Worker deployed without runtime secrets
   (risk #7, `AGENTS.md` § Cloudflare traps), and it is the behaviour Phase 5's harness **relies on**
   to fail loudly. If it cannot be reached from inside this project without restarting the runner,
   assert it instead as a direct unit call on `createClient` in this file and say so in a comment —
   naming what that costs — rather than skipping it.

### Success Criteria:

#### Automated Verification:

- `npm run test:middleware` passes with both suites
- The suite is repeatable (run twice); no `t2c-session-*` account survives a green run
- `npm run lint`, `npm run typecheck` pass

#### Manual Verification:

- **Prove assertion 3 by breaking it**: remove `"/workouts"` from `PROTECTED_ROUTES`; assertion 3
  must go red. Revert.
- **Prove assertion 4 by breaking it**: delete the `AUTH_ROUTES` block; assertion 4 must go red.
  Revert.
- **Prove assertion 2 by breaking it**: make `signout.ts` redirect without calling
  `supabase.auth.signOut()`; assertion 2's data read must go red — not merely the cookie count.
  Revert.

**Implementation Note**: sub-phase A is complete here. Pause for owner confirmation. Risks #2 and #3
are closed at this point **whether or not sub-phase B ever lands**, which is why it went first.

---

## Phase 4: Measure Option B's three conditions

### Overview

Not a test. Research read wrangler's source and did not run it (research:332-334). Every condition
below is measured before Phase 5 is built on it, and a failure changes the phase's shape rather than
being worked around.

### Changes Required:

#### 1. Three measurements, recorded

**File**: this plan's "Measurement record" section

**Intent**: establish by running, not reading:

1. **Does `wrangler dev --config dist/server/wrangler.json` start with `dist/server/.dev.vars`
   deleted?** (research Open Question 3.)
2. **Do `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=true` + `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` feed
   `SUPABASE_URL`/`SUPABASE_KEY` from the launching process env into the workerd env?**
   (`cli.js:255351-255360`, `52362-52368`, `255307-255312` — read, not run.)
3. **Is the served worker actually talking to `gymlog-test`?** Measured positively: `curl` the
   sign-in page, then sign up one throwaway `t2e-probe-<run>@gymlog-test.dev` account through the
   **served** `/api/auth/signup`, and confirm that account exists in `gymlog-test` by signing into it
   with `@supabase/supabase-js` against `SUPABASE_TEST_URL`. Delete it via `delete_own_account()`.

**Contract**: no build with production credentials is deployed and no `wrangler deploy` is run. The
build for this measurement is an ordinary local `npm run build`; the emitted
`dist/server/.dev.vars` is deleted **before** any server is started, and its absence confirmed by
`ls`, because starting the server with it present is precisely the accident this phase exists to
prevent.

### Success Criteria:

#### Automated Verification:

- Measurement 3's probe account is found in `gymlog-test` and removed afterwards

#### Manual Verification:

- All three results recorded in "Measurement record" with the date and the exact commands
- **If (1) fails**: fall back to writing a **zero-byte** `dist/server/.dev.vars` instead of deleting
  it, and the launcher's assert becomes "exists and is empty / contains no `SUPABASE_`" rather than
  "absent". Record which shape shipped.
- **If (2) fails**: fall back to `wrangler dev --var SUPABASE_URL:<test> --var SUPABASE_KEY:<test>`
  from the launcher. `getVarsForDev` (`cli.js:255334-255388`) has `.dev.vars` overwrite config
  `vars` — with no `.dev.vars` present, `--var` survives, and if the launcher is bypassed there are
  no vars at all, which keeps the failure "absent" rather than "production". Note in the launcher
  that this puts a publishable test key on a command line visible to process listings.
- **If (3) fails**: stop. Nothing in Phase 5 or 6 may be written until the harness is provably aimed
  at `gymlog-test`, because the failure being guarded against is exactly a plausible-looking run
  against production.
- **If all three fail**: escalate to the owner for Option D (a second deployed Worker), and until
  that is decided, risk #4 joins the phone-width half as a **named gap** in `test-plan.md` §2, in
  the words `lessons.md` § "An assertion you keep because it cannot fail YET" prescribes.

**Implementation Note**: pause for owner confirmation of all three results before Phase 5.

---

## Phase 5: The browser harness — build, delete, assert, launch

### Overview

Playwright against the **built** worker, with the deletion and the assertion in different processes
so the assertion is provable.

### Changes Required:

#### 1. Playwright as a devDependency

**File**: `package.json`

**Intent**: add `@playwright/test` and a `test:e2e` script; install the Chromium browser only.

**Contract**: `"test:e2e": "node scripts/e2e-build.mjs && playwright test"`. Chromium only — one
engine is what risk #4 asks about (hydration), and three would triple CI time for no additional
signal. *Guidance dated 2026-08-16: no vendor-docs MCP is exposed (`test-plan.md` §4), so pin whatever
`@playwright/test` version `npm` resolves at install time and record it in `test-plan.md` §4 rather
than trusting a remembered version number.*

#### 2. The build-and-strip script

**File**: `scripts/e2e-build.mjs`

**Intent**: run `astro build`, then **delete** `dist/server/.dev.vars` (or truncate it, per Phase 4's
result) and report what it did.

**Contract**: exits non-zero if the build fails; prints the file's byte count before deleting so the
log records that it existed. It **does not** assert absence — that is the launcher's job, and keeping
them apart is what makes the assert provable.

#### 3. The launcher

**File**: `scripts/e2e-serve.mjs`

**Intent**: the only way the server starts, carrying the whole credential guarantee.

**Contract**, in order, refusing loudly at each step:

1. `process.loadEnvFile()` in a `try`, then the **same subtractive strip** as
   `vitest.integration.config.ts:19-24`;
2. require `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY`, `GYMLOG_TEST_PASSWORD` — throw, never skip;
3. **assert `dist/server/.dev.vars` does not exist** (or is empty), with a message naming
   `npm run test:e2e` as the fix; this runs immediately before spawn, on every launch;
4. assert `process.env.SUPABASE_URL === process.env.SUPABASE_TEST_URL` after seeding, so the positive
   claim is checked and not assumed;
5. spawn `wrangler dev --config dist/server/wrangler.json --port <port>` with the gates measured in
   Phase 4, and wait for the port to answer.

The header comment states the property: **if this launcher is bypassed, the variables are absent, not
wrong** — `supabase.ts:9-11` returns `null`, `middleware.ts:28-30` sets `locals.user = null`, and
every protected route redirects. For a human that failure is famously silent; for a browser suite it
is a red test on the first step (research:411-417).

#### 4. The Playwright config

**File**: `playwright.config.ts`

**Intent**: apply the same strip **in the Playwright process itself**, so the runner is as incapable
as the server; wire `webServer` to the launcher.

**Contract**: top-level `loadEnvFile` + strip + seed (the config a runner cannot start without —
the property `vitest.integration.config.ts` has and a wrapper script does not, research:297-299);
`testDir: "tests/e2e"`, `use.baseURL: "http://localhost:<port>"` (**`localhost`, not `127.0.0.1`** —
Chrome treats `localhost` as a secure context, so a `Secure` session cookie is still accepted),
`webServer: { command: "node scripts/e2e-serve.mjs", url: baseURL, reuseExistingServer: false }`,
`workers: 1`, `forbidOnly: !!process.env.CI`, no retries locally. `globalTeardown` deletes the run's
account via `delete_own_account()`.

#### 5. Housekeeping

**File**: `.gitignore`, `eslint.config.js`

**Intent**: keep Playwright's output out of the repository and keep the two new scripts lintable.

**Contract**: add `test-results/`, `playwright-report/`, `blob-report/`, `.playwright/` to
`.gitignore`. The `scripts/**` ESLint override (`eslint.config.js:82-93`) declares its globals
explicitly — extend that list with whatever the two scripts genuinely use (`Buffer`, timers) rather
than disabling the rule.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` starts the server and a trivial smoke spec loads `/auth/signin` and finds the
  `Sign in` heading (`signin.astro`, research:650)
- `npm run lint` and `npm run typecheck` pass over `scripts/`, `playwright.config.ts`, `tests/e2e/`
- `npm run build` still passes and does not pick up the new directories

#### Manual Verification:

- **Prove the absence-assert by breaking it**: after a build+strip, write a dummy
  `dist/server/.dev.vars`, run `node scripts/e2e-serve.mjs` directly, and confirm it **refuses** with
  the message it carries. Delete the dummy. (`lessons.md` § "A hook that never fires and a hook that
  passes are the SAME observation".)
- **Prove the strip by breaking it**: run the launcher with `SUPABASE_TEST_URL` unset and confirm it
  refuses rather than starting a server pointed at nothing.
- **Prove the aim**: run the smoke spec, sign up one account through the browser, and find that
  account in `gymlog-test` (not in `gymlog`). This is Phase 4 measurement 3 repeated through the real
  harness, and it is the check that must be repeated after any change to the launcher.

**Implementation Note**: pause for owner confirmation of the three manual proofs before Phase 6.

---

## Phase 6: The critical flow in a real browser (risk #4)

### Overview

A person completes sign up → create a workout → log a set → **see its estimate**. One spec, one
account, one run-unique mark.

### Changes Required:

#### 1. The spec

**File**: `tests/e2e/critical-flow.spec.ts`

**MARK**: `t2e-`. One account per run, `t2e-<run>@gymlog-test.dev`, password `GYMLOG_TEST_PASSWORD`,
removed in `globalTeardown` by signing in with `@supabase/supabase-js` and calling
`delete_own_account()`. **`delete_own_account()` cannot rescue an interrupted run** — the cleanup
call is the thing that did not happen (`account-boundary.test.ts:80-85`) — so the mark is what makes
a leaked account identifiable, and the suite keeps to **one** account per run so an interrupted run
leaks one, not seven.

**Locators** (`getByRole` / `getByLabel` / `getByText` only; never CSS, never XPath; never
`page.waitForTimeout()` — wait on state):

- `/auth/signup`: `Email`, `Password`, `Confirm password`, button `Create account`.
  ⚠ **both visibility toggles carry the identical `aria-label` `Show password`**
  (`PasswordToggle.tsx:14`) — scope or `.first()` (research:646-648).
- `/workouts`: `getByLabel("Date")`, button `Start workout`. **Success is a navigation, not a
  message** (`NewWorkoutForm.tsx:52`) — `waitForURL(/\/workouts\/[0-9a-f-]{36}/)`.
- `/workouts/[id]`: search box `Search exercises` (`ExercisePicker.tsx:32-34`); the exercise button's
  accessible name **concatenates name + badges + muscle group**, so match non-exactly. Use
  **`Lat Pulldown`** — the seeded names contain no other string it is a substring of, unlike
  `Bench Press` (⊂ `Incline Bench Press`) and `Deadlift` (⊂ `Romanian Deadlift`).
- Set entry: `Reps`, `Weight (kg)` — **the unit is in the label** (`AddSetForm.tsx:118-120`) — and
  the submit is icon-only, `aria-label="Add set"`. The labels repeat per entry (ids are
  `reps-<entryId>`), so scope with `getByRole("listitem").filter({ hasText: … })` if a second
  exercise is ever added (research:673-675).

**Assertions**:

1. **The flow, to a number.** Sign up → land on `/dashboard` (confirmation is **off** on
   `gymlog-test`, so `signUp` returns a session — `auth-flows.test.ts:75-81`) → `/workouts` → start a
   workout dated today → add `Lat Pulldown` → log `5` reps at `100` → assert the new set row reads
   `5 × 100 kg` **and** carries `≈ 112.5 kg 1RM`.
   *Behavior asserted*: three `client:load` islands actually hydrate and their handlers reach the
   API. *Regression caught*: a screen that renders correctly and does nothing — invisible to all
   three existing runners, and four of five shipped defects were of this shape (`test-plan.md` §2
   row #4 source). *Source*: `WorkoutDetail.tsx:545-562`, `372-378`;
   defaults `20260810063450_…:13-15`; Brzycki `100 × 36 / (37 − 5) = 112.5`.
   *Boundary*: 5 reps at positive load is **deliberately inside** 1–12, because outside it the slot
   holds a sentence and the assertion would prove nothing.
   *Anti-pattern avoided*: asserting the estimate element is present. The assertion is on the number
   that appeared **as a result of** submitting the form — and the number is domain-correct, not
   merely non-empty.
   *Waiting*: on the set row / its `1RM` span, never on a timeout; the submit button's accessible
   name does not change while pending (`aria-label` is static), so it is not a signal
   (research:692-694).
2. **The product declines to guess, in the browser.** In the same entry, log `15` reps at `60` and
   assert that row reads `outside 1–12 reps — no estimate` and contains **no** `1RM` number.
   *Why it belongs here and not in a unit test*: the unit tests pin `estimateForLoggedSet`; this pins
   that the **screen** puts the refusal in the same slot the number occupies, which is the thing a
   user reads. *Error/boundary case*: the 1–12 boundary at its far edge.
   *Anti-pattern avoided*: a happy-path-only flow. A flow that only ever sees the number cannot tell
   a working estimator from one that prints something for every input.
3. **Sign-out ends it, from the browser.** Navigate to `/dashboard` — **there is no sign-out control
   on `/workouts` or `/workouts/[id]`** (research:699-704) — click `Sign out`, then navigate straight
   back to the workout URL and assert the URL is `/auth/signin` **and** the workout's note text is
   **not** on the page.
   *Why this is here despite Phase 3*: Phase 3 proves it at the cookie level with a doubled
   `AstroCookies`; this proves the real browser cookie jar honours the `Set-Cookie` the worker
   actually emitted. Its own comment must say that is the only delta, so it is not cited as the
   primary evidence for risk #3.
   *Anti-pattern avoided*: asserting the destination URL without attempting to see data.

**Explicitly not asserted**: anything about viewport, layout or reachability at a phone width. That
half of risk #4 has no layer and this spec does not pretend otherwise.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` passes from a clean `dist/` and again immediately (repeatable)
- No `t2e-` account survives a green run
- `npm run lint`, `npm run typecheck` pass

#### Manual Verification:

- **Prove assertion 1 by breaking it**: remove the `client:load` directive from `WorkoutDetail`
  (`[id].astro:98`) so the island renders but never hydrates, and confirm the spec goes red at the
  "Add set" step — an unhydrated form that still renders is exactly the failure risk #4 names. If it
  goes red at a **locator** instead, the assertion is testing markup rather than behaviour and must be
  re-aimed before this phase closes. Revert.
- **Prove assertion 2 by breaking it**: temporarily widen the estimator's rep range past 12 and
  confirm assertion 2 goes red. Revert.
- Run the spec headed once (`--headed`) and watch the flow end to end, which is also the only
  moment in this plan when a human sees the product at all.
- Confirm no `rls-owner-*`, `s09i-*` or production row was touched.

**Implementation Note**: pause for owner confirmation before Phase 7.

---

## Phase 7: The gate, the documentation, and the cookbook

### Overview

A check outside the gate rots. Wire both runners in, then write down what shipped — including the two
`AGENTS.md` facts research surfaced that are not recorded anywhere today.

### Changes Required:

#### 1. CI

**File**: `.github/workflows/ci.yml`

**Intent**: add `npm run test:middleware` and `npm run test:e2e` as steps of the **existing `ci`
job**, so they inherit the workflow-level `concurrency: gymlog-test-fixtures` group
(`:18-20`) rather than needing a new one — research:825-827 warns that a new workflow would **not**
join it automatically and would reintroduce the race the group exists to prevent.

**Contract**: `test:middleware` immediately after `test:integration`, with
`SUPABASE_TEST_URL` / `SUPABASE_TEST_KEY` / `GYMLOG_TEST_PASSWORD` and **no production credential**.
`test:e2e` **after** `build` (it consumes `dist/`), same three secrets, preceded by
`npx playwright install --with-deps chromium`. No new repository secret is required — the five
existing ones cover both. A comment states that both steps write to `gymlog-test` and are inside the
group **because** they are in this job.

#### 2. The gate, restated where people read it

**File**: `AGENTS.md` (§ Commands, § Testing), `README.md` (scripts table, CI section)

**Intent**: the gate is no longer six steps. Say so everywhere the six are enumerated.

**Contract**: `lint` → `typecheck` → `test` → `test:render` → `test:integration` →
**`test:middleware`** → `build` → **`test:e2e`**. State that `test:e2e` is required in CI on every PR
(`test-plan.md` §5 already commits this) and required locally before claiming done on anything
touching pages, islands, `src/middleware.ts`, `src/lib/supabase.ts` or the adapter. Add the fourth
and fifth Vitest/Playwright projects to the "**there are three Vitest projects and they cannot see
each other's files**" paragraph — there are now four, plus Playwright.

#### 3. The two Cloudflare facts research found

**File**: `AGENTS.md` § Cloudflare traps

**Intent**: record what nothing in this repository records today (research:891-901).

**Contract**: (a) **`npm run build` writes the production Supabase credentials to
`dist/server/.dev.vars`** — emitted by `@cloudflare/vite-plugin` (`index.mjs:83194-83201`), read by
`wrangler`/`astro preview` relative to the **config file's** directory; gitignored and kept off the
CDN by `.assetsignore`, so nothing leaks, but any harness pointed at the build output inherits
production silently, which is why `scripts/e2e-build.mjs` deletes it and `scripts/e2e-serve.mjs`
refuses without it gone. (b) **Narrow the "`wrangler dev` is legacy" sentence** to the *dev loop*,
which is what it means: dev **inlines** its secrets, the build **defers** to the runtime env
(`dist/server/chunks/server_Cs1d2reD.mjs:146-165`), so running the **built** worker under wrangler as
a test harness is a different question and is not foreclosed.

#### 4. `test-plan.md` §6 — the cookbook patterns that shipped

**File**: `context/foundation/test-plan.md`

**Intent**: §6.3 is currently "TBD — see §3 Phase 2". Write it, add the new §6.7 for the middleware
project, and close the two smaller backports.

**Contract**:

- **§6.3 "Adding an e2e test"** — location `tests/e2e/`; the harness is the **built** worker, never
  `astro dev`, and the reason in one line with the file:line; the launcher is the only way to start
  it and the absence-assert on `dist/server/.dev.vars` runs before every launch; one per-run account
  with the `t2e-` mark, removed by `delete_own_account()` in `globalTeardown`, never a shared
  fixture; locators `getByRole`/`getByLabel`/`getByText`, never CSS/XPath, never `waitForTimeout`;
  the two locator traps (duplicate `Show password`; per-entry labels repeat) and the "success is a
  navigation, not a message" note; **assert the effect of an interaction, not the presence of an
  element**; the estimate is a number only for 1–12 reps at positive load, so a flow must land inside
  it; reference test `tests/e2e/critical-flow.spec.ts`; run with `npm run test:e2e`.
- **New §6.7 "Adding a middleware / cookie test"** — location `tests/middleware/`; what this project
  can see that no other can (a real cookie becoming `locals.user`); the two-part credential guarantee
  (subtractive strip **plus** `envDir`, and why either alone is insufficient); the three cookie
  states — valid, cleared, **invalid/forged** — and that the third is the dangerous one because it
  can behave silently like the first; the positive-control rule for any forged cookie; `t2c-` mark,
  per-run accounts, **no `LIKE` sweeps in this project**; what is real and what is doubled in
  `_shared/context.ts`; reference tests; run with `npm run test:middleware`.
- **§6.4** — add the file:line behind "cannot be displaced"
  (`@astrojs/cloudflare/dist/index.js:292-303` + `vite/.../config.js:9417-9418`), so the next reader
  does not re-derive it (research:888-890).
- **§5** — note on the `e2e on the critical flow` row that the job joins `gymlog-test-fixtures` by
  living in the workflow that declares it.
- **§4 Stack** — replace the `e2e | none yet` row with the installed `@playwright/test` version,
  Chromium only, dated.
- **§3** — flip Phase 2's Status to `complete` and add a one-paragraph §6.6 entry recording what
  outlived it: that the real gap behind #2/#3 was never the browser, and that the build output ships
  production credentials to disk.

#### 5. Change-folder bookkeeping

**File**: `context/changes/testing-browser-layer/change.md`, `C:\10xdev\handoff\STATE.md`

**Intent**: `status: complete`, `updated: <date>`; STATE.md records that test-plan Phase 2 landed and
which two gaps remain named (phone width; anything Phase 4 downgraded).

### Success Criteria:

#### Automated Verification:

- The full gate passes locally in order: `lint`, `typecheck`, `test`, `test:render`,
  `test:integration`, `test:middleware`, `build`, `test:e2e`
- A CI run on a PR is green and shows both new steps
- Two concurrent CI runs do **not** overlap (the concurrency group still holds with the added steps)

#### Manual Verification:

- `test-plan.md` §6.3 and §6.7 read as instructions somebody could follow without opening this plan
- `AGENTS.md`'s gate sentence, the Vitest-projects paragraph, and § Cloudflare traps all agree with
  what shipped
- The phone-width gap is still stated as a gap in §2 and is **not** implied to be covered anywhere

---

## Testing Strategy

### Integration (the fourth Vitest project)

- Identity derivation from a real cookie; a forged cookie with a positive control; cross-account
  mutation and read via middleware-derived `locals`, each paired with a **read-back as the row's
  owner**; the three cookie states; both redirect directions; the no-credentials branch.

### E2E

- One critical flow to a domain-correct number, one refusal at the far edge of the 1–12 boundary,
  one sign-out that is checked by attempting to see data.

### Manual

1. Run each mutation proof named in Phases 2, 3, 5 and 6 — nine in total — confirming red, then
   revert. A green suite that was never made to fail is decoration.
2. Run `npm run test:e2e -- --headed` once and watch the flow.
3. Confirm in the dashboard that `gymlog` was never touched: the production project's account count
   and its single account's workout count are unchanged.

## Performance Considerations

CI grows by two steps. `test:middleware` is a handful of auth round trips to Frankfurt — comparable
to one integration file. `test:e2e` adds a build (already in the gate), a Chromium download (cached by
`actions/setup-node`'s npm cache only for the package; the browser needs `npx playwright install`,
~30 s) and one flow. Both are inside the existing concurrency group, so the wall-clock cost is paid
serially against other runs — that is the price of the shared fixture rows and is not negotiable.

## Migration Notes

No schema change. No migration. `delete_own_account()` already exists
(`20260815140000_delete_own_account.sql`) and is used as-is.

## Measurement record

> Filled in by Phases 1 and 4 as they run. Each entry: date, exact command, result, and — where the
> result differed from what the source read suggested — what changed in the plan.

- **P1.a `astro:middleware` resolves under `getViteConfig` + `configFile: false`** — **PASSED**,
  2026-08-16. `MIDDLEWARE_PROBE_MODE=seeded npx vitest run --config vitest.middleware.config.ts`.
  `import { onRequest } from "@/middleware"` resolved with no `resolve.alias` at all and
  `typeof onRequest === "function"`. **Fallback 1 was not needed** — Astro's own
  `astro:middleware` → `astro/virtual-modules/middleware.js` alias is present under `getViteConfig`,
  which research had only read (`create-vite.js:214-216`). The `@/` alias resolved too, from
  `tsconfig.json` paths, exactly as `tests/render/` already relies on.
- **P1.b `astro:env/server` reports the seeded `process.env` value** — **PASSED**, 2026-08-16. Same
  command, no decoy on disk. `astro:env/server` reported `https://nfmrwvevntbzulsmrmel.supabase.co`,
  which is `SUPABASE_TEST_URL`. Production is a **different** project ref
  (`cdzybmwxtefhbanfytna`, confirmed by `node -e` printing both hostnames from `.env`), so the
  strip-then-seed genuinely re-aimed the runner rather than coinciding with what was already there.
- **P1.c `vite.envDir` binds (decoy `.env` probe)** — **PASSED**, 2026-08-16, measured as the
  difference between three runs with `printf 'SUPABASE_URL=https://decoy.invalid\n' >
  tests/middleware/no-env/.env`:
  1. decoy present, seed **withheld** → reported `https://decoy.invalid`. The env **directory** is
     genuinely what `loadEnv` reads — and, the load-bearing half, the **repository root's `.env` is
     not**, because that one names production and production is what did not appear.
  2. decoy present, seed applied → reported the test URL. `process.env` is applied last
     (`config.js:9417-9418`), as read.
  3. **Mutation, to prove the probe was not inert**: decoy **removed**, still asserting the decoy →
     red, and red for its own reason — `expected undefined to be 'https://decoy.invalid'`. The
     observed value was **`undefined`**, not production's URL. That is the property the whole plan
     rests on stated as a measurement rather than an intention: with the strip applied and nothing
     in the env directory, being wrong yields an **absent** credential, never a production one.
- **P1 artefacts** — `tests/middleware/no-env/.gitkeep` and `vitest.middleware.config.ts` kept (the
  latter as the first draft, without the `readdirSync` guard, which is Phase 2's and which probe (c)
  had to be able to violate). Decoy `.env` and `tests/middleware/probe.test.ts` deleted; the
  config's `MIDDLEWARE_PROBE_MODE` branch went with the probe rather than being left as a knob that
  can withhold the seed.
- **P4.1 `wrangler dev` starts with `dist/server/.dev.vars` deleted** — pending
- **P4.2 `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV` + `CLOUDFLARE_INCLUDE_PROCESS_ENV` behave as read** — pending
- **P4.3 the served worker is provably talking to `gymlog-test`** — pending

## References

- Research: `context/changes/testing-browser-layer/research.md` (ground truth for this phase)
- Change identity: `context/changes/testing-browser-layer/change.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks + guidance), §3 (Phase 2), §5, §6
- Rules invoked: `context/foundation/lessons.md` §§ "A hook that never fires…", "A guard you have not
  mutated may not guard", "A mutation that fails for the WRONG REASON…", "The ORDER database-internal
  actions fire in…", "An assertion you keep because it cannot fail YET…", "A `finally` that restores
  shared state…", "A test whose title claims more than its body asserts…"
- Config shapes to mirror: `vitest.integration.config.ts:9-44`, `vitest.render.config.ts:1-45`
- Suite shapes to mirror: `tests/integration/account-deletion.test.ts:86-103,189-195` (per-run
  accounts + RPC teardown), `tests/integration/workout-mutations-rls.test.ts:149-157,176-188`
  (status + persisted state in one test)
- Code under test: `src/middleware.ts:7,15,18,21,23-30,32-40`; `src/lib/supabase.ts:8-27`;
  `src/pages/api/auth/signout.ts:3-12`; `src/pages/api/_shared/mutation-route.ts:42-58`;
  `src/components/workouts/WorkoutDetail.tsx:372-378,545-562`;
  `src/components/workouts/AddSetForm.tsx:97-169`; `src/pages/dashboard.astro:307-314`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Measure that the fourth project is possible

#### Automated

- [x] 1.1 The probe suite runs under `vitest.middleware.config.ts`
- [x] 1.2 `onRequest` imports and is callable (probe a)
- [x] 1.3 `astro:env/server` reports the seeded test URL (probe b)
- [x] 1.4 The decoy `.env` in the env directory is what `loadEnv` reads when `process.env` is unseeded (probe c)
- [x] 1.5 Decoy file removed and probe test deleted

#### Manual

- [x] 1.6 Result recorded in "Measurement record", with the fallback taken if any probe failed

### Phase 2: The fourth Vitest project, and the cookie → identity boundary (risk #2)

#### Automated

- [ ] 2.1 `npm run test:middleware` passes
- [ ] 2.2 `npm run lint` and `npm run typecheck` pass
- [ ] 2.3 The suite is repeatable — two consecutive green runs, no `t2c-` account left behind
- [ ] 2.4 The three Vitest globs still cannot see each other's files

#### Manual

- [ ] 2.5 Assertion 1 proven by hardcoding `locals.user` — red, then reverted
- [ ] 2.6 Assertion 2 proven by swapping `getUser()` for `getSession()` — red, then reverted
- [ ] 2.7 The `envDir` guard proven by planting a `.env` — throws, then removed
- [ ] 2.8 No `rls-owner-*` or `s09i-*` fixture touched

### Phase 3: The session lifecycle — three cookie states, both directions (risk #3)

#### Automated

- [ ] 3.1 `npm run test:middleware` passes with both suites
- [ ] 3.2 Repeatable — two consecutive green runs, no `t2c-session-*` account left behind
- [ ] 3.3 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 3.4 Assertion 3 proven by removing `/workouts` from `PROTECTED_ROUTES` — red, then reverted
- [ ] 3.5 Assertion 4 proven by deleting the `AUTH_ROUTES` block — red, then reverted
- [ ] 3.6 Assertion 2 proven by making `signout.ts` skip `signOut()` — the data read goes red, then reverted

### Phase 4: Measure Option B's three conditions

#### Automated

- [ ] 4.1 Measurement 3's probe account found in `gymlog-test` and removed

#### Manual

- [ ] 4.2 P4.1 recorded — `wrangler dev` with `dist/server/.dev.vars` deleted
- [ ] 4.3 P4.2 recorded — the two `CLOUDFLARE_*` gates
- [ ] 4.4 P4.3 recorded — the served worker is provably aimed at `gymlog-test`
- [ ] 4.5 Fallback (if any) chosen and written into the plan before Phase 5 starts

### Phase 5: The browser harness — build, delete, assert, launch

#### Automated

- [ ] 5.1 `npm run test:e2e` starts the server and the smoke spec finds the `Sign in` heading
- [ ] 5.2 `npm run lint` and `npm run typecheck` pass over the new files
- [ ] 5.3 `npm run build` still passes

#### Manual

- [ ] 5.4 The absence-assert proven by planting `dist/server/.dev.vars` — the launcher refuses
- [ ] 5.5 The strip proven by unsetting `SUPABASE_TEST_URL` — the launcher refuses
- [ ] 5.6 The aim proven — a browser-created account is found in `gymlog-test`

### Phase 6: The critical flow in a real browser (risk #4)

#### Automated

- [ ] 6.1 `npm run test:e2e` passes from a clean `dist/`, and again immediately
- [ ] 6.2 No `t2e-` account survives a green run
- [ ] 6.3 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 6.4 Assertion 1 proven by removing `client:load` from `WorkoutDetail` — red at "Add set", then reverted
- [ ] 6.5 Assertion 2 proven by widening the estimator's rep range — red, then reverted
- [ ] 6.6 The flow watched once with `--headed`
- [ ] 6.7 No shared fixture and no production row touched

### Phase 7: The gate, the documentation, and the cookbook

#### Automated

- [ ] 7.1 The full eight-step gate passes locally, in order
- [ ] 7.2 A CI run on a PR is green and shows both new steps
- [ ] 7.3 Two concurrent CI runs do not overlap

#### Manual

- [ ] 7.4 `test-plan.md` §6.3 and the new §6.7 are followable without this plan
- [ ] 7.5 `AGENTS.md` gate sentence, Vitest-projects paragraph and § Cloudflare traps all agree with what shipped
- [ ] 7.6 The phone-width gap is still stated as a gap and implied nowhere to be covered
- [ ] 7.7 `change.md` and `STATE.md` updated
