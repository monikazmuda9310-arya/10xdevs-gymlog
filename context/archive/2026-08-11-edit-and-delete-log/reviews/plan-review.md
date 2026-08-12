<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Edit and Delete the Log

- **Plan**: `context/changes/edit-and-delete-log/plan.md`
- **Mode**: Deep (inline, no sub-agents — owner's standing instruction)
- **Date**: 2026-08-11
- **Verdict**: REVISE → **SOUND after fixes**
- **Findings**: 2 critical, 2 warnings, 2 observations — all six fixed

## Verdicts

| Dimension             | Before  | After |
| --------------------- | ------- | ----- |
| End-State Alignment   | PASS    | PASS  |
| Lean Execution        | PASS    | PASS  |
| Architectural Fitness | WARNING | PASS  |
| Blind Spots           | FAIL    | PASS  |
| Plan Completeness     | FAIL    | PASS  |

## Grounding

10/10 paths ✓, 7/7 symbols ✓, brief↔plan ✓.

The plan's foundational claim — "no migration is needed" — was verified against the live
`gymlog-test` database through the Management API rather than read off the migration file:

- `workouts`, `exercise_entries`, `sets` each grant `DELETE,INSERT,SELECT,UPDATE` to `authenticated`;
  **`anon` has no grant row at all** on any of the three.
- 12 policies, exactly one per command per table.
- `exercise_entries_workout_owner_fkey` and `sets_entry_owner_fkey` are both `on delete cascade`, so
  deleting a workout reaches the sets two levels down; `exercise_entries_exercise_id_fkey` is
  `restrict`, as documented.

`@radix-ui/react-slot` is already a dependency via `button.tsx`, so the dialog primitive is a new
package but not a new ecosystem.

## Findings

### F1 — Progress carries rows that no phase criterion defines

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 and Phase 2
- **Detail**: Phase 1 listed 8 automated criteria against 11 Progress rows; row 1.11 (the date-change
  assertion) had no matching criterion in the phase body. Phase 2 listed 6 criteria against 8 rows and
  declared Manual Verification "None" while Progress carried a manual row. `/10x-implement` reads
  Progress as the source of execution state, so a row without a criterion is a step nobody defined how
  to verify.
- **Fix**: Criteria added to both phase bodies; the mutation-protocol bullet split into three in the
  body to match Progress. Verified mechanically afterwards: 45 rows, continuous numbering, all five
  phases consistent.
- **Decision**: FIXED

### F2 — No error path when the impact preflight fails

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 (`GET …/impact`) and Phase 3 (the dialog)
- **Detail**: The plan was silent on a failed ranking query. Both default behaviours are wrong: an
  empty impact list renders as "nothing is at stake" and the user deletes a record-holding set
  unwarned — the exact outcome the slice exists to prevent — or the action is blocked and the product
  is uncorrectable again. The precedent from S-04 ("a failed verdict costs the badge, never the 201")
  does **not** transfer: there the verdict was a decoration arriving after a committed write; here the
  preflight *is* the guarantee US-02 asks for.
- **Fix ⭐ (chosen)**: A third dialog state. The endpoint answers a non-2xx with `impact_unavailable`
  and never falls back to `{ impact: [] }`; the dialog distinguishes "no record affected" from "the
  consequence could not be determined", and confirmation stays available in the latter.
  - Strength: the two cases can no longer look alike, and a database hiccup does not re-create the
    uncorrectable product.
  - Tradeoff: a user may confirm a deletion without knowing a record is at stake.
  - Confidence: HIGH — mirrors the project's existing discipline of never collapsing distinct outcomes
    into one rendering.
  - Blind spot: how often the preflight actually fails in practice is unmeasured.
- **Fix B (not chosen)**: Block the action and offer retry. Rejected because a transient read failure
  would make the product uncorrectable, which is what S-05 exists to remove.
- **Decision**: FIXED via Fix A

### F3 — `record-impact.ts`'s described signature cannot be built

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, change #2
- **Detail**: The contract described "a total function mapping holders + removal → the affected
  records", but `FallingRecord` carries a successor that cannot be fetched before knowing which
  records are affected. The implementer would have had to invent a split mid-phase — the same shape as
  S-03's finding F4 (`set-display.ts` invented mid-phase because the plan's file list and its criteria
  disagreed), and the recurring failure `lessons.md` rule 5 was written for.
- **Fix**: Split into `affectedRecords(holders, removal)` — ids only — and
  `fallingRecords(affected, successors)`. Both named in criterion 1.4, so the unit criterion points at
  modules that will exist.
- **Decision**: FIXED

### F4 — When the preflight is fetched was specified for one path only

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: The workout-header contract said "fetches the impact, shows the dialog"; the set and
  entry paths said nothing. Fetching at page load would show a stale figure on the one screen whose
  underlying state changes under the user throughout a session.
- **Fix**: Stated once, for all paths: the impact is fetched when the dialog opens, never at page
  load, with the reason.
- **Decision**: FIXED

### F5 — The dialog primitive had no fallback threshold

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3, change #1
- **Detail**: Criterion 3.3 required measuring the island delta, which is the right control, but named
  no number — so the measurement could not decide anything.
- **Fix**: Threshold named in advance: above ~15 KB of island growth, fall back to native `<dialog>`
  with explicit focus management. Recorded either way.
- **Decision**: FIXED

### F6 — `successor: null` conflated two different futures

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1, changes #2 and #3; Phase 3, change #2
- **Detail**: A null successor meant either "sets remain but none can hold this record" — the exercise
  stays on `/records` with an explanation — or "no sets remain", in which case the exercise disappears
  from `/records` entirely. One sentence for two different outcomes would promise the user a screen
  state that will not happen.
- **Fix**: `no_estimable_set` and `no_sets_left` kept distinct through the shape, the display function
  and the dialog, and pinned by criterion 1.4 and manual criterion 3.8.
- **Decision**: FIXED
