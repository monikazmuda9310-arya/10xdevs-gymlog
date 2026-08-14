# Cross-account isolation — Implementation Plan

## Overview

Close, in the database, the one way an account can reach into another's: `exercise_entries.exercise_id`
is a single-column foreign key that is not ownership-scoped, so a row can exist in which account A's
entry points at account B's private exercise. Then cover the one acceptance criterion of US-04 that
nothing in the repository asserts today.

## Current State Analysis

**US-04 is already proven, and this is the plan's most important finding.** All thirteen integration
suites were read before any phase was written, per `lessons.md` § "A user cannot do X yet" is not "X
is untested" — the lesson that cost S-06 an entire phase. Coverage as it actually stands:

| US-04 acceptance criterion                                                | Where it is proven today                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The failure is verified against **recorded data**, not the response alone | `workout-mutations-rls` 1–5 — every cross-account attempt paired with a read-back as the owner; `profiles-rls` 4                                              |
| The same protection at **every level** — workouts, entries, sets          | `workout-log-rls` 2 (read by id), 3 (insert carrying the other's `user_id`), 4 and 5 (the graft, two levels); `workout-mutations-rls` 1–5 (update and delete) |
| **Signing out and returning requires authenticating again**               | **Nothing.** `workout-endpoints` 5 refuses an _unauthenticated_ caller, which is a different claim: it never signs a real session out and retries with it.    |

Derived views, catalogue, profile and page are covered too (`personal-records` 2/3, `weekly-tonnage`
7/8, `tonnage-breakdown` 7/8, `exercises-rls`, `profiles-rls`, `profile-mutations-rls`,
`workout-page-access`). **So this slice adds one assertion to a nearly complete proof and spends the
rest of its effort on a real defect** — not on rebuilding what S-03 through S-08 already built.

### The defect

`exercise_entries.exercise_id uuid not null references public.exercises (id) on delete restrict`
(`20260811005248_create_workout_log_with_row_ownership.sql:59`) is **single-column** and **not**
ownership-scoped. Foreign-key checks bypass RLS, the INSERT policy only checks the entry's own
`user_id`, and `addExerciseEntry` (`src/lib/services/workouts.ts:149`) inserts the id it is handed
with no visibility check. **`exercise_entries` also carries an UPDATE policy**, so an account can
equally re-point an entry it owns — the same hazard through a second door.

Assertion 9 of `tests/integration/tonnage-breakdown.test.ts` constructs exactly this row on purpose,
so it is proven constructible rather than hypothetical. S-08 met it from the tonnage side and answered
with `left join` in `public.daily_exercise_tonnage`.

**It has a second end, and that is why it is worth a migration.** `exercises.user_id references
auth.users (id) on delete cascade`, so deleting account B cascades into B's private exercises — and
the `on delete restrict` above then **blocks the cascade**. One account can permanently prevent
another from deleting their own account, which the PRD keeps in scope as a baseline GDPR duty. Nothing
surfaces but a database error.

## Desired End State

A row in which one account's entry points at another account's private exercise **cannot be created or
updated into existence**, refused by the database rather than by the endpoint, and the caller receives
the same `exercise_not_found` it already receives for an exercise that does not exist. Signing out
provably ends read access. Verified by a new suite that fails when the trigger is removed.

### Key Discoveries

- **The endpoint needs no change at all, if the trigger raises `23503`.**
  `src/pages/api/exercise-entries/index.ts:51-56` already maps `FOREIGN_KEY_VIOLATION` to
  `exercise_not_found`, discriminating on whether the message contains `WORKOUT_OWNER_CONSTRAINT`.
  A trigger raising `foreign_key_violation` therefore lands on the chosen answer — the same code as
  "no such exercise", no existence oracle — with zero application code. **This is a finding that
  shrank Phase 2**; it was scoped as "map the trigger's error" before the endpoint was read.
- **A composite foreign key cannot work here**, unlike every other nested table in this repository:
  `exercises.user_id` is nullable for the 38 seeded rows, `exercise_entries.user_id` is `not null`, and
  a policy admits a row only on `TRUE`. See `context/foundation/access-control.md` § the
  shared-catalogue variant.
- **A `security invoker` trigger function gets the visibility check for free.** Under PostgREST the
  role is `authenticated`, which does not own the tables, so RLS applies inside the function: a plain
  `select 1 from public.exercises where id = new.exercise_id` returns no row precisely when the
  exercise is neither seeded nor the caller's. The check therefore reuses the existing select policy
  instead of restating it — one definition, not two.
- `UNIQUE_VIOLATION` / `FOREIGN_KEY_VIOLATION` are already exported from
  `src/lib/services/workouts.ts:23-24`.

## What We're NOT Doing

- **Not rebuilding the US-04 proof.** The existing suites are the proof; this plan cites them and adds
  what is missing.
- **Not changing `on delete restrict` on `exercise_id`.** It is a deliberate decision recorded in the
  migration: an exercise with logged history cannot be deleted at all.
- **Not changing `exercises.user_id` to `on delete set null`.** That would turn a deleted account's
  private exercises into shared rows and leak their names to every account.
- **Not handling the deletion failure path.** A blocked cascade answering honestly belongs to
  `account-deletion`; this slice owns whether the blocking row can exist. Stated once, in both
  `change.md` files, because `lessons.md` records what happens when a handover merges two decisions.
- **Not deploying.** Production is served from `main`; both branches carry a migration, so `db:push`
  and `wrangler deploy` run once after both PRs merge.
- **No E2E.** Phase 3 of the course owns the browser level.

## Implementation Approach

One migration adding a trigger function and a `before insert or update` trigger; one new integration
suite that owns the whole of this slice's evidence; one assertion for the sign-out gap. The endpoint
is expected to need no change — Phase 2 proves that rather than assuming it.

## Critical Implementation Details

**The trigger's error message must not contain the workout-owner constraint name.**
`src/pages/api/exercise-entries/index.ts:53` discriminates `workout_not_found` from
`exercise_not_found` by `message.includes(WORKOUT_OWNER_CONSTRAINT)`. A trigger raising
`foreign_key_violation` whose message happened to mention that constraint would flip every rejected
exercise into "workout not found". Name the trigger and its message after the exercise.

**Measure before constraining.** A `before insert or update` trigger does not validate existing rows,
so a violating row already stored stays and stays invisible. Phase 1 counts violations in **both**
hosted projects before the migration is written, and the plan branches on the answer rather than
assuming zero.

---

## Phase 1: The trigger, and the proof that it bites

### Overview

Measure existing violations, add the trigger, and build the suite that would notice its removal.

### Changes Required

#### 1. Measurement (no file — a recorded step)

**Intent**: establish, before writing the migration, whether either hosted project already holds an
`exercise_entries` row whose `exercise_id` names an exercise that is neither seeded nor owned by the
entry's `user_id`. The result decides whether the migration needs a data step.

**Contract**: one read-only query run against `SUPABASE_DB_URL` and `SUPABASE_TEST_DB_URL`, joining
`exercise_entries` to `exercises` on id and filtering `e.user_id is not null and e.user_id <>
ee.user_id`. Record both counts in `## Progress`. **If either is non-zero, stop and escalate** — the
choice between deleting somebody's logged sets and leaving a known hole is the owner's.

#### 2. The trigger

**File**: `supabase/migrations/<timestamp>_scope_exercise_entries_to_visible_exercises.sql`

**Intent**: refuse, in the database, any `exercise_entries` row whose `exercise_id` is not visible to
the row's owner — on insert and on update alike, because `exercise_entries` carries an UPDATE policy
and re-pointing an entry is the same hazard through a second door.

**Contract**: a `security invoker` trigger function in `public`, and a `before insert or update of
exercise_id` trigger on `public.exercise_entries`. The function raises `foreign_key_violation`
(`23503`) so the existing endpoint mapping applies unchanged; its message names the exercise and must
not contain `exercise_entries_workout_owner_fkey`. Pin `search_path` on the function. The visibility
check is a bare existence query against `public.exercises` — RLS supplies the predicate, so the select
policy is not restated.

The migration header states why a composite foreign key was not used, so the next reader meets the
nullable-owner reason rather than assuming an oversight.

#### 3. The suite

**File**: `tests/integration/account-boundary.test.ts`

**Intent**: own every claim this slice makes, in one place a reviewer can read as the US-04 dossier,
with its own fixtures so the parallel branch cannot collide with it.

**Contract**: MARK `s09i-` — not a prefix of, and not prefixed by, `s03-`, `s08-` or any existing
mark. Its own throwaway accounts; **never** `rls-owner-a/b`. Assertions:

1. account B cannot **insert** an entry naming account A's private exercise — refused, and the row is
   absent when re-read as B;
2. account B cannot **update** its own entry onto account A's private exercise — refused, and the
   entry still names what it named before;
3. a **seeded** exercise is still insertable by both accounts (the trigger must not break the
   catalogue, which is the whole point of the nullable owner);
4. an account's **own private** exercise is still insertable by that account;
5. **the seam**: with the hazard row refused, account A's private exercise has no foreign reference
   from another account, so the cascade that account deletion depends on is not blocked. Title this
   assertion after what its body checks — `lessons.md` § "A test whose title claims more than its body
   asserts becomes the citation";
6. cross-account reads at all three levels still refused (a thin restatement citing
   `workout-log-rls`, present so the dossier is readable on its own — and labelled as a restatement,
   not as new coverage).

### Success Criteria

#### Automated Verification

- Violation counts recorded for both projects, and both are zero (or escalated): the query in step 1
- Migration applies to both projects: `npm run db:push`
- The new suite passes: `npm run test:integration`
- The suite is repeatable: run `npm run test:integration` twice, second run green
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- **Mutation (a)**: drop `or update of exercise_id` from the trigger → assertion 2 fails
- **Mutation (b)**: remove the trigger entirely → assertions 1 and 2 fail
- **Mutation (c)**: change the check to accept any exercise row (`user_id is not null` removed from
  the reasoning — i.e. make the function `return new` unconditionally) → assertions 1 and 2 fail
- **Mutation (d)**: make the function raise a code other than `23503` → Phase 2's endpoint assertion
  fails, confirming the mapping is load-bearing rather than incidental
- Every mutation's failure is read, not just its colour: `lessons.md` § "A mutation that fails for the
  WRONG REASON has not confirmed the guard"

#### Manual Verification

- The migration header explains the nullable-owner reason a composite key was not used, and a reader
  who has not seen this plan can tell why the trigger exists

**Implementation Note**: pause after this phase for confirmation before proceeding.

---

## Phase 2: The sign-out gap, and proving the endpoint already answers correctly

### Overview

Cover US-04's third criterion, and verify the expectation that no application change is needed.

### Changes Required

#### 1. The sign-out assertion

**File**: `tests/integration/account-boundary.test.ts`

**Intent**: assert US-04's third criterion — signing out ends read access — at the level of the
session rather than the screen.

**Contract**: sign in as this suite's own account, read a training row successfully, `signOut()`, then
retry the identical read **with the same client** and assert it is refused and returns no training
data. The claim is session invalidation; the title must not imply anything about the UI.

#### 2. The endpoint mapping

**File**: `tests/integration/account-boundary.test.ts` (assertion) — **no source change expected**

**Intent**: confirm that `POST /api/exercise-entries` answers `404 exercise_not_found` when the trigger
refuses, and **not** `500 unexpected` and **not** `workout_not_found`. If it does not, the endpoint
gains a branch; if it does, the plan records that the existing mapping covered it.

**Contract**: call the exported handler as account B with account A's private exercise id, in the
pattern of `tests/integration/workout-endpoints.test.ts` — never through `astro dev`, whose
`.dev.vars` point at production. Assert status and message code, then re-read as B to confirm nothing
was stored.

### Success Criteria

#### Automated Verification

- Both assertions pass: `npm run test:integration`
- The endpoint answers `404 exercise_not_found`, and the plan states whether a source change was
  needed — either outcome is recorded, neither is assumed
- The full gate passes: `npm run lint` → `npm run typecheck` → `npm test` → `npm run test:render` →
  `npm run test:integration` → `npm run build`

#### Manual Verification

- None. This phase adds no user-visible behaviour.

---

## Phase 3: Documents, and the pull request

### Overview

Make the documents true, then open the PR.

### Changes Required

#### 1. `AGENTS.md`

**Intent**: record the trigger as the answer to the unscoped-`exercise_id` hazard the file already
documents twice (§ Domain rules → "Under `security_invoker`, a JOIN is a FILTER", and § Known state).
Both currently describe the hazard as open.

**Contract**: amend those two places to say it is closed, by what, and name
`account-boundary.test.ts` assertions 1 and 2 as what would notice the trigger being dropped. Add the
trigger to `context/foundation/access-control.md` as the exception to "the composite key is how nested
ownership is closed" — with the nullable-owner reason, so nobody re-derives it.

#### 2. `README.md`

**Intent**: the route table's `/api/exercise-entries` row should say that an exercise the caller cannot
see is refused like one that does not exist.

**Contract**: one row amended; no new section.

#### 3. `context/foundation/lessons.md`

**Intent**: append one entry — a single-column foreign key to a table with a select policy is an
ownership hole that no policy on either table will show you, and it has as many ends as the table has
cascades.

**Contract**: appended at the end, in the register's Context / Problem / Rule / Applies-to shape.

#### 4. Change and roadmap bookkeeping

**Contract**: `change.md` → `status: implemented`; roadmap item **S-09 `account-boundary`** annotated
as split into `cross-account-isolation` and `account-deletion` and flipped to `in-progress`.

#### 5. The pull request

**Contract**: PR from `feature/cross-account-isolation` to `main`, body naming the defect, the closure,
the measured violation counts, and the fact that the deployment is shared with `account-deletion` and
runs after both merge. **Do not merge** — this is one of the two PRs M2 deliverable 5 asks for, and it
wants a solo review first.

### Success Criteria

#### Automated Verification

- Full gate green: all six steps
- CI green on the pushed branch
- Every test file and assertion number named in the amended documents exists

#### Manual Verification

- The PR body is readable by somebody who has not seen this plan
- `AGENTS.md` no longer describes the hazard as open anywhere

---

## Post-merge (shared with `account-deletion`, owned by neither alone)

`npm run db:push` for both migrations, then `npx wrangler deploy`, then confirm on the public URL.
Runs once, after both PRs merge, because `db:push` advances production and each branch carries its own
migration. Recorded here and in `account-deletion`'s plan identically.

## Testing Strategy

### Integration Tests

`tests/integration/account-boundary.test.ts`, MARK `s09i-`, own throwaway accounts, fixtures reset in
`beforeAll` and restored in a `finally` — and each precondition established by this suite itself rather
than trusted from another, per `lessons.md` § "A `finally` that restores shared state does not survive
a killed process".

### Manual Testing Steps

None. This slice changes no screen.

## Performance Considerations

The trigger adds one indexed primary-key lookup per entry insert or `exercise_id` update. Entries are
created at human speed, one per exercise per workout, so this is not on any hot path and is nowhere
near the 10 ms Worker CPU cap.

## References

- Change identity and the seam: `context/changes/cross-account-isolation/change.md`
- The hazard, from the tonnage side: `AGENTS.md` § Domain rules, and assertion 9 of
  `tests/integration/tonnage-breakdown.test.ts`
- Why a composite key does not transfer: `context/foundation/access-control.md`
- Sibling slice: `context/changes/account-deletion/change.md` on `feature/account-deletion`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles.

### Phase 1: The trigger, and the proof that it bites

#### Automated

- [ ] 1.1 Violation counts recorded for both projects, and both zero (or escalated)
- [ ] 1.2 Migration applies to both projects: `npm run db:push`
- [ ] 1.3 The new suite passes: `npm run test:integration`
- [ ] 1.4 The suite is repeatable: second consecutive run green
- [ ] 1.5 Type checking passes: `npm run typecheck`
- [ ] 1.6 Linting passes: `npm run lint`
- [ ] 1.7 Mutation (a): dropping `or update of exercise_id` fails assertion 2
- [ ] 1.8 Mutation (b): removing the trigger fails assertions 1 and 2
- [ ] 1.9 Mutation (c): an unconditional `return new` fails assertions 1 and 2
- [ ] 1.10 Mutation (d): a raised code other than `23503` fails Phase 2's endpoint assertion
- [ ] 1.11 Every mutation's failure message read and confirmed to be the intended one

#### Manual

- [ ] 1.12 The migration header explains why a composite key was not used

### Phase 2: The sign-out gap, and proving the endpoint already answers correctly

#### Automated

- [ ] 2.1 Both assertions pass: `npm run test:integration`
- [ ] 2.2 The endpoint answers `404 exercise_not_found`; the outcome is recorded, not assumed
- [ ] 2.3 The full six-step gate passes

### Phase 3: Documents, and the pull request

#### Automated

- [ ] 3.1 Full gate green: all six steps
- [ ] 3.2 CI green on the pushed branch
- [ ] 3.3 Every test file and assertion number named in the amended documents exists

#### Manual

- [ ] 3.4 The PR body is readable by somebody who has not seen this plan
- [ ] 3.5 `AGENTS.md` no longer describes the hazard as open anywhere
