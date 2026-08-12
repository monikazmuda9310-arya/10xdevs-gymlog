---
change_id: edit-and-delete-log
title: Edit and delete workouts and sets, warned first about which record will fall
status: archived
created: 2026-08-11
updated: 2026-08-12
archived_at: 2026-08-12T10:00:33Z
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

- **Phase 3 — the dialog primitive is the plan's measured FALLBACK, not its first choice.** The plan
  named the shadcn `alert-dialog` with a threshold written in advance: fall back to the native
  `<dialog>` if `WorkoutDetail`'s built island grows by more than ~15 KB. The shadcn component was
  installed and measured first. It pulls in `radix-ui` and took that island from
  **10 689 B to 50 720 B (+40 KB)**, plus a new 5 194 B shared chunk — nearly triple the threshold.
  The package was removed and `src/components/ui/confirm-dialog.tsx` written on `showModal()`
  instead, which supplies focus containment, Escape, an inert background and focus restoration from
  the platform. Two deliberate departures from the UA default are documented in the file: the
  `cancel` event is intercepted so React state stays the single source of truth, and a backdrop
  click does nothing, because dismissing an irreversible action by an accidental click-through is
  what a confirmation exists to prevent. `autoFocus` is also avoided — React implements it as a
  `.focus()` call on MOUNT, and this dialog is mounted (closed) from page load, so the opening focus
  is set explicitly in the effect that calls `showModal()`.
- **Phase 3 — `readSetFields` extracted into `src/lib/validation/workout.ts`, and `AddSetForm`
  refactored onto it.** The plan said the edit form should pre-check the weight "with
  `isWeightAllowed` exactly as `AddSetForm` does". Doing that literally would have copied five more
  rules — reps range, empty-versus-zero weight, bounds, decimal places, RPE — into a second
  client-side pre-check, and two pre-checks that agree today drift the first time a bound moves,
  leaving a correction refused by a rule a new set is not held to. One exported function, two
  callers, five unit tests (`src/lib/validation/workout.test.ts`), and `hasAllowedPrecision` moved
  out of the component with it.
- **Phase 3 — two files the plan did not name.** `src/components/workouts/EditSetForm.tsx`, because
  the inline editor is a form with its own state and `WorkoutDetail` is already long; and
  `src/components/hooks/useRecordImpact.ts`, because the preflight is made from four call sites
  across two islands and `AGENTS.md` § Conventions puts hooks there.
- **Phase 3 — an edit with nothing at stake does not open the dialog.** The plan's state 1 says the
  dialog "still appears **for a deletion**, because the action is irreversible whether or not a
  record is at stake". An edit is not irreversible, so the preflight runs first and the dialog
  appears only when a record is actually affected — or when the preflight could not say. A dialog
  that always answers "no record depends on this" is how people learn to click through the one that
  matters.
- **Phase 3 — `no_sets_left` is a DELETION's answer only, and the dialog says so.** The impact query
  excludes the set being edited, so an exercise whose only set is the one under correction comes back
  as "nothing survives". For a deletion that is exactly right. For an edit it would promise that the
  lift is about to vanish from `/records` because somebody fixed its RPE — the invented screen state
  the three-outcome successor type exists to prevent. An edit therefore reads both empty outcomes as
  "no other set could hold it"; a deletion keeps them as two distinct sentences, which is what
  criterion 3.8 checks.

- **Phase 4 — the plan named the wrong file for the route manifest.** Criterion 4.5 said the new API
  routes should be visible in `dist/server/virtual_astro_middleware.mjs`. They are not: that file
  holds the middleware, and the route table lives in `dist/server/chunks/worker-entry_*.mjs`. The
  criterion was checked there instead, and then checked again against the deployed address, which is
  the stronger evidence: the three `GET …/impact` routes answer `401 unauthenticated`, the `PATCH`
  and `DELETE` routes answer `403` from Astro's `checkOrigin` (a non-GET with no matching `Origin` —
  the documented trap), and an invented route on the same prefix answers `404`. Without that last
  contrast the first two results would prove nothing.
- **Phase 4 — the phase-3 SHA write-back needed its own commit before the push.** Criterion 4.1
  ("nothing local and unpushed") cannot be satisfied while the previous phase's Progress edit sits
  dirty, because a phase's own SHA cannot be inside its own commit. Landed as
  `chore(edit-and-delete-log): record phase 3 SHAs in Progress`, the same shape S-03 used twice.

### Working mode

No subagents unless the owner asks — including for skills that spawn them by default
(`/10x-research`, `/10x-plan`, `/10x-impl-review`). Sessions 5–8 ran them inline.
