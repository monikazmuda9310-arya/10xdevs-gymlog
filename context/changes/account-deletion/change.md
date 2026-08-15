---
change_id: account-deletion
title: Let an account delete itself, and fail honestly when the database refuses
status: implemented
created: 2026-08-14
updated: 2026-08-15
archived_at: null
---

## Notes

One half of the split S-09. The other half is `cross-account-isolation`, developed in parallel in its
own worktree on `feature/cross-account-isolation`; this one is on `feature/account-deletion`. The
split exists to produce M2 deliverable 5 (two worktrees → two PRs after solo review), the last
Phase-2 artefact still outstanding against CONTRACT §8.

**Why this is in scope at all.** The PRD puts compliance out of scope *except* baseline GDPR duties,
and names **own-data deletion** as one of them. So this is a requirement, not a nice-to-have — but it
has no user story of its own, which is why the acceptance criteria have to be written rather than
quoted.

**The mechanism is the first real question, and it is not a client call.** Supabase's
`auth.admin.deleteUser` needs a `service_role` key, and this repository holds none: the Worker carries
exactly `SUPABASE_URL` and `SUPABASE_KEY`, integration checks use the publishable key on purpose, and
`AGENTS.md` § Environment forbids a `service_role` key reaching either. **A check that bypasses RLS
proves nothing, and an application holding an admin key is the thing that guardrail exists to
prevent.** The shape that fits is a Postgres function with `security definer` deleting
`auth.users where id = auth.uid()`, granted to `authenticated` — which the plan must design carefully,
because `security definer` is precisely the escape hatch RLS is protecting against. Pin `search_path`,
grant nothing wider than needed, and prove from the outside that it cannot be made to delete anybody
else's row.

**The deletion is already wired to cascade, and that is mostly good news.** `profiles`, `exercises`,
`workouts`, `exercise_entries` and `sets` all carry `user_id references auth.users (id) on delete
cascade`, so one delete takes the account's whole training record with it and leaves no orphans.
Confirm it rather than assume it — this has never been executed.

**The one place it does NOT cascade, and this slice's half of that problem.**
`exercise_entries.exercise_id references public.exercises (id) on delete restrict`. If another account
has an entry pointing at *this* account's private exercise, the cascade into `exercises` is blocked
and the whole deletion fails. **This slice owns the honest failure: the user is told the deletion
could not complete and why, never a 500 and never a silent success.** Whether that row can be created
at all is the sibling slice's decision — see `cross-account-isolation`. Neither blocks the other: the
error path is correct whether or not the root cause is closed.

**Deleting is irreversible, so the confirmation is part of the feature, not decoration.** S-05
established the pattern for destructive actions — a dialog that names what will be lost before
confirming — on the native `<dialog>` rather than shadcn's `alert-dialog`, which cost **+40 KB** in a
`client:load` island against a ~15 KB threshold written into the plan beforehand. Reuse
`ui/confirm-dialog.tsx`; do not reintroduce the dependency. Unlike a set or a workout, there is no
"what will this fall to" figure to preflight — the honest thing to name is the scope of what goes.

**Shared-resource hazards for the parallel run** — `gymlog-test` is not isolated by a worktree:

- **This suite deletes accounts, which makes it the more dangerous of the two.** It must create its
  own throwaway accounts per run, in the pattern of `tests/integration/auth-flows.test.ts`
  (`s01-signup-<run>@gymlog-test.dev`). **Touching `rls-owner-a/b` breaks every other suite**, and
  unlike a bad row it cannot be repaired by re-running.
- Pick a MARK that is not a prefix of, and not prefixed by, an existing one (`s09d-`, not `s09-`).
- Both branches may add a migration. No file conflict, but whichever merges second needs the later
  timestamp, and `npm run db:push` advances both hosted projects at once.
- Both will edit `AGENTS.md` and `README.md` in their documentation phase. That is a guaranteed
  conflict on the second merge and is expected, not a surprise.

**Three facts the sibling slice settled on 2026-08-15, after this file was written.**
`cross-account-isolation` is implemented, reviewed and open as PR #1 (not merged). Each of these
contradicts something above or would be assumed wrongly:

1. **The latest migration is now `20260815120000`, not `20260815090000`.** The sibling slice shipped
   a second migration out of its implementation review. Any migration here needs a timestamp after
   that one.
2. **`s09i-a@`, `s09i-b@` and `s09i-signout@gymlog-test.dev` are now PERMANENT accounts**, not
   per-run throwaways. That reversal was itself an implementation-review finding: nothing in this
   repository can delete an `auth.users` row, so per-run accounts leaked three per run, and an
   interrupted run's rows became unreachable to every later run. **This suite must never delete an
   account whose address begins `s09i-`** — a hazard that did not exist while they were disposable,
   and one that no assertion here would notice, because it would surface as the sibling suite
   failing on a later run.
   - The same finding is worth reading before designing this suite's own fixtures: a suite that
     genuinely CAN delete accounts is the first one here able to clean up after itself, which makes
     "throwaway per run" a real option rather than the least-bad one. Say which it is and why.
3. **The unscoped `exercise_id` is closed for `authenticated` callers.** So the blocked-cascade
   failure this slice owns is now unreachable through the application — but **not** unreachable in
   general: a `before` trigger validates nothing already stored and binds `authenticated` only, so
   `postgres` and `service_role` can still create the blocking row. The honest-failure path is still
   required; what changed is that constructing the fixture for it may now need a migration or a
   deliberately seeded row rather than an ordinary insert. **Establish how the test will build that
   state before planning a phase around asserting it** — `lessons.md` § "A user cannot do X yet" is
   not "X is untested", and its inverse bites here.

**Also due here, from `STATE.md`:** the one-off accounts listed in its reference block are to be
cleaned up with this slice — including the production account that now holds real training rows,
which this feature is the intended way to remove.
