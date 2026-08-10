---
change_id: account-access
title: Account creation, sign-in, sign-out and the signed-out redirect
status: implementing
created: 2026-08-10
updated: 2026-08-10
deviations:
  - "Phase 1 §2/§5: the shared constants and the zod schemas live in two files, not one.
    `src/lib/validation/auth.ts` stays import-free (MIN_PASSWORD_LENGTH, isValidEmail, the
    message constants) and is what the hydrated forms import; the schemas and the FormData
    parsers moved to `src/lib/validation/auth-schemas.ts`, imported by the endpoints only.
    Reason: with both in one module the `client:load` islands pulled zod's runtime into the
    browser — the exact cost the plan's §5 rationale exists to avoid. Measured over two builds:
    client chunk 96 746 B merged vs 36 135 B split. Success criterion 1.4 is unaffected — the
    definition is still in auth.ts. Approved by the owner on 2026-08-10."
archived_at: null
---

## Notes

Roadmap S-01, the first user-visible slice — everything before it was foundation. Outcome: a person
can create an account, sign in, sign out, and be sent to sign-in when they are signed out.
PRD refs: FR-001, FR-002, FR-003, US-04, Access Control.

The starter already ships working auth wiring (`src/lib/supabase.ts`, `src/middleware.ts`,
`src/pages/api/auth/{signin,signup,signout}.ts`, `src/pages/auth/*.astro`) and F-03 proved it end to
end against the deployed URL. So this slice is mostly about making that wiring correct and honest
rather than building it — read it before adding to it.

Known defect to fix here, found during the F-03 deployment check: after signing up, the user is told
to check an inbox that will never receive anything. **The precise cause is narrower than first
recorded.** `confirm-email.astro:4` does branch — but on `import.meta.env.DEV`, i.e. on _build mode_,
not on whether email confirmation is actually enabled on the Supabase project. In `npm run dev` it
correctly says "Registration successful"; in every production build it says "Check your email",
which on the deployed instance is false. The condition exists and is keyed to the wrong fact.

Two constraints inherited from F-03 that any plan here must respect:

- **Auth endpoints read `formData()`, not JSON.** A JSON probe returns 500 from failed parsing,
  which looks identical to "Supabase is not configured" and is not that.
- **Astro's `security.checkOrigin` rejects a POST with 403** unless `Origin` matches the host. A
  browser form does this itself; a scripted `fetch` must set it explicitly.

**Accounts in `gymlog` (production), for S-09 to clean up.** Eight, all verified against
`auth.users` rather than recalled:

| Account                                | Created by                                      |
| -------------------------------------- | ----------------------------------------------- |
| `smoke-1786276093721@gymlog-test.dev`  | F-03 deployment check                           |
| `dash-1786344010@gymlog-test.dev`      | F-03 deployment check                           |
| `dash-a-1786349322975@gymlog-test.dev` | F-03 deployment check                           |
| `dash-b-1786349322975@gymlog-test.dev` | F-03 deployment check                           |
| `proroknh@gmail.com`                   | Phase 1 manual verification (owner's own)       |
| `s01-manual-1786367266171@example.com` | Phase 2's signed-in redirect script             |
| `monika.zmuda9310@gmail.com`           | Phase 4, first confirmed-email account          |
| `monika.zmuda9310+gymlog1@gmail.com`   | Phase 4, re-verification after the site_url fix |

The last two are the only ones that ever went through a confirmation link; the six before them were
created while confirmation was off and carry `email_confirmed_at` stamped at signup time. That is
why enabling the setting locked nobody out — checked, not assumed.

**Email confirmation is now ON for `gymlog` and OFF for `gymlog-test`** (Phase 4, 2026-08-10),
confirmed by reading `mailer_autoconfirm` from the Management API for both projects rather than by
looking at the dashboard. The integration suite's "a fresh signup still returns a session" assertion
is the tripwire if that is ever made uniform.

**Defect found during Phase 4's manual verification, not predicted by the plan.** Production's
`site_url` was `http://localhost:3000` — a Next.js port left over from the template, which `astro
dev` does not even use. Every confirmation link therefore pointed at an address no real user has:
the account was confirmed correctly, but the user saw "site unreachable" and would reasonably
conclude the signup had failed. Fixed via the Management API to
`https://gymlog.10x-astro-starter.workers.dev/auth/signin`, with `uri_allow_list` set to that host
plus `http://localhost:4321/**`. No code change, no redeploy.

**Observation for a later slice, deliberately not acted on here.** The confirmation link now lands
on `/auth/signin?code=…` — the PKCE code — and this application has no `/auth/callback` route to
exchange it for a session, so the user lands signed out and types their password. That matches what
the plan asked for ("clicking the link, then signing in, lands on /dashboard") and is not a defect,
but a slice that wants a confirmed user to arrive already signed in would add that route.
