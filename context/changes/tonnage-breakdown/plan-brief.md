# Tonnage Breakdown — Plan Brief

> Full plan: `context/changes/tonnage-breakdown/plan.md`
> Research: `context/changes/tonnage-breakdown/research.md`

## What & Why

The weekly total S-07 put on `/dashboard` answers "was this week more work?" but not "where did the
work go?" — the only actionable half of the figure. S-08 breaks the **current** week's tonnage down
per exercise (FR-018) and per muscle group (FR-019), on the same screen, with the group figures
summing exactly to the total already shown (US-03).

## Starting Point

`public.daily_tonnage` emits one row per account per day and **never joins `exercises`**, which is
precisely why the total is blind to muscle groups. `weeklyTonnage` folds at most fourteen of those
rows in the Worker. `muscle_group` lives on `public.exercises` and is reachable only by joining, and
`exercise_entries` deliberately stores no copy of it — the absence that keeps a group correction a
re-derivation rather than a data migration.

## Desired End State

Under the two weekly totals, `/dashboard` shows six muscle-group rows for the current week (largest
first, proportional bar, reader's unit), the week's exercises with their tonnage, and — only when it
exists — an `Unattributed` row for tonnage whose exercise this account can no longer read. The group
rows sum to the total on screen, and a breakdown that does not reconcile is **not shown at all**.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Correcting a muscle group (PRD OQ2) | Retroactive, **no edit path in this slice** | The weekly total cannot move because nothing stores the group; shipping `PATCH /api/exercises/[id]` is a separate slice. | Owner |
| Muscle-group labels | Promote to `MUSCLE_GROUP_LABELS` in `src/lib/validation/exercise.ts`, rewire all four call sites | One name per group, and the existing "Shoulders" vs "shoulders" split disappears with it. | Owner |
| One view or two | **Two** — `daily_tonnage` untouched, `daily_exercise_tonnage` added | The read path already serving production is not rewritten; the duplicated SQL expression sits in append-only migration files and is pinned by a cross-view assertion that would be a tautology under the nested alternative. | Plan |
| The `exercises` join | **`left join`**, null group rendered as `Unattributed` | An inner join inside a `security_invoker` view is filtered by `exercises`' RLS policy and deletes a set's tonnage from its own owner's breakdown, silently. | Plan |
| Rounding on screen | Group and exercise rows rounded **together**, by largest remainder against the rounded total | Reconciling kilograms does not reconcile the printed column, and adding the rows up is the only check the user can perform (owner, on plan-review F1). | Owner |
| Reconciliation | Structural + **runtime guard** + integration assertion | `numeric` is exact in Postgres, `double` is not in the Worker, so equality is checked against a stated `0.001` kg tolerance and a mismatch suppresses the breakdown. | Plan |
| The Worker's bound | `MAX_BREAKDOWN_ROWS = 7 × 30`, a throw and never a `.limit()` | S-07's `=== 14` has no equivalent at `(day, exercise)` grain, and a limit is a silent truncation. | Plan |
| Where it renders | Inline on `/dashboard`, no hydrated island | US-03 says "home screen"; the content is static, so the render suite's no-island assertion stays and stays wanted. | Plan |
| Failure model | The breakdown degrades **alone**; both totals survive | S-05's `impact_unavailable` ruling: the reliable figure stays, the unknown one says it is unknown. | Plan |

## Scope

**In scope:** one additive view; a pure fold with unit-testable guards; the breakdown section on
`/dashboard`; the promoted label map; an integration suite that constructs the reconciliation hazard;
deploy; documents including PRD Open Question 2.

**Out of scope:** editing `muscle_group` from the UI; any change to `daily_tonnage`, `weeklyTonnage`
or the two totals; a breakdown of last week; a new route; charts; percentages printed as numbers;
`date_trunc('week', …)` and any SQL reference to `profiles.timezone`.

## Architecture / Approach

`sets → exercise_entries → workouts` joined on `(id, user_id)` pairs exactly as `daily_tonnage` does,
plus `left join exercises`, grouped at `(user_id, performed_on, exercise_id)` — the only grain that
keeps the range predicate on `workouts_user_performed_on_idx` while letting the muscle group be
joined at read time. `weeklyBreakdown` reads seven days of it; `foldBreakdown` (pure) groups, sorts,
guards and reconciles against the week total `weeklyTonnage` already produced; `dashboard.astro`
renders it in its own try/catch with its own failure flag.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. View + proof | `daily_exercise_tonnage`, types, integration suite (9 assertions), 4 mutations | The hazard assertion must construct a row the UI cannot create — an entry naming another account's private exercise |
| 2. Fold + labels | `tonnage-breakdown.ts`, `weeklyBreakdown`, promoted label map, unit suite | The reconciliation tolerance must be justified as a float artefact, not a data allowance |
| 3. Screen | The breakdown section, render suite extended | Three render tripwires fire; only one of them is a wanted failure |
| 4. Deploy | The section live at the public URL | None — the migration is already applied and additive |
| 5. Documents | `AGENTS.md`, `README.md`, PRD OQ2 closed, `lessons.md`, `STATE.md` | Passing two decisions in one sentence, the failure `lessons.md` records |

**Prerequisites:** S-07 (done), F-01. `.env` credentials for `gymlog-test` and both database URLs.
**Estimated effort:** ~3 sessions — plan → phases 1–2 → phase 3 → deploy + documents, with a `/clear`
at each boundary.

## Open Risks & Assumptions

- **Nothing about the CPU cap or the index path can be measured in this project** (`gymlog-test`
  holds a few dozen sets). Inherited from S-04 unchanged and stated in the migration.
- `MAX_BREAKDOWN_ROWS = 210` is a product judgement, not a measurement: a user who genuinely logs
  more than thirty distinct exercises in one day loses the breakdown and keeps their totals.
- The duplicated `sum(reps * greatest(weight_kg, 0))` is a third instance of a hazard this repository
  documents twice. It is accepted because migration files are append-only and the two views are
  compared directly in CI — an argument that stops holding the day someone replaces a view.

- **One row can read a unit away from its own independently rounded value** — the accepted price of
  the column adding up. Stated in the formatter's header, since it is a second answer to "what does
  this row round to".

## Plan Review

`reviews/plan-review.md` (one subagent, deep mode): **2 critical, 4 warnings, 4 observations — all
applied**. The two critical findings were a rounding drift that would have made the headline
criterion unsatisfiable by correct code, and a mutation criterion naming a failure that could not
occur. The architecture (two views, `left join`, pure fold, degrade-alone failure model) was verified
against the code and survived intact, including the claim that the hazard row is constructible by the
integration suite.

## Success Criteria (Summary)

- On `/dashboard`, the muscle-group rows add up to the "This week" figure — checked by hand on
  screen, by assertion in CI, and by a guard at read time.
- Tonnage logged against an exercise the account cannot read still appears in the breakdown, labelled
  honestly, instead of vanishing from a figure that looks correct.
- Switching the unit moves the totals and every breakdown row together.
