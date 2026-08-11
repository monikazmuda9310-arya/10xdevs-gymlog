# Edit and Delete the Log — Plan Brief

> Full plan: `context/changes/edit-and-delete-log/plan.md`

## What & Why

The user can log a workout but cannot correct one. A mistyped weight is permanent, a workout logged
twice stays twice, and every derived number is built on top of the mistake. S-05 adds the four
correcting operations — edit a workout's date and note, delete a workout, remove an exercise from a
workout, edit or delete a set — each preceded by a warning naming which personal record it holds and
what that record will fall to (FR-006, FR-007, FR-010, US-02). It closes the last gap in the badge's
"meaningful CRUD" criterion.

## Starting Point

The database is already prepared: S-03's migration granted `update` and `delete` on all three tables
with matching per-operation policies and `on delete cascade` between the levels, and said in a comment
that the missing screens were **scope for S-05, not permission**. Records are derived by two
`security_invoker` views and stored nowhere. What does not exist is any write path other than insert —
S-03's review confirmed `.update(`, `.delete(` and `.upsert(` appear nowhere in `src/`. So twelve
policies exist that application code has never exercised.

## Desired End State

On `/workouts/<id>` the user can change the date and note in place, delete the workout, remove an
exercise from it, and edit or delete any set — each irreversible action stopped by a dialog naming the
records at stake and what each falls to. Afterwards `/records` reflects the new truth on the next
read, with no write to any record and nothing to invalidate.

## Key Decisions Made

| Decision                              | Choice                                                                   | Why (1 sentence)                                                                                                                | Source |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Number shown when editing a set       | The successor from SQL, in a conditional sentence                        | Computing the post-edit estimate in float64 and comparing it to Postgres's exact `numeric` is the one comparison the project forbids. | Plan   |
| Which records the warning covers      | Both — estimate **and** heaviest                                          | The existing top-two query only ranks estimates, so deleting a heaviest-record set gives no warning at all today.                | Plan   |
| Query shape for the warning           | "Best surviving candidate, excluding what disappears" + holders from the view | Top-two is exact for one set but wrong for an entry or a workout, which can remove the leader *and* the runner-up.           | Plan   |
| Removing an exercise from a workout   | In scope, as a fourth operation                                           | Without it, deleting an entry's last set leaves a row that can only be cleared by deleting the whole workout.                   | Plan (§6.6 owner decision) |
| Weight unit on a set edit             | Whatever the row already stores                                           | Re-stamping it from the profile would turn 100 lb into 100 kg after S-06 and corrupt every figure derived from `weight_kg`.      | Plan   |
| Deleting a whole workout              | Collective warning listing every exercise and value                      | It is the only operation that can take several records with one click.                                                          | Plan   |
| Where the operations live             | The workout page; the list stays navigation                              | One surface for all four, and it is where the user already is when they spot the mistake.                                       | Plan   |
| API shape                             | Resource routes `/[id]` with `PATCH`/`DELETE` and an `/impact` sibling   | Leaves the three existing `POST` endpoints untouched, so the assertions pinning them cannot move.                                | Plan   |
| Island state after a change           | Replace with the row the server returned                                  | Derived figures on that screen recompute from the array by themselves, and `weight_kg` is never guessed client-side.             | Plan   |
| Ephemeral record badge                | Disappears whenever its set is edited or deleted                          | "This set beat your record" may be false after an edit, and a false badge is the same defect class as S-03's placeholder.        | Plan   |
| Week-boundary warning on a date edit  | Deferred to S-07, proved instead                                          | Tonnage does not exist yet, so the warning would describe numbers nobody has seen; nothing is stored, so nothing needs migrating. | Plan   |
| Browser test runner                   | Not in this slice                                                         | Course Phase 3 owns E2E through `/10x-e2e` with two chosen risks.                                                               | Plan   |
| A failed impact preflight             | Third dialog state: "consequence unknown", action still allowed          | An empty impact list is a positive claim; falling back to it would tell the user nothing is at stake exactly when we cannot know. | Plan review (F2) |
| No-successor outcomes                 | Two distinct outcomes, never one `null`                                   | "No estimated record" and "gone from the records list" are different futures and must not share a sentence.                      | Plan review (F6) |

## Scope

**In scope:** edit workout date and note · delete a workout with its children · remove an exercise
from a workout · edit and delete a set · record-impact warning covering both records · six resource
routes with preflights · the first integration suite exercising the update/delete policies · deploy
with an explicit push-and-CI criterion.

**Out of scope:** any migration or new database object · stored records or caches · a tonnage warning
on a date change (S-07) · Playwright · undo, soft delete or bulk operations · changing which exercise
an entry points at · bounding `listWorkouts`.

## Architecture / Approach

Postgres ranks, TypeScript reads the ranking, and only **identifiers** are compared — the seam S-04
established. `public.personal_records` already reports who holds each record and in which workout, so
"is this record affected" needs no computation. One new query shape answers "the best surviving
candidate, excluding these rows", parameterised by set, entry or workout, and serves all four
operations. A pure module (`record-impact.ts`) exports **two** functions, because the data flow forces
the split: `affectedRecords` decides from ids alone which records this removal takes off their holder,
the endpoint then fetches only those successors, and `fallingRecords` pairs them up. A display
function re-derives each printed figure from the surviving set's typed weight, so no number computed
by SQL is ever shown.

## Phases at a Glance

| Phase                                 | What it delivers                                                      | Key risk                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. What falls, and to what            | Two successor queries, the pure decision module, integration coverage | The ordering now exists in three places; a drift makes the warning name the wrong set          |
| 2. The writes                         | Validation, five services, six handlers, the mutation-boundary suite  | A zero-row update under RLS reports success — a `204` there would be a lie and an oracle       |
| 3. The screens                        | Editable header, per-set edit/delete, entry delete, the dialog        | The dialog primitive is a new client dependency; the island's size must be measured, not assumed |
| 4. Deploy and prove it                | Worker shipped and exercised under the public address                 | Session 8 twice left work unpushed while production served it — now an automated criterion     |
| 5. Documents                          | AGENTS.md, README, lessons, STATE.md, roadmap                         | Writing a claim no test backs                                                                  |

**Prerequisites:** S-04 and F-01, both done and archived. No new secret, no schema change, no owner
action before Phase 4.
**Estimated effort:** ~1–2 sessions across five phases; Phase 3 is the largest.

## Open Risks & Assumptions

- **Index usage is unverifiable here.** `gymlog-test` holds a few dozen sets, so `explain` proves
  nothing about the plan on a real log. Inherited from S-04's review; S-07 and S-08 inherit it too.
- **The successor ordering is a third copy** of a rule that already lives in the view and in
  `topTwoEstimatesForExercise`. Pinned by assertion, but it is the fragile spot in this slice.
- **`@radix-ui/react-alert-dialog` is a new client dependency.** Phase 3 records the island's built
  size before and after rather than assuming the cost is negligible.
- **Twelve update/delete policies have never been exercised.** Phase 2's suite is the first thing to
  test them; if any is wrong, it surfaces there and not before.
- **Open Question 2's interface half stays open** and is handed to S-07 in writing.

## Success Criteria (Summary)

- The user can correct anything they logged, and is told what a correction costs before it happens.
- A record that falls, falls to the value the dialog named — verified on the deployed URL, not only
  in tests.
- No account can mutate another's rows, asserted against re-read state rather than status codes.
