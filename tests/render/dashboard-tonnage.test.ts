// The states the dashboard's tonnage figures can be in — and, since S-08, the states its per-group
// and per-exercise breakdown can be in — asserted against the rendered HTML.
//
// **Why rendering rather than fetching**: `/dashboard` is in `PROTECTED_ROUTES` and `astro dev`
// reads its credentials from `.dev.vars`, which points at PRODUCTION — a fetch would need a real
// production session. Astro's container renders the real page component with fake `locals` and needs
// no server, no session and no network. The same reason `settings-island.test.ts` exists.
//
// **The dashboard's stub is harder than the settings one, and that is the point.** This page makes
// three reads with two different chain shapes — `from("profiles").select().maybeSingle()` returning
// a row, and `select().eq().gte().lte()` returning an array, for `daily_tonnage` and (since S-08)
// `daily_exercise_tonnage` — so the stub dispatches on the table name. The plan claimed widening the
// profile read "keeps the stub to one chain shape"; that was wrong, and the widening is still right
// for its other two reasons.
//
// **S-08 arrived through the stub's own tripwire.** Its `throw` on an unstubbed table was written in
// S-07 for exactly this moment: adding the breakdown read reddened this file before a single new
// assertion existed, which is what a wanted failure looks like.

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { beforeAll, describe, expect, it } from "vitest";

import Dashboard from "@/pages/dashboard.astro";
import { trainingWeeksFor } from "@/lib/services/calendar";

const PROFILE = { timezone: "Europe/Warsaw", weight_unit: "kg" };

/** The current week's Monday for the profile above — the date a "this week" fixture must carry. */
const weeks = trainingWeeksFor(PROFILE.timezone);

interface DailyRow {
  performed_on: string;
  tonnage_kg: number;
}

interface BreakdownRow {
  performed_on: string;
  exercise_id: string;
  exercise_name: string | null;
  muscle_group: string | null;
  tonnage_kg: number;
}

/** One `(day, exercise)` row of `daily_exercise_tonnage`, always inside the CURRENT week. */
function breakdownRow(group: string | null, name: string | null, tonnageKg: number): BreakdownRow {
  return {
    performed_on: weeks.current.start,
    exercise_id: `exercise-${name ?? "unreadable"}`,
    exercise_name: name,
    muscle_group: group,
    tonnage_kg: tonnageKg,
  };
}

/**
 * The breakdown behind `both`, `inPounds` and `oneEmpty` — and TWO couplings that make this fixture
 * harder to change than it looks. Both were found by plan review (F4) before they were hit.
 *
 * **1. The rows must sum to exactly `12345.7`**, the current week's total in `ROWS` below.
 * `foldBreakdown` THROWS unless the breakdown reconciles with the week total it is handed, and the
 * page answers that throw with its failure sentence — so a fixture that does not add up would leave
 * every assertion here silently testing the failure path while reading as coverage.
 *
 * **2. No row may FORMAT to `12,346` or `9,000`.** The two `not.toContain` guards in the pounds test
 * are whole-page substring checks over the two weekly totals, and this page now prints nine more
 * figures. A breakdown row landing on either string would fail a guard for a reason unrelated to
 * what the guard is about.
 */
const BREAKDOWN = [
  breakdownRow("legs", "Barbell squat", 6000),
  breakdownRow("back", "Deadlift", 4000),
  breakdownRow("chest", "Bench press", 2345.7),
];

/** Tonnage whose exercise this account can no longer read — the `left join`'s null, on screen. */
const BREAKDOWN_WITH_UNREADABLE = [breakdownRow("legs", "Barbell squat", 12000), breakdownRow(null, null, 345.7)];

/** A group that trained and moved no external load, beside five that did not train at all. */
const BREAKDOWN_WITH_PLANKS = [breakdownRow("legs", "Barbell squat", 12345.7), breakdownRow("core", "Plank", 0)];

/** Both range reads share a chain shape: `select().eq().gte().lte()`. */
function rangeChain(answer: () => Promise<unknown>) {
  return { select: () => ({ eq: () => ({ gte: () => ({ lte: answer }) }) }) };
}

/**
 * A Supabase stub that answers all three of the page's reads.
 *
 * `profile: null` models an account with no profile row — `maybeSingle()` returns `null` WITHOUT an
 * error, which is the path that must not fall through to a defaulted unit. `rows: "throw"` models a
 * failed tonnage read and `breakdown: "throw"` a failed breakdown read; the two are separate because
 * the page degrades them separately, which is the whole of the degrade rule.
 */
function stub({
  profile,
  rows,
  breakdown = BREAKDOWN,
}: {
  profile: typeof PROFILE | null;
  rows: DailyRow[] | "throw";
  breakdown?: BreakdownRow[] | "throw";
}) {
  const daily = rangeChain(() =>
    rows === "throw"
      ? Promise.resolve({ data: null, error: { message: "unreachable", code: "XX000" } })
      : Promise.resolve({ data: rows, error: null }),
  );
  const dailyByExercise = rangeChain(() =>
    breakdown === "throw"
      ? Promise.resolve({ data: null, error: { message: "unreachable", code: "XX000" } })
      : Promise.resolve({ data: breakdown, error: null }),
  );
  const profiles = {
    select: () => ({ maybeSingle: () => Promise.resolve({ data: profile, error: null }) }),
  };

  // Throws on an unstubbed table rather than quietly answering the daily chain. A fourth read added
  // to the page would otherwise get a chain whose `.eq()` returns a non-thenable, `await` would hand
  // that straight back, `error` would be undefined, and the page would sail on — leaving this suite
  // green against a read that never happened. S-08's breakdown read is what proved this works.
  return {
    from: (table: string) => {
      if (table === "profiles") return profiles;
      if (table === "daily_tonnage") return daily;
      if (table === "daily_exercise_tonnage") return dailyByExercise;
      throw new Error(`unstubbed table: ${table}`);
    },
  };
}

async function render(config: Parameters<typeof stub>[0]): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  return container.renderToString(
    // A `.astro` module has no type outside Astro's own pipeline, so the import lands as `any` for
    // the type-aware lint rules. `astro check` covers the page itself.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Dashboard,
    {
      locals: {
        supabase: stub(config),
        user: { id: "00000000-0000-4000-8000-000000000000", email: "lifter@example.test" },
      } as unknown as App.Locals,
    },
  );
}

const FAILURE = "Your weekly tonnage could not be loaded";
/** The breakdown's OWN failure sentence. A different sentence because it is a different outcome. */
const BREAKDOWN_FAILURE = "Your breakdown could not be loaded";
// Per WEEK, not per page: the card that is empty names its own week. Rendering "this week" under
// the *Last week* card was the copy defect the implementation review found — and the old constant
// pinned it, so a passing assertion was holding it in place.
const NO_SETS = "No sets logged last week";
/** The class the figure itself carries — present iff a number is on screen. */
const FIGURE_CLASS = "text-2xl font-semibold text-purple-200";
/**
 * The class a BREAKDOWN row's figure carries. Deliberately not `FIGURE_CLASS`: that string is
 * counted exactly twice below, for the two weekly totals, and reusing it on nine breakdown rows
 * would trip an assertion that has nothing to do with the breakdown.
 */
const ROW_FIGURE_CLASS = "text-sm font-medium text-purple-200";
/** The full element, so it cannot match `No sets logged last week`. */
const GROUP_NO_SETS = "No sets</p>";
const NO_EXTERNAL_LOAD = "Sets logged, no external load";

/** The six groups in the order the base fixture must put them in: 6000, 4000, 2345.7, then zeros. */
const GROUPS_LARGEST_FIRST = ["Legs", "Back", "Chest", "Shoulders", "Arms", "Core"];

let both: string;

const ROWS = [
  { performed_on: weeks.current.start, tonnage_kg: 12345.7 },
  { performed_on: weeks.previous.start, tonnage_kg: 9000 },
];

let inPounds: string;
let oneEmpty: string;
let failed: string;
let noProfile: string;
let unreadable: string;
let planks: string;
let breakdownFailed: string;

beforeAll(async () => {
  [both, inPounds, oneEmpty, failed, noProfile, unreadable, planks, breakdownFailed] = await Promise.all([
    render({ profile: PROFILE, rows: ROWS }),
    render({ profile: { ...PROFILE, weight_unit: "lb" }, rows: ROWS }),
    render({ profile: PROFILE, rows: [{ performed_on: weeks.current.start, tonnage_kg: 12345.7 }] }),
    render({ profile: PROFILE, rows: "throw" }),
    render({ profile: null, rows: [] }),
    render({ profile: PROFILE, rows: ROWS, breakdown: BREAKDOWN_WITH_UNREADABLE }),
    render({ profile: PROFILE, rows: ROWS, breakdown: BREAKDOWN_WITH_PLANKS }),
    render({ profile: PROFILE, rows: ROWS, breakdown: "throw" }),
  ]);
});

/** The one `<li>` of the group list whose label is `label`, so a row can be asserted on in isolation. */
function groupRow(html: string, label: string): string {
  const rows = html.split("<li").filter((part) => part.includes(`>${label}<`));

  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Every breakdown figure on the page, in document order: six or seven groups, then the exercises. */
function rowFigures(html: string): number[] {
  return html
    .split(ROW_FIGURE_CLASS)
    .slice(1)
    .map((part) =>
      Number(part.slice(part.indexOf(">") + 1, part.indexOf("<", part.indexOf(">"))).replace(/[\s,]/g, "")),
    );
}

describe("the dashboard's tonnage figures", () => {
  it("renders both weeks, so the assertions below are not vacuous", () => {
    // Without this, every "the wrong thing is absent" check passes against a page that rendered
    // nothing — the failure mode `settings-island.test.ts` calls out first.
    expect(both).toContain("This week");
    expect(both).toContain("Last week");
    expect(both).toContain("12,346");
    expect(both).toContain("9,000");
    expect(both).not.toContain(FAILURE);
    expect(both).not.toContain(NO_SETS);
  });

  it("ships no hydrated island for this", () => {
    // A weekly total has no interaction. Phrased as "hydrated island" rather than "no JavaScript":
    // the page does carry a plain <form method="POST"> for sign-out, which is not JavaScript.
    expect(both).not.toContain("<astro-island");
  });

  it("both figures follow the account's unit, and BOTH change together", () => {
    // **The pair, not one of them.** Asserting a single figure passes against code that converts
    // `current` and prints `previous` raw — which is half of US-03's fourth criterion and reads as
    // a working screen.
    expect(inPounds).toContain("27,218"); // 12345.7 kg
    expect(inPounds).toContain("19,842"); // 9000 kg
    expect(inPounds).toContain("lb");
    expect(inPounds).not.toContain("12,346");
    expect(inPounds).not.toContain("9,000");
  });
});

describe("the dashboard when a week is empty", () => {
  it("shows zero WITH its explanation for the empty week, and a figure for the other", () => {
    // The commonest state a real first-time user is in, and the one a page-level model gets wrong:
    // this week has work, last week has none. Both figures must render; only the empty one carries
    // the sentence.
    expect(oneEmpty).toContain("12,346");
    expect(oneEmpty).toContain(NO_SETS);
    // **The empty week still renders a FIGURE**, and this half was missing until the implementation
    // review: code that hid the number for an empty week — the blank US-03 forbids — passed the
    // suite, because the only figure asserted belonged to the other week. Two figure spans, one 0.
    // Two figure spans, and one of them reads exactly "0" — not merely a second empty span.
    const figures = oneEmpty
      .split(FIGURE_CLASS)
      .slice(1)
      .map((part) => part.slice(part.indexOf(">") + 1, part.indexOf("</span>")).trim());

    expect(figures).toHaveLength(2);
    expect(figures).toContain("12,346");
    expect(figures).toContain("0");
    // And exactly one week says the sentence — not both, and not neither.
    expect(oneEmpty.split(NO_SETS)).toHaveLength(2);
  });

  it("distinguishes an empty week from a failed read", () => {
    // An emitted zero is a positive claim — "you did no work". It must never come from a failure.
    expect(oneEmpty).not.toContain(FAILURE);
  });
});

describe("the dashboard when the read cannot be trusted", () => {
  it("shows the failure sentence and NO figure when the tonnage read fails", () => {
    expect(failed).toContain(FAILURE);
    expect(failed).not.toContain(NO_SETS);
    // No figure is rendered at all. Asserted on the markup that carries one rather than on a
    // pattern over digits: the page legitimately contains other numbers, and a regex over those is
    // the kind of assertion that passes for the wrong reason.
    expect(failed).not.toContain(FIGURE_CLASS);
    expect(both).toContain(FIGURE_CLASS);
  });

  it("treats an absent profile row as a failed read, not as an empty week", () => {
    // `maybeSingle()` returns null WITHOUT throwing, so this path skips the catch entirely. After
    // this slice a null profile means the unit AND the zone are unknown — printing a figure under a
    // defaulted unit is the defect the S-06 review found in settings.astro.
    expect(noProfile).toContain(FAILURE);
    expect(noProfile).not.toContain(NO_SETS);
    expect(noProfile).not.toContain("12,346");
  });
});

describe("the dashboard's weekly breakdown", () => {
  it("lists all six muscle groups, largest first", () => {
    // All six, not only the trained ones: the imbalance FR-019 exists to show is visible only if the
    // untrained groups are on screen saying they are empty.
    const positions = GROUPS_LARGEST_FIRST.map((label) => both.indexOf(label));

    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(groupRow(both, "Shoulders")).toContain(GROUP_NO_SETS);
    expect(groupRow(both, "Legs")).not.toContain(GROUP_NO_SETS);
  });

  it("prints a column that adds up to the total above it", () => {
    // **US-03's criterion, as the user performs it**: add the rows up and compare with the figure on
    // top. Both lists, because every exercise belongs to exactly one group, so each sums to the whole
    // week. Rounded independently, 6000 + 4000 + 2345.7 would print 6,000 + 4,000 + 2,346 — which is
    // right here and drifts by units as soon as more rows carry fractions, which is why
    // `apportionedFigures` rounds the list together.
    const figures = rowFigures(both);

    expect(figures).toHaveLength(9); // six groups, three exercises
    expect(figures.slice(0, 6).reduce((sum, value) => sum + value, 0)).toBe(12346);
    expect(figures.slice(6).reduce((sum, value) => sum + value, 0)).toBe(12346);
    expect(both).toContain("12,346"); // and that is the total printed above them
  });

  it("follows the account's unit, breakdown rows and totals together", () => {
    // The pair again: a page that converts the totals and prints the rows in kilograms reads as a
    // working screen, and is US-03's fourth criterion half-done.
    const figures = rowFigures(inPounds);

    expect(figures.slice(0, 6).reduce((sum, value) => sum + value, 0)).toBe(27218);
    expect(inPounds).toContain("13,228"); // 6000 kg
    expect(inPounds).toContain("5,171"); // 2345.7 kg
  });

  it("names tonnage it cannot attribute, and does not otherwise", () => {
    // The `left join`'s null, on screen. It is a specific claim — an exercise behind this tonnage is
    // no longer readable — so it must not appear on a page where every exercise is readable.
    expect(groupRow(unreadable, "Unattributed")).toContain("no longer readable by your account");
    // The exercise list names it differently on purpose: the group row is tonnage belonging to no
    // group, the exercise row is one exercise this account cannot read. Same cause, two claims.
    expect(unreadable).toContain("Unattributed exercise");
    expect(
      rowFigures(unreadable)
        .slice(0, 7)
        .reduce((sum, value) => sum + value, 0),
    ).toBe(12346);
    expect(both).not.toContain("Unattributed");
  });

  it("distinguishes a group of planks from an untrained group", () => {
    // `hasSets`, not the figure. Both read `0`, and only one of them means "you did not train this".
    expect(groupRow(planks, "Core")).toContain(NO_EXTERNAL_LOAD);
    expect(groupRow(planks, "Core")).not.toContain(GROUP_NO_SETS);
    expect(groupRow(planks, "Back")).toContain(GROUP_NO_SETS);
    expect(groupRow(planks, "Back")).not.toContain(NO_EXTERNAL_LOAD);
    expect(rowFigures(planks).slice(0, 6)).toEqual([12346, 0, 0, 0, 0, 0]);
  });

  it("degrades on its own, leaving both totals on screen", () => {
    // **The degrade rule** (S-05's `impact_unavailable` ruling, not S-07's page-level flag): the
    // totals are the proven feature and must survive a breakdown failure. This is the assertion that
    // catches someone routing the breakdown's catch into `tonnageFailed`.
    expect(breakdownFailed).toContain(BREAKDOWN_FAILURE);
    expect(breakdownFailed).toContain("12,346");
    expect(breakdownFailed).toContain("9,000");
    expect(breakdownFailed).not.toContain(FAILURE);
    expect(breakdownFailed.split(FIGURE_CLASS)).toHaveLength(3); // both totals still rendered
    expect(breakdownFailed).not.toContain(ROW_FIGURE_CLASS); // and no breakdown row is
    // A breakdown that does not reconcile is not shown either — and it must not be reported as an
    // empty week instead. The healthy page carries neither sentence.
    expect(both).not.toContain(BREAKDOWN_FAILURE);
  });
});
