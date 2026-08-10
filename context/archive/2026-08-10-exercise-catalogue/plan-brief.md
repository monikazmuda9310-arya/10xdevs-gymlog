# Exercise Catalogue — Plan Brief

> Full plan: `context/changes/exercise-catalogue/plan.md`

## What & Why

Give the user something to log against. The database holds exactly one table today, so there is no
way to name a lift — which means S-03, the north star, cannot start. This slice adds a catalogue of
38 seeded exercises readable by every account, plus a private catalogue each account can add to,
with exactly one primary muscle group and a bodyweight flag per exercise.

## Starting Point

`public.profiles` is the only table. It established the access-control pattern every later table
copies: `revoke all` then explicit grants, one policy per operation, all `to authenticated`,
`(select auth.uid())` never bare. Two enums exist, `set_updated_at()` is reusable, `src/types.ts`
derives every type from the generated schema, and S-01 left a validation stack whose rule — a
redirect carries a message **code**, never text — this slice copies.

## Desired End State

A signed-in user opens `/exercises`, sees 38 exercises, filters by muscle group, searches by name,
and adds their own. Their custom exercises are invisible to every other account, and **no account can
write into the shared catalogue** — enforced in the database and proven by a test that re-reads as
the other account. The schema is ready for S-03 to hang `sets` off a single `exercise_id`.

## Key Decisions Made

The owner settled the taxonomy before planning; the rest were decided by the planner, at the owner's
request, while they were away from the machine. Each is stated in the plan with what would have to be
true for it to be wrong.

| Decision                 | Choice                                        | Why (1 sentence)                                                                                               | Source |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Muscle groups            | Six: legs, back, chest, shoulders, arms, core | Adding a group later is cheap; merging or removing one rewrites history.                                       | Owner  |
| Multi-joint assignment   | The group the lifter programmes it for        | Deadlift → `back`, Romanian Deadlift → `legs`; the chart's job is to show an unbalanced week.                  | Owner  |
| Seed contents            | 38 exercises, fixed list in the PRD           | Covers the persona's training without becoming a reference work.                                               | Owner  |
| Table shape              | **One table, nullable `user_id`**             | S-03 must hang every set off a single `exercise_id`; two tables force two nullable FKs and a check constraint. | Plan   |
| Muscle group storage     | Postgres enum                                 | Two enums already exist, the set is closed at six, and the generated TypeScript union stays exact.             | Plan   |
| Edit / delete            | Policies yes, UI no                           | Correcting a group rewrites historical per-group tonnage — and tonnage does not exist until S-07.              | Plan   |
| Per-group tonnage source | The exercise's **current** group              | Matches "records are derived, never stored as trophies"; decided now because S-03's schema depends on it.      | Plan   |
| Filtering & search       | Client-side, `ilike` with escaped wildcards   | Tens of rows; a round trip per keystroke would be slower and spend CPU the free plan caps at 10 ms.            | Plan   |

## Scope

**In scope:** the `exercises` table with RLS for dual visibility; the `muscle_group` enum; the
38-exercise seed; a service layer and a create endpoint with zod validation; `/exercises` with
browse, filter, search and add; documentation.

**Out of scope:** editing and deleting custom exercises in the UI (policies ship, screens do not);
a `glutes` group or an `arms` split; full-text or fuzzy search; images, equipment tags, notes,
favourites, reordering; a shadcn component sweep; the user-facing half of Open Question 2.

## Architecture / Approach

One table, `public.exercises`, where **`user_id is null` means "seeded, everybody reads it"** and a
non-null `user_id` means "private to that account". Only the select policy differs from the standard
template — `using (user_id is null or (select auth.uid()) = user_id)`. The three write policies are
unchanged, and that is the subtle part: `auth.uid() = null` evaluates to `null`, not `true`, and a
policy admits a row only on `true`, so the ordinary owner-check already makes seeded rows unwritable
without naming them. **Because that protection is a side effect of three-valued logic rather than a
stated rule, the test suite asserts it explicitly** — otherwise a later "simplification" of the
insert policy would open the shared catalogue to every account and nothing would notice.

Above the database: a service in `src/lib/services/`, zod validation split the way S-01 split it
(import-free rules for the island, schemas server-side), a JSON endpoint, an Astro page with a React
island for interaction.

## Phases at a Glance

| Phase                 | What it delivers                              | Key risk                                                                               |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1. Table & boundary   | Schema, four policies, types, RLS test suite  | A permissive policy is far cheaper to find now than after 38 shared rows exist         |
| 2. Seed               | 38 exercises as shared rows, idempotent       | A mis-assigned row; caught by asserting the per-group distribution, not just the total |
| 3. Service & endpoint | Read and create, validated, no provider prose | Duplicate-name handling returning a 500 instead of a message                           |
| 4. Screen             | `/exercises` — browse, filter, search, add    | First non-auth screen; phone-width usability is a real requirement, not a nicety       |
| 5. Documents          | AGENTS.md, README, roadmap                    | The shared-catalogue variant being copied wrongly by S-03                              |

**Prerequisites:** S-01 (done, archived) and F-03 (done). Both Supabase projects reachable;
`.env` already carries every key this needs. No new secret, no new dependency.

**Estimated effort:** ~2–3 sessions across five phases. Phases 1 and 4 carry most of the work;
2 and 5 are short.

## Open Risks & Assumptions

- **The shared catalogue is protected by an accident of three-valued logic.** Correct, but nothing
  in the policy text says "seeded rows are read-only". One integration assertion is the whole guard.
- **Decision 4 binds S-03**: if sets ever snapshot the muscle group, Open Question 2 gets answered by
  accident, in a direction nobody chose. Overturning it after S-03 ships means a data migration.
- **This is the first slice that writes _content_ to the production database** rather than structure.
  Both migrations are additive and the seed is idempotent, but it is still a write.
- **Nothing enforces `npm run db:types` after a push** — the known gap in `STATE.md` § Ryzyka #5. A
  push without a regenerate type-checks against stale types.

## Success Criteria (Summary)

- A signed-in user can find a lift by name or muscle group and add one that is missing.
- A second account sees the same 38 exercises and none of the first account's custom ones — proven
  against stored rows, not response codes.
- S-03 can start: every set will reference one `exercise_id`, and per-group tonnage has a column to
  group by.
