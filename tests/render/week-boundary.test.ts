// THE WEEK-BOUNDARY SEAM: does the week a SCREEN shows come from the zone the profile stores?
//
// Risk #1 of `context/foundation/test-plan.md` — the only High × High row on the map: _the week's
// figures are computed from the wrong days after a timezone change; the number looks correct and is
// believed_. The whole join is one expression, `dashboard.astro:43`:
//
//     tonnage = await weeklyTonnage(supabase, user.id, profile.timezone);
//
// Before this file existed, replacing `profile.timezone` there with the literal `"Europe/Warsaw"`
// left all five runners green.
//
// **Why these assertions read the QUERY and not the HTML.** `/dashboard` never renders the week's
// days. It prints the zone NAME and two figures; `week.start` / `week.end` reach the markup —
// `WeekTonnage extends DateRange` (`tonnage.ts:48`) — and are ignored. No `.start`, no `.end` and no
// `Intl.DateTimeFormat` appears anywhere in `src/**/*.astro` or `src/**/*.tsx`. So the window this
// page computed is observable at exactly one place: the range it asks the database for. The stub
// below therefore RECORDS `gte`/`lte` where `dashboard-tonnage.test.ts:92` discards them.
// `/workouts` is the one screen where the arithmetic IS visible in HTML, and it is asserted from the
// rendered `value` further down.
//
// **The circularity rule: `trainingWeeksFor` must never be imported here.** Every expected window
// and every expected date below is a literal `YYYY-MM-DD` string. This is not fastidiousness — it is
// the defect that made the existing coverage inert. `dashboard-tonnage.test.ts:30` computes its
// fixture dates with the function under test, and `weekly-tonnage.test.ts` and
// `tonnage-breakdown.test.ts` anchor the same way, so an off-by-one in `mondayOf` moves fixture and
// expectation together and nothing goes red.
//
// **Why fake timers, when nothing else in this repository uses them.** Neither page has an
// injectable clock: `dashboard.astro:43` calls `weeklyTonnage` with three arguments and
// `workouts/index.astro:23` calls `todayIn` with one, so both fall back to their own `new Date()`.
// Pinning the instant is the only way to make a literal expectation possible, and it also closes the
// once-a-week Sunday-midnight flake S-07's implementation review named and left open. Only `Date` is
// faked (`toFake: ["Date"]`) — Astro's container renderer is async, and handing it a fake
// `setTimeout` would be a hazard unrelated to anything asserted here.
//
// **Why there is deliberately no `TZ` pin in `vitest.render.config.ts`.** Measured: the probe behind
// this file ran under an ambient `Europe/Warsaw` and correctly produced `America/New_York`'s window,
// because the subject NAMES its own zone on every call and every expectation here is a literal. A
// pin would be a guard nobody had mutated — exactly what `lessons.md` § "A guard you have not
// mutated may not guard" refuses. The ambient hazard for this suite was never `TZ`; it was the
// clock, and the clock is pinned.

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import Dashboard from "@/pages/dashboard.astro";
import Workouts from "@/pages/workouts/index.astro";

const USER = { id: "00000000-0000-4000-8000-000000000000", email: "lifter@example.test" };

/**
 * The two instants, chosen WITH their zones rather than separately.
 *
 * `lessons.md` § "A manual criterion whose outcome depends on the hour it runs" records that only 9
 * of 418 zones sat on a different calendar date at the hour S-06's manual step ran: **"far away" is
 * not the property being tested; "currently on a different calendar date" is.** Applied here, and
 * measured:
 *
 * | instant | `Europe/Warsaw` | `UTC`      | `America/New_York` |
 * | ------- | --------------- | ---------- | ------------------ |
 * | I1      | week 08-10      | week 08-03 | week 08-03         |
 * | I2      | week 08-10      | week 08-10 | week 08-03         |
 *
 * **Both rows are needed and neither is sufficient.** At I1, UTC agrees with `America/New_York`; at
 * I2, UTC agrees with `Europe/Warsaw`. Only the pair catches a substituted `"UTC"`, and only the
 * pair catches a hardcoded `"Europe/Warsaw"` — I2 under that literal yields I1's window. This is the
 * two-property argument `vitest.config.ts:12-32` makes about the ambient zone, applied to the
 * SUBJECT instead.
 *
 * **Read the table before adding a case.** Which zone a given instant can distinguish from UTC is
 * the whole design here, and half the pairs prove nothing: an assertion that `Europe/Warsaw` reads
 * `2026-08-10` at I2 is silent about a UTC substitution, because UTC reads `2026-08-10` too.
 */
const I1 = "2026-08-09T22:30:00Z";
const I2 = "2026-08-10T02:00:00Z";

interface Range {
  gte: string;
  lte: string;
}

interface CapturedRange extends Range {
  table: string;
}

interface DailyRow {
  performed_on: string;
  tonnage_kg: number;
}

interface BreakdownRow {
  performed_on: string;
  exercise_id: string;
  exercise_name: string;
  muscle_group: string;
  tonnage_kg: number;
}

/**
 * One training week's worth of expectation and fixture, named by its own Monday.
 *
 * **Named by the week and never by a zone**, because which zone lands on which week is exactly what
 * varies — `Europe/Warsaw` at I1, `America/New_York` at I2 and the UTC fallback at I1 all reach
 * different weeks, and a constant called `WARSAW_*` reused for the UTC case would read as a mistake.
 */
interface Week {
  windows: { daily: Range; breakdown: Range };
  rows: DailyRow[];
  breakdown: BreakdownRow[];
}

const CURRENT_KG = 12345.7;
const PREVIOUS_KG = 9000;

/**
 * Rows for a week pair named by LITERAL Mondays — the fixture, never the expectation.
 *
 * They are a second, independent reader of the same window, and that is deliberate. Both services
 * refuse a row outside the range they asked for (`tonnage.ts:112-119`, `tonnage-breakdown.ts:134`)
 * and `foldBreakdown` refuses a breakdown that does not reconcile with the week total, so a page
 * that computed the WRONG window against these rows renders its failure sentence instead of two
 * figures. The window assertions carry the claim; these rows are what stops a wrong window from also
 * looking healthy on screen.
 */
function weekFixture(currentMonday: string, previousMonday: string): Pick<Week, "rows" | "breakdown"> {
  return {
    rows: [
      { performed_on: currentMonday, tonnage_kg: CURRENT_KG },
      { performed_on: previousMonday, tonnage_kg: PREVIOUS_KG },
    ],
    breakdown: [
      {
        performed_on: currentMonday,
        exercise_id: "exercise-barbell-squat",
        exercise_name: "Barbell squat",
        muscle_group: "legs",
        tonnage_kg: CURRENT_KG,
      },
    ],
  };
}

/** The week `Europe/Warsaw` is in at both instants. */
const WEEK_OF_08_10: Week = {
  windows: {
    daily: { gte: "2026-08-03", lte: "2026-08-16" },
    breakdown: { gte: "2026-08-10", lte: "2026-08-16" },
  },
  ...weekFixture("2026-08-10", "2026-08-03"),
};

/** The week `America/New_York` is in at both instants — and the one UTC falls back to at I1. */
const WEEK_OF_08_03: Week = {
  windows: {
    daily: { gte: "2026-07-27", lte: "2026-08-09" },
    breakdown: { gte: "2026-08-03", lte: "2026-08-09" },
  },
  ...weekFixture("2026-08-03", "2026-07-27"),
};

/**
 * The dashboard's three reads, with the two ranged ones recording what they were asked for.
 *
 * Each chain records at the link that RESOLVES it — `.lte` for `daily_tonnage`, `.limit` for
 * `daily_exercise_tonnage` — so a recorded range proves the whole chain executed rather than merely
 * that a prefix of it did. The extra `.limit` link is the same mirror `dashboard-tonnage.test.ts`
 * keeps and for the same reason: dropping it from the production read must redden this file.
 *
 * The `throw` on an unstubbed table is copied from `dashboard-tonnage.test.ts:143-150` and restated
 * rather than shared, because the chains differ. Without it a fourth read added to the page would
 * receive a non-thenable, `await` would hand it straight back with `error` undefined, and this suite
 * would stay green against a read that never happened.
 */
function dashboardStub(timezone: string, week: Week, captured: CapturedRange[]) {
  const daily = {
    select: () => ({
      eq: () => ({
        gte: (_column: string, from: string) => ({
          lte: (_lteColumn: string, to: string) => {
            captured.push({ table: "daily_tonnage", gte: from, lte: to });
            return Promise.resolve({ data: week.rows, error: null });
          },
        }),
      }),
    }),
  };

  const dailyByExercise = {
    select: () => ({
      eq: () => ({
        gte: (_column: string, from: string) => ({
          lte: (_lteColumn: string, to: string) => ({
            limit: () => {
              captured.push({ table: "daily_exercise_tonnage", gte: from, lte: to });
              return Promise.resolve({ data: week.breakdown, error: null });
            },
          }),
        }),
      }),
    }),
  };

  const profiles = {
    select: () => ({
      maybeSingle: () => Promise.resolve({ data: { timezone, weight_unit: "kg" }, error: null }),
    }),
  };

  return {
    from: (table: string) => {
      if (table === "profiles") return profiles;
      if (table === "daily_tonnage") return daily;
      if (table === "daily_exercise_tonnage") return dailyByExercise;
      throw new Error(`unstubbed table: ${table}`);
    },
  };
}

async function container(): Promise<AstroContainer> {
  const created = await AstroContainer.create();
  created.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  created.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  return created;
}

function pinClock(instant: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}

/** Render `/dashboard` at a pinned instant, and hand back the HTML and the windows it asked for. */
async function renderDashboardAt(
  instant: string,
  timezone: string,
  week: Week,
): Promise<{ html: string; asked: CapturedRange[] }> {
  pinClock(instant);

  const captured: CapturedRange[] = [];
  const html = await (
    await container()
  ).renderToString(
    // A `.astro` module has no type outside Astro's own pipeline, so the import lands as `any` for
    // the type-aware lint rules. `astro check` covers the page itself.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Dashboard,
    { locals: { supabase: dashboardStub(timezone, week, captured), user: USER } as unknown as App.Locals },
  );

  return { html, asked: captured };
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The one range asked of `table`, or a failure naming what was asked instead.
 *
 * Insisting on EXACTLY one is part of the claim: a page that never reached the read, or reached it
 * twice, is not a page whose window can be compared against anything.
 */
function windowFor(asked: CapturedRange[], table: string): Range {
  const matches = asked.filter((range) => range.table === table);

  expect(matches, `expected exactly one ${table} read, got ${JSON.stringify(asked)}`).toHaveLength(1);
  return { gte: matches[0].gte, lte: matches[0].lte };
}

const FAILURE = "Your weekly tonnage could not be loaded";
const BREAKDOWN_FAILURE = "This week's breakdown could not be shown";
/** The class the two weekly totals carry — present iff a figure is on screen. */
const FIGURE_CLASS = "text-2xl font-semibold text-purple-200";

/** The page rendered both figures through the healthy path — so a captured range is not vacuous. */
function expectHealthy(html: string): void {
  expect(html).not.toContain(FAILURE);
  expect(html).not.toContain(BREAKDOWN_FAILURE);
  expect(html.split(FIGURE_CLASS)).toHaveLength(3);
  expect(html).toContain("12,346");
  expect(html).toContain("9,000");
}

describe("the dashboard's week comes from the profile's stored timezone", () => {
  it("asks for the stored zone's days at a positive offset, not UTC's", async () => {
    // I1: `Europe/Warsaw` is already on 2026-08-10 while UTC is still on 2026-08-09. **This is the
    // case a substituted `"UTC"` fails and a hardcoded `"Europe/Warsaw"` survives** — which is why
    // the negative-offset test below exists, and why deleting either one leaves a suite that passes
    // against a real defect.
    const { html, asked } = await renderDashboardAt(I1, "Europe/Warsaw", WEEK_OF_08_10);

    expect(windowFor(asked, "daily_tonnage")).toEqual(WEEK_OF_08_10.windows.daily);
    expect(windowFor(asked, "daily_exercise_tonnage")).toEqual(WEEK_OF_08_10.windows.breakdown);
    // Diagnostic, and below the claim on purpose (`lessons.md` § "The assertion carrying the claim
    // goes FIRST"): a captured range from a page that fell into its failure branch would be a
    // vacuous pass, and this is what says it did not.
    expectHealthy(html);
  });

  it("asks for the stored zone's days at a negative offset, not UTC's", async () => {
    // I2: `America/New_York` is still on 2026-08-09 while UTC has rolled to 2026-08-10. **This is
    // the case a hardcoded `"Europe/Warsaw"` fails**, because that literal would produce the other
    // test's window from this instant.
    const { html, asked } = await renderDashboardAt(I2, "America/New_York", WEEK_OF_08_03);

    expect(windowFor(asked, "daily_tonnage")).toEqual(WEEK_OF_08_03.windows.daily);
    expect(windowFor(asked, "daily_exercise_tonnage")).toEqual(WEEK_OF_08_03.windows.breakdown);
    expectHealthy(html);
  });

  it("gives two zones two different weeks from ONE instant", async () => {
    // **What makes the pair above load-bearing rather than two constants that happen to match.**
    // Four assertions all recording the same window would still pass; this one varies nothing but
    // the stored column and requires the answer to move — by a whole week, measured.
    const warsaw = await renderDashboardAt(I2, "Europe/Warsaw", WEEK_OF_08_10);
    const newYork = await renderDashboardAt(I2, "America/New_York", WEEK_OF_08_03);

    expect(windowFor(warsaw.asked, "daily_tonnage")).toEqual(WEEK_OF_08_10.windows.daily);
    expect(windowFor(newYork.asked, "daily_tonnage")).toEqual(WEEK_OF_08_03.windows.daily);
    expect(windowFor(warsaw.asked, "daily_tonnage")).not.toEqual(windowFor(newYork.asked, "daily_tonnage"));
    expectHealthy(warsaw.html);
    expectHealthy(newYork.html);
  });
});

describe("the dashboard when the stored zone cannot be formatted", () => {
  it("computes a UTC week and still tells the reader it used the stored zone", async () => {
    // **Both halves of the failure, because the second one is what makes Risk #1 invisible.**
    // `todayIn` catches the `RangeError` an unknown zone raises and answers in UTC
    // (`calendar.ts:29-34`), while the sentence on screen is built from the COLUMN
    // (`dashboard.astro:143`). So the paragraph contradicts itself: the arithmetic came from UTC and
    // the prose claims `Europe/Warsawa`. Asserting only the window would pin the smaller fact and
    // leave the sentence — the product's one week-related claim on screen — unguarded.
    //
    // **At I1 and nowhere else.** At I2 the UTC fallback lands on the same week `Europe/Warsaw`
    // produces, so this assertion would pass against a perfectly working zone and prove nothing.
    //
    // **PINNED, NOT ENDORSED** (`lessons.md` § "An assertion you keep because it cannot fail YET").
    // The guarantee is that a profile carrying an unformattable zone does not take the page down —
    // UTC is wrong by at most a day and the screen still renders. What this cannot claim is that the
    // value is reachable through the product: `isSupportedTimeZone` (`timezones.ts:79-81`) checks
    // membership in `Intl.supportedValuesOf("timeZone")`, which is a strict SUBSET of what
    // `Intl.DateTimeFormat` accepts, so the form and the endpoint refuse everything the formatter
    // would refuse and more. It is reachable by a direct PostgREST write from the row's own owner —
    // `profiles.timezone` carries no membership constraint
    // (`20260810063450_create_profiles_with_row_ownership.sql:13,18`) and
    // `profiles-rls.test.ts:179-194` writes `Test/Run-<id>` into it today. **The edit that would
    // change this assertion** is `/dashboard` learning to name the zone it actually COMPUTED in
    // rather than the one it stored, at which point the contradiction below stops being the
    // behaviour and starts being the bug.
    const broken = await renderDashboardAt(I1, "Europe/Warsawa", WEEK_OF_08_03);

    expect(windowFor(broken.asked, "daily_tonnage")).toEqual(WEEK_OF_08_03.windows.daily);
    expect(broken.html).toContain("Your training week runs Monday to Sunday in Europe/Warsawa.");
    expectHealthy(broken.html);

    // **The positive control, at the same instant.** Without it a stub that had silently stopped
    // being called, or a page that answered the UTC week for every zone, would read as a pass.
    const working = await renderDashboardAt(I1, "Europe/Warsaw", WEEK_OF_08_10);

    expect(windowFor(working.asked, "daily_tonnage")).toEqual(WEEK_OF_08_10.windows.daily);
    expect(windowFor(broken.asked, "daily_tonnage")).not.toEqual(windowFor(working.asked, "daily_tonnage"));
  });
});

// ---------------------------------------------------------------------------------------------
// `/workouts` — the one screen in the product where the zone arithmetic reaches the HTML.
// ---------------------------------------------------------------------------------------------

/** What a `/workouts` read is made to do. `"throw"` is PostgREST's shape: an `error`, not a rejection. */
type Answer = "throw" | unknown[] | Record<string, unknown> | null;

const READ_FAILED = { data: null, error: { message: "unreachable", code: "XX000" } };

const resolve = (answer: Answer) =>
  answer === "throw" ? Promise.resolve(READ_FAILED) : Promise.resolve({ data: answer, error: null });

/** `getProfile`: `.select("*").eq("id", …).maybeSingle()` — it THROWS on an error (`profiles.ts:37`). */
const profileChain = (answer: Answer) => ({ select: () => ({ eq: () => ({ maybeSingle: () => resolve(answer) }) }) });

/** `listWorkouts`: `.select().eq().order().order()`. The page reads both tables in one `Promise.all`. */
const workoutsChain = (answer: Answer) => ({
  select: () => ({ eq: () => ({ order: () => ({ order: () => resolve(answer) }) }) }),
});

const WORKOUTS_FAILED = "Your workouts could not be loaded";

/**
 * Render `/workouts` at a pinned instant and return the date its form opens on.
 *
 * The date is server-rendered TWICE — as the `<input type="date">` `value` and inside the
 * `<astro-island props="…">` payload that hydrates `NewWorkoutForm`. The `value` is the one a user
 * can see, so it is the one asserted; the HTML comes back too, because three of the four states
 * below are separated by a sentence rather than by the date.
 */
async function renderWorkoutsAt(instant: string, profile: Answer): Promise<{ html: string; date: string }> {
  pinClock(instant);

  const html = await (
    await container()
  ).renderToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Workouts,
    {
      locals: {
        supabase: {
          from: (table: string) => {
            if (table === "profiles") return profileChain(profile);
            if (table === "workouts") return workoutsChain([]);
            throw new Error(`unstubbed table: ${table}`);
          },
        },
        user: USER,
      } as unknown as App.Locals,
    },
  );

  const match = /<input[^>]*type="date"[^>]*value="([^"]*)"/.exec(html);

  expect(match, 'no <input type="date"> with a value in the rendered page').not.toBeNull();
  return { html, date: match?.[1] ?? "" };
}

const PROFILE_IN = (timezone: string) => ({
  id: USER.id,
  timezone,
  weight_unit: "kg",
  estimation_formula: "brzycki",
});

describe("the new-workout form opens on the date the stored zone is on", () => {
  it("uses the stored zone rather than UTC, at a negative offset", async () => {
    // I2: `America/New_York` is still on 2026-08-09 while UTC has rolled to 2026-08-10. A workout
    // filed on the wrong day at this hour lands in the wrong week's tonnage on `/dashboard`, which
    // is why a date field is a week-boundary assertion and not merely a display one.
    const { html, date } = await renderWorkoutsAt(I2, PROFILE_IN("America/New_York"));

    expect(date).toBe("2026-08-09");
    expect(html).not.toContain(WORKOUTS_FAILED);
  });

  it("uses the stored zone rather than UTC, at a positive offset", async () => {
    // I1, and the instant matters: at I2 `Europe/Warsaw` reads `2026-08-10` and so does UTC, so the
    // same assertion there would be silent about a substituted `todayIn("UTC")`. Read the instant
    // table at the top of this file before moving either of these two tests.
    const { html, date } = await renderWorkoutsAt(I1, PROFILE_IN("Europe/Warsaw"));

    expect(date).toBe("2026-08-10");
    expect(html).not.toContain(WORKOUTS_FAILED);
  });

  it("varies with the stored zone at ONE instant, so neither date above is a constant", async () => {
    const warsaw = await renderWorkoutsAt(I2, PROFILE_IN("Europe/Warsaw"));
    const newYork = await renderWorkoutsAt(I2, PROFILE_IN("America/New_York"));

    expect(warsaw.date).toBe("2026-08-10");
    expect(newYork.date).toBe("2026-08-09");
    expect(warsaw.date).not.toBe(newYork.date);
  });
});

describe("the new-workout form's two silent UTC fallbacks", () => {
  // **PINNED, NOT ENDORSED, and the asymmetry is the point.** `dashboard.astro:31-37` treats a null
  // profile as a FAILED load specifically so it does not compute "a week in UTC for somebody who is
  // not in it", and `settings.astro:37-47` does the same. `workouts/index.astro` does the opposite
  // for the identical input: `:23`'s `?? "UTC"` and `:13`'s initialiser both put a UTC date on
  // screen with nothing saying it is UTC. That is the `records.astro` class Phase 3 of the rollout
  // named, applied to the timezone — and it is week-shaped, because the date decides which week the
  // workout's tonnage lands in.
  //
  // The guarantee these two pin is that the form stays USABLE when the profile is unavailable — a
  // date that is wrong by at most a day and can be changed, rather than no form at all
  // (`workouts/index.astro:50-53`). **No mutation available today breaks that through the product**:
  // both branches are reached only when the profile read returns nothing or fails, neither of which
  // a user can cause. **The edit that would change them** is the product deciding this page should
  // say when its date came from UTC, or should refuse the form the way `/dashboard` refuses a
  // figure — Open Question 2 of the `testing-week-boundary-seam` change folder's `research.md`, and
  // an owner call rather than a test's.
  //
  // **`not.toContain("UTC")` below is deliberately UNBOUNDED, against this project's usual
  // discipline.** `dashboard-tonnage.test.ts:250` bounds such a check to a region so it cannot fail
  // for a reason unrelated to its claim, and that is right there, where the same sentence
  // legitimately appears elsewhere on the page. Here the claim is precisely "NOWHERE on this
  // screen", so narrowing it to the form would weaken it into something these two fallbacks could
  // pass while a banner further down said UTC. The cost is accepted and named: unrelated copy
  // containing those three letters would redden these two tests, and the fix for that is to read
  // this paragraph, not to loosen the assertion.

  it("falls back to UTC with no signal when there is no profile row", async () => {
    // At I2 the UTC date is `2026-08-10` — the same date `Europe/Warsaw` would give, which is why
    // the assertion below cannot be "the date is UTC's" on its own. What separates this state from
    // a working one is that NOTHING on screen says so, and that is asserted explicitly.
    const { html, date } = await renderWorkoutsAt(I2, null);

    expect(date).toBe("2026-08-10");
    expect(html).not.toContain(WORKOUTS_FAILED);
    expect(html).not.toContain("UTC");
  });

  it("keeps the initialiser's UTC date when the profile read THROWS, and names only the list", async () => {
    // `getProfile` throws on a PostgREST error (`profiles.ts:37-39`), and it shares one `Promise.all`
    // and one `catch` with `listWorkouts` — so `:23` never runs and `today` keeps `:13`'s UTC value.
    // The sentence the reader gets is about the WORKOUT LIST; nothing anywhere says the date fell
    // back. Asserting the sentence's presence here and its absence above is what tells the two
    // fallbacks apart, because the date is identical in both.
    const { html, date } = await renderWorkoutsAt(I2, "throw");

    expect(date).toBe("2026-08-10");
    expect(html).toContain(WORKOUTS_FAILED);
    expect(html).not.toContain("UTC");
  });
});
