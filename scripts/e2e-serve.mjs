// The ONLY way the browser suite's server starts. It carries the whole credential guarantee.
//
// **THE PROPERTY: if this launcher is bypassed, the variables are ABSENT, not WRONG.** The built
// worker resolves its Supabase credentials from the workerd env at REQUEST time
// (`dist/server/chunks/server_*.mjs`: `_internalGetSecret("SUPABASE_URL")`), unlike `astro dev`,
// which INLINES whatever `.dev.vars` names and cannot be re-aimed by any per-process mechanism. So
// whoever supplies that env decides the project — and with `dist/server/.dev.vars` deleted and this
// launcher skipped, nobody does: `src/lib/supabase.ts:9-11` returns `null`, `src/middleware.ts:28-30`
// sets `locals.user = null`, and every protected route redirects. For a human that failure is
// famously silent; for a browser suite it is a red test on the very first step.
//
// Measured end to end rather than inferred — plan.md § Measurement record, P4.2: with the two
// `CLOUDFLARE_*` gates below WITHHELD, every probe against the served worker answered
// `?error=not_configured`, the branch `signin.ts:30-32` takes when `locals.supabase` is null. The
// gates are load-bearing, not belt-and-braces.
//
// Runnable directly, and that is how its two refusals are proven (plan.md Phase 5 manual steps):
//   node scripts/e2e-serve.mjs                  ... after planting dist/server/.dev.vars -> refuses
//   SUPABASE_TEST_URL= node scripts/e2e-serve.mjs                                        -> refuses
// The second passes an EMPTY value rather than unsetting it: `process.loadEnvFile()` does not
// overwrite a key already present in `process.env` — measured, including for the empty string — so
// unsetting it in the shell would simply be refilled from `.env` and prove nothing.
//
// Note for anyone scripting HTTP against this server: Astro's `security.checkOrigin` is on by
// default for `output: "server"`, so a form-encoded POST carrying no `Origin` header is answered
// `403` before it reaches a handler — which reads exactly like an absent credential (P4.4). A real
// browser sends `Origin` itself, so Playwright is unaffected; a `fetch` probe must set it.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEV_VARS = fileURLToPath(new URL("../dist/server/.dev.vars", import.meta.url));
const WRANGLER_CONFIG = fileURLToPath(new URL("../dist/server/wrangler.json", import.meta.url));
const PORT = process.env.E2E_PORT ?? "8788";
const BASE = `http://localhost:${PORT}`;

const refuse = (message) => {
  console.error(`\ne2e-serve REFUSING TO START\n  ${message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- 1. load, then strip
// `.env` holds production's URL, key and database password plus an account-wide access token, and
// loadEnvFile is about to pull all of them into this process. The strip is SUBTRACTIVE on purpose:
// every option that merely SUPPLIES the right value instead wins a precedence contest and loses
// silently the day a flag is forgotten. Same set, same regex as `vitest.integration.config.ts:19-24`.
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

// ---------------------------------------------------------------- 2. require, never skip
const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_KEY;
const PASSWORD = process.env.GYMLOG_TEST_PASSWORD;
if (!TEST_URL || !TEST_KEY || !PASSWORD) {
  refuse(
    "SUPABASE_TEST_URL, SUPABASE_TEST_KEY and GYMLOG_TEST_PASSWORD are all required. This harness " +
      "only ever talks to gymlog-test; starting without them would serve a worker that can sign " +
      "nobody in, and every spec would fail somewhere less obvious than here.",
  );
}

// ------------------------------------------------- 3a. the build output must EXIST before 3b
// Ordering, not ceremony. `dist/server/.dev.vars` is trivially absent when there was no build at
// all, so asserting its absence first would pass for the wrong reason and leave the guard inert.
// Requiring the build's own config first makes the next check a statement about a build that
// happened (`lessons.md` § "A mutation that fails for the WRONG REASON has not confirmed the guard").
if (!existsSync(WRANGLER_CONFIG)) {
  refuse(
    "dist/server/wrangler.json is missing — there is no built worker to serve. Run `npm run test:e2e`, " +
      "which builds first (scripts/e2e-build.mjs) and then launches this script.",
  );
}

// ------------------------------------------- 3b. and the production credentials must be GONE
// Immediately before spawn, on EVERY launch — never once at setup. An ordinary `npm run build`
// re-creates this file, so a check that ran at setup would be stale by the time it mattered.
if (existsSync(DEV_VARS)) {
  refuse(
    "dist/server/.dev.vars EXISTS and it names PRODUCTION. wrangler reads it relative to the config " +
      "file's directory, so this worker would serve the owner's real training log and every spec " +
      "below would write into it. Run `npm run test:e2e` — scripts/e2e-build.mjs deletes it after " +
      "the build — or delete the file by hand.",
  );
}

// ---------------------------------------------------------------- 4. seed, then CHECK the seed
// The positive claim is checked rather than assumed: the strip above removed `SUPABASE_URL`, so what
// the worker is handed can only be what these two lines put back.
process.env.SUPABASE_URL = TEST_URL;
process.env.SUPABASE_KEY = TEST_KEY;
if (process.env.SUPABASE_URL !== process.env.SUPABASE_TEST_URL) {
  refuse("SUPABASE_URL is not SUPABASE_TEST_URL after seeding. Refusing to serve an unknown project.");
}
console.log(`e2e-serve: worker will be handed ${new URL(TEST_URL).hostname} on ${BASE}`);

// ---------------------------------------------------------------- 5. spawn, and wait for the port
// The two gates are what carry `SUPABASE_URL` / `SUPABASE_KEY` from this process into the workerd
// env; withholding them was measured to produce `not_configured` on every request (P4.2).
const child = spawn("npx", ["wrangler", "dev", "--config", WRANGLER_CONFIG, "--port", String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "true",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
  },
  stdio: "inherit",
  shell: true,
});

function stop() {
  if (process.platform === "win32") {
    // `shell: true` makes `child.pid` the shell's, so the tree flag is what actually reaches wrangler.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

const deadline = Date.now() + 120_000;
let ready = false;
while (!ready && Date.now() < deadline) {
  try {
    const res = await fetch(BASE, { redirect: "manual" });
    console.log(`e2e-serve: ${BASE} answered ${res.status} — ready.`);
    ready = true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!ready) {
  stop();
  refuse(`${BASE} never answered within 120s. The wrangler output above is the diagnosis.`);
}
