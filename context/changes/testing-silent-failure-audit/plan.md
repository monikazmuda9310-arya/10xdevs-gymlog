# Silent-Failure Audit (Rollout Phase 3) Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` closes Risk #5 — _"an operation fails, the
failure is logged, and the caller is told it succeeded."_ Research (`research.md`, 2026-08-20)
enumerated all 43 catch sites in `src/` and found the repository already handles 41 of them
correctly. The phase therefore has three jobs, in descending order of value:

1. **Fix and pin the one real defect** — `src/pages/api/auth/signout.ts:8` discards the result of
   `supabase.auth.signOut()`, so a provider failure leaves a live session behind a redirect that
   claims the user signed out.
2. **Extend and pin guarantees that are already correct but unwitnessed** — `impact_unavailable` is
   proven for one of three impact routes; four pages' `loadFailed` branches have no render test in
   existence; the two deliberate swallows have nothing stopping a future author from "fixing" them.
3. **Write the patterns down** in `test-plan.md` §6, so the next author does not re-derive them.

## Current State Analysis

**The defect, verified against the installed library rather than inferred.**
`@supabase/auth-js`'s `_signOut` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js`) has
**two early returns ahead of `_removeSession()`**: one for a session error, one for any
`admin.signOut()` failure that is not 404/401/403. `_removeSession()` is the only thing that drives
`setAll` in `src/lib/supabase.ts:20-24`, and therefore the only thing that puts a cleared
`Set-Cookie` on the response. On either early return the cookie survives, `signout.ts` ignores the
`{ error }` it was handed, and answers `302 → /auth/signin`. The browser still holds a session, so
`src/middleware.ts:38-40` sees `locals.user` on an `AUTH_ROUTE` and redirects **back to
`/dashboard`**. What the user experiences is _"I clicked Sign out and landed on my dashboard"_ — a
UI glitch in appearance, an unended session on a shared machine in fact. US-04's third criterion is
the guarantee this breaks.

**Retrying with a different scope does not help.** `_signOut` calls
`this.admin.signOut(accessToken, scope)` **before** it branches on `scope !== 'others'`, so
`{ scope: "local" }` makes the same network call and dies at the same early return. Confirmed by
reading the installed source, 2026-08-20. The only path that ends the session on this device
without the provider's cooperation is clearing the cookies ourselves.

**The same call is handled correctly one directory away.** `src/pages/api/account/index.ts:58-74`
catches the throw, branches on `signOut.error`, logs it, and explains in a comment why reporting
success is still right _there_ (the account is genuinely gone). Two endpoints, one call, opposite
treatment. That contrast is what makes `signout.ts` an oversight rather than a house style — and it
also names an edge the plan must handle: **`signOut()` resolves `{ error }` for an ordinary auth
failure but RE-THROWS anything that is not an `AuthError`.** Two failure shapes, not one.

**Coverage state, measured rather than assumed** (`grep` over `tests/`, 2026-08-20):

| Thing                                                               | Witness today                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/sets/[id]/impact` failure                                 | `workout-mutations-rls.test.ts:369-398` (assertion 13) + its non-vacuity control 14 |
| `GET /api/workouts/[id]/impact`                                     | **nothing — imported by no test in the repository**                                 |
| `GET /api/exercise-entries/[id]/impact`                             | **nothing — imported by no test in the repository**                                 |
| `/api/sets` record-badge swallow                                    | **nothing**                                                                         |
| `/api/account` post-deletion `signOut` swallow                      | **nothing**                                                                         |
| `records` / `workouts` / `workouts/[id]` / `exercises` `loadFailed` | **nothing — `tests/render/` holds three files, none touching these pages**          |
| `signout.ts` failure path                                           | **nothing, at any layer** — `session-lifecycle.test.ts:227-276` covers success only |

### Key Discoveries

- **`src/pages/api/auth/signout.ts:8`** — the discarded result; the entire defect. The only awaited
  Supabase call in `src/` whose result is dropped.
- **`tests/middleware/_shared/context.ts:77`** — the doubled `AstroCookies` implements **`set()`
  only**; `get`, `has` and `delete` throw `notDoubled(...)` on purpose. A fix built on
  `cookies.delete()` reddens the harness rather than the product.
- **`tests/middleware/_shared/session.ts:58-70`** — `applyCookieWrites` already treats `value === ""`
  **or** `maxAge === 0` as a browser dropping the cookie, because that is how `@supabase/ssr` clears
  one. So a fix that clears through `cookies.set(name, "", { maxAge: 0, … })` travels the **same
  path a successful sign-out travels** and needs no harness change at all.
- **`tests/middleware/session-lifecycle.test.ts:160-170`** — `signoutContext(locals, redirectedTo)`
  builds the slice of `APIContext` the route reads today: `locals`, `params`, `request`, `redirect`.
  It carries **no `cookies`** and its `request` has **no `Cookie` header**. Both are needed once the
  route clears cookies; this is a required harness change, named in Phase 1.
- **`tests/middleware/_shared/session.ts:87-89`** — `storageKeyFor(url)` derives
  `sb-<project ref>-auth-token` from the project URL, and the minting helper then **checks it against
  what the library actually wrote** rather than trusting the derivation. Production needs the same
  derivation; the check is what stops it rotting.
- **`tests/integration/workout-mutations-rls.test.ts:376-388`** — `new Proxy(client, { get })`
  intercepting `from` and throwing for named tables. The repository's only broken-client precedent,
  and the right shape: it leaves the ownership read working, which is what a real hiccup looks like.
- **`tests/render/dashboard-tonnage.test.ts:143-150`** — a stub that dispatches on table name and
  **throws on an unstubbed table**. That tripwire is what reddened the dashboard suite the moment
  S-08 added a third read (`:139-142`).
- **`astro/dist/container/index.d.ts`** — `renderToResponse(component, options)` returns a real
  `Response`, and `ContainerRenderOptions.params` is `Record<string, string | undefined>`. Both are
  needed to tell `workouts/[id].astro`'s 404 apart from its `loadFailed` branch. Verified 2026-08-20.
- **`src/lib/validation/auth.ts:53-70`** — `AUTH_MESSAGES` has no `sign_out_failed`, and
  `messageForCode` resolves an unrecognised code to the **generic** message. A code added to the
  redirect without a catalogue entry degrades silently rather than failing.
- **Marks in use**: `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`, `s06-`, `s07-`,
  `s08-`, `s09d-`, `s09i-`, `t2c-`, `t2e-`. `t3s-` is neither a prefix of nor prefixed by any.

## Desired End State

- A sign-out whose provider call fails **ends the session on this device anyway** and says so: the
  jar is cleared, the destination is `/auth/signin?error=sign_out_failed`, the middleware does not
  bounce (no session to bounce), and the sign-in page renders a message from this project's own
  catalogue. Returning to a protected route requires authenticating again — US-04's third criterion
  is true on the failure path, not only on the happy one.
- **All three** `…/impact` routes are proven to answer `impact_unavailable` rather than
  `{ impact: [] }` when the ranking read fails, and proven to still answer a meaningful `200`.
- The two deliberate swallows are pinned: `/api/sets` still answers `201` with the set persisted and
  `record: null` when the verdict read fails; `/api/account` still answers `{ deleted: true }` with
  the account genuinely gone when `signOut` fails or throws.
- Each of the four `loadFailed` pages has a render check proving it states the failure instead of
  degrading to an empty list, with a positive control proving the non-failure path renders content.
- `test-plan.md` §6 carries the patterns this phase produced, §3 shows Phase 3 complete, and the two
  class-E fallbacks plus `records.astro`'s null-profile asymmetry are named as gaps assigned to
  Phase 4.

**How to verify**: the eight-step gate passes (`AGENTS.md` § Commands), and every new assertion has
been shown to fail against the unfixed / unmutated code before it was accepted — see the mutation
protocol in each phase.

## What We're NOT Doing

- **Not reversing any deliberate swallow.** Class A (12 sites) and class B (2 sites) are already
  correct; this phase pins them, it does not change them.
- **Not testing the two class-E fallbacks** (`todayIn` → UTC on an unknown zone,
  `timezones.ts`'s 12-entry fallback). Both are genuine silent degradations and both are
  week-boundary-shaped; Phase 4 owns that seam. They are **named** in §6, not tested here.
- **Not changing `records.astro`'s null-profile behaviour.** No path produces a null profile today
  (trigger-created row, no delete path), so a change there would be unprovable. Phase 4 §4 pins
  today's behaviour in the repository's refusal language instead.
- **Not closing the two gaps `account-deletion.test.ts:387-429` refuses in writing.** They are
  refused for a reason and a weaker assertion in their place would be worse than the gap.
- **No browser test anywhere in this phase.** Every question here is answerable at a cheaper layer,
  and `test-plan.md` §1 principle 1 forbids promoting to e2e because it "feels safer".
- **No assertion on log output.** `console.error` is a diagnostic, not a contract. Every assertion
  here lands on a response, a stored row, or a session.

## Implementation Approach

Five sub-phases ordered by cost × signal. Sub-phase 1 is the only one that changes production
behaviour and is the only one whose test can be red before it is written — so it goes first and
carries an explicit mutation protocol. Sub-phases 2 and 3 share one new integration suite and one
account bootstrap. Sub-phase 4 is the most work and the most hermetic. Sub-phase 5 writes the phase
down.

**Every assertion that proves something by ABSENCE gets a positive control in the same test.** This
is `AGENTS.md` § Testing's forged-cookie rule generalised, and it is the single rule most likely to
be skipped here: "no data came back", "no number on screen", "no record badge" and "the account is
gone" are all absence claims, and all four are satisfied perfectly by a path that never produced
anything in the first place.

**AI-native guidance, dated 2026-08-20**: no MCP server is exposed in this session for docs, browser
or provider (`test-plan.md` §4, checked 2026-08-16 and unchanged). Library behaviour in this plan
was grounded by reading `node_modules/` directly, and that is the method to repeat — not a web
search for what `signOut` "usually" does. Drive the phases with `/10x-tdd`, which enforces
red→green per assertion; `/10x-implement` is the fallback for the documentation sub-phase, which has
no red state.

## Critical Implementation Details

**Cookie clearing must go through `set`, not `delete`, and the reason is load-bearing.**
`@supabase/ssr` clears a cookie by writing `value: ""` with `maxAge: 0` — that is what
`applyCookieWrites` (`session.ts:58-70`) already decodes, and what the doubled `AstroCookies`
already records. `AstroCookies.delete()` is deliberately unimplemented in the double
(`context.ts:77`), so a fix built on it fails the harness rather than the product, which is a
failure about the test rather than about the code. Clearing through `set` also means the failure
path and the success path write **the same shape**, so one assertion can compare them.

**The `path` on the cleared cookie must match what `setAll` wrote, or the browser keeps the
cookie.** This is invisible to a test that only inspects `cookiesWritten` by name. Phase 1's
assertion therefore compares the cleared cookie **names** against the set that assertion 2's real
`signOut()` produces, and the implementer must read the `options` `@supabase/ssr` used on the
success path rather than assuming `path: "/"`.

**`session.jar` must be copied, never mutated in place.** `account.session.jar` is shared by
assertions 1, 3, 4 and 5 of `session-lifecycle.test.ts`. The existing code already does this
(`new Map(signedOut.session.jar)` at `:244`); the new assertions must too, or a later assertion
loses its session and fails for a reason unrelated to the code.

**Ordering inside an assertion decides which failure a mutation lands on** (`lessons.md` § "The
assertion carrying the claim goes FIRST", measured on this very file). The data read — or the
absence of it — is the claim; the redirect and the cookie names are diagnostics. Put the claim
first, or a mutation reddens a weaker line and leaves the claim unexecuted.

---

## Phase 1: The sign-out failure path

### Overview

Make a failed sign-out distinguishable from a successful one — and make it _true_ on this device —
then pin both with assertions in the middleware suite, which is the only project that can ask what
identity a real cookie produces.

### Changes Required:

#### 1. A catalogue entry for the outcome

**File**: `src/lib/validation/auth.ts`

**Intent**: Add `sign_out_failed` to `AUTH_MESSAGES` so the redirect can carry a code that resolves
to this project's own words. Without an entry, `messageForCode` falls through to the generic
`unexpected` message and the new code degrades silently — the exact class of failure this phase
exists to close.

**Contract**: One new key in the `AUTH_MESSAGES` object literal, alongside the existing provider
outcomes (`sign_in_failed`, `sign_up_failed`, `rate_limited`). `AuthMessageCode` widens by
inference; no other change. The sentence must be **honest about what did and did not happen**: the
device is signed out, the session may still be live elsewhere, and signing in again is the retry.
It belongs in `AUTH_MESSAGES` (red box) rather than `AUTH_NOTICES` — `AUTH_NOTICES` is documented at
`:74-82` as the catalogue for _deliberate, successful_ actions, and this is neither.

#### 2. Cookie clearing, in the module that owns cookie knowledge

**File**: `src/lib/supabase.ts`

**Intent**: Export a function that clears this project's auth cookies from the response, so the
route can end the session on this device when the provider will not. It lives here because this is
the module that already knows the cookie plumbing (`createServerClient`, `parseCookieHeader`,
`setAll`) — a second place deriving the storage key is the two-implementations hazard `AGENTS.md`
warns about three times over.

**Contract**: `clearSessionCookies(requestHeaders: Headers, cookies: AstroCookies): string[]`,
returning the names it cleared so a caller (and a test) can see what happened. Derives the storage
key as `sb-<hostname's first label>-auth-token` from `SUPABASE_URL` — the same derivation
`tests/middleware/_shared/session.ts:87-89` uses — and clears that name plus any chunked
`<key>.<n>` present in the request's `Cookie` header. Clears by **`cookies.set(name, "", { …,
maxAge: 0 })`**, never `cookies.delete`; see § Critical Implementation Details. Returns `[]` when
`SUPABASE_URL` is absent, matching `createClient`'s documented null behaviour rather than throwing.

#### 3. The route reads the result it was handed

**File**: `src/pages/api/auth/signout.ts`

**Intent**: Stop discarding `signOut()`'s result. On failure, clear the jar anyway and redirect to a
destination that carries the code; on success, behave exactly as today.

**Contract**: Both failure shapes are handled, and they are two, not one — `signOut()` resolves
`{ error }` for an ordinary auth failure and **re-throws** anything that is not an `AuthError`
(documented at `src/pages/api/account/index.ts:58-62`). Both land on the same branch. Success
redirects to `/auth/signin` unchanged; failure redirects to `/auth/signin?error=sign_out_failed`
after `clearSessionCookies`. The failure is logged with the project's `// eslint-disable-next-line
no-console -- deliberate server-side diagnostic` comment, matching every other diagnostic here.
The redirect carries a **code, never prose** (`AGENTS.md` § Architecture).

#### 4. The harness grows two fields it now needs

**File**: `tests/middleware/session-lifecycle.test.ts`

**Intent**: `signoutContext` builds the slice of `APIContext` the route reads. The route now reads
two more things — `context.cookies` (to clear) and `context.request.headers` (to find what to
clear) — so the helper must supply both, or the new assertions test a route that could not clear
anything.

**Contract**: `signoutContext(locals, redirectedTo, { cookies, cookieHeader })` — `cookies` is the
harness's own recording double (`harness.context.cookies`), so what the route clears lands in
`harness.cookiesWritten` and is observable; `cookieHeader` is the live jar's header, so
`clearSessionCookies` sees real cookie names. **Pass the harness's double rather than a new one**:
a fresh double would record writes nothing else can see, and the assertion would pass while the
real response carried no `Set-Cookie` at all.

#### 5. The assertions

**File**: `tests/middleware/session-lifecycle.test.ts`

**Intent**: Prove that a failed sign-out is distinguishable from a successful one **and** that the
session did not survive it.

**Contract**: Two new `it(...)` blocks in the existing `"the three cookie states"` describe,
numbered 6 and 7 to continue the file's convention.

- **Assertion 6 — `signOut` resolves `{ error }`.** Drive the real route with a `locals` whose
  `supabase.auth.signOut` resolves an `AuthError`-shaped `{ error }`, everything else real.
  - _Behavior asserted_: the surviving jar obtains **no** training (`refusal.code === "42501"`, not
    merely an empty list — `anon` has no `select` grant on `workouts`, so the read is refused a step
    earlier than RLS would filter it); the destination is
    `/auth/signin?error=sign_out_failed`; `locals.user` on the next request is `null`, so the
    middleware does **not** bounce to `/dashboard`; and the cleared names contain
    `session.storageKey`. **The data read goes first**, per § Critical Implementation Details.
  - _Positive control, in the same test_: the identical path with `signOut` resolving
    `{ error: null }` must redirect to `/auth/signin` **without** `?error=` — proving the code is
    attached by the failure branch and not unconditionally. Without it, an implementation that
    always appends the code passes assertion 6.
  - _Second control, already in the file_: assertion 2 proves a **real** `signOut()` clears
    `session.storageKey`. Assertion 6 asserting the same name on the failure path is what makes
    "cleared" mean the same thing on both paths.
  - _Regression caught_: someone "simplifying" the route back to a bare `await signOut()`, or
    dropping `clearSessionCookies` because "the library does that".
  - _Research source_: `research.md` § "The defect", gap #1; the library source quoted there.
  - _Edge case_: this is the boundary between "the provider says no" and "the user is signed out" —
    the one place the two can disagree.
  - _Anti-pattern avoided_: **reading a `302` as proof of refusal.** Both paths answer `302`; only
    the destination and the jar tell them apart, which is exactly the correction `test-plan.md` §2
    now carries for Risk #5.
- **Assertion 7 — `signOut` throws a non-`AuthError`.** Same shape, `signOut` rejecting rather than
  resolving.
  - _Behavior asserted_: identical to assertion 6. A throw and an `{ error }` are two different
    library behaviours and must not be assumed to share a branch — that assumption is what
    `account/index.ts:58-62` had to correct in its own handler.
  - _Regression caught_: a fix written as `if (error) { … }` with no `try`, which handles one shape
    and lets the other escape as an Astro HTML 500 — a response the sign-out form cannot show.
  - _Positive control_: shares assertion 6's `{ error: null }` control by construction; state that
    in a comment rather than duplicating it.

#### 6. The route table says what the route now does

**Files**: `README.md`, `AGENTS.md`

**Intent**: `README.md` § Routes currently reads _"POST. Always → `/auth/signin`, so returning
requires authenticating again"_. That is still true and now incomplete: the destination carries a
code when the provider call failed, and the sign-out is completed locally regardless.

**Contract**: Update the `/api/auth/signout` row in `README.md` § Routes, and add a bullet under
`AGENTS.md` § Architecture beside the existing redirect-carries-a-code rule. Both state the same
fact: **a failed sign-out still ends the session on this device, and says so** — the session may
survive elsewhere, and the message does not claim otherwise.

### Success Criteria:

#### Automated Verification:

- Assertions 6 and 7 are **red against the unfixed `signout.ts`** before the fix lands, and the
  failure is on the data read rather than on the redirect (mutation protocol, `lessons.md` § "The
  assertion carrying the claim goes FIRST")
- The `{ error: null }` positive control is red when the fix is mutated to append `?error=` unconditionally
- Assertion 2 (the existing success path) still passes unchanged: `npm run test:middleware`
- `npm test` passes — `messageForCode("sign_out_failed")` resolves to the new sentence, not `unexpected`
- `npm run lint` and `npm run typecheck` pass
- `npm run test:e2e` passes — the sign-out step of `tests/e2e/critical-flow.spec.ts:149-165` crosses
  this route for real

#### Manual Verification:

- Signing out through the deployed app still lands on the sign-in page with no message
- With the failure branch forced locally, the sign-in page shows the new sentence in the red box and
  the dashboard is not reachable without signing in again

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: `impact_unavailable` on the two untested routes

### Overview

The guarantee "a failed impact read answers `impact_unavailable`, never `{ impact: [] }`" is proven
for `sets/[id]/impact` and for nothing else. `workouts/[id]/impact` and
`exercise-entries/[id]/impact` are imported by no test in the repository, and they are the two that
can take several records at once — the cases where an empty list is the most misleading.

### Changes Required:

#### 1. A new integration suite

**File**: `tests/integration/silent-failure.test.ts`

**Intent**: One home for this phase's integration assertions. New rather than an extension of
`workout-mutations-rls.test.ts`, whose title is about twelve RLS policies and which already carries
14 assertions — growing it further is the drift `lessons.md` § "A test whose title claims more than
its body asserts" describes.

**Contract**: Mark `t3s-` (neither a prefix of, nor prefixed by, any mark in use — re-derive with
`grep -rn "const MARK" tests/` rather than trusting this list). Signs in as the shared
`rls-owner-a@` fixture for the impact assertions, following `workout-mutations-rls.test.ts`'s
bootstrap; **creates its own per-run accounts for Phase 3's deletion assertions** and never touches
`rls-owner-*` or an `s09i-` address for those. Fixture rows carry `${MARK}${label}-${RUN_ID}`.
Breaks reads with the `new Proxy(client, { get })` shape from
`workout-mutations-rls.test.ts:376-388`, intercepting `from` and throwing for `personal_records` and
`set_estimates` only.

#### 2. The four impact assertions

**File**: `tests/integration/silent-failure.test.ts`

**Intent**: Extend the proven guarantee from one route to three, and prove each route can still
answer meaningfully.

**Contract**:

- **Assertion 1 — `GET /api/workouts/[id]/impact` with the ranking reads broken.**
  - _Behavior asserted_: `response.status !== 200`, `body.code === "impact_unavailable"`,
    `body.impact === undefined`.
  - _Positive control, same describe_: the same route on the same workout through the **unbroken**
    client answers `200` with a **non-empty** `impact`. Without it, assertion 1 passes against a
    route that has simply stopped working — and this control is stronger than
    `workout-mutations-rls`'s assertion 14, because a workout-level answer that is always empty
    would satisfy an `[]`-only control.
  - _Edge case / boundary_: **only the ranking reads fail; the ownership read stays live.** That is
    the shape a real database hiccup takes, and it is what separates `503 impact_unavailable` from
    `404 workout_not_found`. A Proxy that broke every table would produce a 404 and the assertion
    would pass for the wrong reason.
  - _Regression caught_: someone "simplifying" the catch at `workouts/[id]/impact.ts:33-41` into
    `return ok({ impact: [] })`, which reads as graceful degradation and is a false reassurance at
    the moment the product cannot know.
  - _Research source_: `research.md` § Coverage gaps, gap #2; the untested routes named at
    `src/pages/api/workouts/[id]/impact.ts:33-41`.
  - _Anti-pattern avoided_: asserting on log output — the route's `console.error` is not asserted;
    the response body is.
- **Assertion 2 — `GET /api/exercise-entries/[id]/impact` with the ranking reads broken.** Same
  contract, same controls, scoped to one entry.
- **Assertion 3 — a non-2xx is not self-evidently the right non-2xx.** The same route handed a
  well-formed uuid that names no row answers `404` with the resource's own code
  (`workout_not_found` / `entry_not_found`), **not** `503 impact_unavailable`.
  - _Behavior asserted_: two different failures are two different answers.
  - _Regression caught_: a catch widened to swallow the "not found" branch, collapsing "there is no
    such workout" into "we could not determine the impact" — which would make assertion 1 pass while
    the route had lost the ability to say anything specific.
  - _Anti-pattern avoided_: **treating "non-2xx" as the criterion**, which `research.md` § Corrections
    showed is exactly what would have scored the sign-out defect as passing.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes, including the new suite
- Each failure assertion is red when its route's `catch` is mutated to `return ok({ impact: [] })`
- Each positive control is red when its route is mutated to always throw
- Running the suite **twice in a row** passes both times (fixture discipline, `AGENTS.md` § Testing)
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification:

- The suite's console output names each attempted failure and the raw response, following
  `workout-mutations-rls.test.ts`'s convention that a guarantee is demonstrated by something that
  attacks it

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Pinning the two deliberate swallows

### Overview

Class B (`research.md` § The catch inventory) is two sites where a caught error correctly does
**not** become a non-2xx, because the write has already committed and an error would invite a retry
that duplicates it. Both carry their reasoning inline and **nothing enforces either**. This phase is
the only thing in the repository that would enforce the plan's own anti-pattern, "do not reverse a
deliberate swallow".

### Changes Required:

#### 1. The record-badge swallow

**File**: `tests/integration/silent-failure.test.ts` (new `describe`)

**Intent**: Prove `POST /api/sets` still succeeds when the record verdict cannot be computed.

**Contract**:

- _Behavior asserted_: with the ranking reads broken by the same Proxy, the route answers `201`,
  the body carries `set`, `record` is `null`, **and the set is read back from `sets` as its owner**.
  The persisted read is the assertion that matters: a `201` alone does not say a row exists.
- _Positive control, same describe_: an unbroken client logging a set that genuinely beats a
  previous best answers `201` with `record` **non-null**. Without it, `record: null` is satisfied by
  an endpoint that has stopped announcing records at all — and that endpoint would pass the failure
  assertion perfectly.
- _Edge case / boundary_: the fixture must land **inside** the 1–12 rep range at positive load or
  the verdict is `none` for a domain reason rather than a failure reason, and the control proves
  nothing. Two sets on one exercise, the second heavier, both at 5 reps.
- _Regression caught_: someone "fixing" `src/pages/api/sets/index.ts:84-90` into a `500`, or
  hoisting the verdict above the insert. Either turns a lost badge into a lost set — via the retry
  `AddSetForm` deliberately makes easy.
- _Research source_: `research.md` § Coverage gaps, gap #4; the reasoning at `sets/index.ts:67-73`.
- _Anti-pattern avoided_: **reversing a deliberate swallow** — this assertion exists to make that
  reversal red.

#### 2. The post-deletion sign-out swallow

**File**: `tests/integration/silent-failure.test.ts` (same `describe`)

**Intent**: Prove `DELETE /api/account` still reports success — truthfully — when the session cannot
be ended afterwards.

**Contract**: Two per-run accounts, `t3s-`-marked, one per failure shape.

- _Behavior asserted_: with `auth.signOut` **resolving `{ error }`** (account 1) and with it
  **throwing a non-`AuthError`** (account 2), the route answers `200 { deleted: true }` and the
  account is **genuinely gone**. Both shapes, because `account/index.ts:58-74` handles them in two
  different places (`if (signOut.error)` and `catch`) and only one is reachable per test.
- _Positive control, in the same test_: sign in as the account **before** the deletion and assert a
  session comes back. "Signing in fails afterwards" is an absence claim satisfied perfectly by an
  account that never existed — a typo in the address produces exactly that observation.
- _Edge case / boundary_: the Proxy must intercept **`auth` only** and pass `rpc` through, or
  `delete_own_account()` never runs and the assertion measures a Proxy rather than the endpoint.
- _Regression caught_: someone removing the `try`/`catch` at `account/index.ts:71-74`, after which a
  throw escapes the handler, Astro answers a generic HTML 500, `DeleteAccountPanel`'s
  `response.json()` fails, and the user is told the deletion did not happen — **about an account
  that no longer exists.** The comment calls that "the one lie this endpoint must never tell"; this
  is what makes the comment enforceable.
- _Research source_: `research.md` § The catch inventory, class B; `account/index.ts:58-74`.
- _Anti-pattern avoided_: asserting the response only. The claim is the account's absence, proven
  from outside by attempting a sign-in — the shape `session-lifecycle.test.ts:198-207` uses in
  teardown for the same reason.

**Cleanup note**: these accounts delete themselves as the assertion's subject. `afterAll` must
tolerate an already-deleted account rather than throwing — and must still remove any account whose
assertion failed before reaching the deletion. There is **no `LIKE` sweep in this project**, so a
leaked account is unrecoverable without the dashboard; the `finally` is the recovery path.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes
- The `/api/sets` assertion is red when the verdict `catch` is mutated to `return fail(500, "unexpected")`
- Its positive control is red when the verdict is mutated to always return `null`
- The `/api/account` assertions are red when the `try`/`catch` and the `if (signOut.error)` guard
  are each removed in turn
- Running the suite twice in a row passes both times, and leaves no `t3s-` account behind
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification:

- The Supabase dashboard's auth user list holds no `t3s-` address after a full run

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: The four `loadFailed` branches

### Overview

Four pages carry a `loadFailed` branch whose whole purpose is that a failed read must not render as
"you have nothing". None of them has ever been rendered by a test. `tests/render/` is the only
project that can ask what a protected page's HTML actually contains.

### Changes Required:

#### 1. A render suite for the four pages

**File**: `tests/render/page-load-failures.test.ts`

**Intent**: One suite, four pages, each with its failure branch and a positive control.

**Contract**: Follows `dashboard-tonnage.test.ts`'s shape — a stub that **dispatches on table name
and throws on an unstubbed one** (`:143-150`), so a fifth read added to any of these pages reddens
this file before an assertion exists for it. Uses `renderToString` for the three pages whose
outcome is textual and **`renderToResponse`** for `workouts/[id].astro`, whose outcome includes a
status code. `ContainerRenderOptions.params` supplies the `[id]`. No adapter-specific assertion
anywhere (`test-plan.md` §6.5).

#### 2. `records.astro`

**Intent**: Prove a failed records read states the failure and prints no figures; and pin the
null-profile asymmetry rather than silently inheriting it.

**Contract**:

- _Behavior asserted_: with `personal_records` throwing, the failure sentence is present and **no
  record figure is on screen**.
- _Positive control_: the same stub with one real record renders the figure and **not** the failure
  sentence. "No figures" is otherwise satisfied by a page that renders nothing at all.
- _Boundary_: an account with zero records renders "No records yet", which is a **third** state and
  must not be confused with the failure sentence — assert both are distinguishable, because
  collapsing them is precisely the silent failure `records.astro:29-31` exists to prevent.
- _The asymmetry, pinned in refusal language_: a **null profile with a working records read** prints
  figures under a defaulted `kg` (`records.astro:26-27`), where `dashboard.astro` and
  `settings.astro` treat the same input as a failed read. Assert today's behaviour and say plainly
  in the comment that this pins the **current** behaviour rather than endorsing it, that no path
  produces a null profile today (trigger-created row, no delete path), and that **the edit which
  makes it bite is any change to the `profiles` select policy**. Wording follows `lessons.md`
  § "An assertion you keep because it cannot fail YET must say so in the same words you'd use to
  refuse one".
- _Research source_: `research.md` § Coverage gaps, gaps #3 and #5.

#### 3. `workouts/index.astro`

**Intent**: Prove the list failure does not take the form with it.

**Contract**:

- _Behavior asserted_: with `workouts` throwing, the failure sentence is present **and
  `NewWorkoutForm` is still on screen**. The page puts the form above the failure branch on purpose
  (`workouts/index.astro:47-52`): starting a workout does not depend on the read that failed.
- _Positive control_: a working read renders a workout's note and no failure sentence.
- _Boundary_: an account with zero workouts renders "no workouts yet" — the state the failure
  branch exists to be distinguishable from.
- _Regression caught_: someone moving the form inside the `else`, which reads as tidier and removes
  the one action the user came for at the moment the page is already degraded.

#### 4. `workouts/[id].astro`

**Intent**: Prove three outcomes are three outcomes. This is the richest page and the strongest
signal in the sub-phase.

**Contract**:

- _Behavior asserted_, via `renderToResponse`: a **missing/not-yours** workout answers **404** with
  the not-found copy; a **failed read** answers **not-404** with the failure copy (`[id].astro:33-35`
  guards `!loadFailed && !workout`); a **malformed uuid** answers 404 **without any query running** —
  provable because the stub throws on any table it is asked for, so a query would redden the test.
- _Positive control_: a real workout renders the `WorkoutDetail` island.
- _Edge case / boundary_: the malformed-id case is the boundary `AGENTS.md` § Access control names —
  Postgres answers `22P02` for a uuid column handed a non-uuid, surfacing as a `500` for what is
  really "no such row", and a 500 is a different fact about the system than a 404.
- _Regression caught_: collapsing `loadFailed` into the 404 branch, which would tell a user their
  workout does not exist when the database was merely unreachable — an existence claim made from a
  failed read.
- _Anti-pattern avoided_: asserting the presence of an element instead of the outcome. Each of the
  three states is asserted by **status plus copy**, not by "the page rendered".

#### 5. `exercises.astro`

**Intent**: Prove a failed catalogue read is not an empty catalogue.

**Contract**:

- _Behavior asserted_: with `exercises` throwing, the failure sentence is present and
  `ExerciseCatalogue` is **absent**.
- _Positive control_: a working read renders the island with a seeded exercise's name — otherwise
  "the island is absent" is satisfied by a page that never renders it.
- _Regression caught_: the branch being removed as redundant, after which a failed read is
  indistinguishable from a seed that never landed — the page's own comment (`exercises.astro:18-21`)
  states exactly this and nothing enforced it.

### Success Criteria:

#### Automated Verification:

- `npm run test:render` passes with the new suite
- Each failure assertion is red when its page's `catch` block is mutated to swallow without setting
  `loadFailed`
- Each positive control is red when its page's success branch is mutated to render nothing
- The stub's unstubbed-table `throw` fires when a page is given a fifth read (verify by adding a
  throwaway read locally, then reverting)
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification:

- The three `records.astro` states — failure, empty, populated — read as three different things to a
  person, not merely to an assertion

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Write the phase down in `test-plan.md` §6

### Overview

The last sub-phase, and the one the phase is judged by later: the patterns this work produced belong
in the cookbook, or the next author re-derives them. `test-plan.md` §2's Risk #5 row and the
correction paragraph beneath it were already rewritten by research on 2026-08-20 and need no further
edit — this phase adds the cookbook entries, flips the status, and names the gaps that stay open.

### Changes Required:

#### 1. Cookbook additions

**File**: `context/foundation/test-plan.md`

**Intent**: Record the four patterns this phase produced, each in the sub-section that owns its
layer, so they are found by someone reading about that layer rather than about this phase.

**Contract**:

- **§6.7 (middleware / cookie)** — _injecting an auth failure_. The route's `locals` is
  hand-built, so substituting `supabase.auth.signOut` is a one-line change with the real route under
  test. **Two failure shapes, not one**: `{ error }` and a re-thrown non-`AuthError`. **The doubled
  `AstroCookies` implements `set()` only**, and `applyCookieWrites` decodes a clear as
  `value: ""` / `maxAge: 0` — so production code that clears through `set` needs no harness change,
  and production code that clears through `delete` reddens the harness rather than the product.
  **Copy the jar (`new Map(...)`), never mutate `session.jar`** — it is shared by four assertions.
- **§6.2 (integration)** — _breaking one read without mocking the client_.
  `new Proxy(client, { get })` intercepting `from` and throwing for **named tables only**, leaving
  the ownership read working. That asymmetry is the point: break everything and a `503` assertion
  passes against a `404`. Note the `auth`-only variant for `DELETE /api/account`, which must pass
  `rpc` through.
- **§6.5 (render)** — _the stub tripwire, and reading a status_. Dispatch on table name and **throw
  on an unstubbed table**, so a new read reddens the suite before an assertion exists for it. Use
  `renderToResponse` rather than `renderToString` when the outcome includes a status code —
  `workouts/[id].astro` is the case, and telling its 404 apart from its `loadFailed` branch is not
  possible from the HTML alone.
- **§6.4 (new API endpoint)** — one line: **a non-2xx is not the criterion.** For a redirect-shaped
  endpoint, success and failure share a status and the signal is the **destination**; for a JSON
  endpoint, two different failures must stay two different codes. Cross-reference §2's Risk #5 row.

#### 2. The phase note

**File**: `context/foundation/test-plan.md` §6.6

**Intent**: Record what outlived this phase, in the shape §6.6's Phase 1 and Phase 2 notes use —
what was wrong before it was measured, not what was done.

**Contract**: A `**Phase 3 — Silent-failure audit (complete, 2026-08-20).**` block naming: that the
churn evidence behind Risk #5 pointed at the **best-defended** code in the repository while the file
holding the defect had zero commits in the window (§1 principle 3 behaving as designed); that the
original response criterion would have scored the defect as **passing**; and that **41 of 43 catch
sites were already correct**, so the audit's value was one route plus the pinning of classes that
were right and unwitnessed.

#### 3. Gaps that stay open, named

**File**: `context/foundation/test-plan.md` (§6.6, beside the phase note)

**Intent**: Three things this phase deliberately did not close. Stated so a green gate is not read
as covering them — the same treatment §2 already gives risk #4's phone-width half.

**Contract**:

- **The two class-E fallbacks** — `todayIn` → UTC on an unknown zone (`calendar.ts:26-35`), and the
  418-zone list degrading to 12 entries (`timezones.ts:50-63`). Both are genuine silent
  degradations; both are compensated on `/settings` only; both are week-boundary-shaped and are
  **assigned to Phase 4**. Say the **category**, not a count — `test-plan.md` said "three swallows
  are deliberate" and there are five, and `lessons.md` § "The conversion constant has been miscounted
  twice, in the same direction" is the precedent for why a bare count invites a wrong correction.
- **`records.astro`'s null-profile asymmetry** — pinned in Phase 4 of this change as today's
  behaviour, with the triggering edit named (any change to the `profiles` select policy). Not fixed,
  because no path produces the input today.
- **A failed sign-out ends the session on this device only.** The refresh token survives at the
  provider; the message says so and this phase asserts nothing stronger, matching the precision
  `session-lifecycle.test.ts:14-18` already states about what `signOut` can and cannot do.

#### 4. Status and ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 3 has landed.

**Contract**: §3's Phase 3 row Status → `complete`. The `> Last updated:` line at the top → the
landing date. §5's gate table needs **no** new row: every check added here runs inside
`test:middleware`, `test:integration` and `test:render`, all three already required and all three
already inside the CI concurrency group.

#### 5. Close the change

**Files**: `context/changes/testing-silent-failure-audit/change.md`

**Contract**: `status: complete`, `updated:` to the landing date. Archive with `/10x-archive` once
the gate is green on `main`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (prettier over `*.md` runs in pre-commit)
- The full eight-step gate passes in the order `AGENTS.md` § Commands lists it
- The PR's `ci` check is green before merge — `main` is protected with `enforce_admins: true` since
  2026-08-20 and will refuse otherwise

#### Manual Verification:

- §6's new entries are findable by someone reading about a **layer**, not about this phase
- The three named gaps read as deliberate carries with an assigned owner, not as omissions

**Implementation Note**: This sub-phase has no red state; drive it with `/10x-implement` rather than
`/10x-tdd`.

---

## Testing Strategy

### Unit tests (`npm test`)

- `messageForCode("sign_out_failed")` resolves to the new catalogue sentence, not to the generic
  `unexpected` fallback. This is the only unit-layer addition, and it exists because the failure it
  catches — a code on the redirect with no catalogue entry — is **silent** by construction.

### Middleware tests (`npm run test:middleware`)

- Assertions 6 and 7 of `session-lifecycle.test.ts`: a failed sign-out clears the jar, carries the
  code, and leaves the training unreachable (`42501`) — with a `{ error: null }` control proving the
  code is attached by the failure branch.

### Integration tests (`npm run test:integration`)

- `silent-failure.test.ts`: three impact-route assertions plus non-vacuity controls; a `404` ≠ `503`
  assertion; the `/api/sets` verdict swallow with a record-announcing control; the `/api/account`
  sign-out swallow in both failure shapes with a sign-in-before control.

### Render tests (`npm run test:render`)

- `page-load-failures.test.ts`: four pages × (failure branch + positive control), plus
  `workouts/[id].astro`'s three-way status/copy distinction and `records.astro`'s pinned asymmetry.

### Manual testing steps

1. Sign out through the deployed app — land on `/auth/signin` with no message, and confirm
   `/dashboard` is not reachable without signing in again.
2. Force the failure branch locally (make `signOut` reject) and sign out — confirm the sign-in page
   shows the new sentence in the red box, that the dashboard is **not** reachable, and that the
   middleware did not bounce you back to it.
3. Read the three `records.astro` states side by side and confirm they read as three different
   things to a person.

## Performance Considerations

None material. The added `clearSessionCookies` runs only on the failure branch of a route that
handles one request per sign-out, and does a handful of string comparisons over the request's cookie
names — nowhere near the Workers Free 10 ms CPU cap. The new integration suite adds network round
trips to `gymlog-test` and joins the CI concurrency group by living in the existing steps; the
render suite is hermetic.

## Migration Notes

No migration. No schema change, no new column, no new policy. `npm run db:push` and
`npm run db:types` are not part of this phase, and `src/db/database.types.ts` is untouched.

## References

- Research: `context/changes/testing-silent-failure-audit/research.md`
- Change identity: `context/changes/testing-silent-failure-audit/change.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risk #5, corrected 2026-08-20), §3, §6
- Prior art for the broken-client Proxy: `tests/integration/workout-mutations-rls.test.ts:376-388`
- Prior art for the render stub tripwire: `tests/render/dashboard-tonnage.test.ts:139-150`
- Prior art for the sign-out harness: `tests/middleware/session-lifecycle.test.ts:160-276`
- Prior art for the correct handling of the same call: `src/pages/api/account/index.ts:58-74`
- `context/foundation/lessons.md` § "The assertion carrying the claim goes FIRST",
  § "An assertion you keep because it cannot fail YET must say so…",
  § "A test whose title claims more than its body asserts becomes the citation",
  § "A guard you have not mutated may not guard"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The sign-out failure path

#### Automated

- [x] 1.1 Assertions 6 and 7 are red against the unfixed `signout.ts`, failing on the data read — d9ba619
- [x] 1.2 The `{ error: null }` positive control is red when `?error=` is appended unconditionally — d9ba619
- [x] 1.3 Assertion 2 still passes unchanged: `npm run test:middleware` — d9ba619
- [x] 1.4 `npm test` passes — `messageForCode("sign_out_failed")` resolves to the new sentence — d9ba619
- [x] 1.5 `npm run lint` and `npm run typecheck` pass — d9ba619
- [x] 1.6 `npm run test:e2e` passes — the critical flow's sign-out step crosses this route — d9ba619

#### Manual

- [x] 1.7 Signing out through the deployed app lands on the sign-in page with no message — d9ba619
- [x] 1.8 With the failure branch forced, the sentence shows and the dashboard needs a fresh sign-in — d9ba619

### Phase 2: `impact_unavailable` on the two untested routes

#### Automated

- [x] 2.1 `npm run test:integration` passes, including the new suite — d767cf5
- [x] 2.2 Each failure assertion is red when its route's catch is mutated to `ok({ impact: [] })` — d767cf5
- [x] 2.3 Each positive control is red when its route is mutated to always throw — d767cf5
- [x] 2.4 The suite passes twice in a row — d767cf5
- [x] 2.5 `npm run lint` and `npm run typecheck` pass — d767cf5

#### Manual

- [x] 2.6 Console output names each attempted failure and the raw response — d767cf5

### Phase 3: Pinning the two deliberate swallows

#### Automated

- [x] 3.1 `npm run test:integration` passes — 626e9e0
- [x] 3.2 The `/api/sets` assertion is red when the verdict catch is mutated to a 500 — 626e9e0
- [x] 3.3 Its positive control is red when the verdict is mutated to always return null — 626e9e0
- [x] 3.4 The `/api/account` assertions are red with the `try`/`catch` and the `if` guard removed in turn — 626e9e0
- [x] 3.5 The suite passes twice in a row and leaves no `t3s-` account behind — 626e9e0
- [x] 3.6 `npm run lint` and `npm run typecheck` pass — 626e9e0

#### Manual

- [x] 3.7 The auth user list holds no `t3s-` address after a full run — 626e9e0

### Phase 4: The four `loadFailed` branches

#### Automated

- [x] 4.1 `npm run test:render` passes with the new suite — a020a7a
- [x] 4.2 Each failure assertion is red when its page's catch stops setting `loadFailed` — a020a7a
- [x] 4.3 Each positive control is red when its page's success branch renders nothing — a020a7a
- [x] 4.4 The stub's unstubbed-table throw fires when a page is given a fifth read — a020a7a
- [x] 4.5 `npm run lint` and `npm run typecheck` pass — a020a7a

#### Manual

- [x] 4.6 `records.astro`'s three states read as three different things to a person — a020a7a

### Phase 5: Write the phase down in `test-plan.md` §6

#### Automated

- [x] 5.1 `npm run lint` passes — 1880fe9
- [x] 5.2 The full eight-step gate passes in order — 1880fe9
- [x] 5.3 The PR's `ci` check is green before merge — 1880fe9

#### Manual

- [x] 5.4 §6's new entries are findable by layer, not by phase — 1880fe9
- [x] 5.5 The three named gaps read as deliberate carries with an assigned owner — 1880fe9
