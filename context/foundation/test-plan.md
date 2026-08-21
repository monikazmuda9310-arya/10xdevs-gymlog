# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-20

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

| #   | Risk (failure scenario)                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The week's figures are computed from the wrong days after a timezone change; the number looks correct and is believed | High   | High       | interview Q3; hot-spot `src/lib/services/` — 53 changes/30d                                                                                                                                         |
| 2   | Account B reaches account A's training by naming an identifier directly (**abuse scenario**)                          | High   | Medium     | `prd.md` § Guardrails; `prd.md` US-04 AC1; `infrastructure.md` § Risk register (M×H row asks for exactly this)                                                                                      |
| 3   | A signed-out visitor returns and is shown training data, or a signed-in visitor is bounced between routes             | High   | Medium     | `prd.md` US-04 AC3; interview Q4; hot-spot `src/` — 16 changes/30d at root of the source tree                                                                                                       |
| 4   | A screen renders correctly and does nothing — the island never hydrates, or the control is unusable at a phone width  | High   | Medium     | interview Q4; `roadmap.md` § Done — four of five shipped defects were browser-visible and pipeline-invisible                                                                                        |
| 5   | An operation fails, the failure is logged, and the caller is told it succeeded                                        | High   | Medium     | module 3 M3L5 (OWASP A10); `prd.md` § Deleting your account — a refusal must be distinguishable from a success. **Not hot-spot-led (corrected 2026-08-20)** — see the note under the guidance table |
| 6   | A migration proven against the empty test project meets real rows for the first time on production                    | High   | Medium     | interview Q2; `AGENTS.md` § Commands — migration histories are compared, schemas are not                                                                                                            |
| 7   | The Worker deploys green, serves 200s, and nobody can sign in because runtime secrets are absent                      | High   | Medium     | `infrastructure.md` § Risk register (H×H row; mitigation proposed 2026-08-08, never built)                                                                                                          |

Risk #2 is the mandatory abuse row. The other three abuse classes were checked and are not top-N:
untrusted input is validated by a shared zod schema at every endpoint and covered by seven suites;
secret leakage is bounded by server-only env access; resource abuse is throttled by the auth
provider, outside this repository.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                            | Must challenge                                                                                                                                                                                                                  | Context `/10x-research` must ground                                                                                                                                                                                             | Likely cheapest layer                | Anti-pattern to avoid                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #1   | A screen shows a week bounded by the days of the profile's stored zone, not by UTC, including for a zone the form accepts                                                                                                              | "The unit tests pin both DST transitions" — they pin a pure function, not what a screen does with a settable zone                                                                                                               | Where the stored zone is read, what happens to an unknown one, whether form and validator share a list                                                                                                                          | integration + render                 | A guard left inert by the runner's ambient zone; asserting a figure without asserting which days made it                                   |
| #2   | After a real sign-in as B, a request naming A's identifier returns no data, and A's row reads back untouched as A                                                                                                                      | "Fifteen integration suites already prove this" — they prove it at the client-library layer, not through a cookie; none of them touches `@supabase/ssr` or `src/middleware.ts`                                                  | The session/cookie shape, which layer answers 404, what persisted state proves the row survived                                                                                                                                 | integration (cookie path in-process) | Asserting the status code only; under RLS a zero-row write reports success                                                                 |
| #3   | Signing out ends access: returning to a protected route requires authenticating again before any data is shown                                                                                                                         | "A redirect happened" is not "the session stopped working"                                                                                                                                                                      | Both directions of route protection, where the user is resolved, what a stale cookie does — an INVALID or expired cookie is a third state, distinct from a cleared one, and the danger is it behaving silently like a valid one | integration (cookie path in-process) | Asserting the destination URL without attempting a data read                                                                               |
| #4   | A person completes the full flow — sign up, create a workout, log a set, see its estimate — in a real browser                                                                                                                          | "The HTML rendered" is not "it can be used"                                                                                                                                                                                     | Which controls are islands, what hydration they need, the accessible name of each control; the estimate renders as a number only for 1–12 repetitions at positive load, so the flow must land inside that boundary              | e2e                                  | Asserting an element is present instead of asserting the effect of interacting with it                                                     |
| #5   | A failed operation is DISTINGUISHABLE from a successful one to the caller — a code for a JSON endpoint, a **destination** for a redirect-shaped one — and the persisted state (a row **or a session**) confirms it did not take effect | **That every caught error is a defect** — several swallows here are deliberate and carry written rules; and **that a non-2xx status proves anything on a redirect-shaped endpoint**, where success and failure share one status | Which catch sites decorate a committed write, which one _is_ the guarantee being offered, and which operation reports success with no body at all                                                                               | middleware + integration + render    | Reversing a deliberate swallow; asserting on log output instead of on the response and the stored row; reading a `302` as proof of refusal |
| #6   | The two projects' schemas are compared, not their migration histories                                                                                                                                                                  | "`db:status` is green" — that compares which migrations were applied, not what they produced                                                                                                                                    | What the status wrapper actually reads, and where the committed types are generated from                                                                                                                                        | script + CI gate                     | An e2e test where a schema comparison would answer it                                                                                      |
| #7   | The deployed URL can authenticate an account, checked after the deploy                                                                                                                                                                 | "The build passed and the deploy was green"                                                                                                                                                                                     | What a missing runtime secret does to the request path, and what a visitor sees                                                                                                                                                 | post-deploy smoke                    | Wiring this into the per-commit gate, where there is nothing deployed to check                                                             |

**Risk #5's guidance was rewritten on 2026-08-20 by Phase 3's research, and the three corrections are
worth keeping visible.** The original criterion — "answers non-2xx and the persisted state confirms
nothing was written" — would have scored the one real defect as **passing**: the operation it lives on
answers `302` whether it worked or not, and writes no row at all, so neither clause has a subject
there. **"Three swallows are deliberate" was an undercount**; the category is what matters, not the
number (`lessons.md` § "The conversion constant has been miscounted twice"). And the **hot-spot
citation was misleading for this risk**: churn in the window concentrates on the code whose failure
branches were built and tested in that same window, while the file holding the defect had no commits
in it at all. The evidence that raised the risk was real; it did not point where the failure lived,
which is §1 principle #3 behaving exactly as designed.

**Named gap, carried deliberately:** risk #4 has two halves and only one of them has a layer. "The
island never hydrates" is answerable in a browser; **"the control is unusable at a phone width" is
not assigned to anything**, in Phase 2 or anywhere else. Stated here rather than left implied, so a
green gate is not read as covering it.

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status
moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on
disk.

| #   | Phase name           | Goal (one line)                                                                  | Risks covered | Test types               | Status      | Change folder                   |
| --- | -------------------- | -------------------------------------------------------------------------------- | ------------- | ------------------------ | ----------- | ------------------------------- |
| 1   | Edit-time gates      | Lock the floor: lint and typecheck fire at edit time, not at commit time         | cross-cutting | gates                    | complete    | — (no change folder — see §6.6) |
| 2   | Browser layer        | Prove the boundary and the flow through a real session, against the test project | #2, #3, #4    | integration + e2e        | complete    | `testing-browser-layer`         |
| 3   | Silent-failure audit | A failure that is caught must still be told to the caller                        | #5            | integration + regression | complete    | `testing-silent-failure-audit`  |
| 4   | Week-boundary seam   | The week the screen shows is bounded by the zone the profile holds               | #1            | integration + render     | complete    | `testing-week-boundary-seam`    |
| 5   | Environment parity   | Prove the two projects agree, and that a deploy can still sign somebody in       | #6, #7        | script + CI + smoke      | not started | —                               |

Phases 1–3 are course deliverables (module 3, items 3, 4 and 5) and come first for that reason.
Phase 4 covers the highest-scoring risk on the map and is deliberately **not** first: it is cheap,
it is well defended already at the pure-function layer, and it blocks nothing. Phase 5 is
post-badge.

**Phase 2 opened with a sub-phase that is not a test, and it has been answered** (research, 2026-08-16
— the **`testing-browser-layer`** change folder's `research.md`). Nothing in this repository pointed a running
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

| Layer         | Tool                         | Version          | Notes                                                                                        |
| ------------- | ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| unit          | Vitest                       | ^4.1.10          | `src/**` glob; hermetic; `TZ` pinned to `America/New_York`, load-bearing                     |
| integration   | Vitest (separate config)     | ^4.1.10          | `tests/integration/**`; real network to `gymlog-test`; env allowlist enforced                |
| render        | Vitest (separate config)     | ^4.1.10          | `tests/render/**`; Astro container; `configFile: false` is mandatory                         |
| middleware    | Vitest (separate config)     | ^4.1.10          | `tests/middleware/**`; real cookies; subtractive strip **plus** `vite.envDir`                |
| e2e           | `@playwright/test`           | 1.62.1           | `tests/e2e/**`; **Chromium only**; the BUILT worker, never `astro dev`. installed 2026-08-20 |
| API mocking   | none — not needed            | —                | No third-party HTTP boundary in the product                                                  |
| accessibility | none yet                     | —                | Role-based locators in Phase 2 give partial coverage as a side effect                        |
| lint / format | ESLint / Prettier            | ^9.29.0 / ^3.8.3 | Type-checked rules; pre-commit via husky + lint-staged                                       |
| typecheck     | `astro check`                | astro ^6.3.1     | Covers `.astro` and `.ts` alike; `tsc --noEmit` would not                                    |
| runtime       | Cloudflare Workers / workerd | wrangler ^4.90.0 | 10 ms CPU cap on the free plan constrains what may run in a request                          |

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

| Gate                           | Where                  | Required?                 | Catches                                                        |
| ------------------------------ | ---------------------- | ------------------------- | -------------------------------------------------------------- |
| lint + typecheck               | local + CI             | required                  | syntactic and type drift                                       |
| unit                           | local + CI             | required                  | domain-calculation regressions                                 |
| render check                   | local + CI             | required                  | what a page's HTML actually contains                           |
| integration                    | local + CI             | required                  | access-control and persisted-state regressions                 |
| build                          | local + CI             | required                  | adapter and bundling failures                                  |
| pre-commit (staged files)      | local                  | required                  | lint and format drift before a commit lands                    |
| edit-time lint + typecheck     | local (agent loop)     | required after §3 Phase 1 | regressions at the moment they are written                     |
| middleware / cookie check      | local + CI             | required                  | a request bound to the wrong identity; the three cookie states |
| e2e on the critical flow       | local + CI on PR       | required                  | broken sign-in, routing, hydration, cross-account boundary     |
| schema parity between projects | CI or manual, pre-push | required after §3 Phase 5 | two databases believed identical that are not                  |
| post-deploy smoke              | after deploy           | required after §3 Phase 5 | a green deploy that cannot authenticate anybody                |

Any new job that writes to `gymlog-test` joins the existing CI concurrency group, or it reintroduces
the race that group exists to prevent. **The middleware and e2e steps join it by living in the
workflow that declares it** — they are steps of the existing `ci` job, not a new workflow, and a new
workflow would **not** inherit the group.

**"Required" became enforced on 2026-08-20, and until then it was not.** Every gate above said
"required" while nothing stopped a red PR from being merged — discovered by merging one with its
check still running, which `gh pr merge --auto` permitted because the repository had no required
status checks configured. `main` now carries branch protection requiring the **`ci`** check, with
**`enforce_admins: true`**, which is the load-bearing half: this is a single-maintainer repository,
so protection that exempts admins exempts everyone and is theatre. Proven by breaking it — a direct
push to `main` is refused with `GH006 … Required status check "ci" is expected`.

- **It lives in repository settings, not in this repository, so nothing in the gate can see it** —
  the same class as `site_url` (`AGENTS.md` § Environment). Re-checkable with
  `gh api repos/<owner>/<repo>/branches/main/protection`.
- **The context string must match the job name exactly.** A typo produces an identical-looking
  success — protection on, pushes refused — and a permanently unmergeable `main`, because GitHub
  waits for a status nothing emits. The next PR that merges green is what proves the name.
- Emergency path: `gh api --method DELETE …/branches/main/protection`, merge, then re-apply.

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
- **To break ONE read without mocking the client, wrap it**: `new Proxy(client, { get })`
  intercepting `from` and throwing for **named tables only**. **The asymmetry is the design, not a
  shortcut.** On the impact routes, `impactOf` reads `personal_records` and `set_estimates` while
  `getWorkout` / `getEntry` read `workouts` and `exercise_entries` — break everything and the route
  answers `404` before it ever reaches the ranking, so a `503` assertion passes against a completely
  different branch. A real database hiccup is partial; the fixture has to be too.
  - **The `auth`-only variant** doubles `auth.signOut` and leaves `rpc` alone, which
    `DELETE /api/account` needs: a Proxy that intercepted everything would leave the account alive
    while the route reported success — the exact confusion the assertion exists to rule out.
  - **A route that ALWAYS fails satisfies a failure assertion perfectly.** Measured 2026-08-20:
    with both impact routes mutated to throw unconditionally, the two "answers `impact_unavailable`"
    assertions stayed green and only the positive controls went red. Pair every failure assertion
    with one proving the route can still answer.
- **Reference tests**: `tests/integration/workout-mutations-rls.test.ts`;
  `tests/integration/silent-failure.test.ts` for the Proxy shapes and for pinning a swallow.
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
  - **Not every "state" check is one.** Verify through something only the FRAMEWORK could have
    produced — a client-side filter having narrowed a list, a row having appeared — rather than
    through the DOM value of the field you just filled: the DOM is exactly what lies in this failure,
    so `toHaveValue` can report success while React's state is still empty.
- **Assert the EFFECT of an interaction, never the presence of an element**, and **give every
  absence-assertion a positive control**. "The note is gone after signing out" is satisfied perfectly
  by a note that was never saved; without a control proving it was on screen first, the strongest
  assertion in a spec passes for the wrong reason and reports green.
- **The estimate is a number only for 1–12 reps at positive load**, so a flow must land inside that
  range for the assertion to mean anything: 5 reps at 100 kg is `100 × 36 / (37 − 5)` = **112.5**
  under the default Brzycki. Outside it the slot holds a sentence instead.
- **A known failure mode that is NEITHER the product nor the spec: `wrangler dev` can die mid-run.**
  Seen once, on the push run for `7fbfb0d` (2026-08-20, GitHub Actions run `32411019182`). Read the
  log before diagnosing anything else, because the symptom points at the wrong place:

  ```
  19:58:01.466  GET /auth/signin 200 OK           ← critical-flow's last step
  19:58:01.605  ✘ [ERROR]                         ← wrangler's crash handler, EMPTY message
  19:58:01.605  If you think this is a bug then please create an issue at workers-sdk
  19:58:01.616  GET /workouts/61a3ac5d… 302 Found ← still serving, 11 ms AFTER the error
  19:58:01.660  🪵 Logs were written to …         ← wrangler exits
  19:58:01.709  ✓ critical-flow (9.3s)
  19:58:01.926  ✘ smoke — ERR_CONNECTION_REFUSED
  ```

  **The spec that fails is not the spec that provoked it.** `critical-flow` — signup, a logged set,
  an estimate, sign-out — passed in full; `smoke`, a single `page.goto`, met a dead port 260 ms
  later. So the red test is the trivial one and the accusation lands on the harness's own smoke
  check, which is the last thing at fault. **`ERR_CONNECTION_REFUSED` from any spec means the server
  is gone: grep the `[WebServer]` lines for `✘ [ERROR]` before reading a single line of product
  code.**
  - **The trigger is unknown and is not recorded as known.** Wrangler's message was **empty**; a
    telemetry notice printed 80 ms earlier is suggestive and unproven, and writing it down as the
    cause would be inventing one. What IS established: the process crashed, it was not the specs, and
    it has not recurred — the same two specs went green twice the following day.
  - **`wrangler` is `^4.90.0` in `package.json` while `npm ci` installs whatever the lockfile pins**,
    and wrangler's own crash output suggested 4.125.0. A lead for whoever meets this next, not a fix:
    nobody has checked whether the newer version changes anything.
  - **`retries: 0` is deliberate and it settles two different questions with one rule.**
    `playwright.config.ts:70` argues it for the FLOW — "a flow that only passes on the second attempt
    is a finding, not a flake to absorb" — which is right. A crashed harness server is not the flow
    behaving inconsistently, and the gate cannot currently tell the two apart. Do not "fix" this by
    turning retries on: that would absorb the product flakiness the rule exists to surface. If it
    recurs, the shape worth building is one that distinguishes a dead port from a failed assertion.

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
- **"It answers non-2xx" is NOT the criterion.** Two different failures must stay two different
  answers: `404 workout_not_found` and `503 impact_unavailable` are both non-2xx and are different
  facts about the system, so a catch widened to swallow the not-found branch passes a non-2xx test
  while the route has lost the ability to say anything specific. And for a **redirect-shaped**
  endpoint, success and failure share one status entirely — the signal is the **destination** and
  its `?error=` code. See §2's Risk #5 row, rewritten 2026-08-20 for exactly this reason.
- **A caught error is not automatically a defect.** After a write has already committed, an error
  invites a retry that duplicates it — so `/api/sets` keeps its `201` when the record verdict fails,
  and `/api/account` keeps its `{ deleted: true }` when the post-deletion sign-out fails. The rule
  is: log it and carry on **exactly when the caller's next action cannot be improved by knowing.**
  Both are pinned in `tests/integration/silent-failure.test.ts`; do not "fix" either into a 500.
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
- **The stub dispatches on table name and THROWS on an unstubbed one.** That throw is a tripwire,
  not defensiveness: without it a new read gets a chain whose `.eq()` returns a non-thenable, `await`
  hands it straight back, `error` is `undefined`, and the page sails on — leaving the suite green
  against a read that never happened. It has now fired twice on purpose: S-08's breakdown read, and
  a fifth read planted in `exercises.astro` on 2026-08-20 (`unstubbed table: sets`). **Write each
  table's chain out separately** rather than sharing one permissive shape, so the mirror stays exact.
- **Use `renderToResponse` when the outcome includes a STATUS**, `renderToString` otherwise.
  `workouts/[id].astro` is the case: "absent or not yours" is a `404` and a **failed read must not
  be**, because the database being unreachable is not evidence that a workout does not exist. The
  HTML alone cannot tell those two apart. `ContainerRenderOptions.params` supplies the `[id]`.
- **An empty state and a failed state are two different sentences, and both need asserting.** A page
  that renders "you have nothing" for a failed read is the silent failure risk #5 is about, and it
  is invisible to every other layer.
- **Reference tests**: `tests/render/dashboard-tonnage.test.ts`;
  `tests/render/page-load-failures.test.ts` for the four `loadFailed` branches and the status split.
- **Run locally**: `npm run test:render`.

### 6.7 Adding a middleware / cookie test

- **Location**: `tests/middleware/`, under `vitest.middleware.config.ts`.
- **What this project can see that no other can**: what identity a **real cookie** produces.
  Everything between an inbound HTTP request and `locals.user` — `src/middleware.ts`,
  `src/lib/supabase.ts` — executes **zero times** in the rest of the gate, because every integration
  suite hands a handler a hand-built `locals` whose client and user id agree by construction. A
  middleware binding the _wrong_ identity to a request is invisible to all of them.
- **The credential guarantee has two parts and NEITHER is sufficient alone.**
  1. The **subtractive strip** removes production from `process.env` after `loadEnvFile` deliberately
     pulled it in. Anything that merely _supplies_ the right value wins a precedence contest and
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
- **To inject an AUTH failure, substitute one call on the `locals` the harness already built.** The
  route is handed a hand-built `locals`, so wrapping `supabase.auth.signOut` is a one-line change
  with the real route, the real cookie plumbing and the real middleware still under test. Three
  things make it work rather than merely run:
  - **Two failure shapes, not one.** `signOut()` resolves `{ error }` for an ordinary auth failure
    and **re-throws** anything that is not an `AuthError`. A route written as `if (error)` alone
    handles the first and lets the second escape as a generic HTML 500 — which a form POST cannot
    show. Drive both, and give the doubling a `"real"` outcome so the success path and the failure
    paths differ in exactly one argument.
  - **The doubled `AstroCookies` implements `set()` only** (`_shared/context.ts`), and
    `applyCookieWrites` decodes a clear as `value: ""` / `maxAge: 0` — which is how `@supabase/ssr`
    clears one. So production code that clears through `set` needs no harness change, and production
    code that clears through `delete` reddens the harness rather than the product. **The jar
    simulation models no `path`**, so a clear written with the wrong path would satisfy every
    assertion while a real browser kept the cookie: assert the written `options` directly.
  - **Copy the jar (`new Map(...)`), never mutate `session.jar`** — it is shared by four assertions,
    and clearing it in place leaves later ones failing for an unrelated reason.
- **Reference tests**: `tests/middleware/cookie-identity.test.ts`,
  `tests/middleware/session-lifecycle.test.ts` (assertions 6 and 7 for the injected auth failure).
- **Run locally**: `npm run test:middleware`.

### 6.8 Adding a week-boundary or timezone check

- **Location**: `tests/render/` for "does a SCREEN use the stored zone", `tests/integration/` for
  "does a stored zone change which week a real set counts in", `src/**/*.test.ts` for the arithmetic
  itself. The unit layer is already strong — `calendar.test.ts` pins both Warsaw DST transitions, the
  Sunday rollover, month/year/leap boundaries and a 365-instant sweep — so a new week test almost
  never belongs there. **What nothing checked until Phase 4 is that anything CALLS it with the zone
  the account stored.**
- **NEVER derive an expected week from `trainingWeeksFor`.** This is the rule, and it is what made
  three suites inert before anybody noticed. `dashboard-tonnage.test.ts:30`,
  `weekly-tonnage.test.ts:63-74` and `tonnage-breakdown.test.ts:130-134` all compute their fixture
  dates with the function under test, so an off-by-one in `mondayOf` moves the fixture and the
  expectation together and every assertion still passes — including the ones titled after the Sunday
  boundary. **Type the dates out.** Where the right answer is awkward to write by hand, that
  awkwardness is the point; see `lessons.md` § "An expectation derived from the subject is not an
  assertion".
- **On `/dashboard` the window is observable only at the QUERY boundary.** The page renders no dates
  at all: it prints the zone name and two figures, and `week.start` / `week.end` reach the markup and
  are ignored. So the stub records the range instead of discarding it — `gte: (column, value) => …`,
  where `dashboard-tonnage.test.ts:92` takes no parameters and throws the real arguments away.
  Record at the link that RESOLVES the chain (`.lte` for `daily_tonnage`, `.limit` for
  `daily_exercise_tonnage`), so a recorded range proves the whole chain executed.
- **Pin the clock with `vi.setSystemTime`, and fake only `Date`.** Neither page has an injectable
  `now` — `dashboard.astro:43` passes three arguments and `workouts/index.astro:23` passes one — so
  the instant cannot be supplied any other way. It also removes the once-a-week Sunday-midnight flake
  S-07's implementation review named and left open. `vi.useFakeTimers({ toFake: ["Date"] })`: Astro's
  container renderer is async, and a faked `setTimeout` is a hazard unrelated to anything asserted.
- **Choose the instant and the zone TOGETHER, and use two pairs.** The property being tested is
  "currently on a different calendar date", not "far away" — only 9 of 418 zones satisfied it at the
  hour S-06's manual step ran (`lessons.md`). The measured pairs:

  | instant                | `Europe/Warsaw` | `UTC`      | `America/New_York` | catches                                   |
  | ---------------------- | --------------- | ---------- | ------------------ | ----------------------------------------- |
  | `2026-08-09T22:30:00Z` | week 08-10      | week 08-03 | week 08-03         | UTC substituted for a **positive** offset |
  | `2026-08-10T02:00:00Z` | week 08-10      | week 08-10 | week 08-03         | UTC substituted for a **negative** offset |

  **Neither row is sufficient alone**, and half the zone/instant pairs prove nothing: asserting that
  `Europe/Warsaw` reads `2026-08-10` at the second instant is silent about a UTC substitution,
  because UTC reads it too. Together the two rows also catch a hardcoded `"Europe/Warsaw"`, since the
  second instant under that literal yields the first's window. Read the table before adding a case.

- **In an integration suite the stored COLUMN is the input, not a literal.** Write the zone through
  `PATCH /api/profile` (the `setPreferences` shape at `preferences-derive.test.ts:84-90`, which
  throws on a non-200) and read it back off the row before each read. Passing the same literal to the
  write and to the service asserts only that the service honours its own argument. **Own a year no
  other suite writes to** — this read aggregates by DATE RANGE, so a name prefix protects nothing —
  and keep two tests' windows weeks apart. **Restore the zone in a `finally` AND establish it in
  `beforeAll`**: measured, an interrupted run does leak the flipped value, and only setup recovers it.
- **No `TZ` pin belongs in `vitest.render.config.ts`, and this is deliberate.** Measured: the probe
  ran under an ambient `Europe/Warsaw` and correctly produced `America/New_York`'s window, because
  the subject names its own zone on every call and every expectation is a literal. A pin here would
  be a guard nobody had mutated. `vitest.config.ts:12-32`'s pin is a different case and both of its
  properties are load-bearing — the unit suite's subject is `Date` arithmetic, which the ambient zone
  genuinely changes.
- **Reference tests**: `tests/render/week-boundary.test.ts`,
  `tests/integration/week-boundary-seam.test.ts`.
- **Run locally**: `npm run test:render`, then `npm run test:integration`.

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

**Phase 3 — Silent-failure audit (complete, 2026-08-20).** Three things outlived it, and the first
two were wrong in this document before they were measured.

- **The churn evidence pointed at the best-defended code in the repository.** Risk #5's Source column
  cited hot spots; the 30-day window concentrates on `dashboard.astro` (11 touches), `tonnage.ts` and
  `records.astro` — every one of which had its failure branch **built and tested in that same
  window**. `src/pages/api/auth/signout.ts`, which held the only real defect, had **zero** commits in
  it. The evidence that raised the risk was real and it did not point where the failure lived, which
  is §1 principle 3 behaving exactly as designed rather than failing.
- **The original response criterion would have scored the defect as PASSING.** "A failed operation
  answers non-2xx and the persisted state confirms nothing was written" has no subject on a
  redirect-shaped endpoint: `/api/auth/signout` answered `302` whether it worked or not, and signing
  out writes no row at all. Both clauses were rewritten (§2, and §6.4's "non-2xx is not the
  criterion").
- **41 of 43 catch sites were already correct**, so the audit's value was one route plus the pinning
  of classes that were right and unwitnessed. The repository's error handling was not weak; the
  _policy_ was enforced by comments and reviewer attention, and the one place predating the policy
  was never revisited.

**What Phase 3 deliberately did NOT close**, stated so a green gate is not read as covering it:

- **The two class-E fallbacks**, which degrade silently by design and are compensated on `/settings`
  only: `todayIn` answering in UTC for an unknown zone (`calendar.ts:26-35`), and
  `Intl.supportedValuesOf("timeZone")` degrading from 418 entries to a seven-entry hardcoded list
  (`timezones.ts:50-63`). Both are week-boundary-shaped and are **assigned to Phase 4**. Note the
  **category** rather than a count: this document said "three swallows are deliberate" and there are
  five, which is the same failure mode as `lessons.md` § "The conversion constant has been miscounted
  twice, in the same direction".
- **`records.astro`'s null-profile asymmetry.** It reads `profile?.weight_unit ?? "kg"` and prints
  headline figures under a defaulted unit, where `dashboard.astro` and `settings.astro` treat the
  identical input as a failed read. Assertion 4 of `tests/render/page-load-failures.test.ts` pins
  **today's behaviour and says plainly that it is not an endorsement**: no path produces a null
  profile (trigger-created row, no delete path), so a change there could not be proven. The edit that
  makes it bite is **any change to the `profiles` SELECT policy**.
- **A failed sign-out ends the session on this device only.** The refresh token survives at the
  provider, the message says "on this device" rather than claiming a global sign-out, and nothing
  here asserts anything stronger — matching the precision `session-lifecycle.test.ts` already states
  about what `signOut` can and cannot do.
- **The `if (signOut.error)` guard in `/api/account` is diagnostic-only, and deleting it breaks
  nothing.** Measured 2026-08-20: all ten assertions stayed green. The assertion beside it pins the
  **swallow**, not the log. Named rather than covered by an assertion that would only look like
  coverage; the edit that would make it load-bearing is a caller learning to act on that log.

**Phase 4 — Week-boundary seam (complete, 2026-08-21).** Risk #1, the only High × High row on the
map. **No production code changed**: the defect was that nothing would have noticed if it had.
Replacing `profile.timezone` with the literal `"Europe/Warsaw"` at `dashboard.astro:43` left all five
runners green, and the same held for `workouts/index.astro:23`. Three things were wrong in this
document before they were measured.

- **The hot-spot citation was adjacent rather than the anchor.** Risk #1's evidence cited
  `src/lib/services/` at 53 changes/30d, which is a directory-level figure; per file `calendar.ts`
  had 3 and `timezones.ts` had 1. The seam is one expression in `src/pages/`, and `tonnage.ts` is its
  consumer rather than its site — so the citation points at the right neighbourhood and not at the
  door. The sharper evidence was never churn at all: **the column became user-settable on
  2026-08-13**, which is the event that made a wrong zone reachable.
- **"Assert which days made the figure" is structurally impossible from `/dashboard`'s HTML.** The
  guidance stated it as a discipline. The page prints the zone name and two figures and renders no
  dates: `week.start` / `week.end` reach the markup — `WeekTonnage extends DateRange` — and are
  ignored, and no `Intl.DateTimeFormat` appears anywhere in the UI. The window is observable only at
  the query boundary, which is why the assertions read the query and the stub had to start recording
  what `dashboard-tonnage.test.ts:92` throws away. `/workouts` is the one screen where the arithmetic
  reaches the HTML, and it was not in the brief.
- **The inertness mechanism was CIRCULARITY, not the ambient zone the anti-pattern column named.**
  `mondayOf` and `addDays` work on the `getUTC*` accessors of a zoneless date and every call names
  its own zone, so the subject is ambient-independent by construction and a `TZ` pin in the render
  config would have been a guard nobody had mutated. What actually made three suites unable to fail
  is that each computes its expected week with `trainingWeeksFor` — the function under test. The
  ambient hazard that WAS real is the one S-07's review left open: the clock, closed here by pinning
  the instant. Both corrections are now §6.8's first two rules and a new `lessons.md` entry.

**A fourth correction, to this section rather than to §2**: `Intl.supportedValuesOf`'s fallback list
has **seven** entries (`timezones.ts:34-42`, and the module's own comment says seven), not twelve.
Fixed above. Note the **category** rather than the number, for the reason `lessons.md` § "The
conversion constant has been miscounted twice, in the same direction" gives — and which this phase's
own brief then violated by repeating the wrong figure.

**§6.8's one untested claim, and who settles it.** Criterion 4.4 asked whether §6.8 is sufficient to
write a correct week assertion without reading `research.md` — and it was checked by the person who
wrote §6.8, which is the same shape as `lessons.md` § "Verify with a script that attacks, not by
asking the owner to read code". The owner confirmed it, which is the strongest signal available
today, and it is not evidence. **The next author who writes a week- or timezone-related test against
§6.8 settles it**: record here whether they needed `research.md`, and if they did, what §6.8 was
missing. Found by this change's own implementation review, 2026-08-21.

**What Phase 4 deliberately did NOT close**, stated so a green gate is not read as covering it:

- **`timezones.ts`'s fallback is closed by this paragraph, not by a test**, and that is a decision
  rather than an omission. It **cannot produce a wrong week at all**: `todayIn` formats through
  `Intl.DateTimeFormat` and never consults the list, so the two are independent code paths over
  different APIs — a collapsed list shortens a `<select>` and moves no boundary. It is also
  unreachable, measured in workerd (418 zones) and in Node, and forcing it would mean stubbing `Intl`
  — runtime-specific, which `vitest.render.config.ts:17-23` forbids in the only suite that could host
  it. **The edits that would make it bite** are a runtime without `supportedValuesOf`, or somebody
  growing the list by hand towards completeness, which turns a tripwire into a second source of truth.
- **`todayIn`'s UTC fallback IS closed by a test**, and the reachability is worth stating because the
  brief assumed the wrong route. Not through the form: `isSupportedTimeZone` checks membership in
  `Intl.supportedValuesOf("timeZone")`, which is a strict SUBSET of what `Intl.DateTimeFormat`
  accepts — measured, `US/Eastern`, `Australia/Canberra`, `GMT` and `Etc/GMT+5` all format and are
  all refused, and no counter-example runs the other way. It is reachable by a **direct PostgREST
  write from the row's own owner**: the column carries no membership constraint and
  `profiles-rls.test.ts:179-194` writes `Test/Run-<id>` into it today. `week-boundary.test.ts` pins
  both halves of the resulting failure — the window falls back to UTC while the sentence on screen
  still names the stored zone — and says plainly that this is pinned, not endorsed. **The edit that
  would change it** is `/dashboard` learning to name the zone it actually computed in.
- **`src/lib/services/tonnage.ts` still has no unit test**, and its five throws have no coverage.
  That is a real gap and a **different** one: research proved the two span guards check the window's
  WIDTH and can say nothing about whether it starts on the right Monday, so covering them would read
  as a defence of this seam without being one. Whoever writes it should not record Risk #1 as
  better covered afterwards.
- **`/workouts`' null-profile asymmetry is pinned, not endorsed.** `dashboard.astro:31-37` treats an
  absent profile as a FAILED load specifically so it does not compute a week in UTC for somebody who
  is not in it; `settings.astro:37-47` does the same; `workouts/index.astro` puts a UTC date on the
  form for the identical input with nothing on screen saying so, by three paths. That is the
  `records.astro` class Phase 3 named, applied to the timezone, and it is week-shaped rather than
  merely date-shaped: a workout filed on the wrong day at 01:00 Warsaw lands in the wrong week's
  tonnage. Two assertions pin today's behaviour and say it is not an endorsement. **The edit that
  makes it a product decision** is Open Question 2 in the `testing-week-boundary-seam` change
  folder's `research.md` — an owner call, not a test's.

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
