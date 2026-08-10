---
change_id: account-access
title: Account creation, sign-in, sign-out and the signed-out redirect
status: plan_reviewed
created: 2026-08-10
updated: 2026-08-10
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

Email confirmation is currently **off** on both Supabase projects so that tests can create accounts
(the free plan sends two emails an hour). It must be switched back on before the product sees real
users — decide in this slice whether that is S-01's job or a launch checklist item.
