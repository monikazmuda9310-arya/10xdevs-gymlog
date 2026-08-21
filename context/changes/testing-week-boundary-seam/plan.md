# Week-boundary seam — Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md`, covering Risk #1 — _the week's figures are
computed from the wrong days after a timezone change; the number looks correct and is believed_
(High × High, the only such row on the map).

**No production code changes and no migration.** This phase adds assertions that would notice the
seam breaking, plus the cookbook entry and the corrections that keep the next reader from repeating
the mistakes this phase found.

## Current State Analysis

`src/pages/dashboard.astro:43` is the entire join between the stored zone and the days a figure is
made from:

```text
tonnage = await weeklyTonnage(supabase, user.id, profile.timezone);
```

**Replace `profile.timezone` there with the literal `"Europe/Warsaw"` and all five runners stay
green.** The same holds for `src/pages/workouts/index.astro:23`. That is the defect Risk #1
describes, and today it is undetectable.

Four constraints, all grounded in `research.md`, decide the shape of every assertion below:

- **`/dashboard` never renders the week's days** (research § Finding 1). It prints the zone name and
  two figures. `week.start` / `week.end` reach the markup — `WeekTonnage extends DateRange`
  (`tonnage.ts:48`) — and are ignored. Negative evidence searched: no `.start` / `.end` and no
  `Intl.DateTimeFormat` anywhere in `src/**/*.astro` or `src/**/*.tsx`. **The window is observable
  only at the query boundary**, so an assertion about "which days" has to read the query, not the
  HTML.
- **Every non-unit assertion about the week today is circular** (research § Finding 2).
  `dashboard-tonnage.test.ts:30` computes its fixture dates with `trainingWeeksFor` — the function
  under test — and its stub discards the range arguments (`:92`, `gte: () => …`).
  `weekly-tonnage.test.ts:63-74` and `tonnage-breakdown.test.ts:130-134` anchor the same way,
  including their Sunday-boundary assertions. An off-by-one moves fixture and expectation together.
- **There is no tonnage endpoint** — `grep -rln "weeklyTonnage|trainingWeeksFor|weeklyBreakdown"
src/pages/` returns only `dashboard.astro`. The join is executable **only by the render project**.
- **The unit layer is strong and is not the gap.** `calendar.test.ts` pins both Warsaw DST
  transitions against literals, the Sunday rollover, month/year/leap boundaries, and a 365-instant
  sweep asserting the Monday anchor (`:160`). What nothing checks is that anything **calls** it with
  the zone the account stored.

### Key Discoveries

- **The capturing stub is additive.** `dashboard-tonnage.test.ts:92`'s `gte: () => …` already
  receives `(column, value)` and throws them away; recording them changes no existing path.
  Measured — the real calls carry `("performed_on", "2026-08-03")`.
- **`vi.setSystemTime` reaches the page's own `new Date()` through Astro's container.** Measured at
  commit `7fbfb0d` (research § Measurement record). No fake timers exist anywhere in the repository
  today, so this is a new pattern here.
- **`/workouts` renders the computed date twice** — `<input type="date" … value="2026-08-09">` and
  inside `<astro-island props="{&quot;defaultDate&quot;:[0,&quot;2026-08-09&quot;]}">`. Measured.
  It is the only screen in the product where zone arithmetic is visible in HTML.
- **`page-load-failures.test.ts:75-103` already has a generic `stub(tables)` / `locals()` /
  `render(page, tables)` harness** keyed by table name, and already renders `workouts/index.astro`
  with `timezone: "Europe/Warsaw"` in its fixture (`:39`, `:218-260`) — asserting nothing about the
  date.
- **`preferences-derive.test.ts:84-90`'s `setPreferences`** drives `updateProfileRoute` and throws on
  a non-200 — the pattern the integration phase reuses.
- **`profiles.timezone` has no membership constraint** — `timezone text not null default
'Europe/Warsaw'` plus a 1–64 length check
  (`20260810063450_create_profiles_with_row_ownership.sql:13,18`). `profiles-rls.test.ts:179-194`
  writes `Test/Run-<id>` into it today, which is why `todayIn`'s UTC fallback is reachable.
- **`FALLBACK_TIME_ZONES` has SEVEN entries** (`timezones.ts:34-42`), and the module's own comment
  says "seven" (`:28`). `test-plan.md:433` and this change's `change.md:34` both say twelve.

## Desired End State

Mutating `dashboard.astro:43` to a hardcoded zone, or `workouts/index.astro:23` to `"UTC"`, turns
the gate **red** — at the render step, naming the day it got wrong. Writing an unformattable zone
into `profiles.timezone` produces an assertion that says the screen degrades to a UTC week **and
keeps claiming the stored zone**. A set logged on a Sunday moves between weeks when the account's
stored zone changes, proven against real rows.

Verified by: `npm run test:render` and `npm run test:integration` green with the new files, plus the
two mutation measurements in Phase 1 and Phase 3's success criteria.

## What We're NOT Doing

- **No production code changes.** Not `dashboard.astro`, not `workouts/index.astro`, not
  `calendar.ts`. The two product questions research raised — should `/dashboard` print the week's
  dates, should `/workouts` say when its date came from UTC — are owner decisions and stay in
  `research.md` § Open Questions.
- **No unit tests for `src/lib/services/tonnage.ts`.** It has none and its five throws are
  uncovered. That is a real gap and a **different** one: research proved the two span guards are
  blind to a shifted window, so covering them would read as a defence of this seam without being
  one. Named in Phase 4, not built.
- **No test forcing the `timezones.ts` fallback branch.** It cannot produce a wrong week (research
  § Finding 4b), it is unreachable in workerd (418 zones measured) and in Node, and reaching it would
  mean stubbing `Intl` — a runtime-specific assertion `vitest.render.config.ts:17-23` forbids in the
  only suite that could host it. It gets the written paragraph `lessons.md` prescribes instead.
- **No `TZ` pin in `vitest.render.config.ts`.** Measured: the probe ran under ambient
  `Europe/Warsaw` and correctly produced `America/New_York`'s window, because the page formats
  through the zone it is **given** and the expectations are literals. A pin would be a guard nobody
  mutated — the exact thing `lessons.md` § "A guard you have not mutated may not guard" refuses. The
  reasoning is written into the new file's header instead.
- **No e2e.** The join is server-side; a browser adds a build, a worker and a session to observe a
  value the container already renders (`test-plan.md` §1 principle 1).
- **No SQL, no migration.** No migration references `profiles.timezone` in executable SQL and
  `AGENTS.md` forbids adding one.
- **No changes to `dashboard-tonnage.test.ts`.** Its 43 assertions stay untouched; the new file sits
  beside it.

## Implementation Approach

Two render sub-phases first — render is the only runner that can execute the join, so it carries the
whole of Risk #1 and the gate can go green after Phase 1 alone. Then one narrow integration
assertion that closes the loop through a real column write and real rows. Then the cookbook.

**Two disciplines bind every assertion in Phases 1–3**, and both come from what made the existing
coverage inert:

1. **Never derive an expectation from the subject.** Every expected window and every expected date is
   a literal string in the test. `trainingWeeksFor` must not be imported by any new file.
2. **Every absence or degradation assertion carries a positive control** in the same test — the
   identical path with a good zone producing the other answer. Without it, a stub that silently
   stopped being called reads as a pass.

### Critical Implementation Details

**The instant and the zone must be chosen together, and the choice is not interchangeable.** Only 9
of 418 zones were on a different calendar date at the hour S-06's manual step ran (`lessons.md` § "A
manual criterion whose outcome depends on the hour it runs") — _"far away" is not the property being
tested; "currently on a different calendar date" is_. Measured pairs, and what each one catches:

| #   | Instant                | Stored zone        | `daily_tonnage` window     | `daily_exercise_tonnage` window | `/workouts` date | Catches                                        |
| --- | ---------------------- | ------------------ | -------------------------- | ------------------------------- | ---------------- | ---------------------------------------------- |
| I1  | `2026-08-09T22:30:00Z` | `Europe/Warsaw`    | `2026-08-03`..`2026-08-16` | `2026-08-10`..`2026-08-16`      | `2026-08-10`     | UTC substituted for a **positive**-offset zone |
| I2  | `2026-08-10T02:00:00Z` | `America/New_York` | `2026-07-27`..`2026-08-09` | `2026-08-03`..`2026-08-09`      | `2026-08-09`     | UTC substituted for a **negative**-offset zone |

**Both rows are needed and neither is sufficient.** At I1, UTC and `America/New_York` agree; at I2,
UTC and `Europe/Warsaw` agree. Together they also catch a hardcoded `"Europe/Warsaw"`, because I2
under that literal yields I1's window. This is the two-property argument `vitest.config.ts:12-32`
makes about the ambient zone, applied to the **subject**.

**The unformattable-zone case must use I1, not I2.** At I2 the UTC fallback lands on the same window
`Europe/Warsaw` produces, so the assertion would pass against a working zone and prove nothing. At I1
a stored `Europe/Warsawa` yields `2026-07-27`..`2026-08-09` while `Europe/Warsaw` yields
`2026-08-03`..`2026-08-16` — and that same pair is the positive control.

---

## Phase 1: The dashboard's window comes from the stored zone

### Overview

The whole of Risk #1, at the cheapest layer that can execute the join. One new render file with a
stub that records the range instead of discarding it, and a pinned clock.

### Changes Required

#### 1. The new render suite

**File**: `tests/render/week-boundary.test.ts` (new)

**Intent**: Assert that `/dashboard` asks `daily_tonnage` and `daily_exercise_tonnage` for the days
of the **stored** `profiles.timezone`, at a pinned instant, with literal expectations. Header carries
three things a reader will otherwise re-derive: why the assertion reads the query rather than the
HTML (the page renders no dates), why no `TZ` pin (measured — the subject names its own zone and the
expectations are literals), and the circularity rule (`trainingWeeksFor` must not be imported here).

**Contract**: A Supabase double dispatching on table name and **throwing on an unstubbed one** — the
same tripwire `dashboard-tonnage.test.ts:143-150` and `page-load-failures.test.ts:75-84` carry,
restated because the chains differ. The `daily_tonnage` and `daily_exercise_tonnage` chains record
their range arguments; the second keeps its `.limit` link so the mirror stays exact. The recorded
shape is what the rest of the phase asserts against:

```ts
interface CapturedRange {
  table: string;
  gte: string;
  lte: string;
}
// daily_tonnage:          .select().eq().gte(col, val).lte(col, val)
// daily_exercise_tonnage: the same, then .limit(MAX_BREAKDOWN_ROWS + 1)
```

The clock is pinned with `vi.setSystemTime` per test and released in `afterEach`; nothing in this
repository used fake timers before, so the header says why they are here (the page has no injectable
`now` — `dashboard.astro:43` calls `weeklyTonnage` with three arguments).

#### 2. The two-zone assertions

**File**: `tests/render/week-boundary.test.ts`

**Intent**: At I1 with `Europe/Warsaw` and at I2 with `America/New_York`, assert both recorded
windows equal the literals in the Critical Implementation Details table. Each is its own test, and
each states in a comment which substitution it catches, so a future reader deleting one knows what
they are removing.

**Contract**: Four assertions — two tables × two instant/zone pairs. Expectations are literal
`YYYY-MM-DD` strings. The rendered HTML is asserted only for non-vacuity (the page produced the
tonnage section rather than the failure sentence), because a captured range from a page that failed
early would be a vacuous pass.

#### 3. The cross-check that makes the pair load-bearing

**File**: `tests/render/week-boundary.test.ts`

**Intent**: One test rendering **the same instant under both zones** and asserting the two recorded
windows differ. Without it, four assertions that all happened to record the same constant would
still pass; this is what proves the stored zone is the thing being varied.

**Contract**: At I2, `Europe/Warsaw` and `America/New_York` must produce windows seven days apart —
`2026-08-03`..`2026-08-16` and `2026-07-27`..`2026-08-09`. Measured.

### Success Criteria

#### Automated Verification

- `npm run test:render` passes with the new file
- `npm run lint` passes
- `npm run typecheck` passes
- `npm test` still passes — the new file is under `tests/render/**` and cannot be matched by the
  `src/**` glob
- `tests/render/dashboard-tonnage.test.ts` still reports its existing count unchanged

#### Manual Verification

- **Mutation 1**: replace `profile.timezone` with `"Europe/Warsaw"` at `dashboard.astro:43` and
  confirm the I2 / `America/New_York` assertions go red naming the wrong dates; revert
- **Mutation 2**: replace it with `"UTC"` and confirm **both** instant rows go red — this is what
  proves the pair rather than one of them
- **Mutation 3**: delete the range arguments from `weeklyTonnage`'s `.gte`/`.lte` (`tonnage.ts:99-100`)
  and confirm the suite goes red — the bounds S-07's review found were guarded by nothing now have a
  reader; revert

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation of the three mutations before proceeding. Record what each one produced in
`change.md` — a mutation that passed unexpectedly means the assertion is not testing what it claims.

---

## Phase 2: The unformattable zone, and the date `/workouts` shows

### Overview

The two things Phase 3 of the rollout deferred here, plus the screen where the arithmetic is
actually visible. Same file, same pinned clock.

### Changes Required

#### 1. The stored zone that cannot be formatted

**File**: `tests/render/week-boundary.test.ts`

**Intent**: With `Europe/Warsawa` stored, assert **both halves of the failure**: the recorded window
is UTC's, and the page still prints `Your training week runs Monday to Sunday in Europe/Warsawa.`
The sentence comes from the column (`dashboard.astro:143`) while the arithmetic came from the
fallback (`calendar.ts:29-34`), so the paragraph contradicts itself — that contradiction is what
makes Risk #1 invisible, and asserting only the UTC half would pin the smaller fact.

**Contract**: At **I1** (see Critical Implementation Details — I2 would prove nothing here): stored
`Europe/Warsawa` records `2026-07-27`..`2026-08-09`; the positive control, stored `Europe/Warsaw` at
the same instant, records `2026-08-03`..`2026-08-16`. A comment in the form `lessons.md` § "An
assertion you keep because it cannot fail YET" prescribes: this pins today's behaviour and does not
endorse it; the value is reachable by a direct PostgREST write from the owner's own client
(`profiles-rls.test.ts:179-194` does it today, and the column carries no membership constraint), not
through the form, whose list is a strict subset of what `Intl.DateTimeFormat` accepts; the edit that
would change this is `/dashboard` learning to say which zone it actually computed in.

#### 2. `/workouts` — the visible date, three states

**File**: `tests/render/week-boundary.test.ts`

**Intent**: Assert the date field's value comes from the stored zone, and pin the three silent UTC
paths. `dashboard.astro:31-37` treats a null profile as a **failed** load precisely so it does not
compute a week in UTC for somebody who is not in it; `workouts/index.astro` does the opposite for the
identical input. That asymmetry is the `records.astro` class Phase 3 named, applied to the timezone,
and it is week-shaped: a workout filed on the wrong day at 01:00 Warsaw lands in the wrong week's
tonnage.

**Contract**: Four assertions at I2, reading the `<input type="date">` `value` from the rendered
HTML (measured to be present, alongside the `astro-island props` payload):

| State                | Stub                                               | Expected `value`   | What it pins                                                                                |
| -------------------- | -------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| stored zone honoured | `profiles` → `{ timezone: "America/New_York", … }` | `2026-08-09`       | the positive control, and Risk #1 on this screen                                            |
| stored zone honoured | `profiles` → `{ timezone: "Europe/Warsaw", … }`    | `2026-08-10`       | that the zone is varied, not a constant                                                     |
| no profile row       | `profiles` → `null`                                | `2026-08-10` (UTC) | `:23`'s `?? "UTC"`, with **no** signal on screen                                            |
| profile read throws  | `profiles` → error                                 | `2026-08-10` (UTC) | `:13` surviving the `catch`; and that the failure sentence names the **list**, not the date |

The third and fourth rows assert the failure sentence's presence or absence explicitly, because
"a date is on screen" is true in all four and cannot separate them. `workouts/index.astro` makes a
`workouts` read too — the stub must answer it or the tripwire fires.

### Success Criteria

#### Automated Verification

- `npm run test:render` passes
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification

- **Mutation 4**: change `workouts/index.astro:23` to `todayIn("UTC")` and confirm the two
  stored-zone rows go red while the two fallback rows stay green — which is what proves the fallback
  assertions are pinning the fallback rather than the happy path; revert
- **Mutation 5**: change `dashboard.astro:143` to print a literal instead of `profile.timezone` and
  confirm the unformattable-zone test goes red on the sentence half, not only the window half; revert
- Read the two "pinned not endorsed" paragraphs back and confirm each names the guarantee, states
  that no mutation available today breaks it **through the form**, and names the edit that would

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: The stored column decides the bucket, against real rows

### Overview

One narrow integration suite. Render stubs the database, so only this can prove that a zone written
the way a user writes it changes which week a real set is counted in.

### Changes Required

#### 1. The new integration suite

**File**: `tests/integration/week-boundary-seam.test.ts` (new)

**Intent**: Close the loop render cannot: write the zone through `PATCH /api/profile`, **read it back
from the row**, and pass that value to `weeklyTonnage`. The stored column is the input, not a
literal — which is the one thing every existing tonnage suite avoids doing.

**Contract**: `MARK = "t4w-"` — a prefix of no existing mark and prefixed by none; re-derive with
`grep -rn "const MARK" tests/` rather than trusting the list. Fixture accounts `rls-owner-a` only.
Follows `weekly-tonnage.test.ts`'s helpers in shape (`authenticate`, `logWorkout`, per-test windows)
and its cleanup order — workouts first, then exercises, because `on delete restrict` on
`exercise_entries.exercise_id` is released by the cascade.

`beforeAll` establishes `profiles.timezone` on the default via `resetPreferences` **and** every test
restores it in a `finally`: teardown protects the happy path, only setup protects the next run
(`fixture-preferences.ts:7-21`). `preferences-derive.test.ts:405-412` is the cross-suite tripwire
that goes red if this suite leaks a flipped zone.

#### 2. Assertion 1 — a Sunday belongs to the week that started, against literals

**File**: `tests/integration/week-boundary-seam.test.ts`

**Intent**: The claim `weekly-tonnage.test.ts:273` makes circularly, made non-circularly. Its
`weeks.lastSunday` / `weeks.thisMonday` come from `trainingWeeksFor`; these are typed literals, so an
off-by-one in `mondayOf` moves the product's answer without moving the expectation.

**Contract**: Anchor window in **2023** — measured free: 2024 holds 4 date literals across the repo,
2025 holds 16, 2026 holds 29, 2027 holds 2, and `weekly-tonnage` owns 2025-06→2025-12 while
`tonnage-breakdown` owns 2024-12→2025-05. Sets on Sunday `2023-06-18` and Monday `2023-06-19`, read
at `now = 2023-06-21T12:00:00Z`. Assert the returned ranges equal the literals
`current 2023-06-19..2023-06-25` and `previous 2023-06-12..2023-06-18`, **and** that each set's
kilograms landed in the matching bucket. Verified by computation, not assumed.

#### 3. Assertion 2 — the same row, two stored zones, opposite buckets

**File**: `tests/integration/week-boundary-seam.test.ts`

**Intent**: The sharpest available statement of Risk #1: nothing about the data changes, only the
column, and the answer moves.

**Contract**: One set on Sunday `2023-08-13`, read at `now = 2023-08-14T02:00:00Z`. With
`Europe/Warsaw` stored the set is in **previous** (`2023-08-07..2023-08-13`); with
`America/New_York` stored the same set is in **current** (`2023-08-07..2023-08-13` is that zone's
current week, because its "today" is still `2023-08-13`). Both windows and both buckets asserted as
literals. Verified by computation. The zone is written through `updateProfileRoute` — the
`setPreferences` shape at `preferences-derive.test.ts:84-90`, which throws on a non-200 — and read
back from the row before each read, so a write that silently did nothing cannot pass.

Its own window is ≥4 weeks from assertion 1's, because this suite aggregates by **date range** and
two tests sharing a window share an answer (`weekly-tonnage.test.ts:31-38`).

### Success Criteria

#### Automated Verification

- `npm run test:integration` passes with the new file
- Running it **twice in a row** passes both times — the repeatability check that catches a suite
  which mutated the column its own cleanup keys on
- `npm run test:integration` passes **for the whole directory**, not just the new file — the check
  that this suite left `profiles.timezone` as it found it, via
  `preferences-derive.test.ts` assertion 4
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification

- **Mutation 6**: make `updateProfile` ignore the `timezone` argument and confirm assertion 2 goes
  red — proving the read-back is load-bearing and not decoration; revert
- Confirm the suite's date window does not overlap any other suite's, by re-running the grep for
  date literals rather than trusting this plan
- Confirm `profiles.timezone` on `rls-owner-a` reads `Europe/Warsaw` after an **interrupted** run
  (Ctrl-C mid-test), or record that it does not and that `beforeAll` recovers it on the next run

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Cookbook, corrections, and the gaps this phase did not close

### Overview

What the next author needs, and what a green gate must not be read as covering.

### Changes Required

#### 1. A cookbook sub-section for the seam

**File**: `context/foundation/test-plan.md`

**Intent**: Add the patterns this phase shipped, so the next week-related assertion does not
reinvent the circular version. Three rules, each with the measurement behind it.

**Contract**: A new §6.8 "Adding a week-boundary or timezone check", carrying: the **circularity
rule** (never derive an expected week from `trainingWeeksFor`; it is what made three existing suites
inert); the **argument-capturing stub** (record `(column, value)` on `gte`/`lte` — `/dashboard`
renders no dates, so the window is observable only at the query boundary); the **clock pin**
(`vi.setSystemTime`, because no page here has an injectable `now`, and it also removes the
once-a-week Sunday-midnight flake `weekly-tonnage`'s review named); the **instant/zone pairing rule**
with the measured table; and why **no `TZ` pin** belongs in the render config.

#### 2. Per-phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: §6.6 gains a "Phase 4 — Week-boundary seam (complete, <date>)" entry recording what was
wrong in the document before it was measured, in the same register as Phases 1–3.

**Contract**: Names three things: that the seam is one expression in `src/pages/` while the hot-spot
citation pointed at `src/lib/services/` (adjacent, not misleading — `tonnage.ts` is the range's
consumer — and the sharper evidence is that the column became settable on 2026-08-13); that "assert
which days made the figure" is **structurally impossible from the HTML** on this page, which the
guidance stated as a discipline; and that the inertness mechanism was circularity, not the ambient
zone the anti-pattern column named.

#### 3. The miscount

**File**: `context/foundation/test-plan.md`, `context/changes/testing-week-boundary-seam/change.md`

**Intent**: `12-entry hardcoded list` → `7-entry`. `FALLBACK_TIME_ZONES` has seven entries
(`timezones.ts:34-42`) and the module's own comment says so (`:28`).

**Contract**: Both occurrences (`test-plan.md:433`, `change.md:34`), each restated to name the
**category** rather than lean on the number — the same instruction `lessons.md` § "The conversion
constant has been miscounted twice" gives, and which this phase's own brief violated.

#### 4. The class-E paragraph, and the named gaps

**File**: `context/foundation/test-plan.md` §6.6

**Intent**: Discharge the two fallbacks Phase 3 assigned here, and state plainly what a green gate
still does not cover.

**Contract**: Four entries. **`timezones.ts`'s fallback is closed by a paragraph, not a test** — it
cannot produce a wrong week (independent code paths over different APIs; `todayIn` never consults the
list), it is unreachable in workerd and in Node, and the edit that would make it bite is a runtime
without `supportedValuesOf` or the list being hand-grown into a second source of truth.
**`todayIn`'s fallback is closed by a test** and the paragraph says why it is reachable at all — a
direct PostgREST write, not the form. **`src/lib/services/tonnage.ts` has no unit test**, five throws
uncovered, and the two span guards are blind to a shifted window so covering them would not defend
this seam. **`/workouts`' null-profile asymmetry is pinned, not endorsed**, and the edit that makes
it a product decision is Open Question 2 in `research.md`.

#### 5. Add a lesson

**File**: `context/foundation/lessons.md`

**Intent**: The finding most likely to recur: an assertion that computes its expectation with the
function under test is not a guard, and it looks exactly like one.

**Contract**: A new entry — "An expectation derived from the subject is not an assertion" — with
context (three suites, S-07 and S-08), the problem (fixture and expectation move together, so a
boundary defect passes), the rule (derive expectations from literals or from an independent
implementation; where the value is awkward to write by hand, that awkwardness is the point), and
where it applies (dates, weeks, IDs, hashes, formatted output — anywhere the natural way to know the
right answer is to ask the code).

### Success Criteria

#### Automated Verification

- `npm run lint` passes — pre-commit runs `prettier --write` on `*.md`
- The full gate passes in order: `lint` → `typecheck` → `test` → `test:render` → `test:integration`
  → `test:middleware` → `build` → `test:e2e`

#### Manual Verification

- Grep for `12-entry` and confirm no occurrence survives anywhere in `context/`
- Read §6.8 and confirm a reader who has not seen `research.md` could write a correct week
  assertion from it alone — specifically, that they would not import `trainingWeeksFor`
- Confirm §6.6's Phase 4 entry states what was **wrong in the document** before it was measured,
  not only what was built
- Update `test-plan.md` §3's Phase 4 row Status to `complete`

---

## Testing Strategy

### Render tests

- The two instant/zone pairs, both tables, literal expectations
- The cross-check that the two zones produce different windows at one instant
- The unformattable zone, both halves, at I1 with its positive control
- `/workouts`' date value across four states, with the failure sentence asserted explicitly

### Integration tests

- A Sunday and the following Monday land in different weeks, against 2023 literals
- One row, one instant, two stored zones, opposite buckets — the zone read back from the column

### Manual Testing Steps

1. Run the six mutations listed in the phases and record each outcome in `change.md`. A mutation that
   **passes** means the assertion is not testing what its title claims — fix the claim or the test,
   never delete the mutation (`lessons.md` § "When a mutation does not break anything, fix the
   claim").
2. Run `npm run test:integration` twice consecutively and confirm both are green.
3. Sign in to the deployed instance, change the timezone on `/settings` to a zone currently on a
   different **calendar date** — not merely "far away" — and confirm `/dashboard`'s two figures
   change. Establish the property at the moment of running rather than trusting a fixed example:
   `node -e "const n=new Date();const d=t=>new Intl.DateTimeFormat('en-CA',{timeZone:t}).format(n);console.log(Intl.supportedValuesOf('timeZone').filter(z=>d(z)!==d('Europe/Warsaw')).slice(0,10))"`
   (`lessons.md` § "A manual criterion whose outcome depends on the hour it runs").

## Performance Considerations

The render suite gains no network and no build; the probe measured three renders at 89 ms total. The
integration suite adds one file to a `fileParallelism: false` project — a handful of round trips to
Frankfurt, in line with the existing tonnage suites.

## References

- Research: `context/changes/testing-week-boundary-seam/research.md` — Findings 1–6 and the
  Measurement record, which every literal in this plan comes from
- Test plan: `context/foundation/test-plan.md` §2 Risk #1, §3 Phase 4, §6.2, §6.5
- Stub and harness patterns: `tests/render/page-load-failures.test.ts:75-103`,
  `tests/render/dashboard-tonnage.test.ts:91-150`
- Integration fixture patterns: `tests/integration/weekly-tonnage.test.ts:31-52,105-175`,
  `tests/integration/preferences-derive.test.ts:84-90`, `tests/integration/fixture-preferences.ts`
- Prior art on this seam: the **`weekly-tonnage`** change folder's `reviews/impl-review.md` (F3, F8,
  and the ambient-clock risk left open at `:149-151`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: The dashboard's window comes from the stored zone

#### Automated

- [x] 1.1 `npm run test:render` passes with the new file — 4c7ea4b
- [x] 1.2 `npm run lint` passes — 4c7ea4b
- [x] 1.3 `npm run typecheck` passes — 4c7ea4b
- [x] 1.4 `npm test` still passes — 4c7ea4b
- [x] 1.5 `dashboard-tonnage.test.ts` reports its existing count unchanged — 4c7ea4b

#### Manual

- [x] 1.6 Mutation 1 — hardcoded `"Europe/Warsaw"` at `dashboard.astro:43` reddens the I2 case — 4c7ea4b
- [x] 1.7 Mutation 2 — hardcoded `"UTC"` reddens both instant rows — 4c7ea4b
- [x] 1.8 Mutation 3 — deleting `.gte`/`.lte` from `tonnage.ts:99-100` reddens the suite — 4c7ea4b

### Phase 2: The unformattable zone, and the date `/workouts` shows

#### Automated

- [x] 2.1 `npm run test:render` passes
- [x] 2.2 `npm run lint` and `npm run typecheck` pass

#### Manual

- [x] 2.3 Mutation 4 — `todayIn("UTC")` at `workouts/index.astro:23` reddens only the stored-zone rows
- [x] 2.4 Mutation 5 — a literal at `dashboard.astro:143` reddens the sentence half
- [x] 2.5 Both "pinned not endorsed" paragraphs name the guarantee and the edit that would break it

### Phase 3: The stored column decides the bucket, against real rows

#### Automated

- [ ] 3.1 `npm run test:integration` passes with the new file
- [ ] 3.2 Running the new suite twice in a row passes both times
- [ ] 3.3 The whole integration directory passes, including `preferences-derive` assertion 4
- [ ] 3.4 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 3.5 Mutation 6 — `updateProfile` ignoring `timezone` reddens assertion 2
- [ ] 3.6 The suite's date window overlaps no other suite's, re-checked by grep
- [ ] 3.7 An interrupted run's effect on `profiles.timezone` is recorded

### Phase 4: Cookbook, corrections, and the gaps this phase did not close

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 The full eight-step gate passes in order

#### Manual

- [ ] 4.3 No `12-entry` occurrence survives in `context/`
- [ ] 4.4 §6.8 is sufficient to write a correct week assertion without reading `research.md`
- [ ] 4.5 §6.6's Phase 4 entry states what was wrong in the document before it was measured
- [ ] 4.6 `test-plan.md` §3 Phase 4 Status set to `complete`
