// Build, check the Worker's secret NAMES, deploy, then prove the deployed thing can still reach
// its auth provider.
//
// **The smoke lives inside the deploy command for the same reason `db:push` has no single-target
// variant**: forgetting is not an available mistake. `lessons.md` § "A slice that ends in a screen
// needs a deployment phase" records what forgetting costs here — S-02 closed with 38 exercises in
// the production database and no route able to reach them, every success criterion green.
//
// **Deploy stays MANUAL and out of CI, deliberately.** Putting it in a workflow needs
// `CLOUDFLARE_API_TOKEN` as a repository secret, which hands every merge the ability to overwrite
// production — the same property AGENTS.md § Environment already refuses to the database.
//
// Usage: npm run deploy
// Exit:  0 deployed and probed · non-zero otherwise (3 = deployed, probe inconclusive)

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEPLOYED_ORIGIN } from "./deployed-origin.mjs";
import { smoke, HEALTHY, INCONCLUSIVE } from "./deploy-smoke.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REQUIRED_SECRETS = ["SUPABASE_URL", "SUPABASE_KEY"];

// `node <bin>`, not `npx` through a shell — the same reasoning as e2e-serve.mjs: with `shell: true`
// the child is the shell, and its exit code is one indirection away from this process.
const wranglerBin = join(
  dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
  "bin",
  "wrangler.js",
);

function banner(text) {
  console.log(`\n— ${text} —`);
}

function refuse(message) {
  console.error(`\ndeploy REFUSING\n  ${message}\n`);
  process.exit(1);
}

function wrangler(args, { capture = false } = {}) {
  return spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: ROOT,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
}

// ---------------------------------------------------------------- 1. build
// Resolved from astro's own `bin` field rather than hardcoded, the same way supabase-db.mjs finds
// the Supabase CLI — a guessed path fails the build step and the refusal then blames the build for
// this script's mistake, which is how this line was found wrong on 2026-08-21.
const astroBin = join(dirname(createRequire(import.meta.url).resolve("astro/package.json")), "bin", "astro.mjs");

banner("build");
const build = spawnSync(process.execPath, [astroBin, "build"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (build.status !== 0) {
  refuse("`astro build` failed; nothing was deployed.");
}

// ------------------------------------------- 2. the secret NAMES, before publishing a version
// **Necessary and not sufficient, and the order is why it is here at all.** This catches the most
// common cause of a dead deployment — the secrets were never `wrangler secret put` — BEFORE a
// version goes out, rather than after. What it cannot see is the VALUES: a secret holding the wrong
// project's URL lists exactly like the right one, which is what the smoke below is for.
//
// The Worker name comes from `wrangler.jsonc` via wrangler itself. Naming it here too would be a
// second definition that could drift from the one that decides where `deploy` actually publishes.
banner("worker secrets");
const secrets = wrangler(["secret", "list"], { capture: true });
if (secrets.status !== 0) {
  refuse(
    "`wrangler secret list` failed. Without it there is no cheap check that the runtime secrets " +
      "exist at all, and a deployment missing them serves 200s while nobody can sign in.",
  );
}
let names;
try {
  names = JSON.parse(secrets.stdout).map((entry) => entry.name);
} catch {
  refuse(`could not parse \`wrangler secret list\` output:\n  ${String(secrets.stdout).slice(0, 200)}`);
}
const missing = REQUIRED_SECRETS.filter((name) => !names.includes(name));
if (missing.length > 0) {
  refuse(
    `the Worker is missing runtime secret(s): ${missing.join(", ")}.\n` +
      `  GitHub repository secrets are BUILD-time only and do not become Worker secrets.\n` +
      missing.map((name) => `    npx wrangler secret put ${name}`).join("\n") +
      `\n  Deploying now would produce a Worker that builds, returns 200 and can sign nobody in.`,
  );
}
console.log(`deploy: runtime secrets present by name — ${names.join(", ")}`);

// ---------------------------------------------------------------- 3. deploy
banner("deploy");
const deployed = wrangler(["deploy"]);
if (deployed.status !== 0) {
  refuse("`wrangler deploy` failed. The previously deployed version is still serving.");
}

// ---------------------------------------------------------------- 4. smoke, against the real URL
// A green deploy is not evidence of anything a user cares about. This is the only step that asks
// the deployed thing a question whose answer depends on its runtime secrets.
banner(`smoke: ${DEPLOYED_ORIGIN}`);
const verdict = await smoke(DEPLOYED_ORIGIN);

if (verdict === HEALTHY) {
  console.log(`\ndeploy: done. ${DEPLOYED_ORIGIN} is serving and can reach its auth provider.`);
  process.exit(0);
}

if (verdict === INCONCLUSIVE) {
  // **Not a failure.** Rate limiting is a fact about this IP, and a smoke run twice can cause it
  // itself; failing here would report a broken deploy for running the command again.
  console.error(
    `\ndeploy: the version IS deployed. The smoke could not reach a verdict — re-run\n` +
      `  \`node scripts/deploy-smoke.mjs\` in a few minutes to settle it.`,
  );
  process.exit(INCONCLUSIVE);
}

// **No automatic rollback, and this is a decision rather than an omission.** The commonest cause of
// a red smoke is absent runtime secrets, which are Worker state rather than deployment state — the
// previous version does not have them either. An automatic rollback would report success at having
// "recovered" while leaving the application just as dead, turning a loud failure into a quiet one.
// The recovery command that fits depends on which code came back, and deploy-smoke printed it.
console.error(
  `\ndeploy: THE DEPLOYED VERSION CANNOT AUTHENTICATE ANYBODY. It is live and it is broken.\n` +
    `  Nothing was rolled back automatically — read the verdict above: the fix for absent secrets\n` +
    `  is \`wrangler secret put\`, and rolling back would reach a version missing the same ones.\n` +
    `  To roll back deliberately:  npx wrangler rollback`,
);
process.exit(verdict);
