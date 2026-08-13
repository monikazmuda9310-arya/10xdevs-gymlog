// **The 418-entry timezone list must never cross into JavaScript.**
//
// Astro serialises island props into an `<astro-island props="…">` attribute in the rendered HTML,
// so a list passed as a prop would ship ~7 KB of zone names to the browser to be parsed at
// hydration — for a `<select>` that needs no JavaScript at all. `settings.astro` therefore emits
// the `<option>` elements itself and slots the `<select>` into the island, which passes through the
// DOM rather than through props.
//
// **Why this suite renders rather than fetches.** The plan asked for a script that fetches
// `/settings`, but `/settings` is behind `PROTECTED_ROUTES`, and `astro dev` reads its credentials
// from `.dev.vars`, which points at PRODUCTION — so a fetch would need either a production session
// or a redirect to follow. Astro's container renders the real page component with fake `locals`,
// needs no server, no session and no network, and answers the same question about the same HTML.
// Checking `dist/client/` would NOT answer it: server-rendered HTML does not live there, so that
// check passes while the leak is present. That was finding F4 of this slice's plan review.

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { beforeAll, describe, expect, it } from "vitest";

import Settings from "@/pages/settings.astro";
import { supportedTimeZones } from "@/lib/services/timezones";

const PROFILE = { timezone: "Europe/Warsaw", weight_unit: "kg", estimation_formula: "brzycki" };

/**
 * The slice of the Supabase client `getProfile` actually calls. Enough to render the page and
 * nothing more — this suite is about markup, and the read path is covered by the integration check.
 */
const supabaseStub = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: PROFILE, error: null }),
      }),
    }),
  }),
};

let html: string;

beforeAll(async () => {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  // A `.astro` module has no type outside Astro's own pipeline, so the import above lands as `any`
  // for the type-aware lint rules. `astro check` DOES understand it and covers the page itself;
  // the suppression is only about this import boundary.
  html = await container.renderToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Settings,
    {
      // Cast for the same reason `workout-endpoints.test.ts` casts its APIContext: the page reads
      // two fields, and constructing a whole Supabase client and a whole auth User to hand over
      // three strings would obscure what the test is actually about.
      locals: {
        supabase: supabaseStub,
        user: { id: "00000000-0000-4000-8000-000000000000" },
      } as unknown as App.Locals,
    },
  );
});

/** Every `props="…"` payload Astro serialised into the page, decoded from its HTML entities. */
function islandProps(markup: string): string[] {
  const payloads: string[] = [];
  const pattern = /<astro-island\b[^>]*\bprops="([^"]*)"/g;
  for (const match of markup.matchAll(pattern)) {
    payloads.push(
      match[1].replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&amp;", "&").replaceAll("&#38;", "&"),
    );
  }
  return payloads;
}

/** Every `value` of every `<option>` the page emitted. */
function optionValues(markup: string): string[] {
  return [...markup.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((match) =>
    match[1].replaceAll("&#47;", "/").replaceAll("&amp;", "&"),
  );
}

describe("the settings page's rendered HTML", () => {
  it("renders the island at all, so the assertions below are not vacuous", () => {
    // Without this, every check that follows would pass against a page that rendered nothing —
    // "no zone name in the props" is trivially true when there are no props.
    const props = islandProps(html);
    expect(props.length, "the page should render exactly one hydrated island").toBe(1);
    // The island DOES receive the three current values; that is all it is entitled to.
    expect(props[0]).toContain("Europe/Warsaw");
    expect(props[0]).toContain("brzycki");
  });

  it("3.3 — no zone name appears inside any astro-island props payload", () => {
    const props = islandProps(html).join("\n");
    // The current value is legitimately in there (asserted above), so the leak is measured by every
    // OTHER zone: a list passed as a prop would carry all 418.
    const leaked = supportedTimeZones().filter((zone) => zone !== PROFILE.timezone && props.includes(zone));

    expect(leaked, `these zone names crossed into island props: ${leaked.slice(0, 5).join(", ")}`).toEqual([]);
  });

  it("3.4 — the rendered option set is exactly Intl.supportedValuesOf('timeZone')", () => {
    // 418 entries are not verifiable by eye (context/foundation/lessons.md), and the list the page
    // offers must be the list the endpoint validates against — otherwise the form can offer a value
    // the server then refuses, and the user has no way to tell which of the two is wrong.
    const rendered = optionValues(html);
    const runtime = [...supportedTimeZones()];

    expect(rendered.length).toBeGreaterThan(100);
    expect([...rendered].sort()).toEqual([...runtime].sort());
  });

  it("marks the account's own zone as selected, so the form opens on what is stored", () => {
    expect(html).toMatch(/<option[^>]*value="Europe\/Warsaw"[^>]*\bselected\b/);
  });

  it("keeps the select inside the island, where its value can be read on submit", () => {
    // The slot is what makes the no-prop design work. If the `<select>` ever moved outside the
    // island, `new FormData(form)` would stop seeing it and the timezone would silently never save.
    const island = /<astro-island[\s\S]*?<\/astro-island>/.exec(html)?.[0] ?? "";
    expect(island).toContain('name="timezone"');
  });
});
