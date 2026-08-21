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
//
// **The circularity rule: `trainingWeeksFor` must never be imported here.** Every expected window
// below is a literal `YYYY-MM-DD` string. This is not fastidiousness — it is the defect that made
// the existing coverage inert. `dashboard-tonnage.test.ts:30` computes its fixture dates with the
// function under test, and `weekly-tonnage.test.ts` and `tonnage-breakdown.test.ts` anchor the same
// way, so an off-by-one in `mondayOf` moves fixture and expectation together and nothing goes red.
//
// **Why fake timers, when nothing else in this repository uses them.** The page has no injectable
// clock: `dashboard.astro:43` calls `weeklyTonnage` with three arguments, so its `now` defaults to
// the page's own `new Date()`. Pinning the instant is the only way to make a literal expectation
// possible, and it also closes the once-a-week Sunday-midnight flake S-07's implementation review
// named and left open. Only `Date` is faked (`toFake: ["Date"]`) — Astro's container renderer is
// async, and handing it a fake `setTimeout` would be a hazard unrelated to anything asserted here.
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
 */
const I1 = "2026-08-09T22:30:00Z";
const I2 = "2026-08-10T02:00:00Z";

/** The two windows `/dashboard` asks for, per zone. Literals — never `trainingWeeksFor`. */
const WARSAW_WINDOWS = {
  daily: { gte: "2026-08-03", lte: "2026-08-16" },
  breakdown: { gte: "2026-08-10", lte: "2026-08-16" },
};
const NEW_YORK_WINDOWS = {
  daily: { gte: "2026-07-27", lte: "2026-08-09" },
  breakdown: { gte: "2026-08-03", lte: "2026-08-09" },
};

interface CapturedRange {
  table: string;
  gte: string;
  lte: string;
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

const CURRENT_KG = 12345.7;
const PREVIOUS_KG = 9000;

/**
 * Rows for a week pair named by LITERAL Mondays — the fixture, never the expectation.
 *
 * It is a second, independent reader of the same window, and that is deliberate. Both services
 * refuse a row outside the range they asked for (`tonnage.ts:112-119`, `tonnage-breakdown.ts:134`)
 * and `foldBreakdown` refuses a breakdown that does not reconcile with the week total, so a page
 * that computed the WRONG window against these rows renders its failure sentence instead of two
 * figures. The window assertions below carry the claim; these rows are what stops a wrong window
 * from also looking healthy on screen.
 */
function weekFixture(currentMonday: string, previousMonday: string): { rows: DailyRow[]; breakdown: BreakdownRow[] } {
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

const WARSAW_FIXTURE = weekFixture("2026-08-10", "2026-08-03");
const NEW_YORK_FIXTURE = weekFixture("2026-08-03", "2026-07-27");

interface StubConfig {
  timezone: string;
  rows: DailyRow[];
  breakdown: BreakdownRow[];
}

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
function stub(config: StubConfig, captured: CapturedRange[]) {
  const daily = {
    select: () => ({
      eq: () => ({
        gte: (_column: string, from: string) => ({
          lte: (_lteColumn: string, to: string) => {
            captured.push({ table: "daily_tonnage", gte: from, lte: to });
            return Promise.resolve({ data: config.rows, error: null });
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
              return Promise.resolve({ data: config.breakdown, error: null });
            },
          }),
        }),
      }),
    }),
  };

  const profiles = {
    select: () => ({
      maybeSingle: () => Promise.resolve({ data: { timezone: config.timezone, weight_unit: "kg" }, error: null }),
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

/** Render `/dashboard` at a pinned instant, and hand back the HTML and the windows it asked for. */
async function renderDashboardAt(
  instant: string,
  config: StubConfig,
): Promise<{ html: string; asked: CapturedRange[] }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));

  const captured: CapturedRange[] = [];
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  const html = await container.renderToString(
    // A `.astro` module has no type outside Astro's own pipeline, so the import lands as `any` for
    // the type-aware lint rules. `astro check` covers the page itself.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Dashboard,
    { locals: { supabase: stub(config, captured), user: USER } as unknown as App.Locals },
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
function windowFor(asked: CapturedRange[], table: string): { gte: string; lte: string } {
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
    const { html, asked } = await renderDashboardAt(I1, { timezone: "Europe/Warsaw", ...WARSAW_FIXTURE });

    expect(windowFor(asked, "daily_tonnage")).toEqual(WARSAW_WINDOWS.daily);
    expect(windowFor(asked, "daily_exercise_tonnage")).toEqual(WARSAW_WINDOWS.breakdown);
    // Diagnostic, and below the claim on purpose (`lessons.md` § "The assertion carrying the claim
    // goes FIRST"): a captured range from a page that fell into its failure branch would be a
    // vacuous pass, and this is what says it did not.
    expectHealthy(html);
  });

  it("asks for the stored zone's days at a negative offset, not UTC's", async () => {
    // I2: `America/New_York` is still on 2026-08-09 while UTC has rolled to 2026-08-10. **This is
    // the case a hardcoded `"Europe/Warsaw"` fails**, because that literal would produce the other
    // test's window from this instant.
    const { html, asked } = await renderDashboardAt(I2, { timezone: "America/New_York", ...NEW_YORK_FIXTURE });

    expect(windowFor(asked, "daily_tonnage")).toEqual(NEW_YORK_WINDOWS.daily);
    expect(windowFor(asked, "daily_exercise_tonnage")).toEqual(NEW_YORK_WINDOWS.breakdown);
    expectHealthy(html);
  });

  it("gives two zones two different weeks from ONE instant", async () => {
    // **What makes the pair above load-bearing rather than two constants that happen to match.**
    // Four assertions all recording the same window would still pass; this one varies nothing but
    // the stored column and requires the answer to move — by a whole week, measured.
    const warsaw = await renderDashboardAt(I2, { timezone: "Europe/Warsaw", ...WARSAW_FIXTURE });
    const newYork = await renderDashboardAt(I2, { timezone: "America/New_York", ...NEW_YORK_FIXTURE });

    expect(windowFor(warsaw.asked, "daily_tonnage")).toEqual(WARSAW_WINDOWS.daily);
    expect(windowFor(newYork.asked, "daily_tonnage")).toEqual(NEW_YORK_WINDOWS.daily);
    expect(windowFor(warsaw.asked, "daily_tonnage")).not.toEqual(windowFor(newYork.asked, "daily_tonnage"));
    expectHealthy(warsaw.html);
    expectHealthy(newYork.html);
  });
});
