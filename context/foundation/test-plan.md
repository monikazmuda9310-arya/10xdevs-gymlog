# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-16

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote
   to e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff
   that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the owner is worried about X, and
   the failure would surface somewhere in that area" carry the same weight as PRD lines or hot-spot
   data.
3. **Risks are scenarios, not code locations.** This plan documents _what could fail_ and _why we
   believe it's likely_ — drawn from documents, interview, and codebase _signal_ (churn, structure,
   test base). It does NOT claim to know which line owns the failure. That knowledge is produced by
   `/10x-research` during each rollout phase. If the plan and research disagree about where the
   failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `tests/` — 138 commits in the
30 days to 2026-08-16. Counts below are file-touches in that window, not commit counts.

A fourth rule is specific to this repository and binds every phase below: **a test that writes data
runs against `gymlog-test` and must be structurally incapable of reaching `gymlog`.** Production
holds one account with real training and free-plan backup retention is zero days.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood.
Risks are failure scenarios in user / business terms, not test names. The Source column cites the
_evidence that surfaced this risk_ — never a specific file as "where the failure lives" (§1 #3).

| #   | Risk (failure scenario)                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | The week's figures are computed from the wrong days after a timezone change; the number looks correct and is believed | High   | High       | interview Q3; hot-spot `src/lib/services/` — 53 changes/30d                                                    |
| 2   | Account B reaches account A's training by naming an identifier directly (**abuse scenario**)                          | High   | Medium     | `prd.md` § Guardrails; `prd.md` US-04 AC1; `infrastructure.md` § Risk register (M×H row asks for exactly this) |
| 3   | A signed-out visitor returns and is shown training data, or a signed-in visitor is bounced between routes             | High   | Medium     | `prd.md` US-04 AC3; interview Q4; hot-spot `src/` — 16 changes/30d at root of the source tree                  |
| 4   | A screen renders correctly and does nothing — the island never hydrates, or the control is unusable at a phone width  | High   | Medium     | interview Q4; `roadmap.md` § Done — four of five shipped defects were browser-visible and pipeline-invisible   |
| 5   | An operation fails, the failure is logged, and the caller is told it succeeded                                        | High   | Medium     | module 3 M3L5 (OWASP A10); `prd.md` § Deleting your account — a refusal must be distinguishable from a success |
| 6   | A migration proven against the empty test project meets real rows for the first time on production                    | High   | Medium     | interview Q2; `AGENTS.md` § Commands — migration histories are compared, schemas are not                       |
| 7   | The Worker deploys green, serves 200s, and nobody can sign in because runtime secrets are absent                      | High   | Medium     | `infrastructure.md` § Risk register (H×H row; mitigation proposed 2026-08-08, never built)                     |

Risk #2 is the mandatory abuse row. The other three abuse classes were checked and are not top-N:
untrusted input is validated by a shared zod schema at every endpoint and covered by seven suites;
secret leakage is bounded by server-only env access; resource abuse is throttled by the auth
provider, outside this repository.

### Risk Response Guidance

| Risk | What would prove protection                                                                                               | Must challenge                                                                                                                                                                 | Context `/10x-research` must ground                                                                                                                                                                                             | Likely cheapest layer                | Anti-pattern to avoid                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| #1   | A screen shows a week bounded by the days of the profile's stored zone, not by UTC, including for a zone the form accepts | "The unit tests pin both DST transitions" — they pin a pure function, not what a screen does with a settable zone                                                              | Where the stored zone is read, what happens to an unknown one, whether form and validator share a list                                                                                                                          | integration + render                 | A guard left inert by the runner's ambient zone; asserting a figure without asserting which days made it |
| #2   | After a real sign-in as B, a request naming A's identifier returns no data, and A's row reads back untouched as A         | "Fifteen integration suites already prove this" — they prove it at the client-library layer, not through a cookie; none of them touches `@supabase/ssr` or `src/middleware.ts` | The session/cookie shape, which layer answers 404, what persisted state proves the row survived                                                                                                                                 | integration (cookie path in-process) | Asserting the status code only; under RLS a zero-row write reports success                               |
| #3   | Signing out ends access: returning to a protected route requires authenticating again before any data is shown            | "A redirect happened" is not "the session stopped working"                                                                                                                     | Both directions of route protection, where the user is resolved, what a stale cookie does — an INVALID or expired cookie is a third state, distinct from a cleared one, and the danger is it behaving silently like a valid one | integration (cookie path in-process) | Asserting the destination URL without attempting a data read                                             |
| #4   | A person completes the full flow — sign up, create a workout, log a set, see its estimate — in a real browser             | "The HTML rendered" is not "it can be used"                                                                                                                                    | Which controls are islands, what hydration they need, the accessible name of each control; the estimate renders as a number only for 1–12 repetitions at positive load, so the flow must land inside that boundary              | e2e                                  | Asserting an element is present instead of asserting the effect of interacting with it                   |
| #5   | A failed operation answers non-2xx and the persisted state confirms nothing was written                                   | **That every caught error is a defect** — three swallows in this project are deliberate and carry written rules                                                                | Which catch sites decorate a committed write, and which one _is_ the guarantee being offered                                                                                                                                    | integration + regression             | Reversing a deliberate swallow; asserting on log output instead of on the response and the stored row    |
| #6   | The two projects' schemas are compared, not their migration histories                                                     | "`db:status` is green" — that compares which migrations were applied, not what they produced                                                                                   | What the status wrapper actually reads, and where the committed types are generated from                                                                                                                                        | script + CI gate                     | An e2e test where a schema comparison would answer it                                                    |
| #7   | The deployed URL can authenticate an account, checked after the deploy                                                    | "The build passed and the deploy was green"                                                                                                                                    | What a missing runtime secret does to the request path, and what a visitor sees                                                                                                                                                 | post-deploy smoke                    | Wiring this into the per-commit gate, where there is nothing deployed to check                           |

**Named gap, carried deliberately:** risk #4 has two halves and only one of them has a layer. "The
island never hydrates" is answerable in a browser; **"the control is unusable at a phone width" is
not assigned to anything**, in Phase 2 or anywhere else. Stated here rather than left implied, so a
green gate is not read as covering it.

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status
moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on
disk.

| #   | Phase name           | Goal (one line)                                                                  | Risks covered | Test types               | Status        | Change folder                            |
| --- | -------------------- | -------------------------------------------------------------------------------- | ------------- | ------------------------ | ------------- | ---------------------------------------- |
| 1   | Edit-time gates      | Lock the floor: lint and typecheck fire at edit time, not at commit time         | cross-cutting | gates                    | complete      | — (no change folder — see §6.6)          |
| 2   | Browser layer        | Prove the boundary and the flow through a real session, against the test project | #2, #3, #4    | integration + e2e        | complete      | `context/changes/testing-browser-layer/` |
| 3   | Silent-failure audit | A failure that is caught must still be told to the caller                        | #5            | integration + regression | not started   | —                                        |
| 4   | Week-boundary seam   | The week the screen shows is bounded by the zone the profile holds               | #1            | integration + render     | not started   | —                                        |
| 5   | Environment parity   | Prove the two projects agree, and that a deploy can still sign somebody in       | #6, #7        | script + CI + smoke      | not started   | —                                        |

Phases 1–3 are course deliverables (module 3, items 3, 4 and 5) and come first for that reason.
Phase 4 covers the highest-scoring risk on the map and is deliberately **not** first: it is cheap,
it is well defended already at the pure-function layer, and it blocks nothing. Phase 5 is
post-badge.

**Phase 2 opened with a sub-phase that is not a test, and it has been answered** (research, 2026-08-16
— `context/changes/testing-browser-layer/research.md`). Nothing in this repository pointed a running
HTTP server at `gymlog-test`, and the reason is now mechanical rather than folklore: `@astrojs/cloudflare`
does `Object.assign(process.env, parseEnv(".dev.vars"))` in `astro:config:done`, and Vite's `loadEnv`
applies `process.env` **last**, so `.dev.vars` beats a shell variable, `.env` and `.env.<mode>` alike.
**`astro dev` cannot be re-aimed by any per-process mechanism, and no browser test may run against it.**
Two consequences reshaped this phase:

- **The gap behind risks #2 and #3 is not the browser.** It is everything between an inbound request
  and `locals.user` — `src/middleware.ts` and `src/lib/supabase.ts` — which executes **zero times** in
  the whole gate today. A fourth Vitest project driving that path with a real `gymlog-test` cookie
  closes it structurally (the integration config's subtractive strip, plus `vite.envDir` pointed at a
  credential-free directory), with no HTTP server and no browser. Hence the layer change in §2.
- **`npm run build` copies the production credentials into `dist/server/.dev.vars`** (emitted by
  `@cloudflare/vite-plugin`; gitignored, so local-only). The built worker itself reads its credentials
  from the workerd env **at request time** rather than having them inlined, which is what makes a
  browser against the _built_ worker aimable — but only if that file is deleted after every build and
  its absence asserted immediately before launch. That is the sole path to risk #4, and it is gated on
  its measurements rather than assumed.

## 4. Stack

| Layer         | Tool                         | Version          | Notes                                                                         |
| ------------- | ---------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| unit          | Vitest                       | ^4.1.10          | `src/**` glob; hermetic; `TZ` pinned to `America/New_York`, load-bearing      |
| integration   | Vitest (separate config)     | ^4.1.10          | `tests/integration/**`; real network to `gymlog-test`; env allowlist enforced |
| render        | Vitest (separate config)     | ^4.1.10          | `tests/render/**`; Astro container; `configFile: false` is mandatory          |
| middleware    | Vitest (separate config)     | ^4.1.10          | `tests/middleware/**`; real cookies; subtractive strip **plus** `vite.envDir` |
| e2e           | `@playwright/test`           | 1.62.1           | `tests/e2e/**`; **Chromium only**; the BUILT worker, never `astro dev`. installed 2026-08-20 |
| API mocking   | none — not needed            | —                | No third-party HTTP boundary in the product                                   |
| accessibility | none yet                     | —                | Role-based locators in Phase 2 give partial coverage as a side effect         |
| lint / format | ESLint / Prettier            | ^9.29.0 / ^3.8.3 | Type-checked rules; pre-commit via husky + lint-staged                        |
| typecheck     | `astro check`                | astro ^6.3.1     | Covers `.astro` and `.ts` alike; `tsc --noEmit` would not                     |
| runtime       | Cloudflare Workers / workerd | wrangler ^4.90.0 | 10 ms CPU cap on the free plan constrains what may run in a request           |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or vendor docs MCP is exposed; stack facts are grounded in local
  manifests and configs. checked: 2026-08-16
- Search: built-in web search and fetch are available but were not used; no search MCP.
  checked: 2026-08-16
- Runtime/browser: none — no Playwright or browser MCP is exposed. Phase 2 therefore plans on the
  Playwright CLI and the test runner, not on a browser MCP. checked: 2026-08-16
- Provider/platform: none — no GitHub, Cloudflare or Supabase MCP. Equivalent capability exists as
  CLI only (`gh`, `npx wrangler`, the repository's own database script). checked: 2026-08-16

## 5. Quality Gates

| Gate                           | Where                  | Required?                 | Catches                                                    |
| ------------------------------ | ---------------------- | ------------------------- | ---------------------------------------------------------- |
| lint + typecheck               | local + CI             | required                  | syntactic and type drift                                   |
| unit                           | local + CI             | required                  | domain-calculation regressions                             |
| render check                   | local + CI             | required                  | what a page's HTML actually contains                       |
| integration                    | local + CI             | required                  | access-control and persisted-state regressions             |
| build                          | local + CI             | required                  | adapter and bundling failures                              |
| pre-commit (staged files)      | local                  | required                  | lint and format drift before a commit lands                |
| edit-time lint + typecheck     | local (agent loop)     | required after §3 Phase 1 | regressions at the moment they are written                 |
| middleware / cookie check      | local + CI             | required                  | a request bound to the wrong identity; the three cookie states |
| e2e on the critical flow       | local + CI on PR       | required                  | broken sign-in, routing, hydration, cross-account boundary |
| schema parity between projects | CI or manual, pre-push | required after §3 Phase 5 | two databases believed identical that are not              |
| post-deploy smoke              | after deploy           | required after §3 Phase 5 | a green deploy that cannot authenticate anybody            |

Any new job that writes to `gymlog-test` joins the existing CI concurrency group, or it reintroduces
the race that group exists to prevent. **The middleware and e2e steps join it by living in the
workflow that declares it** — they are steps of the existing `ci` job, not a new workflow, and a new
workflow would **not** inherit the group.

## 6. Cookbook Patterns

How to add new tests in this project. A sub-section marked TBD is filled in by the rollout phase
named against it.

### 6.1 Adding a unit test

- **Location**: beside the code, `src/**/*.test.ts`.
- **Import** the subject through the `@/` alias; import `describe` / `it` / `expect` from `vitest`
  — globals are off on purpose.
- **Constraint**: the subject must not import an `astro:*` virtual module. The harness cannot
  resolve them, and that is what keeps the domain calculations dependency-free.
- **Reference test**: `src/lib/services/calendar.test.ts` for boundary-heavy pure logic;
  `src/lib/services/accounts.test.ts` for error-code mapping.
- **Run locally**: `npm test`.

### 6.2 Adding an integration test

- **Location**: `tests/integration/`.
- **Target**: `gymlog-test` only, with that project's publishable key. Never a `service_role` key —
  a check that bypasses RLS proves nothing.
- **Fixture discipline**: pick a MARK that is neither a prefix of nor prefixed by an existing one;
  reset fixture rows in `beforeAll`, write run-unique values, restore in a `finally`; never mutate
  the column your own cleanup keys on. A suite filtering by date range cannot rely on a name prefix
  at all and must own its own window in a year no other suite writes to.
- **Never touch** `rls-owner-a@` / `rls-owner-b@` or any `s09i-` address: they are permanent shared
  fixtures, and damage surfaces as a different suite failing on a later run.
- **Every negative assertion pairs with a read back as the row's owner.** The failure worth catching
  is a caller told "nothing happened" while the write landed.
- **Reference test**: `tests/integration/workout-mutations-rls.test.ts`.
- **Run locally**: `npm run test:integration`.

### 6.3 Adding an e2e test

- **Location**: `tests/e2e/`, under `playwright.config.ts`. Chromium only.
- **The harness is the BUILT worker under `wrangler dev`, never `astro dev`.** Dev **inlines**
  whatever `.dev.vars` names — production — into `astro:env/server` and cannot be re-aimed by any
  per-process mechanism (`@astrojs/cloudflare/dist/index.js:292-303` +
  `vite/dist/node/chunks/…/config.js:9417-9418`). The build defers to the workerd env at request
  time instead, and that is the only aimable path.
- **`scripts/e2e-serve.mjs` is the only way the server starts.** It strips the environment, requires
  the three test credentials, requires `dist/server/wrangler.json` to exist, asserts
  `dist/server/.dev.vars` is **absent**, seeds the test pair and checks the seed, then spawns
  wrangler. The absence-assert runs **immediately before every launch**, because an ordinary
  `npm run build` re-creates that file. `scripts/e2e-build.mjs` is what deletes it — **the delete and
  the assert live in different processes on purpose**, so the refusal can be proven by planting the
  file rather than being an assertion that can never fire.
- **If the launcher is bypassed the credentials are ABSENT, not production's.** Every protected route
  redirects and the suite goes red on its first step. That is the whole safety argument, and it was
  measured by withholding the two `CLOUDFLARE_*` gates and watching every request answer
  `?error=not_configured`.
- **One per-run account, mark `t2e-`**, named in `playwright.config.ts` and removed in
  `globalTeardown` through `delete_own_account()`, with the removal **proven from outside** by
  re-attempting sign-in. Never a shared fixture; never `rls-owner-*` or an `s09i-` address. The RPC
  cannot rescue an interrupted run, so the mark is the recovery path.
- **Locators**: `getByRole` / `getByLabel` / `getByText` only. Never CSS, never XPath, never
  `page.waitForTimeout()` — wait on state.
  - Two traps in this product: **both password visibility toggles carry the identical
    `aria-label="Show password"`** (`PasswordToggle.tsx:14`), so scope or `.first()`; and the set
    fields' labels **repeat per entry** (ids are `reps-<entryId>`), so scope with
    `getByRole("listitem").filter({ hasText: … })` once a second exercise is on screen.
  - **Success is a NAVIGATION, not a message** on `/workouts` (`NewWorkoutForm.tsx:52` assigns
    `window.location.href`) — wait on the URL, not for a confirmation that never appears.
- **A `fill()` that lands before the island hydrates is SILENTLY LOST.** Every input here is a
  controlled React input inside a `client:load` island: the DOM takes the text, React's state does
  not, and hydration restores the empty value. Measured at **one run in three**. Retry the fill until
  the island's own state reflects it (`expect(async () => {…}).toPass()` — waiting on state, not
  sleeping).
- **Assert the EFFECT of an interaction, never the presence of an element**, and **give every
  absence-assertion a positive control**. "The note is gone after signing out" is satisfied perfectly
  by a note that was never saved; without a control proving it was on screen first, the strongest
  assertion in a spec passes for the wrong reason and reports green.
- **The estimate is a number only for 1–12 reps at positive load**, so a flow must land inside that
  range for the assertion to mean anything: 5 reps at 100 kg is `100 × 36 / (37 − 5)` = **112.5**
  under the default Brzycki. Outside it the slot holds a sentence instead.
- **Reference test**: `tests/e2e/critical-flow.spec.ts`; `tests/e2e/smoke.spec.ts` for the harness.
- **Run locally**: `npm run test:e2e`. To watch it: `E2E_SLOWMO=500 npm run test:e2e -- --headed`.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration, driving the exported handler directly with a real session. Do not
  drive it over HTTP against the dev server — that server's credentials point at production and
  cannot be displaced (`@astrojs/cloudflare/dist/index.js:292-303` assigns `.dev.vars` into
  `process.env` at `astro:config:done`; `vite/dist/node/chunks/…/config.js:9417-9418` applies
  `process.env` **last**, so it beats `.env`, `.env.<mode>` and a shell variable alike). Recorded here
  so the next reader does not re-derive it.
- **Assert on both** the response and the persisted row, read back as an entitled caller.
- **Reference test**: `tests/integration/workout-endpoints.test.ts`.
- **When to add e2e instead**: only when the failure needs the full deployed shape — cookie,
  middleware and handler crossing together.

### 6.5 Adding a render check

- **Location**: `tests/render/`, under the separate config.
- **What it can see**: the HTML a real page produces through Astro's container, with fake `locals`
  and no session, which is what makes it usable on protected routes.
- **What it cannot see**: hydration, middleware, cookies, CSS, viewport. A form that renders
  perfectly and does nothing passes every check here. That gap is §3 Phase 2's subject.
- **Do not assert anything runtime-specific here** — the config deliberately omits the Cloudflare
  adapter, so workerd-specific behaviour must be measured in workerd instead.
- **Reference test**: `tests/render/dashboard-tonnage.test.ts`.
- **Run locally**: `npm run test:render`.

### 6.7 Adding a middleware / cookie test

- **Location**: `tests/middleware/`, under `vitest.middleware.config.ts`.
- **What this project can see that no other can**: what identity a **real cookie** produces.
  Everything between an inbound HTTP request and `locals.user` — `src/middleware.ts`,
  `src/lib/supabase.ts` — executes **zero times** in the rest of the gate, because every integration
  suite hands a handler a hand-built `locals` whose client and user id agree by construction. A
  middleware binding the *wrong* identity to a request is invisible to all of them.
- **The credential guarantee has two parts and NEITHER is sufficient alone.**
  1. The **subtractive strip** removes production from `process.env` after `loadEnvFile` deliberately
     pulled it in. Anything that merely *supplies* the right value wins a precedence contest and
     loses silently the day a flag is forgotten.
  2. **`vite.envDir`** pointed at the committed, credential-free `tests/middleware/no-env/`. This
     project loads Astro's Vite pipeline, and `loadEnv` reads `.env*` **from the env directory** as
     well — so stripping the process alone leaves the repository root's `.env`, which names
     production, readable from disk. A load-time `readdirSync` guard throws if anything `.env*`
     appears there, and `.gitignore` is the second defence.
  - Measured: with the strip applied and the directory empty, the reported value is **`undefined`** —
    being wrong yields an **absent** credential, never a production one.
- **Three cookie states — valid, cleared, and invalid/forged — and the third is the dangerous one**,
  because a forgery can behave silently like a valid cookie. **Every forged cookie needs a positive
  control in the same test**: the identical reassemble/re-encode path with the original claims must
  still authenticate. Without it, a tamper that silently missed and a tamper that was correctly
  refused are the same observation.
- **What is real and what is doubled** is named in `tests/middleware/_shared/context.ts`: real are
  the `Cookie` header parse, `createServerClient`, the `auth.getUser()` round trip, the `locals`
  derivation and the two route arrays; doubled are `AstroCookies` and `redirect`, because Astro's
  package exports do not expose them.
- **Mark `t2c-`, per-run accounts, and NO `LIKE` sweeps anywhere in this project** — accounts are
  removed through `delete_own_account()` on the client that owns them.
- **A signed-out caller is refused at the GRANT layer, not filtered by RLS** (`42501`, `permission
  denied for table workouts`). Both outcomes are "no data" and they are different guarantees; pin the
  SQLSTATE so a widened grant does not slip past as a filtered zero.
- **Reference tests**: `tests/middleware/cookie-identity.test.ts`,
  `tests/middleware/session-lifecycle.test.ts`.
- **Run locally**: `npm run test:middleware`.

### 6.6 Per-rollout-phase notes

**Phase 1 — Edit-time gates (complete, 2026-08-16).** Shipped directly rather than through a change
folder: the work was one settings key plus a measurement, and four skills around it would have cost
more than the change. Two findings outlive it. **The course example's hook budgets are wrong for this
repository by two to four times** — linting one file costs more than type-checking all of it, because
the ESLint config is type-aware — so lint runs per-edit but asynchronously, and type-check moved to
the end of the turn. **And the first version of the hook never ran at all**, silently, because `jq`
emits CRLF here and the extension match never fired; a clean-file probe could not tell that apart
from success. Both recorded in `lessons.md`. Prove any future hook by breaking something.

**Phase 2 — Browser layer (complete, 2026-08-20).** Two things outlived it, and both were wrong in
the plan before they were measured. **The real gap behind risks #2 and #3 was never the browser** — it
was the cookie, and closing it needed a fourth _Vitest_ project rather than a browser at all; that
half shipped first and stands whether or not the browser half ever had. **And the build output ships
production's credentials to disk** (`dist/server/.dev.vars`, 118 bytes), which is what made a browser
against the _built_ worker aimable in the first place, and is a hazard nothing in this repository had
recorded. A third finding is the one most likely to bite the next author: **a `fill()` before an
island hydrates is silently lost, one run in three**, and what it threatens is not the flake but any
assertion that proves something by ABSENCE — see §6.3.

**What did NOT get covered, and is implied to be covered nowhere**: the phone-width half of risk #4.
"The control is unusable at a phone width" still has no assigned layer, in this phase or any other.
It stays a named gap in §2.

## 7. What We Deliberately Don't Test

- **Screens in the state the owner already occupies daily** — one account, their own data, their
  own window width, their own timezone. Test budget goes to the states they never occupy: a second
  account, a fresh signup, a phone width, an empty week. Re-evaluate if the product gains users
  other than the owner. (Source: interview Q5, refined against Q4.)
- **The seeded exercise catalogue as data** — 38 rows, unwritable by anyone, changed by migration
  only. Re-evaluate if catalogue editing ships.
- **Performance budgets** — the PRD's save-acknowledgement and page-load targets have no automated
  check and will not get one at this scale. Re-evaluate if the log grows past a season of training.
- **Snapshot tests of anything** — they break constantly and catch little; the render checks assert
  named properties instead.
- **That the provider's client library works** — the boundary under test is our policy, not their
  SDK.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-16
- Stack versions last verified: 2026-08-16
- AI-native tool references last verified: 2026-08-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
