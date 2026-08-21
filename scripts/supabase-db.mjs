#!/usr/bin/env node
// Wrapper around the Supabase CLI for a project with no local database stack.
//
// Why this exists (see context/changes/owned-persistence-baseline/plan.md, Decision 13):
//   * the CLI will not read SUPABASE_DB_URL from the environment — it must be a --db-url flag,
//     and no shell-variable interpolation is portable across PowerShell, cmd.exe and sh;
//   * Node refuses to spawn .cmd shims without a shell, so the CLI is spawned as a plain JS
//     file through process.execPath instead;
//   * it is the one place the "both databases, test first" rule can live;
//   * it writes the generated types file itself, so the output is LF on Windows.
//
// Usage: node scripts/supabase-db.mjs <status|push|types>

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Imported as a FUNCTION rather than spawned: a child process puts a shell between the exit code and
// this caller, and a swallowed non-zero exit is exactly the failure the after-check exists to catch.
import { compareEnvironments, DIFFERS, UNVERIFIABLE } from "./env-parity.mjs";

const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_FILE = join(REPO_ROOT, "src", "db", "database.types.ts");

// Ordered deliberately: the disposable database is always addressed first.
const TARGETS = [
  { key: "test", label: "gymlog-test", variable: "SUPABASE_TEST_DB_URL" },
  { key: "production", label: "gymlog (production)", variable: "SUPABASE_DB_URL" },
];

function fail(message) {
  console.error(`supabase-db: ${message}`);
  process.exit(1);
}

function banner(label) {
  console.log(`\n— ${label} —`);
}

// CI has no .env and must fall through to the real environment.
function loadEnv() {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env here — the real environment is the source */
  }
}

// Resolved from the package's own bin field rather than hardcoded, so a hoisted
// or workspace install still works.
function resolveCli() {
  let manifestPath;
  try {
    manifestPath = require.resolve("supabase/package.json");
  } catch {
    fail("cannot resolve the `supabase` package — run `npm install` first.");
  }
  const manifest = require("supabase/package.json");
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.supabase;
  if (!bin) {
    fail("the `supabase` package declares no `bin` entry — cannot locate its entry point.");
  }
  return join(dirname(manifestPath), bin);
}

// Never printed, never echoed: the URL carries a database password. Validated here rather than
// left to the CLI, because the CLI's parse-failure path echoes the string it could not parse —
// which for an unencoded `@`, `#` or `/` in a password means the password lands in the terminal.
function urlFor(target) {
  const url = process.env[target.variable];
  if (!url) {
    fail(
      `${target.variable} is not set. It holds the ${target.label} session-pooler connection string; put it in .env.`,
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(
      `${target.variable} is not a parseable URI. Copy it from the dashboard's Connect dialog and ` +
        `percent-encode the password if it contains @ : / ? # [ ] % or a space.`,
    );
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail(`${target.variable} must be a postgresql:// URI (session-mode pooler), not ${parsed.protocol}//.`);
  }
  if (!parsed.hostname || !parsed.password) {
    fail(`${target.variable} is missing a host or a password. Copy the full URI from the Connect dialog.`);
  }
  return url;
}

// Defence in depth for the same hazard: whatever the child writes to stderr passes through here
// before it reaches the terminal, with any `//user:password@` credential pair masked.
function maskCredentials(text) {
  return text.replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, "$1****@");
}

// The CLI switches to JSON when it detects it is being driven by an agent, which would turn the
// migration tables into one-line blobs and wrap generated TypeScript in a JSON envelope. Pin it.
const OUTPUT_FORMAT = ["--output-format", "text"];

function run(cli, args) {
  // Both streams inherited so the CLI's progress lines interleave with its tables in the order it
  // wrote them — buffering stderr to mask it puts "Connecting to remote database…" *after* the
  // table it precedes, which makes `db:status` harder to read for a hazard urlFor() has already
  // closed at the source. `capture` still masks, because it buffers anyway.
  const result = spawnSync(process.execPath, [cli, ...args, ...OUTPUT_FORMAT], { stdio: "inherit" });
  if (result.error) {
    fail(`failed to start the Supabase CLI: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function capture(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args, ...OUTPUT_FORMAT], {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stderr) {
    process.stderr.write(maskCredentials(result.stderr));
  }
  if (result.error) {
    fail(`failed to start the Supabase CLI: ${result.error.message}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function status(cli) {
  // Resolve every URL before touching the network, so a missing variable fails immediately.
  const urls = TARGETS.map((target) => ({ target, url: urlFor(target) }));
  let worst = 0;
  // Both always run, even if the first fails: the point of `status` is to compare them.
  for (const { target, url } of urls) {
    banner(target.label);
    const code = run(cli, ["migration", "list", "--db-url", url]);
    if (code !== 0) worst = code;
  }
  return worst;
}

/**
 * Push, with a parity comparison on BOTH sides of it — and the two sides make different claims.
 *
 * **Before**: "did the two projects agree when we started?" A difference here PREDATES this push,
 * so it warns and does not block. Refusing would make the only tool that can reveal pre-existing
 * drift the tool that blocks its repair — and repairing drift usually means pushing a migration.
 *
 * **After**: "did this push leave them agreeing?" That one fails the command. It is the failure the
 * wrapper is blind to today: the production push failing, somebody repairing it by hand, and both
 * migration histories reading identical afterwards while the schemas do not
 * (context/changes/testing-environment-parity/research.md § Detailed Findings 1).
 *
 * **UNVERIFIABLE is fatal after and merely a warning before.** An after-state nobody could read
 * must not be reported as a successful push; a before-state nobody could read is not a reason to
 * refuse to migrate.
 *
 * **The before-check always runs, and the plan said to skip it when nothing is pending.** Detecting
 * "nothing pending" means either parsing the CLI's migration table or reconciling local filenames
 * against remote history, and a mis-detection SILENTLY SKIPS A GUARD. That is precisely the class
 * of failure this whole change exists to close, so the few seconds are the better trade — the two
 * network pushes below cost more than both checks together.
 */
async function push(cli) {
  const urls = TARGETS.map((target) => ({ target, url: urlFor(target) }));
  const [test, production] = urls;

  banner("parity BEFORE the push");
  const before = await compareEnvironments();
  if (before === DIFFERS) {
    console.error(
      `\nsupabase-db: WARNING — the two projects ALREADY differ, before this push touched anything.` +
        `\nThis is not a reason to refuse the migration, and it is not caused by it. Read the aspects` +
        `\nabove: if the migration you are about to apply is the repair, carry on.`,
    );
  } else if (before === UNVERIFIABLE) {
    console.error(
      `\nsupabase-db: WARNING — parity could not be checked before the push. Continuing anyway;` +
        `\nthe check after the push is the one that blocks.`,
    );
  }

  banner(test.target.label);
  const testCode = run(cli, ["db", "push", "--db-url", test.url, "--yes"]);
  if (testCode !== 0) {
    console.error(
      `\nsupabase-db: the ${test.target.label} push failed, so ${production.target.label} was NOT touched.` +
        `\nFix the migration and re-run \`npm run db:push\` — nothing has been applied anywhere.`,
    );
    return testCode;
  }

  banner(production.target.label);
  const productionCode = run(cli, ["db", "push", "--db-url", production.url, "--yes"]);
  if (productionCode !== 0) {
    console.error(
      `\nsupabase-db: DIVERGENCE — ${test.target.label} is ahead of ${production.target.label}.` +
        `\nThe migration applied to the test database and failed on production.` +
        `\nRecovery: fix the cause and re-run \`npm run db:push\`. It is idempotent — the test push will` +
        `\nreport "up to date" and the production push will apply what is missing.` +
        `\nDo NOT apply the SQL by hand in the dashboard: that desynchronises the remote migration history.`,
    );
    return productionCode;
  }

  banner("parity AFTER the push");
  const after = await compareEnvironments();
  if (after === DIFFERS) {
    console.error(
      `\nsupabase-db: BOTH PUSHES SUCCEEDED AND THE SCHEMAS DO NOT AGREE.` +
        `\nThe migration histories now match — that is what \`npm run db:status\` compares — and the` +
        `\nschemas they produced do not. The aspects above name what differs.` +
        `\nThe usual cause is DDL applied outside the migration system on one project: the dashboard` +
        `\nSQL editor writes no history row, so nothing else in this repository can see it.`,
    );
    return after;
  }
  if (after === UNVERIFIABLE) {
    console.error(
      `\nsupabase-db: the push succeeded but parity COULD NOT BE CHECKED afterwards.` +
        `\nThat is not the same as "the projects agree", so this command is not reporting success.` +
        `\nRe-run \`npm run db:parity\` once the cause above is fixed — \`db:push\` is idempotent.`,
    );
    return after;
  }

  return 0;
}

// `gen types --db-url` runs the generator in a postgres-meta container, and this machine has no
// container runtime by contract. `--project-id` generates through the Management API instead,
// which needs SUPABASE_ACCESS_TOKEN (a personal access token, read from the environment by the
// CLI itself) and no Docker. The ref is derived from SUPABASE_URL rather than configured
// separately, so the types can only ever come from the project the production URL points at.
function productionProjectRef() {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    fail("SUPABASE_URL is not set. The production project ref is derived from it.");
  }
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail("SUPABASE_URL is not a valid URL, so the production project ref cannot be derived from it.");
  }
  const ref = host.split(".")[0];
  if (!ref || !host.includes(".supabase.")) {
    fail(`cannot derive a project ref from SUPABASE_URL (host "${host}"). Expected https://<project-ref>.supabase.co.`);
  }
  return ref;
}

function types(cli) {
  // Production is the schema of record; `npm run db:status` is what proves the test project matches.
  const target = TARGETS.find((candidate) => candidate.key === "production");
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. Generate a personal access token at " +
        "https://supabase.com/dashboard/account/tokens and put it in .env. " +
        "It is needed only for type generation; never add it to .dev.vars, CI or the Worker.",
    );
  }
  const ref = productionProjectRef();
  banner(`${target.label} → src/db/database.types.ts`);
  const { status: code, stdout } = capture(cli, [
    "gen",
    "types",
    "typescript",
    "--project-id",
    ref,
    "--schema",
    "public",
  ]);
  if (code !== 0) {
    console.error("supabase-db: type generation failed; src/db/database.types.ts was left untouched.");
    return code;
  }
  if (stdout.trim() === "") {
    console.error("supabase-db: type generation produced no output; src/db/database.types.ts was left untouched.");
    return 1;
  }
  mkdirSync(dirname(TYPES_FILE), { recursive: true });
  // Explicit \n: a shell redirect would write CRLF on Windows and .gitattributes pins LF.
  writeFileSync(TYPES_FILE, `${stdout.replace(/\r\n/g, "\n").trimEnd()}\n`, "utf8");
  console.log("wrote src/db/database.types.ts");
  return 0;
}

const VERBS = { status, push, types };

const verb = process.argv[2];
if (!verb || !(verb in VERBS)) {
  fail(`unknown verb ${verb ? `"${verb}"` : "(none)"} — expected one of: ${Object.keys(VERBS).join(", ")}.`);
}

loadEnv();
// `push` is async now — it awaits two parity comparisons. `status` and `types` still return a
// number, and awaiting a number is a no-op, so the dispatcher stays one line.
process.exit(await VERBS[verb](resolveCli()));
