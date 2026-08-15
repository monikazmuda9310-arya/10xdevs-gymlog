// **The delete-account panel must render even when the profile could not be read.**
//
// `settings.astro` replaces the whole preferences form with an explanation when `loadFailed` — and
// the natural place to put a new control is inside that ternary, where every other piece of the page
// lives. Doing so would hide account deletion from exactly the users most likely to want it: the
// ones whose account record is in a state the product cannot show them. That is the mistake this
// file exists to catch, and nothing else would: the unit suite renders no components, and the
// integration suite has no HTML.
//
// The stub mirrors the real call chains rather than short-circuiting them — the S-08 lesson that a
// stub shaped like the query is worth its price. `accountFootprint` awaits the builder directly
// after `.eq()`, with no `.maybeSingle()`, so a stub that only answers the profile chain silently
// yields `undefined` counts. That is not hypothetical: it happened while this suite was being
// written, and the dialog rendered "This removes undefined workouts".

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { describe, expect, it } from "vitest";

import Settings from "@/pages/settings.astro";

const PROFILE = { timezone: "Europe/Warsaw", weight_unit: "kg", estimation_formula: "brzycki" };

/**
 * A Supabase stub answering both chains the page uses:
 *   `from(t).select(c).eq(…).maybeSingle()`            → the profile
 *   `from(t).select(c, { count, head }).eq(…)` awaited → a count
 */
function stub(profileRow: Record<string, string> | null, count: number | null) {
  return {
    from: () => ({
      select: () => {
        const builder = {
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: profileRow, error: null }),
            // Awaited directly by `accountFootprint`. A thenable, so `await` reaches this and not
            // the object itself — which is the whole difference the comment above describes.
            then: (resolve: (value: { count: number | null; error: null }) => unknown) =>
              resolve({ count, error: null }),
          }),
        };
        return builder;
      },
    }),
  };
}

async function render(profileRow: Record<string, string> | null, count: number | null): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  return container.renderToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Settings,
    {
      locals: {
        supabase: stub(profileRow, count),
        user: { id: "00000000-0000-4000-8000-000000000000" },
      } as unknown as App.Locals,
    },
  );
}

describe("the delete-account panel on /settings", () => {
  it("renders when the profile loaded", async () => {
    const html = await render(PROFILE, 3);
    expect(html).toContain('component-export="DeleteAccountPanel"');
    expect(html).toContain("Delete my account");
  });

  it("renders when the profile could NOT be loaded — the placement this suite exists for", async () => {
    // `null` profile is the `loadFailed` branch: the preferences form is replaced wholesale.
    const html = await render(null, 3);
    expect(html).toContain("Your preferences could not be loaded");
    // The form is gone…
    expect(html).not.toContain('component-export="PreferencesForm"');
    // …and the delete panel is still there. Moving it inside the ternary fails exactly here.
    expect(html).toContain('component-export="DeleteAccountPanel"');
    expect(html).toContain("Delete my account");
  });

  it("names the real counts in the dialog", async () => {
    const html = await render(PROFILE, 7);
    expect(html).toContain("7 workouts, 7 sets and 7 custom exercises");
  });

  it("says so instead of showing zeros when the counts could not be read", async () => {
    // **A zero here would be a positive claim** — "you have nothing to lose" — offered at the exact
    // moment that is the question. `accountFootprint` returns null for an unreadable count and the
    // dialog drops the numbers rather than inventing them.
    const html = await render(PROFILE, null);
    expect(html).toContain("could not count your training");
    expect(html).not.toContain("0 workouts");
    // The failure mode that shipped once and must not return.
    expect(html).not.toContain("undefined");
  });

  it("puts Cancel first and gives it the initial focus", async () => {
    // `showModal()` lands on the first focusable descendant unless told otherwise, and for a
    // destructive dialog that would be the destructive control. Both halves matter: the ORDER in the
    // DOM and the marker `ConfirmDialog` looks for.
    const html = await render(PROFILE, 3);
    const dialog = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
    expect(dialog).toContain("data-initial-focus");
    expect(dialog.indexOf("Cancel")).toBeLessThan(dialog.lastIndexOf("Delete my account"));
    expect(dialog).toContain('role="alertdialog"');
  });
});
