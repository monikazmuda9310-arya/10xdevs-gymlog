---
change_id: testing-browser-layer
title: Browser layer — test-plan rollout phase 2 (risks #2, #3, #4)
status: implemented
created: 2026-08-16
updated: 2026-08-20
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Browser layer".
Risks covered: #2 (account B reaches account A's training by naming an identifier directly),
#3 (a signed-out visitor returns and is shown training data), #4 (a screen renders correctly
and does nothing).

Risk response intent:

- #2: after a real sign-in as B, a request naming A's identifier returns no data, and A's row
  reads back untouched as A. Challenge "thirteen integration suites already prove this" — they
  prove it at the client-library layer, not through a cookie.
- #3: signing out ends access; returning to a protected route requires authenticating again
  before any data is shown. Challenge "a redirect happened" as if it meant "the session stopped
  working".
- #4: a person completes sign up, create a workout, log a set, see its estimate, in a real
  browser. Challenge "the HTML rendered" as if it meant "it can be used".

BLOCKING, must be the first sub-phase and is not a test: nothing in this repository points a
running HTTP server at gymlog-test. The dev server reads its Supabase credentials from
.dev.vars, which points at production, and a process-env override does not displace them. The
only mechanism that makes a test process INCAPABLE of reaching production is the env allowlist
in vitest.integration.config.ts; no other runner has one. Until a browser test can be aimed at
gymlog-test with the same guarantee, no browser test may be written. If it cannot be resolved,
re-scope this phase rather than aim it at production.

Standing constraints: never delete or mutate rls-owner-a/b@gymlog-test.dev or any s09i- address
— they are permanent shared fixtures, and damage surfaces as a different suite failing on a
later run. Every test creates its own per-run account; account cleanup is now possible via
delete_own_account(), which is new since S-09 and must be verified rather than assumed.
Locators: getByRole/getByLabel/getByText, never CSS or XPath, never waitForTimeout. Production
holds exactly one account with real training data and zero-day backup retention; nothing may
touch it.

The owner has already approved running /10x-research and /10x-plan for this phase through
subagents in clean context, and the cost was named and accepted. Do not ask again; do delegate
them.
