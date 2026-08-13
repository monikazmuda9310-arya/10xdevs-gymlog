// The four states the two tonnage figures can be in, asserted against the rendered HTML.
//
// **Why rendering rather than fetching**: `/dashboard` is in `PROTECTED_ROUTES` and `astro dev`
// reads its credentials from `.dev.vars`, which points at PRODUCTION — a fetch would need a real
// production session. Astro's container renders the real page component with fake `locals` and needs
// no server, no session and no network. The same reason `settings-island.test.ts` exists.
//
// **The dashboard's stub is harder than the settings one, and that is the point.** This page makes
// two reads with two different chain shapes — `from("profiles").select().maybeSingle()` returning a
// row, and `from("daily_tonnage").select().eq().gte().lte()` returning an array — so the stub
// dispatches on the table name. The plan claimed widening the profile read "keeps the stub to one
// chain shape"; that was wrong, and the widening is still right for its other two reasons.

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

/**
 * A Supabase stub that answers both of the page's reads.
 *
 * `profile: null` models an account with no profile row — `maybeSingle()` returns `null` WITHOUT an
 * error, which is the path that must not fall through to a defaulted unit. `rows: "throw"` models a
 * failed tonnage read.
 */
function stub({ profile, rows }: { profile: typeof PROFILE | null; rows: DailyRow[] | "throw" }) {
  const daily = {
    select: () => ({
      eq: () => ({
        gte: () => ({
          lte: () =>
            rows === "throw"
              ? Promise.resolve({ data: null, error: { message: "unreachable", code: "XX000" } })
              : Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  };
  const profiles = {
    select: () => ({ maybeSingle: () => Promise.resolve({ data: profile, error: null }) }),
  };

  return { from: (table: string) => (table === "profiles" ? profiles : daily) };
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
const NO_SETS = "No sets logged this week";
/** The class the figure itself carries — present iff a number is on screen. */
const FIGURE_CLASS = "text-2xl font-semibold text-purple-200";

let both: string;

const ROWS = [
  { performed_on: weeks.current.start, tonnage_kg: 12345.7 },
  { performed_on: weeks.previous.start, tonnage_kg: 9000 },
];

let inPounds: string;
let oneEmpty: string;
let failed: string;
let noProfile: string;

beforeAll(async () => {
  [both, inPounds, oneEmpty, failed, noProfile] = await Promise.all([
    render({ profile: PROFILE, rows: ROWS }),
    render({ profile: { ...PROFILE, weight_unit: "lb" }, rows: ROWS }),
    render({ profile: PROFILE, rows: [{ performed_on: weeks.current.start, tonnage_kg: 12345.7 }] }),
    render({ profile: PROFILE, rows: "throw" }),
    render({ profile: null, rows: [] }),
  ]);
});

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
    // And exactly one week says it — not both, and not neither.
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
