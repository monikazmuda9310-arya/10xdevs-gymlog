---
change_id: edit-and-delete-log
title: Edit and delete workouts and sets, warned first about which record will fall
status: plan_reviewed
created: 2026-08-11
updated: 2026-08-11
archived_at: null
---

## Notes

S-05 on the roadmap. Outcome: the user can edit a workout's date and note, edit or delete an
individual set, and delete a workout together with everything under it — being told first which
record it holds and what that record will fall to, and having to confirm.

PRD refs: FR-006, FR-007, FR-010, US-02. Prerequisites S-04 and F-01, both done.
This closes the last hole in the badge's "meaningful CRUD" criterion: read and create are on
screen, update and delete are not.

### Four things S-04 left, from `C:\10xdev\handoff\STATE.md` § "Co S-04 zostawił S-05"

- **The query behind the "how far will the record fall" warning already exists.**
  `topTwoEstimatesForExercise` in `src/lib/services/records.ts` returns the runner-up, which is
  exactly what the record falls to once the leader is deleted. Nothing to add to the data layer.
- **Recompute by re-reading, never by patching a stored figure.** Nothing is stored: no record
  column, no record row, no cache. See `AGENTS.md` § Access control → the derived-view variant.
- **The verdict is decided by comparing identifiers, not numbers** (`records-verdict.ts`).
  Postgres computes in exact `numeric`, JS in float64; a record settled by comparing one against
  the other could be invented or erased. S-05 keeps the same seam.
- **`estimate desc, created_at asc, set_id asc` is the tie-break rule and must agree in the view
  and in the service.** Two places, one rule.

Also carried over: `/api/sets` answers `{ set, record }` with the verdict in its own `try/catch` —
a failed recomputation costs the badge, never the 201. PATCH/DELETE hold the same line: a failed
recomputation must not turn a successful edit into an error.

### Explicit requirement for the plan

The deploy phase must carry an **automatic** criterion "pushed to `origin/main` and CI green",
with the run number written into Progress. In session 8 work was twice finished and verified
locally but left unpushed — once while the Worker was already serving it on production. No local
gate can see that state.

### Working mode

No subagents unless the owner asks — including for skills that spawn them by default
(`/10x-research`, `/10x-plan`, `/10x-impl-review`). Sessions 5–8 ran them inline.
