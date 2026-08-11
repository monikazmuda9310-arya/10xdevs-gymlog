---
change_id: edit-and-delete-log
title: Edit and delete workouts and sets, warned first about which record will fall
status: implementing
created: 2026-08-11
updated: 2026-08-12
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

### Deviations from the plan

- **Phase 1 — `no_estimable_set` renamed to `no_qualifying_set`.** The plan named the "sets remain
  but none can hold this record" outcome `no_estimable_set`. That word is estimate-flavoured and the
  same outcome applies to the heaviest-weight record, where nothing is being estimated — so the name
  would have been a small lie in a module whose whole job is to avoid those. Behaviour, the two
  distinct outcomes and criterion 1.4 are unchanged.
- **Phase 1 — criterion 1.7 verified by comparison, not by the literal grep the plan wrote.** The
  plan specified `git grep "estimate_kg desc"`, but the service expresses the ordering as
  `.order("estimate_kg", { ascending: false })`, so that grep would have matched the SQL only and
  reported success while checking nothing in `src`. Replaced with a script that extracts every
  `.order()` chain from `records.ts` and every `distinct on` ordering from the migration and prints
  them side by side. Same criterion, a check that can actually fail.

- **Phase 2 — mutation (a) broke nothing, and the plan's claim was corrected rather than the code.**
  The plan asserted that dropping `.eq("user_id", …)` from `deleteSet` would fail a cross-account
  assertion. It does not: all 14 assertions stayed green. The DELETE policy's predicate is
  `(select auth.uid()) = user_id` — read from `pg_policies` through the Management API, not assumed —
  so account B's delete matches zero rows through the policy alone. The application filter is the
  index path, exactly as AGENTS.md § Access control states. The filter stays (AGENTS.md requires it,
  and the cost of the unfiltered read on `sets` is the 10 ms CPU trap), the criterion now records the
  measurement, and the edit that would make the filter load-bearing — RLS disabled on `sets` — is
  named. Per `lessons.md`: a mutation that breaks nothing is a finding; fix the claim, never the test.
- **Phase 2 — two defensive guards deleted because the type system proved them dead.** The
  `set.exercise_entries?.exercises` optional chains and their `if (!…) return 404` branches were
  flagged by `@typescript-eslint/no-unnecessary-condition`: the embed resolves through the composite
  ownership key, whose columns are both `not null`, so it cannot be absent. Kept as a comment saying
  why there is no guard, rather than as dead code that reads as diligence.
- **Phase 2 — a shared `src/pages/api/_shared/mutation-route.ts` was added, which the plan did not
  name.** Six handlers otherwise repeat the same twelve-line preamble (configured, authenticated,
  well-formed id). The three S-03 POST endpoints were deliberately NOT refactored onto it: they are
  pinned by assertions that would have to move with them, and this slice adds operations rather than
  churning the ones that work.

### Working mode

No subagents unless the owner asks — including for skills that spawn them by default
(`/10x-research`, `/10x-plan`, `/10x-impl-review`). Sessions 5–8 ran them inline.
