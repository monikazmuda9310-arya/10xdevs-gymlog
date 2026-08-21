# Week-boundary seam — Plan Brief

> Full plan: `context/changes/testing-week-boundary-seam/plan.md`
> Research: `context/changes/testing-week-boundary-seam/research.md`

## What & Why

Rollout Phase 4 of the test plan, covering Risk #1 — the week's figures are computed from the wrong
days after a timezone change, the number looks correct, and it is believed. It is the only High ×
High row on the map. Today `src/pages/dashboard.astro:43` is the entire join between the stored zone
and the days a figure is made from, and **replacing `profile.timezone` there with a literal leaves
all five runners green**.

## Starting Point

The pure function is well defended and the wiring is not defended at all. `calendar.test.ts` pins
both Warsaw DST transitions, the Sunday rollover, month/year/leap boundaries and a 365-instant sweep
with a Monday anchor. But every assertion outside the unit suite computes its expected week with
`trainingWeeksFor` — the function under test — so fixture and expectation move together; and the
render stub discards the range arguments entirely (`dashboard-tonnage.test.ts:92`). `/dashboard`
renders no dates, only the zone's name and two figures, so the window is observable only at the query
boundary. There is no tonnage endpoint, which means the render project is the only runner that can
execute the join.

## Desired End State

Hardcoding a zone at `dashboard.astro:43`, or `"UTC"` at `workouts/index.astro:23`, turns the gate
red at the render step, naming the day it got wrong. A stored zone that cannot be formatted produces
an assertion saying the screen degrades to a UTC week **and keeps claiming the stored zone** — the
self-contradicting paragraph that makes this risk invisible. And one set on a Sunday moves between
weeks when the account's stored column changes, proven against real rows in `gymlog-test`.

## Key Decisions Made

| Decision                     | Choice                                   | Why (1 sentence)                                                                                                                | Source   |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Where the window is observed | At the query boundary, not in HTML       | `/dashboard` renders no dates at all, so a markup assertion is structurally impossible                                          | Research |
| Render file placement        | New `tests/render/week-boundary.test.ts` | Keeps `dashboard-tonnage.test.ts`'s 43 assertions clear of a file-wide clock pin                                                | Plan     |
| Integration phase            | Yes — one narrow assertion               | Render stubs the database, so only this proves an endpoint-written column changes a real bucket                                 | Plan     |
| `/workouts` coverage         | All three silent UTC paths + control     | The `catch` path looks covered (there **is** an error sentence) and is not — the most misleading of the three                   | Plan     |
| `TZ` pin in render config    | No — write down why                      | Measured: the page formats through the zone it is given and expectations are literals, so a pin would be a guard nobody mutated | Plan     |
| Unformattable zone           | Assert **both** halves, at I1            | The window alone is the smaller fact; the sentence still naming the stored zone is what hides the defect                        | Plan     |
| `tonnage.ts` unit coverage   | Out of scope, named                      | Its two span guards are blind to a shifted window, so covering them would read as a defence of this seam without being one      | Research |
| `timezones.ts` fallback      | Paragraph, not a test                    | Independent code path — it cannot produce a wrong week, and it is unreachable in workerd and in Node                            | Research |

## Scope

**In scope:** a new render suite (window capture, pinned clock, two zones, the unformattable zone,
`/workouts`' visible date); a new integration suite (mark `t4w-`, 2023 anchors, zone read back from
the row); `test-plan.md` §6.8 + §6.6 + the 12→7 correction; one new `lessons.md` entry.

**Out of scope:** any production code change; the two product questions research raised (should
`/dashboard` print its week's dates, should `/workouts` say when its date came from UTC); unit tests
for `tonnage.ts`; forcing the `timezones.ts` fallback branch; e2e; any SQL.

## Architecture / Approach

Two render sub-phases first, because render is the only runner that can execute the join and Phase 1
alone closes Risk #1. A stub that **records** `gte`/`lte` instead of discarding them, plus
`vi.setSystemTime` (measured to reach the page's own `new Date()` through Astro's container, and a
first for this repository). Then one integration assertion that writes the zone through
`PATCH /api/profile`, reads it back from the row, and passes that to `weeklyTonnage`. Then the
cookbook.

Two disciplines bind everything: **never derive an expectation from the subject** — no new file
imports `trainingWeeksFor` — and **every degradation assertion carries a positive control**.

The instant and zone are chosen together, measured, and complementary: at `2026-08-09T22:30:00Z`
UTC agrees with `America/New_York`, at `2026-08-10T02:00:00Z` UTC agrees with `Europe/Warsaw`, so
each row catches a substitution the other cannot.

## Phases at a Glance

| Phase                     | What it delivers                                                                 | Key risk                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Dashboard window       | The whole of Risk #1 — window asserted against literals, two zones, two instants | Fake timers are new here; a clock left unreleased would corrupt neighbours                           |
| 2. Bad zone + `/workouts` | The inherited class-E fallback, and the only screen showing the arithmetic       | Pins behaviour we do not endorse — needs the "cannot fail yet" paragraph or it reads as approval     |
| 3. Integration            | The stored column decides the bucket, against real rows                          | Writes to shared `gymlog-test` fixtures; a leaked zone surfaces in an unrelated suite next run       |
| 4. Cookbook               | §6.8, §6.6 notes, the 12→7 fix, one lesson                                       | A cookbook entry that omits the circularity rule leaves the next author rebuilding the inert version |

**Prerequisites:** `.env` with the three `gymlog-test` credentials (Phase 3 only); Phases 1, 2 and 4
are hermetic. No migration, no deploy, no new repository secret.

**Estimated effort:** ~2 sessions across 4 phases; Phase 1 is the bulk, Phase 4 is prose.

## Open Risks & Assumptions

- **Six mutations are the real acceptance test**, not the green suite. A mutation that passes means
  the assertion is not testing what its title claims — `lessons.md` says fix the claim, never delete
  the mutation.
- **Phase 3 writes to shared fixture rows.** `beforeAll` establishes the zone and every test restores
  it in a `finally`, because a killed process skips the `finally`; `preferences-derive` assertion 4 is
  the tripwire that catches a leak on the next run.
- **The `/workouts` assertions pin an asymmetry the product may want to change.** If the owner decides
  a UTC-defaulted date should say so, three of them change with it — that is the intent, and the
  paragraph names it.
- **Assumed, not measured**: that `vi.useFakeTimers` in one render file cannot affect the other three
  under this runner's isolation. Phase 1's automated criteria check `dashboard-tonnage.test.ts`'s
  count is unchanged, which is what would catch it.

## Success Criteria (Summary)

- Hardcoding the zone at `dashboard.astro:43` — with `"Europe/Warsaw"` or with `"UTC"` — turns the
  gate red, naming the wrong days.
- A screen that computed its week in UTC because the stored zone could not be formatted is
  distinguishable, in a test, from one that computed it correctly.
- The next person writing a week assertion reads §6.8 and does not derive the expected week from
  `trainingWeeksFor`.
