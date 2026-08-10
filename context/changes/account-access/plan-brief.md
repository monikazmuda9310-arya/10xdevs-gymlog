# Account Access — Plan Brief

> Full plan: `context/changes/account-access/plan.md`

## What & Why

A visitor can create an account, sign in, sign out, and is sent to sign-in when signed out — S-01,
the first user-visible slice. The starter already ships working auth and F-03 proved it end to end
on production, so this slice is about making it **true and airtight** rather than building it: today
nothing is validated on the server, the provider's error text tells a stranger which addresses have
accounts, signing in lands on a splash page, and every new user is told to check an inbox that
receives nothing.

## Starting Point

207 lines across three endpoints, three pages and six React components. Auth works. Validation exists
only in the browser; `form.get("email") as string` is a cast that lies, because `FormData.get()`
returns `null` for an absent field. `zod` is required by `AGENTS.md` and **is not installed**.
`confirm-email.astro` does branch — but on `import.meta.env.DEV`, i.e. on build mode rather than on
whether a confirmation email is actually coming.

## Desired End State

Both endpoints validate through zod schemas built from the same constants and email predicate the
React forms import, so browser and server cannot drift — without shipping the parser to the browser. Neither reveals whether an address has an account. Signing in or up lands on
`/dashboard`; signing out lands on `/auth/signin`; a signed-in visitor cannot open the login form.
The post-signup page appears **only when a confirmation email is genuinely coming**, because the
endpoint branches on whether `signUp` returned a session. Email confirmation is on for `gymlog` and
off for `gymlog-test`.

## Key Decisions Made

| Decision           | Choice                                                                    | Why                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Scope              | Fix and harden the starter's auth; no UI rewrite                          | F-03 proved the path on production; rewriting working auth is risk without return                                                      |
| Email confirmation | On for `gymlog`, off for `gymlog-test`                                    | Real accounts protected, machine-created accounts still possible — the first concrete return on the two-project decision               |
| Error messages     | Project-owned neutral messages, provider prose never shown                | `"User already registered"` is an account-existence oracle; US-04 needs the boundary real, not apparent                                |
| Redirects          | Sign-in/signup → `/dashboard`, sign-out → `/auth/signin`                  | Satisfies US-04's "returning requires authenticating again"; redirect-back rejected as an open-redirect risk                           |
| Validation         | zod on the server; forms share only the constants and the email predicate | `AGENTS.md` mandates zod; one definition per rule stops the two sides disagreeing — while keeping a parser out of two hydrated islands |
| Route protection   | Both directions, in middleware                                            | A signed-in user seeing the login form is confusing and makes the boundary harder to test                                              |
| Password           | Minimum 8 characters, no composition rules                                | Composition rules reliably produce `Password1!`; length is what matters                                                                |
| Testing            | Unit for the schema, integration for the flows, E2E deferred to Faza 3    | Each level tests what it can actually observe                                                                                          |

## Scope

**In scope:** server-side validation; neutral error mapping; redirect targets for all three actions;
signup branching on the real outcome; symmetric route protection; unit tests for the schema;
integration tests for signup and sign-in; enabling email confirmation on production; documentation.

**Out of scope:** UI redesign; password reset, magic links, OAuth; rate limiting and CAPTCHA; account
deletion (S-09); redirect-back-to-requested-page; Playwright/E2E (Faza 3); deciding what `/` is;
touching `gymlog-test`'s auth settings.

## Architecture / Approach

One new module, `src/lib/validation/auth.ts`, becomes the single source of truth for what valid
credentials are and what a caller is allowed to be told. The three endpoints parse through its zod
schemas before touching Supabase and map provider failures onto project-owned messages; the two
hydrated forms import the same constants and email predicate the schemas are built from, so the rules
match without zod reaching the browser. `src/middleware.ts` gains a
second route list so protection runs both ways. The only behavioural cleverness is one branch: signup
redirects on whether `signUp` returned a session, which reads the real outcome instead of guessing
from configuration — so the application follows a dashboard setting change without a redeploy.

## Phases at a Glance

| Phase                             | What it delivers                                            | Key risk                                                                                         |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Harden the endpoints           | zod schema, neutral errors, redirect targets, signup branch | Over-flattening errors makes the form unusable — validation messages must stay specific          |
| 2. Route protection both ways     | Signed-in users bounced off auth pages                      | Guarding `/auth/confirm-email` by accident would strand users who must confirm                   |
| 3. Automated coverage             | Schema unit tests + auth-flow integration tests             | Integration accounts must be unique per run or repeated runs collide                             |
| 4. Confirmation on for production | Real accounts protected; deployed and verified              | Applying the setting to the wrong project breaks tests loudly or leaves production open silently |
| 5. Documents                      | `AGENTS.md`, `README.md`, roadmap tell the truth            | —                                                                                                |

**Prerequisites:** F-03 archived (done). No schema change, so no migration.
**Estimated effort:** ~1–2 sessions across 5 phases; phase 4 is gated on the owner flipping one
dashboard setting and on a real inbox.

## Open Risks & Assumptions

- Phase 4 applied to the wrong project breaks the integration suite (loud, good) or leaves production
  unprotected (silent, bad). The "signup still returns a session on `gymlog-test`" assertion is the
  tripwire for the first; only a human seeing the email covers the second.
- The confirmation email may land in spam, which looks exactly like "the setting did not apply".
- Two emails per hour on the free plan — phase 4's verification must be planned, not improvised.
- Supabase may change its error strings, dropping cases through to the generic fallback. Unmapped
  errors are logged server-side so that stays visible.
- E2E in Faza 3 inherits a constraint: browser tests that create accounts must point at
  `gymlog-test`, because production now requires a link no test can click.

## Success Criteria (Summary)

- A stranger cannot learn from the product whether a given email address has an account.
- Signing up, signing in and signing out each land somewhere that makes sense, and a signed-out
  visitor cannot reach training data.
- Nobody is told to check an inbox unless an email is actually on its way.
