<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Account Access Implementation Plan

- **Plan**: `context/changes/account-access/plan.md`
- **Scope**: all 5 phases (33/33 Progress items complete)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations
- **Method note**: reviewed inline rather than via the skill's two sub-agents — the owner's standing
  instruction for this session is not to spawn sub-agents unless asked.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Scope Discipline PASS**: the diff touches 19 files and every one is named in the plan, except the
two extra validation modules created by the module split — a deviation approved by the owner and
recorded in `change.md`. Nothing on the "What We're NOT Doing" list was touched: no UI redesign, no
password reset, no rate limiting mechanism, no account deletion, no redirect-back, no E2E, and `/`
is still the starter splash.

**Success Criteria PASS**: all 33 items verified. The five-command gate exits 0; both `git grep`
negative checks return nothing; CI green on `31401654048`.

## Findings

### F1 — Any text in `?error=` renders as an application message

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/auth/signin.astro:5`, `src/pages/auth/signup.astro:5`, `src/components/auth/ServerError.tsx:13`
- **Detail**: Both auth pages render `Astro.url.searchParams.get("error")` with no allow-list. Anyone
  can craft `https://gymlog.10x-astro-starter.workers.dev/auth/signin?error=Account+locked.+Call+500-123-456`
  and the victim sees it styled as a genuine system message inside the real product. React escapes
  the string, so this is **not** XSS — it is content spoofing / phishing.
  The irony is the point: this slice built a fixed set of project-owned messages precisely so the
  product controls what a user is told, and left the delivery channel open to arbitrary text. The
  hole predates S-01 (it came with the starter), but S-01 entrenched the pattern and built the error
  mapping on top of it.
- **Fix**: Carry a **code**, not prose: redirect to `?error=invalid_credentials`, and have the page
  map the code to one of the project-owned strings, falling back to the generic message for anything
  unrecognised. The messages already exist as exported constants in `src/lib/validation/`.
  - Strength: Closes the channel entirely rather than filtering it, and reuses the constants the
    forms and endpoints already share, so there is still one definition per message.
  - Tradeoff: Touches both endpoints, both pages and the message modules — a real edit, not a
    one-liner. Validation messages are per-field and would need codes too, or a second channel.
  - Confidence: HIGH — the mapping infrastructure is already there.
  - Blind spot: Have not checked whether any future slice wants to pass a dynamic message through
    this channel; a code-only channel forecloses that.
- **Decision**: FIXED — `AUTH_MESSAGES` + `messageForCode()` in `src/lib/validation/auth.ts` are now
  the only source of on-screen text; schemas emit codes, `neutralAuthMessage` became
  `neutralAuthCode`, both endpoints redirect with `?error=<code>` and both pages resolve it.
  Verified live: `?error=Account+locked.+Call+500-123-456` renders the generic message and the
  attacker's string appears nowhere in the HTML. Unknown codes and `__proto__` resolve to
  `unexpected`; absent code renders no message at all.

### F2 — The signup branch, called "the heart of this change", has no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/auth/signup.ts:26-40`
- **Detail**: The plan's § Critical Implementation Details calls the three-outcome signup branch
  "the heart of this change and it is one line of logic". Nothing automated covers it. The unit
  suite tests the schemas and the error mapping; the integration suite tests Supabase's behaviour
  (does `signUp` return a session) but never the endpoint that reads it. The branch was verified
  only by scripts run by hand during Phases 2 and 4.
  Concretely: change `if (data.session)` to `if (data.user)` and every one of the 51 tests still
  passes, while every new signup on production would be sent to `/dashboard` with no session — where
  the middleware would bounce them straight back to `/auth/signin`, producing an endless loop no
  pipeline would notice.
- **Fix A ⭐ Recommended**: Extract the redirect decision into a pure function
  (`signupDestination(result): "/dashboard" | "/auth/confirm-email"`) in `src/lib/validation/` or a
  sibling, and cover its three outcomes in the hermetic suite.
  - Strength: Cheap, hermetic, and tests exactly the logic the plan calls load-bearing. Fits the
    convention `AGENTS.md` already states — keep decisions in plain, directly unit-testable functions.
  - Tradeoff: Tests the decision, not the wiring; a broken `context.redirect` call would still slip
    through.
  - Confidence: HIGH — the branch is already a pure function of `{ data, error }`.
  - Blind spot: None significant.
- **Fix B**: Leave it to Faza 3's Playwright work, which will exercise signup through a browser.
  - Strength: Zero work now; an E2E test covers wiring as well as logic.
  - Tradeoff: The gap stays open until Faza 3, and E2E against production cannot test the
    confirmation path anyway (that constraint is already recorded in the plan's Migration Notes).
  - Confidence: MEDIUM — depends on Faza 3 landing.
  - Blind spot: Whether the E2E environment will be able to observe the no-session branch at all,
    since `gymlog-test` has confirmation off.
- **Decision**: FIXED via Fix A — `signUpDestination()` in `src/lib/validation/auth-outcomes.ts`,
  with five assertions covering all three outcomes plus the already-registered case.
  **Mutation-tested, per the project's own lesson that an unmutated guard may not guard**: changing
  `data.session` to `data.user` fails two of them. Before the extraction that same mutation passed
  every test in the repository.

### F3 — Sign-in does not collapse "regardless of cause", and the deviation is unrecorded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/validation/auth-errors.ts:47-66`
- **Detail**: The plan's Phase 1 §3 says "Sign-in failures collapse to a single 'invalid email or
  password' **regardless of cause**". The implementation returns three possible strings for sign-in:
  `SIGN_IN_FAILED_MESSAGE`, `RATE_LIMITED_MESSAGE` (HTTP 429) and `UNEXPECTED_ERROR_MESSAGE`.
  The anti-enumeration property survives — Supabase rate-limits `signInWithPassword` per IP, not per
  address, so neither extra message reveals whether an account exists — and telling a rate-limited
  user "invalid email or password" would be actively misleading. So the code is arguably better than
  the plan. But it **is** a departure from a written contract, and unlike the module split it was
  never recorded, which is the part that matters: the next reader compares code to plan and finds an
  undocumented mismatch.
- **Fix**: Add it to `deviations` in `change.md`, with the reasoning that rate limiting is per IP and
  therefore not an account-existence oracle.
- **Decision**: FIXED — recorded in `change.md` under `deviations`, together with the two post-review
  changes (F1, F2).

### F4 — Auth endpoints build a second Supabase client against the middleware's stated rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/auth/signin.ts:19`, `signup.ts:17`, `signout.ts:5`
- **Detail**: `src/middleware.ts:17-18` carries an explicit instruction: "Hand the client on rather
  than building a second one per page: the cookie plumbing is easy to get subtly wrong, and a
  duplicate construction is waste under the Workers Free 10 ms CPU cap." `dashboard.astro` follows it
  (`Astro.locals.supabase`); the three auth endpoints do not — they call `createClient` again, on a
  request where the middleware has already built one. The pattern came from the starter and the plan
  explicitly preserved the `if (!supabase)` branch in all three, so this is not S-01 drift — but S-01
  rewrote these three files and walked past it.
- **Fix**: `const supabase = context.locals.supabase;` in place of the `createClient(...)` call. The
  `if (!supabase)` branch stays exactly as it is — `locals.supabase` is null in the same conditions.
- **Decision**: FIXED — all three endpoints now read `context.locals.supabase`; `createClient` is no
  longer imported by any of them. Verified live: validation, provider failure and sign-out all still
  behave as before, and a provider-level failure still reaches Supabase.

### F5 — No upper bound on field length

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/validation/auth-schemas.ts:19-33`
- **Detail**: The schemas carry `.min()` but no `.max()`. A megabyte-long password is validated and
  handed to Supabase. Real exposure is low — Cloudflare caps request size and Supabase applies its
  own limits — but a module whose job is "validate every input" leaves the top end to somebody else.
  Worth noting specifically: bcrypt truncates at 72 bytes, so a password longer than that is silently
  shortened rather than rejected.
- **Fix**: `.max(254)` on email (RFC 5321) and `.max(72)` on the signup password, with a message
  matching the existing style. Leave `signInSchema's password unbounded so accounts created under
  any earlier rule can still sign in.
- **Decision**: FIXED — `MAX_EMAIL_LENGTH` and `MAX_PASSWORD_LENGTH` in `auth.ts`, four new
  assertions covering both bounds, the exact-maximum case, and that sign-in stays unbounded.
