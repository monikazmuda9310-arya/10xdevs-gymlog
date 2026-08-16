import { fileURLToPath } from "node:url";

import { envField, getViteConfig } from "astro/config";

// FIRST DRAFT — Phase 1 of `context/changes/testing-browser-layer/plan.md`, which was a MEASUREMENT
// and is not yet a suite. Its probe file has been deleted, so `include` currently matches nothing
// and this config is not wired to an npm script; Phase 2 adds the suites, the `envDir` guard and
// `npm run test:middleware`. Until then, running it is expected to go red on an empty glob.
//
// What was measured, in the runner itself rather than read out of `node_modules`:
//   (a) a module importing `astro:middleware` loads here and `onRequest` is callable;
//   (b) `astro:env/server` reports the value seeded into `process.env` before this file was
//       evaluated — Vite's `loadEnv` applies `process.env` last (`vite/.../config.js:9417-9418`);
//   (c) `vite.envDir` genuinely binds — `astro/dist/env/env-loader.js:38-46` reads
//       `loadEnv(mode, config.vite.envDir ?? root, "")`, so pointing it at a credential-free
//       directory is what closes the `.env`-on-disk hole that the subtractive strip alone cannot.
//
// (c) was measured by DIFFERENCE, not by a single run: with a decoy `.env` in the env directory and
// no seed, the decoy was reported (the directory is genuinely read, and the repository root's `.env`
// — which names production — is not); with the seed present the seed won. One run alone cannot tell
// "the directory is read" from "nothing was read and the value came from somewhere else".
// Results: plan.md § Measurement record, P1.a/P1.b/P1.c, 2026-08-16.
try {
  process.loadEnvFile();
} catch {
  /* no .env — CI's environment is the source there */
}

// The same subtractive strip as `vitest.integration.config.ts:19-24`. The guarantee is that this
// process is INCAPABLE of naming production, not merely disinclined to: `.env` holds production's
// URL, key and database password, and `loadEnvFile` above has just pulled all of them in here.
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

// A committed, empty directory whose whole job is to be `envDir`. Phase 2 adds a load-time guard
// that throws if anything matching `/^\.env/` appears here; it is absent in this draft precisely
// because probe (c) has to plant one.
const envDir = fileURLToPath(new URL("./tests/middleware/no-env/", import.meta.url));

export default getViteConfig(
  {
    test: {
      environment: "node",
      include: ["tests/middleware/**/*.test.ts"],
      fileParallelism: false,
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
