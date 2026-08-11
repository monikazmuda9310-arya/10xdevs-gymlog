---
change_id: personal-records
title: A record is announced when it happens, and listed afterwards
status: archived
created: 2026-08-11
updated: 2026-08-11
archived_at: 2026-08-11T13:57:42Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Roadmap item S-04 (`context/foundation/roadmap.md` § Slices). PRD refs: US-02, FR-020, FR-021.
Prerequisites S-03 and F-01, both `done`.

Inherited from S-03, and expensive to get wrong — the archived plan and review are at
`context/archive/2026-08-10-log-workout-with-estimate/`:

- **Records are derived, never stored as trophies.** A record is always the best _surviving_ set,
  recomputed when the underlying sets change, so it may go **down** after an edit or delete. Adding
  an `estimated_1rm` column would turn S-06's formula change from a re-derivation into a lie.
- **A personal record is decided on estimated 1RM**, not raw weight; the heaviest absolute weight is
  a second, distinct record.
- **Compare on `sets.weight_kg`, never on `weight`** — `weight` is what the user typed, in whatever
  unit they typed it.
- `src/lib/services/set-display.ts` already computes the best estimate across a set of sets
  (`bestEstimateOf`), skipping bodyweight, assisted and out-of-range sets.
- The index `exercise_entries (user_id, exercise_id)` was created in S-03 specifically for this
  slice's central question — "every set this account has logged for this exercise" — so no migration
  is needed to make that query travel.
- Any new nested table takes the **nested-ownership variant** in `AGENTS.md` § Access control (own
  `user_id` **plus** a composite foreign key to the parent's `(id, user_id)`). The four-policy
  template alone is a defect at depth 2.
- Aggregation belongs in Postgres, not in the Worker: the Free plan kills an invocation at 10 ms of
  CPU, and this slice's query walks every set of an exercise across the whole history.

### Three unknowns `/10x-research` should settle before a plan is written

Named at the end of session 7, before the change was researched. Each one changes the plan's shape,
not just its wording:

1. **Where the record is computed.** The query walks every set ever logged for an exercise, against
   a 10 ms CPU cap, so it probably belongs in Postgres as a view or a function rather than in the
   Worker. The open part is how that interacts with RLS: a view does **not** inherit the querying
   account's policies by default, and getting this wrong is an access-control defect, not a
   performance one. `security_invoker` is the thing to check.
2. **When the record is announced.** FR-020 says at save time, but `/api/sets` today returns the
   logged set and nothing else. Attaching a verdict changes the contract of an endpoint S-03 has
   just stabilised and which three integration assertions pin — so either the response grows a
   field, or the screen asks a second time. Decide deliberately.
3. **How much of "a record can fall" belongs here.** US-02 requires the user to be warned which
   record will drop and by how much **before confirming** an edit or a delete — but editing and
   deleting are S-05. S-04 has to decide whether it builds the drop rule now (and leaves it with no
   caller) or defers it whole. S-03 hit the mirror image of this and deferred; the reasoning is in
   its plan's § What We're NOT Doing.

All three were settled by `research.md`; D2 and D3 were settled by the owner on 2026-08-11 and are
recorded there under § Decisions.

## Deviations from the plan

### Phase 1 — the mutation protocol found a guard that does not guard

The plan's criterion 1.7 expected **four** mutations, each breaking a named assertion. Five were run
and **four broke a test; one did not**, which is the finding:

| Mutation                                             | Expected to break | Actually broke                 |
| ---------------------------------------------------- | ----------------- | ------------------------------ |
| `set_estimates` loses `security_invoker`             | assertion 2       | assertion 2 ✔                  |
| `personal_records` loses `security_invoker`          | assertion 2       | **nothing — 8/8 still passed** |
| `::numeric` cast dropped from the Epley branch       | assertion 4       | assertions 4 and 4b ✔          |
| heaviest-weight subquery admits a zero load (`>= 0`) | assertion 5       | assertion 5 ✔                  |
| estimate guard admits a zero load (`< 0`)            | assertion 4       | assertion 4 ✔                  |

**Why the second one is not a defect in the view but a false claim in the comment.** Postgres does
not `SET ROLE` for a view — it decides which role the underlying relations are permission- and
RLS-checked as. Every row `personal_records` emits is drawn through `set_estimates`, which still
carries the flag and hands that decision back to the real caller partway down the chain. So the
outer view's flag protects nothing **today**, and no assertion writable from the integration suite
could catch its removal (`authenticated` has no `pg_class` access through PostgREST).

**Resolution (owner, 2026-08-11): keep the flag on both views, and correct the claim.** The migration
header now states which flag is load-bearing, which is defence in depth, that no test covers the
second, and names the future edit that would make it load-bearing — pointing `personal_records` at
`public.sets` directly to skip a level. The test file's header carries the same correction. Removing
the flag was rejected (that edit is plausible and would then leak silently); restructuring the view
so the flag becomes testable was rejected because it would put a third copy of the 1RM formula into
the schema, which is the risk this whole design exists to minimise.

### Phase 2 — the endpoint needed no extra read, and one test was rewritten

- The plan said to extend `getEntryForSet` so the verdict could reach the exercise id. It already
  returned it: S-03 loads `exercises ( id, is_bodyweight )` to answer the bodyweight rule. The
  verdict therefore costs one query, not two.
- An assertion written as "still answers 201 when the verdict cannot be computed" was **rewritten**,
  because its own comment admitted the failure path is unreachable from inside the suite — an empty
  test reading as coverage, which `lessons.md` calls worse than a missing one. It now asserts what
  it can (a plank through the endpoint: 201, stored, no announcement) and names in a comment what it
  does not cover, pointing at manual criterion 2.6, which covers it for real.

### Phase 3 — a display module the plan did not name

`src/lib/services/record-display.ts` (+ its unit tests) was added mid-phase. The plan put the
nullable-column narrowing and the unit conversion in the page. Both are exactly the logic that shows
a wrong number silently, and S-03 hit the identical situation — that is what produced
`set-display.ts` and the `lessons.md` entry about naming the module a unit-test criterion lives in.
Written as a module so it is directly unit-testable, rather than as helpers buried in `.astro`
frontmatter that no test can reach.

### Phase 5 — two edits beyond the phase's stated file list

Phase 5's Changes Required named `AGENTS.md`, `change.md` and `roadmap.md`. Two more files were
touched, both consistent with this repository's conventions and neither planned:

- **`context/foundation/lessons.md`** gained the entry "When a mutation does not break anything, fix
  the claim — never the test", generalising the Phase 1 finding. The roadmap's § Done entries cite
  `lessons.md` for exactly this kind of rule, so the convention called for it; the plan simply did
  not say so.
- **`README.md`** gained `/records` in the routes table and the `{ set, record }` contract under
  `/api/sets`. README documents every route, so leaving it out would have made it wrong by omission.

### Phase 3 — the visual criteria are verified in Phase 4, once, on the public address

Criteria 3.5–3.8 and 3.10 all require logging a set, and `astro dev` reads its Supabase credentials
from `.dev.vars`, which points at **production** — a scripted or local click-through would put
throwaway sets into the database the owner trains against (`AGENTS.md` § Cloudflare traps). 3.9
(route protection) was verified with a read-only probe: `GET /records` while signed out answers
`302 → /auth/signin`, matching `/workouts`.

**Resolution (owner, 2026-08-11): merge the remaining Phase 3 manual checks into Phase 4's
click-through**, which happens against the deployed URL where those checks belong anyway. Phase 3
is committed with those Progress rows still open; they close together with Phase 4's.
