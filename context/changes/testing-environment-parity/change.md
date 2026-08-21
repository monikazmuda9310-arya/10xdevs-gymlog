---
change_id: testing-environment-parity
title: Environment parity — schema drift check and a post-deploy sign-in smoke
status: impl_reviewed
created: 2026-08-21
updated: 2026-08-21
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Phase 5 of `context/foundation/test-plan.md` § 3 (the last rollout phase; post-badge).
Covers risks #6 and #7. Test types: script + CI + smoke.

Two gates in § 5 are marked "required after §3 Phase 5":

- **schema parity between projects** — two databases believed identical that are not
- **post-deploy smoke** — a green deploy that cannot authenticate anybody
