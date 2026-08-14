# Cross-account isolation — Plan Brief

> Full plan: `context/changes/cross-account-isolation/plan.md`

## What & Why

`exercise_entries.exercise_id` is a single-column foreign key that is **not** ownership-scoped, so a
row can exist in which account A's entry points at account B's **private** exercise. S-08 met this from
the tonnage side and answered with a `left join`. It has a second end: because `exercises.user_id`
cascades from `auth.users` while `exercise_id` is `on delete restrict`, such a row lets one account
**permanently block another from deleting their own account** — a baseline GDPR duty the PRD keeps in
scope. This slice closes the hole in the database, and covers the one US-04 acceptance criterion
nothing asserts today.

## Starting Point

**US-04 is already proven, and finding that out was the most valuable part of planning.** All thirteen
integration suites were read first. Two of its three criteria are covered thoroughly —
`workout-mutations-rls` 1–5 pair every cross-account attempt with a read-back as the owner, and
`workout-log-rls` 2–5 cover all three levels including both grafts. The third — signing out ends
access — is covered by **nothing**; the nearest test refuses an _unauthenticated_ caller, which never
signs a real session out.

## Desired End State

The hazard row cannot be created **or updated** into existence; the database refuses it and the caller
receives the same `exercise_not_found` it already gets for an exercise that does not exist, so the
endpoint stays free of an existence oracle. Signing out provably ends read access. A new suite fails
if the trigger is removed.

## Key Decisions Made

| Decision                  | Choice                                             | Why                                                                                                                                     | Source |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| How to close the hole     | `before insert or update` trigger                  | An ordinary composite key cannot match a null owner under `MATCH SIMPLE`; the declarative alternative lost on cost, weighed in the plan | Owner  |
| The guard it destroys     | Retire `tonnage-breakdown` 9, keep the `left join` | The trigger makes that hazard row unconstructible; the `left join` still matters, so it is documented as unguarded rather than deleted  | Owner  |
| Where enforcement lives   | Database, not the endpoint                         | The INSERT policy only checks the entry's own `user_id`, so an application check leaves PostgREST open                                  | Plan   |
| What the caller sees      | The existing `exercise_not_found`                  | "Absent" and "somebody else's" must stay indistinguishable — a distinct code is an existence oracle                                     | Plan   |
| Existing violating rows   | Measure both projects first, then decide           | Deleting somebody's logged sets is not a default; a `before` trigger validates nothing already stored                                   | Plan   |
| Sign-out coverage         | Integration assertion                              | The claim is session invalidation, not UI; E2E can cover the screen later without this waiting on it                                    | Plan   |
| Where the assertions live | New suite `account-boundary.test.ts`, MARK `s09i-` | Own fixtures, no collision with the parallel branch, and one dossier a reviewer can read as the US-04 proof                             | Plan   |
| Deployment                | After **both** PRs merge                           | Production is served from `main` and each branch carries a migration; `db:push` advances production                                     | Plan   |

## Scope

**In scope:** the trigger and its migration; a new integration suite owning this slice's evidence; the
sign-out assertion; documentation; one PR.

**Out of scope:** rebuilding the US-04 proof (it exists); changing `on delete restrict`; the deletion
**failure path** (that is `account-deletion`'s half of the seam); deployment; E2E.

## Architecture / Approach

A `security invoker` trigger function gets the visibility check **for free**: under PostgREST the role
is `authenticated`, which does not own the tables, so RLS applies inside the function and a bare
`select 1 from public.exercises where id = new.exercise_id` returns no row exactly when the exercise is
neither seeded nor the caller's. The select policy is reused rather than restated. Raising
`foreign_key_violation` (`23503`) lands on the endpoint's existing mapping, so **no application code
changes** — a finding that shrank Phase 2 after `src/pages/api/exercise-entries/index.ts` was read.

## Phases at a Glance

| Phase                            | What it delivers                                                        | Key risk                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. The trigger and its proof     | Assertion 9 settled, measurement, migration, new suite, three mutations | Destroying `tonnage-breakdown` 9 without noticing — settled first, before the migration exists |
| 2. Sign-out gap + endpoint proof | US-04's third criterion; confirmation that no code changes              | The endpoint may need a branch after all; the plan records either outcome                      |
| 3. Documents and the PR          | Truthful `AGENTS.md`, a lesson, one PR                                  | `AGENTS.md` conflicts with the parallel branch on the second merge — expected, not a surprise  |

**Prerequisites:** worktree on `feature/cross-account-isolation`; `npm install` in the worktree;
database URLs for both projects.
**Estimated effort:** ~1–2 sessions across three phases.

## Open Risks & Assumptions

- **This change destroys an existing guard, and that is its largest risk.**
  `tonnage-breakdown` assertion 9 constructs the hazard row on purpose and is the only thing that
  would notice `left join` being simplified to `join`. After the trigger it cannot be built at all —
  no suite can, because the only remaining route is `service_role`, which the harness forbids. Phase 1
  owns this **before** the migration exists: the `left join` stays, the assertion is retired openly,
  and the now-unguarded guarantee is written down naming the exact edit that would exploit it.
- **Assumed zero violating rows in production. Phase 1 measures it rather than trusting it.**
  `gymlog-test` will usually be non-zero for an innocent reason — `tonnage-breakdown` resets fixtures
  at the start of a run, so its cross-account entry survives between runs — so only a non-zero count
  on `gymlog` is an escalation.
- The trigger's message must not contain `exercise_entries_workout_owner_fkey`, or every rejected
  exercise flips to `workout_not_found`. After this lands, a `BEFORE` trigger also fires ahead of the
  plain foreign key, so that rule becomes load-bearing for a **second** suite's assertion too.
- The novelty is **a trigger used as access control**, not a trigger — this repository already has
  five, including one on `exercise_entries`. Flipping the function to `security definer` silently
  disables the entire check, which is why that is the mutation the plan tests.

## Success Criteria (Summary)

- An account cannot attach — or re-point — an entry onto another account's private exercise, and the
  refusal is the database's, provable by removing the trigger and watching the suite go red.
- Signing out ends read access, asserted rather than believed.
- Nothing in the catalogue breaks: seeded exercises remain usable by everybody.
