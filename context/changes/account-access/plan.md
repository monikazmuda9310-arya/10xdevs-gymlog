# Account Access Implementation Plan

> Roadmap item: **S-01** (`context/foundation/roadmap.md` § Slices)
> Change identity: `context/changes/account-access/change.md`

## Overview

Make the starter's authentication true and airtight. A visitor can create an account, sign in, sign
out, and is sent to sign-in when they are not signed in — which the product almost does already.
What it does not do is validate anything on the server, keep one account's existence secret from
another, land the user anywhere useful, or tell the truth about whether a confirmation email is
coming.

This is the first user-visible slice. Everything before it was foundation: F-01 gave the pipeline
teeth, F-02 gave a public address, F-03 gave a schema whose rows belong to accounts. **The auth
wiring itself already works** — F-03 proved it end to end against the deployed URL — so this slice
is mostly about correcting and hardening what exists, not building it.

## Current State Analysis

Measured against the working tree on 2026-08-10, not recalled.

### What already works

- `src/lib/supabase.ts` — SSR client via `@supabase/ssr`, cookie sessions, returns `null` when
  credentials are absent. `src/middleware.ts` resolves `locals.user` and `locals.supabase` on every
  request and redirects unauthenticated requests away from `PROTECTED_ROUTES`.
- Three endpoints (`src/pages/api/auth/{signin,signup,signout}.ts`), three pages
  (`src/pages/auth/{signin,signup,confirm-email}.astro`), six React components under
  `src/components/auth/`. The whole surface is **207 lines** — small enough to correct in place.
- Signup → dashboard → signout → dashboard-redirect → signin → dashboard was verified against
  `https://gymlog.10x-astro-starter.workers.dev` during F-03, twice, with cookie carry-over.

### What is wrong, with evidence

| #   | Defect                                                                                                                                                                                                                                                                          | Evidence                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | **No server-side validation at all.** Both endpoints do `form.get("email") as string` — a cast that lies, because `FormData.get()` returns `null` for an absent field. A request without the fields reaches Supabase as `null`.                                                 | `signin.ts:6-7`, `signup.ts:6-7`        |
| 2   | **`zod` is not installed**, though `AGENTS.md` § Conventions requires validating every API input with it. Neither `dependencies` nor `devDependencies` carries it.                                                                                                              | `package.json`                          |
| 3   | **Provider error text goes straight into the URL and onto the screen.** `"User already registered"` tells an attacker which addresses have accounts.                                                                                                                            | `signin.ts:16`, `signup.ts:16`          |
| 4   | **Sign-in lands on `/`**, the starter's `Welcome` splash — the user gets no sign that anything happened.                                                                                                                                                                        | `signin.ts:19`, `index.astro`           |
| 5   | **Signup always redirects to `/auth/confirm-email`**, and that page decides what to say from `import.meta.env.DEV` — i.e. from _build mode_, not from whether confirmation is actually required. In production it tells every new user to check an inbox that receives nothing. | `signup.ts:19`, `confirm-email.astro:4` |
| 6   | **A signed-in user can still open `/auth/signin`** and see the form. `PROTECTED_ROUTES` guards one direction only.                                                                                                                                                              | `middleware.ts:4,18-22`                 |
| 7   | **Client and server disagree about passwords, and only the client has an opinion.** `MIN_PASSWORD_LENGTH = 6` lives in `SignUpForm.tsx`; the server enforces nothing, and Supabase's own floor is 6.                                                                            | `SignUpForm.tsx:8`                      |
| 8   | **`confirmPassword` is checked in the browser only.** A scripted POST bypasses it entirely.                                                                                                                                                                                     | `SignUpForm.tsx:38-40`                  |

### Constraints inherited from F-03

- **Endpoints read `formData()`, not JSON.** A JSON probe returns 500 from failed parsing, which
  looks identical to "Supabase is not configured" and is not that.
- **Astro's `security.checkOrigin` rejects a POST with 403** unless `Origin` matches the host. A
  browser form does this itself; any scripted call must set it.
- **Email confirmation is currently off on both Supabase projects**, so `signUp` returns a usable
  session immediately. Phase 4 changes that for production only.
- The integration suite (`tests/integration/profiles-rls.test.ts`) signs its two fixture accounts in
  against **`gymlog-test`** and depends on `signUp` returning a session there. That project's
  setting must not change.

## Desired End State

- Both endpoints validate with a zod schema before touching Supabase, and reject malformed input
  with a message the user can act on — never a stack trace, never a 500.
- **One definition per rule.** "A password is at least 8 characters" and "this is what an email looks
  like" each exist once, in `src/lib/validation/auth.ts`; the endpoints consume them through zod
  schemas and the React forms consume them directly, so the two sides cannot drift. zod itself stays
  server-side — the forms are hydrated islands and importing it there would ship a parser to the
  browser.
- Neither endpoint reveals whether an email address has an account. The error a caller sees is one
  of a small, fixed set written by this project, not the provider's prose.
- Signing in or signing up lands on `/dashboard`; signing out lands on `/auth/signin`.
- **The post-signup page is shown only when a confirmation email is genuinely coming**, because the
  endpoint branches on whether `signUp` returned a session — the actual outcome, not a build-time
  guess. `confirm-email.astro` loses its `import.meta.env.DEV` branch entirely.
- A signed-in visitor asking for `/auth/signin` or `/auth/signup` is sent to `/dashboard`.
- **Email confirmation is on for `gymlog` and off for `gymlog-test`** — real accounts are protected,
  and the checks that must create accounts still can.
- `npm test` covers the schemas; `npm run test:integration` covers signup and sign-in against
  `gymlog-test`, including the ways they are supposed to fail.

Verify: the five-command gate exits 0; a fresh signup at the deployed URL requires a confirmation
link and lands on `/dashboard` once clicked; a scripted POST with no fields gets a validation error
rather than a 500; and a signed-out request for `/dashboard` still redirects.

## What We're NOT Doing

- **Redesigning the auth UI.** The starter's components stay. This slice changes the server, the
  redirects and one page's logic. (Decision 1.)
- **Password reset, magic links, OAuth providers, "remember me".** None is in FR-001..003, and each
  is its own slice.
- **Rate limiting or CAPTCHA.** Supabase applies its own limits; anything more is premature for a
  single-account product and would need infrastructure this plan does not touch.
- **Account deletion** — S-09.
- **Redirect-back-to-requested-page after sign-in.** Considered and rejected in questioning: the
  return parameter is a classic open-redirect if unvalidated, and the only protected route today is
  `/dashboard`, which is where sign-in already lands.
- **Playwright / E2E** — Faza 3 of the course. This plan adds unit and integration coverage only,
  and records the constraint E2E will inherit (see Migration Notes).
- **Deciding what `/` is.** It stays the starter's `Welcome` splash. Turning it into a landing page
  or a redirect is a product decision nobody has made.
- **Touching `gymlog-test`'s auth settings.** Changing them breaks the F-03 check and every future
  browser test.

## Implementation Approach

Five phases, ordered so that the change with an irreversible-ish operational consequence — turning
on email confirmation, after which every signup test needs a real inbox — happens **last**, once
everything else has been verified the cheap way.

1. **Harden the endpoints**: schema, neutral errors, redirect targets, and the signup branch.
2. **Protect the routes in both directions.**
3. **Cover it automatically**: unit tests for the schema, integration tests for the two flows.
4. **Turn confirmation on for production**, deploy, verify on the live URL.
5. **Truth up the documents.**

### Critical Implementation Details

**The signup branch is the heart of this change and it is one line of logic.** `supabase.auth.signUp`
returns `{ data: { user, session }, error }`. With confirmation **off**, `session` is present and the
account is immediately usable. With confirmation **on**, `user` is present and `session` is `null`.
Branching on `data.session` therefore reads the real outcome, and keeps reading it correctly if
somebody changes the dashboard setting later without redeploying. Do not reintroduce a config flag,
an env var, or a build-mode check for this — all three can disagree with the database.

**Neutral errors must not be neutral about everything.** A validation failure the _user_ caused
("password is too short") must stay specific, or the form becomes unusable. Only the provider's
_identity_ errors get flattened — wrong credentials, address already taken. Getting this backwards
produces a login screen that says "something went wrong" when the user typed six characters.

## Phase 1: Harden the auth endpoints

### Overview

Everything a request touches before Supabase sees it, plus what the caller is told afterwards and
where they are sent.

### Changes Required:

#### 1. The dependency

**File**: `package.json`

**Intent**: `AGENTS.md` mandates zod for API input validation and the package is absent. Install it
as a runtime dependency — it is imported by server code that ships to the Worker.

**Contract**: `zod` in `dependencies`. No other dependency is added by this slice.

#### 2. The shared credential schema

**File**: `src/lib/validation/auth.ts` (new)

**Intent**: One definition of what a valid email and password are, imported by both the endpoints and
the React forms, so the browser and the server cannot disagree. Today `MIN_PASSWORD_LENGTH` lives in
`SignUpForm.tsx` and the server has no opinion at all.

**Contract**: export `MIN_PASSWORD_LENGTH = 8`; a `signInSchema` (email, password non-empty) and a
`signUpSchema` (email, password ≥ `MIN_PASSWORD_LENGTH`, `confirmPassword` matching) built with zod;
and a helper that turns `FormData` into a parse result. Messages are user-facing English and are the
same strings the forms display. This module must stay free of `astro:*` imports so the unit suite can
import it (`AGENTS.md` § Testing).

The bump from 6 to 8 is deliberate (Decision 7) and applies to new accounts only — Supabase does not
re-validate existing ones, and no real accounts exist yet.

#### 3. Neutral error mapping

**File**: `src/lib/validation/auth.ts` (same module) or a sibling — implementer's call

**Intent**: Stop the provider's prose reaching the screen. `"User already registered"` is an oracle
for whether an address has an account, and US-04's whole point is that one account learns nothing
about another.

**Contract**: a function mapping a Supabase `AuthError` to one of a small fixed set of project-owned
messages. Sign-in failures collapse to a single "invalid email or password" regardless of cause;
signup collapses to a message that does not distinguish "taken" from "created". Validation errors
raised by the schema are **not** routed through this function — they stay specific (see § Critical
Implementation Details). Anything unrecognised falls back to a generic message and is logged
server-side, so a genuinely new provider error is diagnosable without being displayed.

#### 4. The endpoints

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: Validate, then act, then redirect somewhere useful.

**Contract**:

- Both POST handlers parse `formData()` through the schema first and, on failure, redirect back to
  their own page with the first validation message. Keep `formData()` — the forms post
  `application/x-www-form-urlencoded` and changing that breaks them.
- `signin.ts`: on success redirect to `/dashboard` (was `/`); on failure use the neutral mapping.
- `signup.ts`: **three outcomes, not two.** `signUp` resolves one of:
  1. **session present** → the account is immediately usable → `/dashboard`;
  2. **no session, no error** → a confirmation email is on its way → `/auth/confirm-email`. **This is
     also what an already-registered address produces once confirmation is on** — Supabase
     deliberately refuses to say the address is taken, and returns an obfuscated user with no
     session. Sending both cases to the same page is not a bug to be fixed later; it _is_ the
     anti-enumeration property, and it comes from the provider rather than from our error mapping;
  3. **error** → back to `/auth/signup` with a neutral message. On `gymlog-test`, where confirmation
     stays off, an already-registered address lands here instead (Supabase returns
     `"User already registered"`), which is exactly what the mapping exists to flatten so the two
     environments do not visibly differ.
- `signout.ts`: redirect to `/auth/signin` (was `/`), so returning requires authenticating again —
  US-04's third acceptance criterion.
- The `if (!supabase)` branch stays in all three. It is the documented missing-credentials behaviour
  (`AGENTS.md` § Cloudflare traps) and must not be "fixed" into a throw.

#### 5. The forms read the shared rules — the constants, not the parser

**Files**: `src/components/auth/SignUpForm.tsx`, `src/components/auth/SignInForm.tsx`

**Intent**: Remove the second, hand-written copy of the rules **without shipping zod to the browser**.

**Contract**: both forms import `MIN_PASSWORD_LENGTH` and a pure `isValidEmail(value: string)`
predicate from `@/lib/validation/auth`, and use them in place of their inline length check and inline
regex. They do **not** import the zod schemas. The rendered markup, the character-countdown hint and
the submit behaviour are unchanged — this is a swap of the rule source, not a UI change.

**Why not the schemas themselves**: `signin.astro:16` and `signup.astro:16` hydrate these components
with `client:load`, so anything they import is bundled for the browser — on the two most-visited
unauthenticated pages, against a PRD non-functional requirement of a 2 s p95 on mobile. What can
actually drift between client and server is the minimum length and the email pattern; both are
shared. The parser stays on the server, which is also what `AGENTS.md` asks for — it mandates zod for
**API routes**, not for React components. The schemas must therefore be built _from_ these two
exports, so there is still exactly one definition of each rule.

#### 6. The post-signup page tells the truth

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: The page is now reached **only** when a confirmation email is genuinely on its way, so
its two-branch content is dead weight and its condition is wrong anyway.

**Contract**: delete the `import.meta.env.DEV` branch and the `isAutoConfirmed` variable; keep the
"check your email" content unconditionally. The layout and the link back to sign-in stay.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- `zod` is a runtime dependency: `node -e "require('./package.json').dependencies.zod"` prints a
  version.
- No provider prose reaches a redirect: `git grep -n "error.message" -- src/pages/api/auth/` returns
  nothing (this command exits 1 on success — run it alone, never `&&`-chained).
- The rules exist once: `git grep -n "MIN_PASSWORD_LENGTH" -- src/` shows the definition in
  `src/lib/validation/auth.ts` and only imports elsewhere.
- A fieldless POST is rejected as a validation error, not a 500. Start `npm run dev` in the
  background, then:

  ```bash
  node -e "const b='http://localhost:4321';fetch(b+'/api/auth/signin',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',Origin:b},body:new URLSearchParams(),redirect:'manual'}).then(r=>console.log(r.status,r.headers.get('location')))"
  ```

  Expect `302 /auth/signin?error=…`. **A 403 means the `Origin` header is missing or does not match
  the host** — Astro's `security.checkOrigin` rejecting the request, not the validation working.
  A 500 means the endpoint still reaches Supabase with `null`.

#### Manual Verification:

- Signing in with a wrong password and signing in with an address that has no account produce the
  **same** message.
- Signing up with a mismatched confirmation, and with a 7-character password, each produce a
  specific, actionable message — not the neutral one.
- Signing in lands on `/dashboard` with the timezone value visible; signing out lands on
  `/auth/signin`.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Protect the routes in both directions

### Overview

`PROTECTED_ROUTES` keeps signed-out visitors out of the application. Nothing keeps signed-in
visitors out of the sign-in form, which is how a user ends up staring at a login screen while already
logged in.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts`

**Intent**: Make the redirect symmetric, and put the rule in one place rather than in per-page
checks — `AGENTS.md` § Auth wiring is explicit that new protected routes go here.

**Contract**: keep `PROTECTED_ROUTES` and its existing behaviour; add a second list of
**auth-only routes** (`/auth/signin`, `/auth/signup`) from which a request carrying a user is
redirected to `/dashboard`. `/auth/confirm-email` is deliberately **not** in that list, and the
reason is checkable rather than precautionary: with confirmation on, `signUp` returns **no session**,
so a user who has just signed up is not authenticated and the guard would never fire on them anyway.
Excluding the route therefore costs nothing today and keeps the page reachable if that ever changes —
bouncing someone off the page that explains what to do next would be actively unhelpful. No other
behaviour changes; the client is still assigned to `locals` exactly as F-03 left it.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.
- Both lists are declared in `src/middleware.ts`: `git grep -n "PROTECTED_ROUTES\|AUTH_ROUTES" -- src/middleware.ts`
  returns both.

#### Manual Verification:

- Signed out: `/dashboard` → 302 `/auth/signin`.
- Signed in: `/auth/signin` and `/auth/signup` → 302 `/dashboard`.
- Signed in: `/auth/confirm-email` still renders.
- Signed out: `/` and `/auth/*` render normally — the guard has not swallowed the public surface.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Cover it automatically

### Overview

Two levels, matching what each can actually observe. The schema is a pure function, so it belongs in
the hermetic suite. Whether a signup produces a session, and whether a wrong password is rejected,
can only be answered by a real auth server — so that goes in the integration suite, against
`gymlog-test`.

### Changes Required:

#### 1. Schema unit tests

**File**: `src/lib/validation/auth.test.ts` (new)

**Intent**: The rules that decide whether input is acceptable are exactly the kind of boundary
`AGENTS.md` § Testing says to cover explicitly.

**Contract**: cover the boundaries rather than the happy path only — empty email, malformed email,
password at `MIN_PASSWORD_LENGTH - 1`, at exactly `MIN_PASSWORD_LENGTH`, mismatched confirmation, and
`FormData` with the fields absent entirely (the `null` case defect 1 was hiding). Import through the
`@/` alias; import `describe` / `it` / `expect` from `"vitest"` — globals are off on purpose.

#### 2. Auth flow integration tests

**File**: `tests/integration/auth-flows.test.ts` (new)

**Intent**: Prove the two flows against a real auth server, including the ways they must fail. This
is also what will catch the Phase 4 setting being applied to the wrong project.

**Contract**: same shape as `profiles-rls.test.ts` — `createClient<Database>` against
`SUPABASE_TEST_URL` / `SUPABASE_TEST_KEY`, publishable key only, no production credential, throw in
`beforeAll` if a variable is missing rather than skipping. Assertions:

- A **fresh** account (unique email per run, timestamp-suffixed, prefixed `s01-` so S-09 can find it)
  signs up and **receives a session** — which is what proves confirmation is still off on
  `gymlog-test`, and therefore that Phase 4 did not touch the wrong project.
- The same signup creates exactly one `profiles` row for that account — the F-03 trigger, exercised
  through the flow this slice owns.
- Signing in with the right password returns a session whose user id matches.
- Signing in with a **wrong** password returns an error and **no** session.
- Signing in as an address with no account returns an error and no session — asserted to be
  indistinguishable from the wrong-password case at the level the caller sees.

Accounts created here accumulate in `gymlog-test`; that project holds no real data and S-09 cleans it
up. Do not reuse the `rls-owner-a/b` fixtures — those are shared with the RLS suite and a signup test
must own its account.

#### 3. Script and pipeline

**Files**: none

**Intent**: Nothing to wire. `vitest.integration.config.ts` globs `tests/integration/**/*.test.ts`,
so the new file is picked up, and CI already runs `npm run test:integration` between `npm test` and
`npm run build`.

**Contract**: confirm rather than change — the count in the criteria below is what proves it.

### Success Criteria:

#### Automated Verification:

- `npm test` includes the new schema tests and stays offline: the run names `auth.test.ts` and exits 0.
- `npm run test:integration` exits 0 and reports **both** files, with the new assertions passing.
- The new suite cannot reach production:
  `git grep -nE "SUPABASE_URL|SUPABASE_KEY" -- tests/` returns nothing (exits 1 on success — run it
  alone).
- `npm run lint` and `npm run typecheck` exit 0 with the new files present.

#### Manual Verification:

- CI is green and its `npm run test:integration` step shows both files.
- The accounts created by the new suite appear in the **`gymlog-test`** Auth users list and **not** in
  production's.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Turn confirmation on for production, deploy, verify

### Overview

The debt recorded on 2026-08-09 comes due. Email confirmation was switched off so that tests could
create accounts; from here it is on for the project real people use, and off for the one machines
use.

**This phase is deliberately last.** Once confirmation is on, every signup check against production
needs a real inbox and the free plan sends two emails an hour — so everything verifiable cheaply is
verified before this point.

### Changes Required:

#### 1. Supabase setting — **owner action**

**Intent**: Stop anyone creating an account on somebody else's address.

**Contract**: in the **`gymlog`** dashboard only — Authentication → Sign In / Providers → Email →
**Confirm email: on**. **`gymlog-test` stays off.** Getting this backwards is the failure mode this
phase's checks are designed to catch: it would break the integration suite immediately and leave
production unprotected silently.

No code change accompanies this. The signup endpoint already branches on the outcome (Phase 1), so
the application follows the setting without a redeploy.

**The accounts that already exist are not affected — verified, not assumed.** All four throwaway
accounts in `gymlog` carry a non-null `email_confirmed_at`, because Supabase stamps it at signup time
while confirmation is off. Enabling the setting therefore locks nobody out and requires no
backfill; only accounts created _after_ the switch need a link. Re-check with
`select email, email_confirmed_at is not null from auth.users;` before flipping it if any real
account has appeared by then.

#### 2. Redeploy

**Intent**: Put phases 1–3 on the public URL.

**Contract**: `npm run build && npx wrangler deploy`. No secret changes — the Worker already holds
the production pair, and nothing in this slice adds a runtime variable. `SUPABASE_DB_URL`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_TEST_*` and `GYMLOG_TEST_PASSWORD` must **never** become Worker
secrets.

### Success Criteria:

#### Automated Verification:

- The full gate — `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run build` — exits 0 **after** the setting change. The integration suite passing is what
  proves `gymlog-test` was not touched.
- The Worker holds no test-project or database secret: `npx wrangler secret list` names
  `SUPABASE_URL` and `SUPABASE_KEY` and nothing else.
- `npx wrangler deploy` exits 0 and prints a new version id.

#### Manual Verification:

- Signing up at the deployed URL with a **real** address the owner controls now lands on
  `/auth/confirm-email` — and an email actually arrives.
- Clicking the link, then signing in, lands on `/dashboard` showing that account's own timezone.
- Signing in before confirming is refused, with the neutral message.
- Signed out, `/dashboard` still redirects to `/auth/signin`.
- The account created here is the owner's real address, not a throwaway — record it for S-09
  alongside the four existing throwaways.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Truth up the documents

### Overview

Three documents describe an auth setup this slice changes, and one of them is the file every future
agent reads first.

### Changes Required:

#### 1. Agent instructions

**File**: `AGENTS.md`

**Intent**: Record the rules a later slice would otherwise have to rediscover or, worse, contradict.

**Contract**: three edits. § Auth wiring — the two route lists in `src/middleware.ts` and the rule
that route protection lives there, not in per-page checks; that endpoints validate with the shared
schema in `src/lib/validation/auth.ts` and never let provider error text reach a response. § Testing
— that auth flows are covered in `tests/integration/auth-flows.test.ts` and why the account-existence
assertions are written the way they are. § Environment — **email confirmation is on for `gymlog` and
off for `gymlog-test`**, deliberately, and what breaks if that is made uniform in either direction.

#### 2. Repository README

**File**: `README.md`

**Intent**: § "Email confirmation in local development" currently tells the reader to switch
confirmation off, full stop. That is now correct for exactly one of the two projects and wrong for
the other.

**Contract**: rewrite that section as a per-project statement, and update § "Auth routes" with the
redirect targets this slice settles.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: § Baseline's Auth bullet describes a scaffold-only state that is no longer true, and
notes email confirmation as "switched off for development" without qualification.

**Contract**: rewrite the Auth bullet — validated inputs, neutral errors, symmetric route protection,
confirmation on in production. Leave the S-01 item's `Status` alone; that is `/10x-implement`'s and
`/10x-archive`'s to move.

### Success Criteria:

#### Automated Verification:

- The per-project confirmation rule is documented in both files:
  `git grep -n "Confirm email\|confirmation" -- README.md AGENTS.md` returns matches in each.
- The roadmap's **Auth** bullet no longer describes auth as scaffold-only:

  ```bash
  grep -n '\*\*Auth:\*\*' context/foundation/roadmap.md | grep -c 'scaffold only'
  ```

  prints `0`. **Do not grep the whole file for `scaffold only`** — the Backend/API bullet also
  carries that phrase and is not this phase's to rewrite, so a file-wide grep can never go green.

- Markdown stays Prettier-clean: `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md`
  exits 0.
- The whole gate is still green.

#### Manual Verification:

- Read `AGENTS.md` § Environment as the agent planning S-02 tomorrow: is it obvious why the two
  projects differ on email confirmation, and what breaks if you "tidy" that up? If not, it is not
  finished.

**Implementation Note**: This is the final phase. After it passes, the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit tests

`src/lib/validation/auth.test.ts` — the schema boundaries. These are pure functions with no network
and no `astro:*` imports, which is what keeps the hermetic suite hermetic.

### Integration tests

`tests/integration/auth-flows.test.ts` — signup, sign-in, and the two failure modes, against
`gymlog-test` only. The design rules from F-03 carry over unchanged: publishable key only, never
`service_role`, throw rather than skip when a credential is missing, and unique identifiers per run so
parallel or repeated runs cannot collide.

**One assertion earns its place beyond the obvious**: that a fresh signup on `gymlog-test` still
returns a session. It looks like a tautology today and becomes the tripwire the moment somebody
applies Phase 4's setting to the wrong project.

### Manual testing steps

1. Signed out, request `/dashboard` — redirected to `/auth/signin`.
2. Sign up with a mismatched confirmation and with a 7-character password — specific messages both times.
3. Sign in with a wrong password, then with an address that has no account — identical messages.
4. Sign in correctly — land on `/dashboard`, see the account's own timezone.
5. While signed in, request `/auth/signin` — redirected to `/dashboard`.
6. Sign out — land on `/auth/signin`; request `/dashboard` again — redirected.
7. After Phase 4 only: sign up at the deployed URL with a real address; confirm the email arrives,
   the link works, and signing in before clicking it is refused.

## Performance Considerations

Nothing here approaches the Workers Free 10 ms CPU cap. Validation is a zod parse over two short
strings; the middleware's added check is a prefix match against a two-element array. `zod` adds to
the Worker bundle, which matters for cold-start size rather than CPU — it is the standard cost of the
convention `AGENTS.md` already mandates.

## Migration Notes

- **No schema change.** This slice adds no table, no column and no migration. `npm run db:push` is
  not part of it.
- **Enabling email confirmation does not invalidate existing accounts.** Verified 2026-08-10: every
  account in `gymlog` already has `email_confirmed_at` set, because Supabase stamps it at signup
  while the setting is off. No backfill, no migration.
- **The password floor moves from 6 to 8 for new accounts only.** Supabase does not re-validate
  existing passwords, and no real accounts exist yet. The throwaway accounts from F-03 keep working.
- **Phase 4 is the only step with an operational cost to undo.** Switching confirmation back off is
  one click, but any account created while it was on stays unconfirmed until its link is used.
- **Constraint inherited by Faza 3 (E2E):** browser tests that create accounts must point at
  `gymlog-test`, not at the production URL, because production now requires a confirmation link no
  test can click. Record this when `/10x-test-plan` runs.

## Decisions

All eight were taken by the owner during planning on 2026-08-10, with the trade-offs stated.

| #   | Decision                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Fix and harden the starter's auth rather than rewrite it**                      | F-03 proved the path end to end on production; rewriting working auth is risk without return. Cost: the starter's visual language stays, which nobody chose but which the badge does not score.                                                                                                                                                                                                                                       |
| 2   | **Email confirmation on for `gymlog`, off for `gymlog-test`**                     | Real accounts cannot be created on someone else's address, while the checks that must create accounts still can. This is the first concrete return on the owner's two-project decision. Cost: the environments differ, which must be documented or it reads as a bug.                                                                                                                                                                 |
| 3   | **Project-owned neutral error messages**                                          | Provider prose is an account-existence oracle, and US-04 requires the boundary to be real rather than apparent. **In production the anti-enumeration guarantee comes from Supabase itself** — with confirmation on, an already-registered address returns no error; the mapping is what stops `gymlog-test`, where confirmation stays off, from behaving visibly differently. Cost: less precise feedback, and a mapping to maintain. |
| 4   | **Sign-in and signup → `/dashboard`; sign-out → `/auth/signin`**                  | Satisfies US-04's "returning requires authenticating again" and removes the "now click sign in" step after registration. Redirect-back was rejected: an unvalidated return parameter is an open redirect, and there is one protected route.                                                                                                                                                                                           |
| 5   | **zod on the server; the forms share only the constants and the email predicate** | `AGENTS.md` mandates zod and it was not installed. One definition of the minimum length and the pattern stops the two sides disagreeing, which they do today — while keeping zod out of the client bundle of two hydrated islands (`client:load`) on a product with a 2 s p95 mobile target.                                                                                                                                          |
| 6   | **Route protection in both directions, in middleware**                            | A signed-in user seeing the login form is confusing and makes the boundary harder to test. `AGENTS.md` already puts route rules in middleware.                                                                                                                                                                                                                                                                                        |
| 7   | **Password floor of 8 characters, no complexity rules**                           | Composition rules reliably produce `Password1!`; length is the property that matters. Supabase's own floor is 6, the form said 6, the server said nothing.                                                                                                                                                                                                                                                                            |
| 8   | **Unit tests for the schema, integration tests for the flows, E2E deferred**      | Each level tests what it can actually observe. E2E belongs to Faza 3 and inherits a constraint recorded in Migration Notes.                                                                                                                                                                                                                                                                                                           |

## Open Risks & Assumptions

- **Phase 4 applied to the wrong project** would break the integration suite loudly (good) or leave
  production unprotected silently (bad). The suite's "signup still returns a session on
  `gymlog-test`" assertion is the tripwire for the first case; the manual check that an email
  actually arrives is the only one for the second.
- **The confirmation email may land in spam**, which looks identical to "the setting did not apply".
  Check the spam folder before diagnosing anything.
- **Two emails per hour on the free plan.** Phase 4's manual verification must be planned, not
  improvised — a failed attempt costs half an hour of waiting.
- **Supabase may change its error strings**, which would silently drop cases through to the generic
  fallback. Logging the unmapped error server-side is what makes that visible rather than invisible.
- **`zod` enters the Worker bundle.** Expected and accepted; watch the bundle size reported by
  `wrangler deploy` if it ever becomes relevant.

## References

- Roadmap item: `context/foundation/roadmap.md` § Slices → S-01
- Product contract: `context/foundation/prd.md` § FR-001, FR-002, FR-003, § US-04 and its acceptance
  criteria
- Agent rules: `AGENTS.md` § Access control, § Conventions (zod, path alias, services), § Testing,
  § Cloudflare traps
- The auth wiring this slice corrects: `src/lib/supabase.ts`, `src/middleware.ts`,
  `src/pages/api/auth/{signin,signup,signout}.ts`, `src/pages/auth/*.astro`,
  `src/components/auth/*.tsx`
- The integration-suite shape this slice copies:
  `context/archive/2026-08-09-owned-persistence-baseline/plan.md` § Phase 4, and
  `tests/integration/profiles-rls.test.ts`
- Deployment traps found during F-03: `context/deployment/deploy-plan.md` § Stage 2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Harden the auth endpoints

#### Automated

- [ ] 1.1 Gate green — `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exit 0
- [ ] 1.2 `zod` is a runtime dependency
- [ ] 1.3 No provider prose reaches a redirect — `git grep -n "error.message" -- src/pages/api/auth/` returns nothing
- [ ] 1.4 The rules exist once — `MIN_PASSWORD_LENGTH` defined in `src/lib/validation/auth.ts`, imported elsewhere
- [ ] 1.5 A fieldless POST to `/api/auth/signin` returns a 302 to `/auth/signin?error=…` (403 = missing Origin, 500 = still unvalidated)

#### Manual

- [ ] 1.6 Wrong password and unknown address produce the same message
- [ ] 1.7 Mismatched confirmation and a 7-character password each produce a specific message
- [ ] 1.8 Sign-in lands on `/dashboard`; sign-out lands on `/auth/signin`

### Phase 2: Protect the routes in both directions

#### Automated

- [ ] 2.1 Gate green — lint, typecheck, unit tests, build all exit 0
- [ ] 2.2 Both route lists declared in `src/middleware.ts`

#### Manual

- [ ] 2.3 Signed out, `/dashboard` redirects to `/auth/signin`
- [ ] 2.4 Signed in, `/auth/signin` and `/auth/signup` redirect to `/dashboard`
- [ ] 2.5 Signed in, `/auth/confirm-email` still renders
- [ ] 2.6 Signed out, `/` and `/auth/*` render normally

### Phase 3: Cover it automatically

#### Automated

- [ ] 3.1 `npm test` names `auth.test.ts`, exits 0, and stays offline
- [ ] 3.2 `npm run test:integration` exits 0 and reports both files
- [ ] 3.3 The new suite cannot reach production — `git grep -nE "SUPABASE_URL|SUPABASE_KEY" -- tests/` returns nothing
- [ ] 3.4 `npm run lint` and `npm run typecheck` exit 0 with the new files present

#### Manual

- [ ] 3.5 CI green, `npm run test:integration` step shows both files
- [ ] 3.6 New accounts appear in `gymlog-test` and not in production

### Phase 4: Turn confirmation on for production, deploy, verify

#### Automated

- [ ] 4.1 Full five-command gate exits 0 after the setting change
- [ ] 4.2 Worker holds only `SUPABASE_URL` and `SUPABASE_KEY`
- [ ] 4.3 `npx wrangler deploy` exits 0 and prints a new version id

#### Manual

- [ ] 4.4 Signup at the deployed URL lands on `/auth/confirm-email` and an email arrives
- [ ] 4.5 Clicking the link then signing in lands on `/dashboard` with that account's timezone
- [ ] 4.6 Signing in before confirming is refused with the neutral message
- [ ] 4.7 Signed out, `/dashboard` still redirects to `/auth/signin`
- [ ] 4.8 The confirmed account is recorded for S-09 alongside the four existing throwaways

### Phase 5: Truth up the documents

#### Automated

- [ ] 5.1 Per-project confirmation rule documented in `README.md` and `AGENTS.md`
- [ ] 5.2 Roadmap **Auth** bullet no longer contains `scaffold only` (grep the Auth line only, never the whole file)
- [ ] 5.3 Markdown Prettier-clean across the three documents
- [ ] 5.4 Gate still green

#### Manual

- [ ] 5.5 `AGENTS.md` § Environment makes the two-project confirmation difference obvious and explains what breaks if it is made uniform
