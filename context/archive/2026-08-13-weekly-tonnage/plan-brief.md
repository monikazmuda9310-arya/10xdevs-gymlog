# Weekly Tonnage — Plan Brief

> Full plan: `context/changes/weekly-tonnage/plan.md`
> Change identity and the two corrected inheritances: `context/changes/weekly-tonnage/change.md`

## What & Why

Total tonnage for the current training week, next to the previous one, on `/dashboard` (US-03,
FR-017). The product already derives a strength score per set; this is the other half of the premise —
"was this week more work than last?" — and it is the first aggregate the product has ever computed.

## Starting Point

**Nothing computes tonnage, and nothing can answer which week a workout falls in.** `calendar.ts`
exports exactly one function, `todayIn`; the only `date_trunc('week', …)` in the repository is a
comment. What does exist: `sets.weight_kg`, generated and unrounded, whose own migration comment names
"every future tonnage sum" as its reason; the index `workouts (user_id, performed_on desc)`, created
by S-03 with this slice named; and a proven `security_invoker` derived-view pattern from S-04.

## Desired End State

A signed-in user opens `/dashboard` and sees two figures in their chosen unit, as whole units with a
thousands separator. A week with no logged sets reads as `0` with a sentence saying why; a failed read
says so in different words and shows **no figure at all**. A Sunday-evening session counts in that
week. Switching the unit moves both figures together; nothing derived is stored anywhere.

## Key Decisions Made

| Decision                   | Choice                                                    | Why                                                                                                            | Source   |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| Aggregation shape          | `security_invoker` view at `(user_id, performed_on)`      | "A training week" stays defined **once**, in testable TypeScript; uses the index that already exists          | Plan     |
| PostgREST `sum()`          | Ruled out — **measured**, `PGRST123`                      | Aggregates are disabled; enabling them is per-project config outside this repo, invisible to every test        | Research |
| Where the timezone is used | Deciding what "today" is, and nowhere else                | Reinterpreting a stored `date` invents an instant; a tripwire test names this slice as the one that would      | S-06     |
| Where it appears           | `/dashboard`, existing card                               | US-03 says the user sees it on opening, not after a click                                                     | Owner    |
| Rounding                   | Whole units + thousands separator                         | A tenth of a kg is real on a barbell and noise on a five-digit total                                          | Owner    |
| Difference between weeks   | Not shown                                                 | FR-017 asks for two figures; a delta from rounded figures disagrees with the true one                         | Owner    |
| Empty week                 | `0` **plus** an explanation; failure shows no figure       | An emitted zero is a positive claim — S-05's `impact_unavailable` rule applied to a screen                    | Owner    |
| FR-006 date-change warning | **Do not warn**                                           | Tonnage re-derives on read and a date change is reversible; S-05's dialog guards irreversible actions          | Owner    |
| Open Question 2            | **Not this slice** — S-08's                               | The total is group-blind by schema; the roadmap says S-08 in three places                                     | Research |
| Test isolation             | Injectable `now`                                          | A date-range aggregate would otherwise pick up every other suite's fixtures around today                      | Owner    |
| Performance                | Not measured, and said so                                 | `gymlog-test` is too small for a query plan to mean anything; inherited from S-04 unchanged                   | S-04     |

## Scope

**In scope:** a week helper in `calendar.ts`; one additive migration creating `public.daily_tonnage`;
a tonnage service; a scalar kg→unit converter and a figure formatter; two figures on `/dashboard`
with three states; unit, integration and render suites; deploy; documents.

**Out of scope:** per-exercise and per-muscle-group breakdowns (S-08); any warning on a date change;
a delta between the weeks; a volume fixture or a measured performance claim; any island; any stored
derived value; any change to the two existing views; a new index; E2E.

## Architecture / Approach

`trainingWeeksFor(timeZone, now?)` turns an instant into four `YYYY-MM-DD` strings. The service passes
two of them as a range to `daily_tonnage`, a view that groups `sum(reps × greatest(weight_kg, 0))` by
`(user_id, performed_on)` and knows nothing about weeks or timezones. At most 14 rows come back and
are folded into two totals. The page converts once and rounds once.

The split is the whole design: **per-set arithmetic in Postgres (unbounded, must not run in the
Worker), per-day folding in TypeScript (constant, 14 rows).**

## Phases at a Glance

| Phase                       | What it delivers                                       | Key risk                                                          |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| 1. The week, in one place   | `mondayOf`, `trainingWeeksFor`, boundary tests         | A DST week is 167 or 169 hours; millisecond subtraction is wrong  |
| 2. The aggregation          | Migration, view, service, integration suite            | A second definition of "week" appearing in SQL                    |
| 3. The screen               | Two figures, three states, render suite                | A zero rendered where the read actually failed                    |
| 4. Deploy                   | Worker shipped and proved publicly                     | The view reaching production after the Worker that reads it       |
| 5. Documents                | Guides, lessons, and four corrections                  | Repeating an inherited claim without checking it                  |

**Prerequisites:** S-05, S-06, F-01 — all done. No new credential, no new Worker secret, one migration.
**Estimated effort:** ~2 sessions across 5 phases; the week boundary is small and the proof is the work.

## Open Risks & Assumptions

- **The sharpest risk is a figure that is wrong and looks right**, and it has two routes: a week
  boundary off by a day, and a sum that includes an assisted set as a negative. Both are covered by
  assertions written to fail; neither is covered today.
- **Index behaviour is unverifiable here** and this plan claims no measurement. What it would take is
  recorded, including the correction that the roadmap's "collides with the cleanup prefixes" blocker
  is weaker than stated — a third account removes it.
- **Two inherited claims were checked and found false** (Open Question 2's ownership; what assertion 9
  proves). Both are corrected in `change.md` and scheduled for correction in `STATE.md`. The lesson —
  a handover that passes two decisions in one sentence gets inherited as one — is the strongest
  candidate for `lessons.md`.
- The `s03-` MARK is a strict prefix of `s03-endpoints-` and `s03-page-`, so one suite deletes two
  others' fixtures. Benign only because `fileParallelism: false` orders them. The new MARK avoids it.

## Success Criteria (Summary)

- Both figures appear on the dashboard on opening, in the account's unit, and move together when the
  unit changes.
- A Sunday-evening session counts in that week — proved against the database, which nothing does today.
- A week with no sets reads as zero with an explanation, and a failed read never shows a figure.
