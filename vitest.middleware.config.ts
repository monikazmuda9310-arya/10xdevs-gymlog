import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { envField, getViteConfig } from "astro/config";

// A FOURTH Vitest project, for the one question the other three cannot ask:
// **what identity does a real cookie produce?**
//
// `npm test` is hermetic and cannot resolve an `astro:*` virtual module at all. `test:render`
// renders pages with fake `locals`. `test:integration` drives handlers with a HAND-BUILT `locals` —
// `{ supabase: client, user: { id: owner.userId } }` — so the client and the user id agree by
// construction, and a middleware that binds the WRONG identity to a request is invisible to all
// fifteen of its suites. Everything between an inbound HTTP request and `locals.user`
// (`src/middleware.ts`, `src/lib/supabase.ts`) executes ZERO times in the gate without this project.
//
// **THE CREDENTIAL GUARANTEE HAS TWO PARTS AND NEITHER IS SUFFICIENT ALONE.** The property wanted is
// the one `vitest.integration.config.ts` has: being wrong must produce an ABSENT credential — a red
// first step — never a PRODUCTION one, which would write into the owner's real training log.
//
//   1. **The subtractive strip** below removes production from `process.env` after `loadEnvFile`
//      deliberately pulled it in. Every option that merely SUPPLIES the right value instead wins a
//      precedence contest and loses silently the day a flag is forgotten.
//   2. **`vite.envDir`** closes the second door. This project loads Astro's Vite pipeline, and
//      `loadEnv(mode, config.vite.envDir ?? root, "")` reads `.env*` files from that directory —
//      so stripping the process alone leaves the repository root's `.env`, which names production,
//      readable from disk. Pointing `envDir` at a committed, credential-free directory is what makes
//      the guarantee subtractive rather than a precedence bet, and the `readdirSync` guard below
//      makes somebody dropping a credentials file there a loud failure rather than a silent re-aim.
//
// Measured in the runner itself rather than read out of `node_modules` — plan.md § Measurement
// record, P1.a/P1.b/P1.c, 2026-08-16: `astro:middleware` resolves here with no `resolve.alias` at
// all; `astro:env/server` reports the seeded `process.env` value; and with the seed withheld and the
// env directory empty the reported value is **`undefined`**, not production's URL.
try {
  process.loadEnvFile();
} catch {
  /* no .env — CI's environment is the source there */
}

// The same subtractive strip as `vitest.integration.config.ts:19-24`. `.env` holds production's URL,
// key and database password plus an account-wide access token, and `loadEnvFile` has just pulled all
// of them into this process.
const ALLOWED = new Set(["SUPABASE_TEST_URL", "SUPABASE_TEST_KEY", "GYMLOG_TEST_PASSWORD"]);
for (const key of Object.keys(process.env)) {
  if (/^(SUPABASE|GYMLOG)_/.test(key) && !ALLOWED.has(key)) {
    Reflect.deleteProperty(process.env, key);
  }
}

// Seed AFTER the strip, never before it: the strip is what removes production, and re-seeding is
// what supplies the only project this runner may reach. Throw rather than seed `undefined` — an
// absent credential must be a loud failure here, not a `null` client three layers down.
const testUrl = process.env.SUPABASE_TEST_URL;
const testKey = process.env.SUPABASE_TEST_KEY;
if (!testUrl || !testKey) {
  throw new Error(
    "SUPABASE_TEST_URL and SUPABASE_TEST_KEY are required — this project only ever talks to gymlog-test.",
  );
}
process.env.SUPABASE_URL = testUrl;
process.env.SUPABASE_KEY = testKey;

// A committed directory holding only `.gitkeep`, whose whole job is to be `envDir`. The guard is
// load-time on purpose: it must run before `getViteConfig` is evaluated, because Astro's env loader
// runs during config resolution and in serve mode INLINES the result into `astro:env/server`. A
// check inside `setupFiles` would be too late to matter.
//
// `.gitignore` carries `tests/middleware/no-env/.env*` as well, so an accidental file here can never
// be committed even if this guard is bypassed. Two independent defences, because a credentials file
// landing here would silently re-aim the whole project.
const envDir = fileURLToPath(new URL("./tests/middleware/no-env/", import.meta.url));
const strays = readdirSync(envDir).filter((entry) => entry.startsWith(".env"));
if (strays.length > 0) {
  throw new Error(
    `${envDir} must hold no .env file — it is this project's envDir precisely because it is ` +
      `credential-free, and Vite's loadEnv would read anything found here. Remove: ${strays.join(", ")}`,
  );
}

export default getViteConfig(
  {
    test: {
      environment: "node",
      include: ["tests/middleware/**/*.test.ts"],
      // Per-run accounts rather than the shared fixture pair, but the auth server is still shared
      // and these suites sign the same addresses in and out: files must not run concurrently.
      fileParallelism: false,
      // Network plus auth round trips against a hosted project in Frankfurt.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      // No passWithNoTests, deliberately: a glob that stops matching must go red, not green.
      env: { ...process.env },
    },
  },
  {
    // Same reason as `vitest.render.config.ts:17-23`: loading `astro.config.mjs` pulls in
    // `@astrojs/cloudflare`, which hands Vitest's runner to workerd and kills it before a test runs.
    configFile: false,
    output: "server",
    env: {
      schema: {
        SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
        SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      },
    },
    vite: { envDir },
  },
);
