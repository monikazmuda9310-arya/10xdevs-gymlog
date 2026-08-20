---
change_id: testing-silent-failure-audit
title: Silent-failure audit — a failure that is caught must still be told to the caller
status: implemented
created: 2026-08-20
updated: 2026-08-20
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Silent-failure audit".
Goal: a failure that is caught must still be told to the caller.

Risks covered: Risk #5 — "An operation fails, the failure is logged, and the caller is told it
succeeded" (High impact × Medium likelihood; evidence: module 3 M3L5 / OWASP A10; prd.md section
"Deleting your account" — a refusal must be distinguishable from a success).

Test types planned: integration + regression.

Risk response intent (from test-plan.md section 2, Risk Response Guidance):

- Risk #5: prove that a failed operation answers non-2xx AND that the persisted state confirms
  nothing was written. Must challenge the assumption that every caught error is a defect — at least
  three swallows in this project are deliberate and carry written rules (the /api/sets record badge,
  the dashboard breakdown reconciliation, the tonnage read). Context to ground: which catch sites
  merely decorate a write that already committed, and which catch site IS the guarantee being
  offered. Anti-patterns to avoid: reversing a deliberate swallow; asserting on log output instead of
  on the response and the stored row.

After creating the folder, follow the downstream continuation rule.
