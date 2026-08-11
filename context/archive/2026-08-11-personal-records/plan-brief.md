# Personal Records — Plan Brief

> Full plan: `context/changes/personal-records/plan.md`
> Research: `context/changes/personal-records/research.md`

## What & Why

S-03 made the product store sets and show what each one is worth. S-04 makes it answer the question a
lifter actually asks: **is this better than what I did before?** A set that beats the previous best
for its exercise says so at the moment it is saved, and `/records` lists what every exercise
currently stands at — the best estimated one-rep max and the heaviest absolute weight, side by side.

## Starting Point

Three tables (`workouts → exercise_entries → sets`), each row owned and each nested level protected by
a composite foreign key. The one-rep-max arithmetic exists in TypeScript, is unit-tested at every
boundary, and already renders per set and per exercise entry. `sets.weight_kg` is generated, so every
comparison has an exact column to run on, and S-03 created the index
`exercise_entries (user_id, exercise_id)` for this slice specifically. What does not exist: any view
or function at all — `Views` and `Functions` in the generated types are both empty, and there is no
`.rpc()` call anywhere. This slice creates the repository's first database object that is not a table.

## Desired End State

Logging a heavier set puts a record badge on that set's own row, naming what it beat, with no reload.
The first set for an exercise establishes a baseline and says nothing. `/records` lists every exercise
the account has logged — including a plank logged only at zero load, which appears with an explanation
rather than vanishing — each record showing its value, the set behind it, and when it happened. No
account can read another's records through the new views, proven against re-read rows.

## Key Decisions Made

| Decision                     | Choice                                                           | Why (1 sentence)                                                                                                                   | Source   |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Where the record is computed | Postgres, two `security_invoker` views                           | The list touches every set ever logged against a 10 ms CPU kill, and one definition prevents the verdict and the list disagreeing. | Research |
| How the verdict is decided   | Ask for the top two sets; compare **ids**, never numbers         | `numeric` and float64 differ in the last bits, and a record decided across that boundary could be invented or erased.              | Research |
| When it is announced         | `/api/sets` grows a sibling `record` field                       | Additive — the three assertions pinning the endpoint read `body.set` — and FR-020 says "at the moment of saving".                  | Research |
| The "record can fall" rule   | Deferred whole to S-05; no helper written                        | S-04 ships no edit or delete path, and its own message already needs the runner-up S-05's warning will reuse.                      | Research |
| "Previous best" means        | Every **other** set, not every earlier one                       | Records are derived from surviving sets; the consequence — back-dating can announce a record today — is asserted, not hidden.      | Research |
| Announcement scope           | One announcement, on the estimate record only                    | At one rep the estimate equals the weight, so a new heaviest single already fires it; a second would usually duplicate it.         | Owner    |
| Heaviest-weight record       | No repetition limit; excludes only `weight_kg <= 0`              | "Heaviest ever handled" is a fact about the load, not an estimate.                                                                 | Owner    |
| Badge persistence            | Ephemeral — gone after a reload; the list is the durable surface | The PRD calls the save-time flag ephemeral in as many words.                                                                       | Owner    |
| Records list row             | Value + the set behind it + the date                             | US-02 requires every record to be backed by a surviving set; showing the set is that evidence.                                     | Owner    |
| Exercise with no record      | Appears, with an explanation                                     | Plank and unweighted pull-up are routine, not edge cases; a logged exercise absent from the list reads as lost data.               | Owner    |
| Browser tests                | Not in this slice                                                | The layer that can lie silently is SQL under RLS, and integration covers it; a browser runner is its own foundation.               | Owner    |
| The records page             | Plain `.astro`, no island                                        | It is static, and React belongs only where interactivity is needed.                                                                | Plan     |
| Verdict failure handling     | Still 201, with `record: null`, logged                           | The set is already committed; an error would invite a manual retry that logs it twice.                                             | Plan     |

## Scope

**In scope:** two Postgres views under the caller's own RLS; a records service and a pure,
unit-tested verdict function; `/api/sets` returning the verdict; the save-time badge; the `/records`
page and its links; an integration suite proving the access boundary and the SQL↔TypeScript parity;
deployment verified on the public address; the documentation of the view variant.

**Out of scope:** editing and deleting (S-05) and therefore the drop warning; a second announcement
for the heaviest weight; a badge that survives a reload; repetition-range records; a browser-test
runner; tonnage of any kind (S-07/S-08); unit or formula preferences (S-06).

## Architecture / Approach

`sets ⋈ exercise_entries ⋈ workouts ⋈ profiles` → **`set_estimates`**, one row per set carrying the
1RM computed with the row owner's own formula. **`personal_records`** sits on top: anchored on the
exercises the account has logged, with each of the two records left-joined on, so an exercise with no
record still produces a row. Both views are `security_invoker = true`, so the caller's RLS applies —
without it a view runs as its owner and returns every account's training to every account.

The seam between the two implementations of the formula is deliberate: **Postgres decides which set
wins, TypeScript decides what number to show.** `/api/sets` asks for the top two sets by estimate,
compares ids, and returns the runner-up; the island re-derives both displayed numbers from the typed
weights through the existing `estimateForLoggedSet`. No number SQL computed ever reaches the screen.

## Phases at a Glance

| Phase                      | What it delivers                                                          | Key risk                                                                                         |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Views, boundary, parity | Both views, regenerated types, and the suite that attacks both guarantees | `security_invoker` omitted → total cross-account leak; the `::numeric` cast dropped → Epley lies |
| 2. Service and verdict     | `records.ts`, the pure `records-verdict.ts`, `/api/sets` returning it     | A failed verdict turning a successful save into an error the user retries                        |
| 3. The screens             | The save-time badge and the `/records` page                               | The badge rendering a number that came from SQL rather than being re-derived                     |
| 4. Deploy and prove it     | The slice reachable at the public address                                 | The S-02 failure: every criterion green while nothing is reachable                               |
| 5. Truth up the documents  | The view variant in `AGENTS.md`; roadmap closed                           | The next slice reintroducing a view without the flag                                             |

**Prerequisites:** S-03 and F-01, both `done`. Database credentials for both projects in `.env`;
Wrangler authenticated. No new secret, no new binding, no schema change to any table.
**Estimated effort:** ~2–3 sessions across five phases; Phase 1 is the largest and the only one whose
failure mode is silent.

## Open Risks & Assumptions

- **The 1RM formula acquires a second implementation, in SQL**, and only one integration assertion
  would notice a drift — weaker than the `0.45359237` guard it resembles, because a `case` expression
  cannot be grepped the way a constant can.
- **`security_invoker` is documented behaviour nothing in this repository has exercised yet.** Phase 1
  proves it against `gymlog-test`, and then breaks it to confirm the proof works.
- **The index path through a view with an RLS predicate is an assumption**, checked once with
  `explain`; the fallback (`left join lateral … limit 1`) is named in the plan.
- **A record whose margin is under 0.05 kg displays as beating an equal number** — both round to the
  one decimal place the product shows everywhere. Accepted, not solved.
- **`personal_records` is a plausible input for S-07/S-08 and is not designed for them.** Tonnage
  needs weekly sums, not argmaxes over all history.

## Success Criteria (Summary)

- A set that beats the previous best for its exercise says so at the moment it is saved, and the
  first set for an exercise says nothing.
- `/records` answers "what do I currently stand at?" for every exercise the account has logged, with
  the evidence behind each number and an honest answer where there is no number.
- No account can reach another's records, and the SQL estimate and the TypeScript estimate are
  provably the same formula — both demonstrated by checks that were broken on purpose and observed to
  fail.
