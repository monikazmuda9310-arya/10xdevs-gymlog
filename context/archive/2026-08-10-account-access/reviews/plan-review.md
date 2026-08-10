<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Account Access

- **Plan**: `context/changes/account-access/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-10
- **Verdict**: REVISE → all six findings fixed 2026-08-10
- **Findings**: 0 critical, 4 warnings, 2 observations

> **Reviewer caveat**: this plan was written in the same session that reviewed it, so the review
> carries an author's bias. Every finding below is therefore anchored to a mechanical check that was
> actually run — a grep, a path listing, or a query against the production database — rather than to
> judgement alone.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | WARNING |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

8/8 modified paths exist ✓ · 3/3 new files correctly absent ✓ · Progress↔Phase 33/33 matched per
phase, no checkboxes outside `## Progress` ✓ · brief↔plan consistent (5 phases, 8 decisions) ✓

## Findings

### F1 — The shared schema puts zod in the browser bundle, and the plan never prices it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 §5 "The forms read the shared schema"
- **Detail**: Both forms are hydrated islands — `signin.astro:16` and `signup.astro:16` carry
  `client:load`. Anything they import ships to the browser, so importing the zod schemas sends zod
  itself. The plan justifies sharing as drift prevention, but what can actually drift is a **number**
  (`MIN_PASSWORD_LENGTH`) and an email pattern — not the parser. The cost was never stated, and the
  product is explicitly optimised for a 2 s p95 on mobile (PRD § NFR).
- **Fix A ⭐ Recommended**: Share the constants and a plain predicate; keep zod server-side only. The
  forms import `MIN_PASSWORD_LENGTH` and a pure `isValidEmail`, both defined next to the schemas.
  - Strength: kills the drift the plan actually worried about — one definition of the number and the
    pattern — at zero bundle cost. Matches `AGENTS.md`, which mandates zod for **API routes**, not
    for React components.
  - Tradeoff: the client and server validators are structurally different code, so a _third_ rule
    added later could still be added to one and not the other.
  - Confidence: HIGH — the constants are the only values both sides genuinely need.
  - Blind spot: none significant.
- **Fix B**: Import the full schemas in the forms and accept the bundle cost.
  - Strength: literally one rule set; the client cannot disagree with the server about anything.
  - Tradeoff: zod lands in the client bundle of the two most-visited unauthenticated pages.
  - Confidence: MEDIUM — the exact cost depends on the zod version resolved and on tree-shaking.
  - Blind spot: not measured; would need a build-size comparison to state a number.
- **Decision**: FIXED via Fix A — forms share MIN_PASSWORD_LENGTH and isValidEmail; zod stays server-side

### F2 — "Already registered" is not an error once confirmation is on, and the plan reads as if it is

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3 and §4; Decision 3
- **Detail**: With email confirmation **enabled**, Supabase deliberately does not report that an
  address is taken — `signUp` returns an obfuscated user and **no session**, no error. Under the
  plan's own branch that is "no session → `/auth/confirm-email`", which is the correct and desirable
  outcome. But the plan never says so, and it describes signup failure as the path where the neutral
  mapping protects against enumeration. Two consequences: an implementer may read the
  no-error-no-session case as a bug and "fix" it, and Decision 3's rationale is partly misattributed
  — in production the anti-enumeration property comes from Supabase, while the mapping is what stops
  the **test** project (confirmation off, which does return `"User already registered"`) from
  behaving visibly differently.
- **Fix**: State the three-way outcome explicitly in Phase 1 §4 — session → `/dashboard`, no session
  and no error → `/auth/confirm-email` (this is the already-registered case as well as the genuine
  new-signup case, and that ambiguity is the point), error → back to the form with a neutral message.
  Correct Decision 3's rationale to name Supabase as the source of the production guarantee.
  - Strength: removes the single most likely misreading of the plan, in the phase where it would do
    the most damage.
  - Tradeoff: none — it is a clarification, not a design change.
  - Confidence: HIGH — this is documented Supabase behaviour and the plan's branch already handles it.
  - Blind spot: not observable on `gymlog-test` today, because confirmation is off there.
- **Decision**: FIXED — Phase 1 §4 now states the three-way signUp outcome; Decision 3 rationale corrected

### F3 — Success criterion 5.2 can never pass as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5, Automated Verification; Progress 5.2
- **Detail**: The criterion is `git grep -n "scaffold only" -- context/foundation/roadmap.md` returns
  nothing. Run today it returns **two** lines — `roadmap.md:87` (the Backend/API bullet) and
  `roadmap.md:89` (the Auth bullet). Phase 5 only rewrites the second, so the grep will still match
  the first and the criterion fails on a correctly completed phase. A gate that cannot go green is
  worse than no gate: it trains the implementer to ignore it.
- **Fix**: Scope the criterion to the Auth bullet — e.g. assert that the line containing `**Auth:**`
  no longer contains `scaffold only`, rather than grepping the whole file.
- **Decision**: FIXED — criterion 5.2 scoped to the Auth line, with the file-wide grep explicitly warned against

### F4 — Criterion 1.5 is filed as automated but ships no command

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Automated Verification; Progress 1.5
- **Detail**: "A fieldless POST is rejected as a validation error, not a 500" says to post against
  `astro dev` but gives no command, and every other automated criterion in this plan is a runnable
  one-liner. It also silently depends on two F-03 traps — the body must be
  `application/x-www-form-urlencoded` and the request must carry an `Origin` header matching the host,
  or Astro returns 403 and the check appears to pass for the wrong reason.
- **Fix**: Spell out the check — start `astro dev` in the background, `node -e` a `fetch` with
  `Origin` set and an empty `URLSearchParams` body, assert a 302 whose `location` contains
  `/auth/signin?error=`. Name the 403 trap inline so a wrong result is diagnosable.
- **Decision**: FIXED — criterion 1.5 now carries a runnable command and names the 403/500 failure signatures

### F5 — Whether Phase 4 locks out the four existing accounts was never asked

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4
- **Detail**: The plan turns on email confirmation for production without stating what happens to the
  accounts already there. **Verified during this review**: all four throwaway accounts carry a
  non-null `email_confirmed_at`, because Supabase stamps it at signup time when confirmation is off.
  So none of them is locked out and there is no migration to write — but that was luck rather than
  design, and the next person to enable a setting like this deserves the check written down.
- **Fix**: Record the verified fact in Phase 4 and in Migration Notes: existing accounts are already
  confirmed and keep working; only accounts created after the switch require a link.
- **Decision**: FIXED — verified fact recorded in Phase 4 and Migration Notes

### F6 — The rationale for excluding `/auth/confirm-email` from the guard is speculative

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: The plan says a user who just signed up "may hold a session in some configurations",
  which is hedging, not reasoning. The actual situation is knowable: with confirmation **on** the
  signup returns no session, so such a user is not signed in and the guard would never fire on them
  anyway; excluding the route costs nothing and keeps the page reachable if that ever changes. A
  reason an implementer can verify beats a reason they have to trust.
- **Fix**: Replace the hedge with the concrete statement above.
- **Decision**: FIXED — hedge replaced with the checkable reason

## Not findings, recorded so they are not re-raised

- **Progress section is well-formed** — 33 items, one `### Phase N` per `## Phase N`, counts match
  per phase, no stray checkboxes in phase bodies.
- **The 6→8 password bump is safe** — sign-in validates only that a password is non-empty, so the
  four existing accounts and the 40-character `GYMLOG_TEST_PASSWORD` fixtures keep working.
- **Phase ordering is right.** Turning confirmation on last, after everything cheap has been verified,
  is what keeps the two-emails-per-hour limit from gating phases 1–3.
- **`gymlog-test` is correctly ring-fenced** — Phase 3's "signup still returns a session" assertion is
  the tripwire for Phase 4 being applied to the wrong project.
