# Log a Workout and See What It Was Worth — Plan Brief

> Full plan: `context/changes/log-workout-with-estimate/plan.md`
> Research: `context/changes/log-workout-with-estimate/research.md`

## What & Why

This is the north star: the slice where the product finally does the arithmetic it exists for. The
user creates a workout dated today, adds an exercise from the catalogue, types repetitions and a
weight, and immediately sees an estimated one-rep max. Everything before this — the account, the
catalogue, the deployment — was scaffolding for it.

## Starting Point

The formula has been finished and unused since F-01: `src/lib/services/one-rep-max.ts` is correct,
dependency-free and pinned by tests at every boundary the domain rules name, with **no caller
anywhere in `src/`**. Three tables exist (`profiles`, `exercises`, and the enums), and S-02 left a
vertical-slice template that this change copies file by file. Missing: the training record itself,
any service that reads a profile preference, and any screen past the catalogue.

## Desired End State

A signed-in user opens `/workouts`, sees their sessions most recent first, and creates one whose
date already reads as today **in their own timezone**. On the workout page they add exercises and
log sets; each set shows an estimate, or says why there is none — "bodyweight", "assisted", or
outside the 1–12 repetition range. Each exercise entry shows the best estimate among its own sets.
Everything survives a reload, and no other account can read, write, or attach anything to it.

## Key Decisions Made

| Decision                          | Choice                                                          | Why (1 sentence)                                                                                     | Source   |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| Weight storage                    | As entered + its unit + generated `weight_kg`                   | Makes the lb round-trip true by construction rather than by a precision argument.                    | Research |
| Workout date type                 | `date`, with "today" computed in the profile timezone           | The user states the date; re-projecting it later would move a session off the day they trained.      | Research |
| Deleting an exercise with history | `on delete restrict`, written explicitly                        | The PRD guarantees a saved workout is never silently lost.                                           | Research |
| Zero-load sets                    | Estimator still returns 0; the screen says "bodyweight"         | A presentation rule, so F-01's tests and the `AGENTS.md` sentence stay untouched.                    | Research |
| Test/production projects          | Two Supabase projects stay two                                  | CI starts writing real training rows here; merging would point them at the owner's own database.     | Research |
| Screens                           | `/workouts` list + `/workouts/[id]` detail                      | A workout can be linked to and returned to between sets; the list is FR-005's confirmation step.     | Plan     |
| Save granularity                  | Incremental — every entity written when created                 | An hour of logging must not live in a phone's browser tab.                                           | Plan     |
| Zero/negative load                | Allowed only on exercises flagged bodyweight                    | Exactly what FR-014 says; catches a mistyped `0` on a squat before it zeroes a week's tonnage.       | Plan     |
| Same exercise twice in a workout  | One entry per exercise; re-choosing is idempotent               | Makes "the best estimate of that entry" (FR-015) unambiguous, enforced by the database.              | Plan     |
| Failed save mid-workout           | Keep the typed values, manual retry, no automatic retry         | An auto-retry after a lost response writes the same set twice — inflated tonnage and a false record. | Plan     |
| Nested ownership                  | Composite foreign keys `(parent_id, user_id)`                   | The four-policy template alone lets an account graft its own row onto somebody else's parent.        | Planner  |
| Stored weight unit                | Read from the profile server-side, never from the body          | A client naming the unit could poison every derived number through `weight_kg`.                      | Planner  |
| Bodyweight rule enforcement       | In the endpoint, not the database                               | It depends on a column in another table; denormalising the flag would be the snapshot S-02 forbade.  | Planner  |
| The display rule                  | New module `set-estimate.ts`, not an extension of the estimator | `one-rep-max.ts` is documented as having no rounding and no unit awareness, and must stay that way.  | Planner  |

## Scope

**In scope:** three tables with RLS and nested-ownership keys; a pure display rule for what a set
shows; "today" in the user's timezone; a profile-preferences service; a workouts service; three JSON
endpoints; the list and workout screens; unit and integration tests; deployment verified on the
public address; documentation.

**Out of scope:** editing or deleting anything (S-05); personal records (S-04); tonnage and weekly
totals (S-07/S-08); the unit/formula/timezone preference screen (S-06); a calendar view; reordering
exercises; offline capture or a retry queue.

## Architecture / Approach

```
/workouts            ──> listWorkouts + getProfile ──> NewWorkoutForm (island)
/workouts/[id]       ──> getWorkout + listExercises + getProfile
                            └─> WorkoutDetail (island)
                                  ├─ ExercisePicker  ─POST /api/exercise-entries
                                  ├─ AddSetForm      ─POST /api/sets
                                  └─ estimateForSet(weight, reps, formula)   [pure, shared]

workouts ──< exercise_entries ──< sets
   each carries its own user_id AND a composite FK (parent_id, user_id) → parent (id, user_id)
```

Server-rendered pages fetch through services in the frontmatter; islands post JSON and resolve every
failure through a message-code catalogue, never by rendering server text. The estimate is computed
by one pure function used on both sides, so the server render and the just-added set cannot disagree.

## Phases at a Glance

| Phase                      | What it delivers                                                                                          | Key risk                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Tables & boundary       | Three tables, twelve policies, composite keys, RLS suite                                                  | The graft: a valid `user_id` on a row attached to somebody else's parent                |
| 2. The estimate as a value | `estimateForSet`, `todayIn`, `getProfile`, tests + mutations, a temporary workerd probe for timezone data | Unit tests run in Node, which has full ICU; the runtime is workerd, which may not       |
| 3. Services & endpoints    | Workouts service, validation split, three JSON endpoints                                                  | Provider prose or a server-chosen unit leaking into the request body                    |
| 4. The screens             | `/workouts`, `/workouts/[id]`, four islands, route guard                                                  | `SubmitButton`'s `useFormStatus` spinner that never spins on a `fetch` form             |
| 5. Deploy & prove          | The flow working on the public URL                                                                        | Everything green while production has tables no route can reach — S-02's actual failure |
| 6. Documents               | `AGENTS.md`, `README.md`, roadmap baseline                                                                | The composite-key pattern staying undocumented and not copied by the next nested table  |

**Prerequisites:** S-02, F-01 and F-03 are done; the Worker already holds `SUPABASE_URL` and
`SUPABASE_KEY` from S-01, so no new secret is needed. Database pushes are applied by hand from the
machine, as always.

**Estimated effort:** ~4–6 sessions across six phases; Phases 1 and 4 carry most of the work,
Phases 5 and 6 are deliberately small.

## Open Risks & Assumptions

- **The graft protection is invisible in the policy text.** Only assertion 4 of the integration suite
  would notice if a later migration replaced the composite key with a plain `references workouts (id)`.
- **The bodyweight rule lives in application code**, because no check constraint can reach across
  tables. An account calling PostgREST directly could store a negative weight on a barbell lift; the
  blast radius is its own numbers, and the arithmetic already refuses to fabricate from them.
- **Production gets the tables in Phase 1 and the screens in Phase 5.** The window is deliberate and
  bounded; Phase 5 is what closes it.
- **`0.45359237` appears in the generated column and nowhere else.** S-06 must import the canonical
  value or read `weight_kg`, or two answers become possible for the same set.
- **The composite key must stay the only foreign key to its parent.** PostgREST embeds through it
  cleanly, but a second, "clarifying" key turns every nested read into `PGRST201`.
- **Workers' ICU completeness is assumed, not documented.** Phase 2's probe converts the assumption
  into a measurement before anything is built on it.
- **`on delete restrict` changes existing behaviour**: from this migration on, an exercise with
  logged history cannot be deleted. No UI exposes that today; whoever builds catalogue editing meets it.

## Success Criteria (Summary)

- A user logs a set on a phone and sees an estimated one-rep max without any further input — and a
  single-repetition set shows exactly the weight they typed.
- The workout is still there after a reload and appears at the top of their list.
- No account can reach another's workout, exercise entry, or set — proven against re-read rows, not
  against status codes — and the whole flow works on the deployed URL, not only locally.
