import { envField, getViteConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// A third Vitest project, and the only one that loads Astro's Vite pipeline.
//
// It exists for one question the other two cannot ask: **what does the rendered HTML actually
// contain?** `npm test` is hermetic and deliberately cannot resolve an `astro:*` virtual module
// (AGENTS.md § Testing), and `test:integration` drives handlers rather than pages. Checking
// `dist/client/` instead would pass while a server-rendered leak was present, because
// server-rendered HTML does not live there — which is exactly the defect S-06's plan review caught
// (F4).
//
// Kept strictly apart from both: `npm test`'s include glob is `src/**` and the integration config's
// is `tests/integration/**`, so neither can match `tests/render/**`.
//
// **`configFile: false`, and the reason is not preference.** Loading `astro.config.mjs` pulls in
// `@astrojs/cloudflare`, which brings `@cloudflare/vite-plugin` and hands Vitest's runner to
// workerd — where it dies with `ReferenceError: exports is not defined` before a single test runs.
// The config below is therefore the real one minus the adapter and the sitemap. That is honest for
// what this suite asserts: island prop serialisation and `<option>` emission are Astro core and do
// not vary by adapter. It is NOT a place to assert anything runtime-specific — the timezone list's
// availability in workerd was measured in workerd (see `src/lib/services/timezones.ts`).
export default getViteConfig(
  {
    test: {
      environment: "node",
      include: ["tests/render/**/*.test.ts"],
      // No passWithNoTests, deliberately: a glob that stops matching must go red, not green.
    },
  },
  {
    configFile: false,
    output: "server",
    integrations: [react()],
    vite: { plugins: [tailwindcss()] },
    // Both optional, exactly as in `astro.config.mjs`: rendering must not require a real credential.
    env: {
      schema: {
        SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
        SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      },
    },
  },
);
