---
date: 2026-08-20T22:23:27+02:00
researcher: Monika Zmuda
git_commit: 7fbfb0d34dc6580ea2b37c3243e82aac3b96cff9
branch: main
repository: monikazmuda9310-arya/10xdevs-gymlog
topic: "Rollout Phase 4 — Week-boundary seam: the week a screen shows is bounded by the zone the profile holds"
tags: [research, codebase, calendar, timezones, tonnage, dashboard, render-tests, risk-1]
status: complete
last_updated: 2026-08-20
last_updated_by: Monika Zmuda
---

# Research: Week-boundary seam (rollout Phase 4, Risk #1)

**Date**: 2026-08-20T22:23:27+02:00
**Researcher**: Monika Zmuda
**Git Commit**: `7fbfb0d34dc6580ea2b37c3243e82aac3b96cff9`
**Branch**: `main`
**Repository**: `monikazmuda9310-arya/10xdevs-gymlog`

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md`, "Week-boundary seam", covering Risk #1:
_the week's figures are computed from the wrong days after a timezone change; the number looks
correct and is believed_ (High × High — the only such row on the map).

Verify rather than accept the plan's response guidance: prove a SCREEN shows a week bounded by the
days of the profile's stored zone; challenge "the unit tests pin both DST transitions"; avoid a guard
left inert by the runner's ambient zone; avoid asserting a figure without asserting WHICH DAYS made
it. Ground where the stored zone is read, what happens to an unknown one, and whether the form and
the validator share one list. Also ground the two class-E fallbacks inherited from Phase 3.

## Summary

**The seam is real, it is one expression wide, and nothing in the eight-step gate touches it.**

`src/pages/dashboard.astro:43` is the entire join between the stored zone and the days a figure is
made from:

```text
tonnage = await weeklyTonnage(supabase, user.id, profile.timezone);
```

Replace `profile.timezone` there with the literal `"Europe/Warsaw"` and **every one of the five
runners stays green**. The same is true of `src/pages/workouts/index.astro:23`. That is the defect
Risk #1 describes, and it is currently undetectable.

Six findings reshape the phase, and four of them correct the brief:

1. **`/dashboard` never renders the week's days.** It prints the zone NAME and two figures, and
   nothing else (§ Finding 1). `week.start` / `week.end` physically reach the markup — `WeekTonnage`
   extends `DateRange` — and are ignored. So "assert WHICH DAYS made the figure" is **not achievable
   from the HTML at all**. The days are observable only at the query boundary. The plan states this
   as a discipline; on this page it is a structural constraint that decides the test's shape.

2. **The existing week coverage outside the unit suite is circular.** `tests/render/dashboard-tonnage.test.ts:30`
   derives its fixture dates from `trainingWeeksFor` — the function under test — and its stub
   **discards the range arguments entirely** (`:92`). `weekly-tonnage.test.ts` and
   `tonnage-breakdown.test.ts` do the same, including their Sunday-boundary assertions. An off-by-one
   or a wrong zone moves the fixture and the expectation together (§ Finding 2).

3. **Measured, not assumed: the cheap test works.** A throwaway render probe (§ Measurement record)
   showed `vi.setSystemTime` controls the page's own `new Date()` inside Astro frontmatter, and an
   argument-capturing stub reads the exact window. At one instant, two stored zones produced two
   windows seven days apart. This is the cheapest useful layer and it costs one stub change.

4. **`/workouts` — not `/dashboard` — is the only screen where zone arithmetic is visible in HTML**,
   and it holds the only silent UTC fallback in production, by **three** paths (§ Finding 3). It is
   week-boundary-shaped, better grounded than either fallback the phase inherited, and it is not in
   the brief.

5. **The two inherited class-E fallbacks are not one category.** `todayIn`'s UTC fallback is
   reachable — but not by the route the brief assumes — and the timezone-list fallback **cannot
   produce a wrong week at all** (§ Finding 4). The brief also repeats a miscount: the fallback list
   has **seven** entries, not twelve.

6. **The hot-spot citation is adjacent but still not the anchor.** `src/lib/services/` — 53
   changes/30d is directory-level; per file, `calendar.ts` had 3 and `timezones.ts` had 1. The seam
   lives in `src/pages/` (§ Finding 6).

**Recommended layer: render first, integration second.** Render is the only runner that can execute
the join at all — there is no tonnage API endpoint, so no integration suite can reach it.

---

## Detailed Findings

### Finding 1 — The dashboard computes a week from the zone and never says which week

`src/pages/dashboard.astro` reads the profile unfiltered (`:19`), treats an absent row as a failed
load (`:39`), and calls the service (`:41-52`):

```text
19  const { data: profile, error } = (await supabase?.from("profiles").select("timezone, weight_unit").maybeSingle()) ?? {
39  let tonnageFailed = !profile;
43      tonnage = await weeklyTonnage(supabase, user.id, profile.timezone);
```

Everything the page prints about time is these two blocks:

```text
143            ? `Your training week runs Monday to Sunday in ${profile.timezone}.`
144            : "Your training week timezone is not set yet."
...
167                { label: "This week", week: tonnage.current },
168                { label: "Last week", week: tonnage.previous },
174                      {tonnageFigure(week.kilograms, weightUnit)}
```

`week` here is a `WeekTonnage`, and `WeekTonnage extends DateRange` (`src/lib/services/tonnage.ts:48`),
so `week.start` and `week.end` are in scope at `dashboard.astro:169` and are **never used**. Negative
evidence, searched: `grep -rn "\.start\b|\.end\b" --include=*.astro --include=*.tsx src/` returns
nothing, and no `toLocaleDateString` / `Intl.DateTimeFormat` appears anywhere in the UI.

**Consequence.** A wrong boundary — wrong zone, a silent UTC fall-back, a shifted Monday — changes
exactly two numbers. The screen still asserts _"Your training week runs Monday to Sunday in
Europe/Warsaw."_, and that sentence is built from `profile.timezone` (the **column**), not from the
zone the arithmetic actually used. When `todayIn` falls back (§ Finding 4) the two halves of one
paragraph disagree, and the paragraph reads as confirmation.

**This is what makes Risk #1 a High × High row rather than a display bug**: the product's only
week-related claim on screen is the one claim that survives the failure intact.

#### The four guards in the tonnage services check width, never correctness

| Guard                          | What it proves                          | What it cannot see                 |
| ------------------------------ | --------------------------------------- | ---------------------------------- |
| `tonnage.ts:88-91`             | the window is 14 days                   | that it starts on the right Monday |
| `tonnage.ts:112-119`           | returned rows sit inside the window     | that the window is right           |
| `tonnage.ts:149-152`           | the breakdown window is 7 days          | as above                           |
| `tonnage-breakdown.ts:135-140` | rows sit inside the week                | as above                           |
| `tonnage-breakdown.ts:171-178` | the breakdown reconciles with the total | that the total is this week's      |

A window shifted by one day — or by a whole week — is 14 days wide, contains every row returned, and
reconciles perfectly. **Nothing in `src/` compares the computed Monday against an independent source
of truth.**

#### There is no tonnage endpoint, and that decides the layer

`grep -rln "weeklyTonnage|trainingWeeksFor|weeklyBreakdown" src/pages/` returns exactly
`src/pages/dashboard.astro`. No route under `src/pages/api/` reads `timezone` at all (the only two
hits in that tree are the message code `timezone_required` in `api/profile/index.ts:38-39`).

**So the zone → days join is executable only by the render project.** An integration suite can drive
`weeklyTonnage` directly, but then _the test_ supplies the zone, which is precisely the thing under
test.

---

### Finding 2 — Every non-unit assertion about the week derives its expectation from the subject

This is the "guard left inert" anti-pattern from the brief, arriving by a different mechanism than
the brief expects. The inertness is not caused by the ambient zone; it is **circularity**.

**Render** — `tests/render/dashboard-tonnage.test.ts`:

```text
27  const PROFILE = { timezone: "Europe/Warsaw", weight_unit: "kg" };
30  const weeks = trainingWeeksFor(PROFILE.timezone);
...
92  return { select: () => ({ eq: () => ({ gte: () => ({ lte: answer }) }) }) };
```

Two independent reasons this cannot see a wrong week. Line 30 computes the fixture dates with the
same function the page uses, so the two move together. And line 92 — **the stub's `gte` and `lte`
accept no parameters**, so the window the page asked for is discarded before anything could assert on
it. The suite's thirteen week-related assertions are all figures and sentences; not one names a date.

**Integration** — `tests/integration/weekly-tonnage.test.ts` hardcodes `ZONE = "Europe/Warsaw"`
(`:29`) and passes it straight to the service (`:185`), then anchors every fixture on
`trainingWeeksFor(ZONE, now)` (`:63-74`). Assertion 4, "a Sunday belongs to the week that started,
and the Monday after it does not" (`:273`), is the closest thing in the repository to a boundary
check — and its `weeks.lastSunday` / `weeks.thisMonday` come from the subject. Assertion 6 is the
only place a range is quoted (`:332-335`), and it is `f(x) === f(x)`:

```text
332      expect(current.start).toBe(weeks.thisMonday);
```

`tests/integration/tonnage-breakdown.test.ts` has the same shape (`:35`, `:130-134`), and never calls
`weeklyBreakdown` at all — it reads the views directly, so the service's range construction is
untouched.

**The stored profile row is never an input anywhere.** Both tonnage suites call `resetPreferences`
(`fixture-preferences.ts:44`) to establish `timezone: "Europe/Warsaw"` as a **precondition**, then
pass a hardcoded literal to the service. `tests/integration/preferences-derive.test.ts:316-401` is
the only place a zone is written through the real endpoint — and it asserts the opposite claim (that
stored dates do not move) and computes no week at all. Its own comment says so:

```text
326    // **THIS IS A TRIPWIRE, NOT A GUARD, AND SAYING SO IS THE POINT.**
```

**`src/lib/services/tonnage.ts` has no unit test of any kind.** No `tonnage.test.ts` exists; none of
its five throws is ever triggered.

#### What the unit suite does prove — the "must challenge" verified, and sharpened

The brief says to challenge _"the unit tests pin both DST transitions"_. Checked: they do, and they
are **stronger** than the phrase suggests, which makes the challenge more precise rather than less.

`src/lib/services/calendar.test.ts` pins both Warsaw transitions against literals (`:121-138`), the
Sunday-night rollover with Warsaw and UTC on opposite weeks (`:112-119`), month, year and leap
boundaries, and a 365-instant sweep that asserts the anchor's weekday, the 14-day window and the
six-day spans (`:147-170`):

```text
160      expect(new Date(`${current.start}T00:00:00Z`).getUTCDay(), …).toBe(1);
```

That `.toBe(1)` was added by S-07's implementation review (F8) after it found _"a `mondayOf`
returning Sunday passes all 365 iterations"_
(`context/archive/2026-08-13-weekly-tonnage/reviews/impl-review.md:121-129`).

**So the correct challenge is not "the pure function might be wrong."** It is: the pure function is
well pinned, it names its own zone in every case, and **no test anywhere checks that anything calls
it with the zone the account stored.** Two smaller notes: both DST cases are asserted at `12:00Z`,
mid-day and far from any boundary — the transition is spanned, not straddled; and the unknown-zone
case at `:172-179` compares `trainingWeeksFor("Nowhere/Nowhere")` against `trainingWeeksFor("UTC")`,
which is self-referential in the same way as above.

#### The ambient-zone anti-pattern: verified, and it applies to a different suite than expected

Only `vitest.config.ts:33` pins `TZ` (`America/New_York`, both properties load-bearing and each
measured — `lessons.md` § "A guard can be inert because of the ENVIRONMENT it runs in"). The render,
integration and middleware configs pin nothing.

For this phase that matters **less** than it looks: `mondayOf` and `addDays` work on `getUTC*`
accessors of a zoneless date, and every call names its own zone, so the subject is
ambient-independent by construction. The live hazard in the render suite is not ambient `TZ` — it is
the ambient **clock**, and S-07's implementation review already named it and left it open
(`context/archive/2026-08-13-weekly-tonnage/reviews/impl-review.md:149-151`):

> **`dashboard-tonnage.test.ts` computes its weeks from the real clock** while the page uses its own
> `new Date()`. Crossing the Warsaw week boundary between the two would fail one assertion — once a
> week, at Sunday midnight. The page has no injectable clock; the risk is named rather than removed.

Pinning the instant closes that too, as a side effect.

---

### Finding 3 — `/workouts` is the only screen where the arithmetic is visible, and the only silent UTC fallback in production

`src/pages/workouts/index.astro`:

```text
13  let today = todayIn("UTC");
...
23      today = todayIn(profile?.timezone ?? "UTC");
24    } catch (error) {
28      loadFailed = true;
...
55        <NewWorkoutForm defaultDate={today} client:load />
```

`defaultDate` seeds a controlled React input (`NewWorkoutForm.tsx:20`, `:75-78`), so the computed
date is server-rendered into the HTML **twice** — as `value="YYYY-MM-DD"` and inside the
`<astro-island props="…">` payload. Both confirmed by measurement (§ Measurement record, probe C).

**Three independent paths to a silent UTC date on that field:**

| Path                                 | Trigger                                      | Signal to the user                                        |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------- |
| `:13` initialiser                    | `supabase` or `user` falsy                   | none                                                      |
| `:23` `?? "UTC"`                     | no profile row (`getProfile` returns `null`) | none                                                      |
| `:13` surviving the `catch` at `:24` | profile read **threw**                       | a sentence about the **workout list**, not about the date |

The page's own comment (`:50-53`) calls the third case _"visible, and changeable, which beats
offering no form at all"_ — but "visible" means only that a date is on screen; nothing in the HTML
says it is UTC.

**This is the same asymmetry Phase 3 named for `records.astro`, applied to the timezone.**
`dashboard.astro:31-37` treats a null profile as a **failed** load specifically so it does not
compute _"a week in UTC for somebody who is not in it"_; `settings.astro:37-47` does the same;
`/workouts` does the opposite for the identical input. And the consequence is week-shaped, not merely
date-shaped: a workout filed on the wrong day at 01:00 Warsaw lands in the wrong week's tonnage on
the very screen `/dashboard` renders.

`POST /api/workouts` does not compensate — it validates the date's **shape** only
(`parseCreateWorkout`) and never compares it against "today" in any zone.

`tests/render/page-load-failures.test.ts` already renders this page with
`PROFILE = { …, timezone: "Europe/Warsaw", … }` (`:39`) across three states (`:218-260`) and asserts
nothing about the date. **The harness exists; the assertions do not.**

---

### Finding 4 — The two inherited class-E fallbacks, corrected

The brief inherits both from Phase 3 as one category, "week-boundary-shaped". Grounded, they are not
the same category and only one of them is.

#### 4a. `todayIn` → UTC (`calendar.ts:26-35`) — genuinely week-boundary-shaped, and reachable, but not by the route the brief implies

```text
26  export function todayIn(timeZone: string, now: Date = new Date()): string {
27    try {
28      return format(timeZone, now);
29    } catch {
33      return format("UTC", now);
34    }
35  }
```

**Not reachable through the form or the API — measured.** `isSupportedTimeZone`
(`timezones.ts:79-81`) checks membership in `Intl.supportedValuesOf("timeZone")`, and that list is a
**strict subset** of what `Intl.DateTimeFormat` accepts. Probed on this machine (Node 22.14.0, 417
zones): `US/Eastern`, `Australia/Canberra`, `GMT` and `Etc/GMT+5` all format correctly and are all
refused by the validator; nothing in the list fails to format. **The asymmetry runs in the safe
direction** — the form can refuse a zone the formatter handles, never the reverse — so every value
the endpoint admits is formattable and the `catch` cannot fire from that path.

**Reachable by a direct PostgREST write, by the account's own owner.** The column carries no
membership constraint:

```sql
-- 20260810063450_create_profiles_with_row_ownership.sql:13,18
  timezone text not null default 'Europe/Warsaw',
  constraint profiles_timezone_length check (char_length(timezone) between 1 and 64)
```

The UPDATE policy lets an owner write their own row, and
`tests/integration/profiles-rls.test.ts:179-194` **does exactly this today**, storing
`Test/Run-${RUN_ID}` and restoring it in a `finally`. A signed-in account holding the publishable key
can do the same against production. Afterwards their dashboard computes every week in UTC while
printing their bogus zone name as fact (§ Finding 1).

**Verdict: worth one assertion, at the page level, not at the function level.**
`calendar.test.ts:172-179` already pins the function. What nothing pins is that the _screen_ degrades
to a UTC week rather than a 500, and — the sharper half — that it goes on making a claim it can no
longer support.

#### 4b. `Intl.supportedValuesOf` degrading (`timezones.ts:50-63`) — **not** week-boundary-shaped, and miscounted

Two corrections.

**The list has SEVEN entries, not twelve.** `FALLBACK_TIME_ZONES` at `timezones.ts:34-42`: `UTC`,
`Europe/Warsaw`, `Europe/London`, `America/New_York`, `America/Los_Angeles`, `Asia/Tokyo`,
`Australia/Sydney`. The module's own comment says "seven" (`:28`). `test-plan.md:433` and this
change's `change.md:34` both say "a 12-entry hardcoded list". This is the failure mode `lessons.md` §
"The conversion constant has been miscounted twice, in the same direction" describes, occurring
inside the brief that quotes that lesson — which is itself the evidence for stating the **category**
rather than the number.

**It cannot produce a wrong week.** The two fallbacks are independent code paths over different APIs.
`timezones.ts` governs what the `<select>` offers and what the validator accepts; `todayIn` calls
`Intl.DateTimeFormat` directly and never consults the list. A collapsed `supportedValuesOf` would
narrow what the form offers — every already-stored zone would keep formatting correctly and every
week would stay right. The visible symptom is a `<select>` of seven, plus `settings.astro:93-141`'s
"not recognised" banner firing for zones that are in fact fine.

**Verdict: name it, do not test it.** The branch is unreachable in the deployment target (418 zones
measured in real workerd, `lessons.md:656-664`), it is unreachable in the Node test runner for the
same reason, and forcing it would mean stubbing `Intl` — a runtime-specific assertion that
`vitest.render.config.ts:17-23` forbids in the only suite that could host it. Write the paragraph
`lessons.md` § "An assertion you keep because it cannot fail YET" prescribes: name the guarantee, say
no mutation available today breaks it, and name the edit that would (a runtime without
`supportedValuesOf`, or the list being hand-grown into a second source of truth).

#### 4c. The form and the validator do share one list — confirmed

`settings.astro:76` calls `supportedTimeZones()`; `profile-schemas.ts:31` refines with
`isSupportedTimeZone`; both are `timezones.ts`, computed once at module scope (`:44`). Already pinned
from the render side by `tests/render/settings-island.test.ts:122-130` ("3.4 — the rendered option
set is exactly `Intl.supportedValuesOf('timeZone')`", set equality against the runtime list).
**Nothing to add here.**

---

### Finding 5 — Where the seam is, in one table

| Claim                                                               | Where it lives                  | What would notice it breaking today                            |
| ------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| The week is Monday–Sunday, DST-safe, zone-parameterised             | `calendar.ts:60-92`             | `calendar.test.ts` — thoroughly                                |
| The zone list is one source for form and validator                  | `timezones.ts:44-81`            | `timezones.test.ts`, `settings-island.test.ts:122`             |
| An unknown zone is refused at the endpoint                          | `profile-schemas.ts:31`         | `profile.test.ts:48`, `profile-mutations-rls.test.ts:168`      |
| A stored `performed_on` never moves when the zone changes           | nothing stores it               | `preferences-derive.test.ts:316` (tripwire)                    |
| A Sunday's sets land in the week that started                       | Postgres + `fold`               | `weekly-tonnage.test.ts:273` — **but relative to the subject** |
| **The dashboard's window comes from the STORED zone**               | `dashboard.astro:43`            | **nothing**                                                    |
| **The window is the right seven/fourteen days for that zone**       | `tonnage.ts:83-100`, `:154-170` | **nothing**                                                    |
| **The new-workout date comes from the STORED zone**                 | `workouts/index.astro:23`       | **nothing**                                                    |
| **A missing/failed profile silently dates the form in UTC**         | `workouts/index.astro:13,23`    | **nothing**                                                    |
| **A stored unformattable zone degrades the screen, not crashes it** | `calendar.ts:29-34` via `:43`   | **nothing at page level**                                      |

---

### Finding 6 — Hot-spot evidence: adjacent, but still not the anchor

`test-plan.md` §2 cites `src/lib/services/` — 53 changes/30d. Re-measured per file for the same
window (`git log --since=2026-07-17 --until=2026-08-16`, 52 file-touches):

| File                 | Touches | Owns the seam?                      |
| -------------------- | ------- | ----------------------------------- |
| `tonnage.ts`         | 4       | consumes the range                  |
| `tonnage-display.ts` | 4       | no                                  |
| `records.ts`         | 4       | no                                  |
| `calendar.test.ts`   | 4       | pins the function                   |
| `calendar.ts`        | **3**   | **defines the week**                |
| `timezones.ts`       | **1**   | created 2026-08-13, untouched since |

This is a **milder** version of Phase 3's correction rather than a repeat of it. Phase 3 found the
churn pointing at the best-defended code while the defect sat in a file with zero commits. Here the
churn is genuinely adjacent — `tonnage.ts` is the range's consumer — but the seam itself is two
expressions in `src/pages/`, a directory the citation does not name, and the two files that define
the week sit near the bottom of the distribution.

The likelihood evidence remains sound for a different reason than churn: `timezones.ts` was
**created** on 2026-08-13 by `unit-formula-timezone-preferences`, which is the slice that made the
column settable. Before that the risk did not exist — the column was safe by inaccessibility
(`context/archive/2026-08-12-unit-formula-timezone-preferences/plan.md:343-348`). The right sentence
for §2's Source column is "the zone became settable on 2026-08-13", not a churn count.

---

## Measurement record

A throwaway probe under `vitest.render.config.ts`, run at commit `7fbfb0d`, deleted immediately after
it answered. It settles the three feasibility questions the plan would otherwise have to assume.

**Probe A/B — `vi.setSystemTime` controls the page's own `new Date()`, and a stub can read the
window.** Same instant `2026-08-10T02:00:00Z`, same fixtures, only `profiles.timezone` varied:

```
stored zone America/New_York → daily_tonnage          gte 2026-07-27  lte 2026-08-09
                             → daily_exercise_tonnage gte 2026-08-03  lte 2026-08-09
stored zone Europe/Warsaw    → daily_tonnage          gte 2026-08-03  lte 2026-08-16
                             → daily_exercise_tonnage gte 2026-08-10  lte 2026-08-16
```

Two windows **seven days apart** from one instant. Both `gte`/`lte` calls carry `(column, value)`, so
the current stub's zero-parameter `gte: () => …` (`dashboard-tonnage.test.ts:92`) is discarding real
data that is already being passed.

**Probe C — `/workouts` exposes the computed date in HTML.** Same instant, stored zone
`America/New_York`:

```
<input type="date" … value="2026-08-09">
<astro-island … props="{&quot;defaultDate&quot;:[0,&quot;2026-08-09&quot;]}">
```

Warsaw at the same instant yields `2026-08-10`. **The date is directly assertable from the markup.**

**Zone/instant pairs, computed rather than guessed.** `lessons.md` § "A manual criterion whose
outcome depends on the hour it runs" records that only 9 of 418 zones were on a different calendar
date at the hour S-06's manual step ran — _"far away" is not the property being tested; "currently on
a different calendar date" is_. Applied here:

| Instant                | `Europe/Warsaw`   | `UTC`             | `America/New_York` |
| ---------------------- | ----------------- | ----------------- | ------------------ |
| `2026-08-09T22:30:00Z` | week `2026-08-10` | week `2026-08-03` | week `2026-08-03`  |
| `2026-08-10T02:00:00Z` | week `2026-08-10` | week `2026-08-10` | week `2026-08-03`  |

**Both rows are needed and neither is sufficient.** The first catches "UTC substituted for a
positive-offset zone"; the second catches "UTC substituted for a negative-offset zone". A suite using
only the first passes against a page hardcoded to UTC-or-later. This is the same two-property
argument `vitest.config.ts:12-32` makes about the ambient zone, applied to the **subject** instead.

**Validator vs formatter (Node 22.14.0, 417 zones):** `US/Eastern`, `Australia/Canberra`, `GMT`,
`Etc/GMT+5` — `isSupportedTimeZone` false, `Intl.DateTimeFormat` succeeds. `Europe/Warsawa` — both
false. No counter-example found in the other direction.

---

## Cheapest useful layer, and what each assertion must not do

### Render — `tests/render/` (primary; the only runner that can execute the join)

1. **Capture the window, do not discard it.** Widen `rangeChain` / `breakdownChain` to record
   `(column, value)` for `gte` and `lte`. The stub already dispatches on table name and throws on an
   unstubbed one (`dashboard-tonnage.test.ts:143-150`); this is the same tripwire discipline one
   level down.
2. **Pin the instant with `vi.setSystemTime`** — measured to work through Astro's container. It also
   removes the once-a-week Sunday-midnight flake S-07's review named and left open.
3. **Vary the stored zone and assert the window against LITERAL date strings.** Never
   `trainingWeeksFor(...)`, never a `Date` computed locally — that is how the existing suite became
   circular, and it is how a new one would.
4. **Both rows of the instant table**, so neither a positive- nor a negative-offset substitution
   survives.
5. **`/workouts`' date field**, in three states — real zone, null profile, failed profile read —
   asserted from the rendered `value`. The `page-load-failures.test.ts` harness already renders this
   page and already carries a `timezone` in its fixture.
6. **A stored unformattable zone** (`Europe/Warsawa`) at page level: the window falls back to UTC, the
   page still renders, and the sentence still names the stored zone. Pin today's behaviour and say
   plainly what it costs — this is the `records.astro` precedent (`page-load-failures.test.ts:187`,
   "pinned not endorsed").
7. **Every absence assertion needs a positive control** — the identical render with a good zone must
   produce the other window, or a stub that silently stopped being called reads as a pass.

**What render still cannot see** (`test-plan.md` §6.5): hydration, middleware, cookies, CSS, viewport
— and, as always, nothing runtime-specific, because `configFile: false` drops the Cloudflare adapter.

### Integration — `tests/integration/` (secondary; closes the loop through real storage)

The end-to-end claim render cannot make: **a zone written through the real endpoint changes which
week a real set is counted in.**

- Write the zone with `updateProfileRoute`, the way `preferences-derive.test.ts:84-90` already does.
- Read it **back from the row** and pass _that_ to `weeklyTonnage`, so the stored column is the input
  rather than a literal.
- **Anchor on literal dates**, not on `trainingWeeksFor`. Suggested, computed and verified: Sunday
  `2023-06-18` / Monday `2023-06-19` (weeks `2023-06-12` and `2023-06-19`), with the Warsaw DST
  Sundays `2023-03-26` and `2023-10-29` available if a transition week is wanted end-to-end — nothing
  today crosses one.
- **Own a year no other suite writes to.** Measured across `tests/` and `src/`: 2024 (4 literals),
  2025 (16), 2026 (29), 2027 (2). **2023 is free.** `weekly-tonnage` owns 2025-06→2025-12,
  `tonnage-breakdown` owns 2024-12→2025-05.
- **MARK: `t4w-`.** In use today: `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`,
  `s06-`, `s07-`, `s08-`, `s09d-`, `s09i-`, `t2c-`, `t2e-`, `t3s-`. `t4w-` is a prefix of none and
  prefixed by none, and follows Phase 3's `t3s-` convention. Re-derive rather than trusting this
  list: `grep -rn "const MARK" tests/`.
- **Restore `profiles.timezone` in a `finally` AND establish it in `beforeAll`** —
  `fixture-preferences.ts:7-21` explains why teardown alone is not enough, and
  `preferences-derive.test.ts:405-412` is the cross-suite tripwire that goes red if this one leaks.

### Deliberately not proposed

- **E2E.** The join is server-side; a browser adds a build, a worker and a session to observe a value
  the container already renders. `test-plan.md` §1 principle 1.
- **A unit test for `tonnage.ts`.** Its five throws have no coverage at all — a real gap, and a
  different one. Worth naming; not what Risk #1 is about.
- **Forcing the `timezones.ts` fallback.** § Finding 4b.
- **Any SQL change.** No migration references `profiles.timezone` in executable SQL (verified: every
  hit is a column definition or a comment forbidding it), and `AGENTS.md` forbids adding one.

---

## Code References

- `src/lib/services/calendar.ts:26-35` — `todayIn`, the UTC `catch`
- `src/lib/services/calendar.ts:60-68` — `mondayOf`, the `getUTC*` frame
- `src/lib/services/calendar.ts:82-92` — `trainingWeeksFor`; the zone stops here
- `src/lib/services/timezones.ts:34-42` — `FALLBACK_TIME_ZONES`, **seven** entries
- `src/lib/services/timezones.ts:50-63` — the degradation branch
- `src/lib/services/timezones.ts:79-81` — `isSupportedTimeZone`, membership not shape
- `src/lib/services/tonnage.ts:83-119` — window construction, span guard, out-of-window throw
- `src/lib/services/tonnage.ts:154-170` — the breakdown window and `.limit(MAX_BREAKDOWN_ROWS + 1)`
- `src/lib/services/tonnage.ts:193-209` — `fold`; `WeekTonnage` carries `start`/`end`
- `src/pages/dashboard.astro:19,39,43` — **the seam**
- `src/pages/dashboard.astro:140-146` — the only zone-related sentence on screen
- `src/pages/workouts/index.astro:13,23,55` — three UTC paths and the visible date
- `src/components/workouts/NewWorkoutForm.tsx:10-20,75-78` — `defaultDate` → `value`
- `src/pages/settings.astro:76,93-144` — the shared list and the unknown-zone banner
- `src/lib/validation/profile-schemas.ts:28-31` — the membership refine
- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:13,18` — no membership
  constraint
- `vitest.config.ts:12-33` — the `TZ` pin and its two load-bearing properties
- `vitest.render.config.ts:17-23` — why `configFile: false`, and why nothing runtime-specific
- `src/lib/services/calendar.test.ts:112-179` — rollover, both DST cases, the 365-day sweep
- `tests/render/dashboard-tonnage.test.ts:27,30,92` — the circularity and the argument-discarding stub
- `tests/render/page-load-failures.test.ts:39,218-260` — the `/workouts` harness that exists already
- `tests/integration/weekly-tonnage.test.ts:29,63-74,273,332-335` — hardcoded zone, derived anchors
- `tests/integration/tonnage-breakdown.test.ts:35,130-134,455-491` — same shape, views read directly
- `tests/integration/preferences-derive.test.ts:316-401` — the only endpoint-driven zone change
- `tests/integration/profiles-rls.test.ts:179-194` — an invalid zone written directly, today
- `tests/integration/fixture-preferences.ts:7-21,44-49` — why setup, not only teardown

## Architecture Insights

- **The zone is a parameter for exactly one line of its life.** `trainingWeeksFor` converts it into
  four date strings and it is gone (`calendar.ts:77`). Everything downstream — the services, both
  views, every guard — is zone-blind by design, which is why the SQL prohibition holds and why the
  whole risk concentrates at the two call sites that supply the parameter.
- **Consistency guards are not correctness guards.** Five separate throws protect the window's width
  and internal agreement; none of them can tell a right window from a wrong one. That is a reasonable
  design — correctness needs an external oracle — but it means the oracle has to be a test, and there
  isn't one.
- **A derived value that never reaches the screen cannot be checked by the user either.**
  `tonnage.ts:16-24` admits the compensating control lives in a test rather than on the page. Risk #1
  is the case where that trade bites: the user has no way to notice, so the test is the only reader.
- **Circularity is this seam's characteristic failure**, the way "asserting the status code only" is
  the access-control seam's. Every fixture wants to know which Monday it is, the subject is the thing
  that knows, and using it is the natural move. Worth stating in §6 as a cookbook rule.

## Historical Context (from prior changes)

- **`weekly-tonnage`** (archived) — birthplace of `calendar.ts`. `plan.md:204-232` chose the edges
  (Sunday, both DST directions, month/year ends) and explicitly declined the extreme-offset case.
  `reviews/impl-review.md:68-77` (F3) found the `.gte`/`.lte` bounds were guarded by nothing, because
  `fold` re-filters in TypeScript; `:121-129` (F8) found the 365-day sweep passed against a `mondayOf`
  returning Sunday. **`:149-151` named the ambient-clock flake in `dashboard-tonnage.test.ts` and left
  it open** — this phase closes it as a side effect.
- **`unit-formula-timezone-preferences`** (archived) — made the column settable on 2026-08-13, which
  is what created Risk #1. `plan.md:52-57` holds the workerd measurement (418 zones, 6825 bytes).
  `plan.md:561-563` handed the interface half forward. `plan-brief.md:50-52` put E2E out of scope.
- **`tonnage-breakdown`** (archived) — `plan.md:100` restates "no `date_trunc('week', …)`, no SQL
  reference to `profiles.timezone`"; `:226-231` records that a range-filtered suite cannot rely on a
  name prefix and needs its own anchors.
- **`testing-silent-failure-audit`** (archived) — deferred both class-E fallbacks here explicitly
  (`plan.md:117-119`, `:709-711`) and recorded the open question about whether they are worth testing
  at all (`research.md:315-317`). § Finding 4 answers it: one yes, one no.
- **`log-workout-with-estimate`** (archived) — `reviews/plan-review.md:47-60` (F1) established the
  precedent for measuring ICU in real workerd through a temporary endpoint, since a green Node test
  proves nothing there.

## Related Research

- `context/archive/2026-08-20-testing-silent-failure-audit/research.md` — the class-E taxonomy and the
  open question this document closes
- `context/archive/2026-08-16-testing-browser-layer/research.md` — why `astro dev` cannot be re-aimed,
  and the `dist/server/.dev.vars` hazard; the reason no browser layer is proposed here

## Open Questions

1. **Should `/dashboard` print the week's dates?** `week.start` and `week.end` are already in scope at
   `dashboard.astro:169`. Printing them would make the screen self-verifying and would turn Risk #1
   from invisible into obvious — and it would give a render check something to assert in HTML rather
   than at the query boundary. It is a **product change**, so it is the owner's call and out of scope
   for a test phase; recorded here because the phase is the reason anybody knows to ask.
2. **Should `/workouts` say when its date came from UTC?** § Finding 3's three paths are currently
   silent. The minimum is a test that pins them; whether the screen should also say so is the same
   class of question as #1, and the same asymmetry Phase 3 named for `records.astro`.
3. **Should the §2 Source column be re-worded?** § Finding 6: the churn citation is adjacent rather
   than misleading, and the sharper evidence is the date the column became settable. Backport is a
   `/10x-test-plan` decision, not this document's.
4. **`src/lib/services/tonnage.ts` has no unit test.** Five throws, zero coverage. Out of scope for
   Risk #1 and worth a line in §6 so a green gate is not read as covering them.
