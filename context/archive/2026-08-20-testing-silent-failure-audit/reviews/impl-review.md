<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Silent-Failure Audit (Rollout Phase 3)

- **Plan**: `context/changes/testing-silent-failure-audit/plan.md`
- **Scope**: All five phases (27 of 27 Progress rows closed)
- **Date**: 2026-08-20
- **Verdict**: NEEDS ATTENTION → all six triaged 2026-08-20 (4 fixed, 1 skipped, 1 rule + plan fix)
- **Findings**: 0 critical, 4 warnings, 2 observations

> **Limitation, stated up front.** This review was performed by the same session that wrote the
> implementation, without independent sub-agents. It is therefore weaker than a fresh review at
> exactly the place it matters most — blind spots in reasoning are shared between author and
> reviewer. Findings F1–F3 are code-level and evidence-backed; F4–F6 are plan-level and were found
> by re-reading the plan against what was actually measured.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

**Scope Discipline — PASS.** Every changed file appears in the plan's Changes Required. Nothing in
the "What We're NOT Doing" list was touched: no deliberate swallow was reversed, the two class-E
fallbacks are untested and named, `records.astro`'s behaviour is unchanged, the two refusals in
`account-deletion.test.ts` are intact, and no browser test was added.

**Success Criteria — PASS.** The full eight-step gate passed locally at `1880fe9` and the `ci` check
passed on PR #6 in 5m53s at `563734d`. Re-verified during this review: lint clean, 249 unit, 43
render. The only commit since CI's green run (`71e8f2d`) touches markdown alone.

## Findings

### F1 — `clearSessionCookies` can throw on the one path that must not throw

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/supabase.ts:38` (`new URL(SUPABASE_URL)`), reached from `src/pages/api/auth/signout.ts:47`
- **Detail**: `storageKey()` calls `new URL(SUPABASE_URL)` unguarded. `astro.config.mjs:19` declares
  the variable as `envField.string({ optional: true })` — **no URL validation** — so a malformed
  value passes the env schema and `new URL` raises `TypeError: Invalid URL`. The call site sits in
  the `if (failure)` branch of `signout.ts`, **outside** the `try` that wraps `signOut()`. The throw
  therefore escapes the handler, Astro answers a generic HTML 500 to a form POST, and the browser
  shows an error page instead of a sign-in screen — **the exact user-visible outcome assertion 7 was
  written to eliminate**, reached through a different door. Likelihood is low (a malformed URL
  breaks other things too), but the failure mode is the phase's own subject.
- **Fix**: Wrap `storageKey()`'s body in a `try`/`catch` returning `null`, matching the module's
  existing "return null when degraded" contract that `createClient` already follows.
  - Strength: Keeps `signout.ts` unchanged, keeps the degraded-path contract in one module, and is
    three lines.
  - Tradeoff: Silently answers `[]` for a misconfiguration — acceptable, because the redirect still
    happens and `createClient` already returns `null` under the same class of failure.
  - Confidence: HIGH — the null-on-absent-credentials pattern is documented in `AGENTS.md` §
    Cloudflare traps and already implemented two functions above.
  - Blind spot: Not verified whether `createServerClient` would itself have thrown earlier in the
    middleware for the same input, which would make this unreachable in practice.
- **Decision**: FIXED — storageKey() now returns null on an invalid URL

### F2 — the result of `clearSessionCookies` is discarded, and the log overstates what happened

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/auth/signout.ts:47-49`
- **Detail**: `clearSessionCookies` returns `string[]` — the names it cleared — specifically so a
  caller can tell what happened. **Nothing consumes it**: `grep` over `src/` and `tests/` finds the
  one call site discarding it and no assertion reading it. The line immediately below then logs
  _"the provider refused; cleared this device's session instead"_, which is a claim the code has not
  checked: the function answers `[]` when credentials are absent **and** when the request carried no
  matching cookie, and in both cases the sentence is false. This is a diagnostic, so no user is
  misled — but it is **the same shape as the defect this phase exists to fix**: a function whose
  return value reports the outcome, called for its side effect with the outcome dropped.
- **Fix**: Assign the result and include it in the log — `const cleared = clearSessionCookies(…)`,
  then log `{ cleared, error: failure }`.
  - Strength: Makes the log true, gives the returned value a consumer, and turns "did the clear
    actually find anything" into something a Worker log can answer.
  - Tradeoff: None material.
  - Confidence: HIGH — one line, no behaviour change.
  - Blind spot: Does not add a test; nothing would notice the log regressing again. That is the
    same class as the `if (signOut.error)` guard already named in `test-plan.md` §6.6.
- **Decision**: FIXED — the result is assigned and logged as `cleared`

### F3 — cookie options are now written in two places, and the test cannot see them diverge

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/supabase.ts:12-26` (`createServerClient`, no `cookieOptions`) vs `:76` (the hardcoded clear)
- **Detail**: `clearSessionCookies` writes `{ path: "/", sameSite: "lax", httpOnly: false, maxAge: 0 }`,
  copied from `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS` (read from the installed source, correctly).
  `createClient` passes **no** `cookieOptions`, so the library supplies those same defaults for
  writes. The two agree today **by coincidence of both matching the library default**, not by
  construction. The day somebody passes `cookieOptions` to `createServerClient` — a plausible edit,
  e.g. `httpOnly: true` or a shorter `maxAge` — the clear diverges, the browser keeps the cookie,
  and **the middleware suite still passes**, because `applyCookieWrites` models `value`/`maxAge` and
  **no `path` or `sameSite` at all**. This is the repository's own "two implementations that must
  agree" hazard (`AGENTS.md` names three others), and it is currently the weakest of them: the two
  copies are in one file, but nothing fails when they drift.
- **Fix A ⭐ Recommended**: Extract the options once in `src/lib/supabase.ts` and pass the same object
  to both `createServerClient`'s `cookieOptions` and the clear, so the two cannot drift.
  - Strength: Makes the agreement structural rather than coincidental, which is what this repository
    does everywhere else it has this hazard.
  - Tradeoff: Passing `cookieOptions` explicitly changes nothing today but does opt out of future
    `@supabase/ssr` default changes — which cuts both ways and should be a conscious choice.
  - Confidence: MEDIUM — the mechanism is clear; whether pinning the library's defaults is desirable
    is a product-lifetime judgement not verified here.
  - Blind spot: Not checked whether any `@supabase/ssr` code path writes cookies with options this
    module never sees.
- **Fix B**: Leave the code and record the hazard where the rule lives — a comment in
  `src/lib/supabase.ts` plus a line in `test-plan.md` §6.7 naming the future edit that breaks it.
  - Strength: Zero risk to working code; matches the treatment already given to the
    `if (signOut.error)` guard, which was named rather than covered.
  - Tradeoff: Prose enforces nothing; the next author meets it only if they read the file.
  - Confidence: HIGH — the precedent exists in this very change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — SESSION_COOKIE_OPTIONS, one object for both sides; mutation-confirmed (path `/wrong` reddens assertion 6)

### F4 — criterion 3.4 is ticked with a claim the measurement disproved

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-silent-failure-audit/plan.md` — Phase 3 Success Criteria, and its Progress row 3.4
- **Detail**: The criterion reads _"The `/api/account` assertions are red with the `try`/`catch` and
  the `if` guard removed in turn"_. Measurement showed the second half is false: **deleting the
  `if (signOut.error)` guard leaves all ten assertions green**, because it is diagnostic-only. The
  correction was recorded in three durable places — the test comment, the p3 commit message, and
  `test-plan.md` §6.6 — but **the plan itself still carries the original wording with a `[x]` beside
  it**. A reader who opens only the plan gets a claim about coverage that does not exist, which is
  `lessons.md` § "A test whose title claims more than its body asserts becomes the citation" applied
  to a success criterion.
- **Fix**: Rewrite criterion 3.4 and its Progress row to name the mutation that actually bites —
  turning the guard into `fail(500, …)` — and add one line recording that deleting it breaks
  nothing.
  - Strength: The plan is the artefact `/10x-archive` preserves; it should not be the only document
    still carrying the disproved version.
  - Tradeoff: Edits a Success Criteria block after the fact, which the implement workflow treats as
    read-only — appropriate here because a review is exactly when the plan gets corrected.
  - Confidence: HIGH — the measurement is recorded and reproducible.
  - Blind spot: None significant.
- **Decision**: FIXED — criterion 3.4 and its Progress row now name the mutation that bites

### F5 — Phase 1's assertions went into a new `describe` against the written contract

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `tests/middleware/session-lifecycle.test.ts:379` (`describe("a sign-out the provider refuses")`)
- **Detail**: The plan's Phase 1 change #5 specified _"Two new `it(...)` blocks in the existing
  `"the three cookie states"` describe"_. The implementation created a new `describe` instead,
  because "the three cookie states" describes cookie states and these assertions describe a provider
  failure. The deviation was announced when made and the reasoning is sound — filing them under that
  title would be the inverse of `lessons.md` § "A test whose title claims more than its body
  asserts". Recorded because it is drift from a written contract, not because it should be reverted.
- **Fix**: None. Keep the new `describe`; the plan's contract was the weaker of the two.
- **Decision**: SKIPPED — the new describe stands; the plan contract was the weaker of the two

### F6 — criterion 1.4 demanded a unit test without naming the module that would hold it

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-silent-failure-audit/plan.md` — Phase 1 Changes Required vs criterion 1.4
- **Detail**: Criterion 1.4 requires that `messageForCode("sign_out_failed")` resolve to the new
  sentence, and § Testing Strategy repeats it — but Phase 1's Changes Required names only
  `src/lib/validation/auth.ts`, never `src/lib/validation/auth.test.ts`. That file was modified
  during implementation and appears in the diff but in no plan section. This is precisely
  `lessons.md` § "A criterion that demands a unit test must name the module that will hold it", a
  rule this repository recorded after S-03 hit it. The location was obvious here so nothing went
  wrong; the plan was still written in the shape the lesson warns about.
- **Fix**: None to the code. Worth noting when writing Phase 4 and 5 plans of the test rollout.
- **Decision**: ACCEPTED-AS-RULE: A criterion that demands a unit test must name the module that will hold it (recurrence appended) + FIXED in the plan
