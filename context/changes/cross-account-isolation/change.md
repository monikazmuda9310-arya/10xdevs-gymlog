---
change_id: cross-account-isolation
title: Prove US-04 against stored state at every level, and decide the unscoped exercise_id
status: implemented
created: 2026-08-14
updated: 2026-08-15
archived_at: null
---

## Notes

One half of the split S-09. The other half is `account-deletion`, developed in parallel in its own
worktree on `feature/account-deletion`; this one is on `feature/cross-account-isolation`. The split
exists to produce M2 deliverable 5 (two worktrees → two PRs after solo review), which is the last
Phase-2 artefact still outstanding against CONTRACT §8 — and S-09 was the last delivery slice able
to produce it.

**This slice owns two things.**

1. **The proof.** US-04 and the PRD's non-functional line that no account's training is obtainable
   by another through any interface, including a request naming a workout, exercise entry or set
   identifier directly — for reads, modifications and deletions alike, at all three levels, asserted
   against **re-read rows** rather than status codes. Plus US-04's third criterion: signing out and
   returning requires authenticating again before any training data is shown. Much of this is
   already covered piecemeal (`workout-log-rls`, `workout-mutations-rls`, `workout-page-access`,
   `exercises-rls`, `profiles-rls`, and the per-view assertions in `personal-records`,
   `weekly-tonnage`, `tonnage-breakdown`) — **read the suites before planning a phase around a gap**,
   per `lessons.md` § "A user cannot do X yet" is not "X is untested".

2. **An open schema decision, escalated to the owner and deliberately NOT pre-decided here.**
   `exercise_entries.exercise_id references public.exercises (id) on delete restrict` is a
   **single-column** foreign key and is **not** ownership-scoped; foreign-key checks bypass RLS and
   `addExerciseEntry` inserts the id it is handed with no visibility check. So a row can exist in
   which account A's entry points at account B's private exercise. Assertion 9 of
   `tests/integration/tonnage-breakdown.test.ts` constructs exactly that row on purpose, so it is
   proven constructible, not hypothetical.

   S-08 met this from the tonnage side and answered it with `left join` in
   `public.daily_exercise_tonnage`. **It has a second end, and that end is this slice's:** because
   `exercises.user_id references auth.users (id) on delete cascade`, deleting account B cascades to
   B's private exercises — and the `on delete restrict` above then **blocks the cascade**. One
   account can therefore permanently prevent another from deleting their own account, which is a
   baseline GDPR duty the PRD keeps in scope. Nothing surfaces but a database error.

   **The plan must compare options rather than assume one.** A composite foreign key to
   `exercises (id, user_id)` — the repository's standard answer for nested ownership — does **not**
   transfer directly, because `exercises.user_id` is nullable for the 38 seeded rows and a policy
   admits a row only on `TRUE`. Read `context/foundation/access-control.md` § the shared-catalogue
   variant and § the nested-ownership variant before proposing anything.

**The seam with `account-deletion`, stated once so it is not inherited as one decision.** This slice
owns whether the hazard row can be created **at all**. The other slice owns that a deletion meeting
`restrict` **answers honestly instead of a 500**. Neither blocks the other: the error path is correct
whether or not the root cause is closed.

**Shared-resource hazards for the parallel run** — `gymlog-test` is not isolated by a worktree:

- Pick a MARK that is not a prefix of, and not prefixed by, an existing one (`s09i-`, not `s09-`).
- The sibling slice's suite **deletes accounts**. It must use its own throwaway accounts; if either
  suite touches `rls-owner-a/b`, every other suite breaks.
- Both branches may add a migration. No file conflict, but whichever merges second needs the later
  timestamp, and `npm run db:push` advances both hosted projects at once.
- Both will edit `AGENTS.md` and `README.md` in their documentation phase. That is a guaranteed
  conflict on the second merge and is expected, not a surprise.
