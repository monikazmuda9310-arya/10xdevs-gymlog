import { defineConfig } from "@playwright/test";

/**
 * The browser layer — a FIFTH runner, and the only one that can answer whether a screen that renders
 * correctly also DOES anything. Every island in this product is `client:load`, and a form that
 * hydrates into nothing passes `npm test`, `npm run test:render` and `npm run test:integration`
 * alike.
 *
 * **The strip below runs in the PLAYWRIGHT process itself, not only in the launcher.** A config a
 * runner cannot start without is a different guarantee from a wrapper script somebody can go around:
 * this is the property `vitest.integration.config.ts` has, applied to the runner that owns the
 * specs. Test workers are spawned from this process, so they inherit the stripped environment —
 * a spec here is as incapable of reaching production as the worker it drives.
 *
 * The server is the BUILT worker under `wrangler dev`, never `astro dev`: dev INLINES whatever
 * `.dev.vars` names (production) into `astro:env/server` and cannot be re-aimed by any per-process
 * mechanism, while the build defers to the workerd env at request time. `scripts/e2e-serve.mjs`
 * carries that half and states the property; `scripts/e2e-build.mjs` deletes the credentials the
 * build writes to disk.
 */

// ---------------------------------------------------------------- load, strip, then seed
try {
  process.loadEnvFile();
} catch {
  /* no .env — CI's environment is the source there */
}

const ALLOWED = new Set(["SUPABASE_TEST_URL", "SUPABASE_TEST_KEY", "GYMLOG_TEST_PASSWORD"]);
for (const key of Object.keys(process.env)) {
  if (/^(SUPABASE|GYMLOG)_/.test(key) && !ALLOWED.has(key)) {
    Reflect.deleteProperty(process.env, key);
  }
}

const testUrl = process.env.SUPABASE_TEST_URL;
const testKey = process.env.SUPABASE_TEST_KEY;
if (!testUrl || !testKey || !process.env.GYMLOG_TEST_PASSWORD) {
  throw new Error(
    "SUPABASE_TEST_URL, SUPABASE_TEST_KEY and GYMLOG_TEST_PASSWORD are required — this suite only " +
      "ever talks to gymlog-test, and must never skip its way to green.",
  );
}
process.env.SUPABASE_URL = testUrl;
process.env.SUPABASE_KEY = testKey;

// ---------------------------------------------------------------- the run's single account
// Named HERE, in the parent process, so the spec that creates it and the teardown that removes it
// agree on one address without either owning it. `delete_own_account()` cannot rescue an interrupted
// run — the cleanup call is the thing that did not happen — so the `t2e-` mark is what makes a leaked
// account identifiable, and the suite keeps to ONE account per run: an interruption leaks one, not
// seven. See `tests/e2e/_shared/account.ts`.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
process.env.E2E_ACCOUNT_EMAIL ??= `t2e-${RUN_ID}@gymlog-test.dev`;

// `localhost`, NOT `127.0.0.1`: Chrome treats `localhost` as a secure context, so the `Secure`
// session cookie `@supabase/ssr` writes over plain HTTP is still accepted. With the IP literal the
// jar silently drops it and every signed-in step fails for a reason that looks like a product bug.
const PORT = process.env.E2E_PORT ?? "8788";
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // One account, one hosted project, one shared auth server: specs must not race each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries. A flow that only passes on the second attempt is a finding, not a flake to absorb —
  // and a retried signup would create a second account the teardown does not know about.
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    url: baseURL,
    // Never reuse: a server already listening on this port was started by something else, and
    // "something else" is exactly the bypass this harness exists to make impossible.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_PORT: PORT },
  },
});
