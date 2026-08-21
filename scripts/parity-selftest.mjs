// Prove that `npm run db:parity` can actually FAIL — by breaking something and watching it notice.
//
// **Why this is committed rather than done by hand.** The two claims the parity check rests on are
// that it goes red, and that it goes red **naming the object that changed**. Both were established
// on 2026-08-21 with throwaway scripts, which means that by the following week the evidence was
// prose in a plan and nothing else. This repository already decided that question elsewhere:
// `scripts/e2e-build.mjs` and `scripts/e2e-serve.mjs` are split across two processes and both
// committed precisely so the refusal is provable by planting a file and running the launcher —
// because a check that never fires is indistinguishable from one that passes.
//
// **It asserts the ASPECT and the ROW, not the exit code.** A self-test satisfied by any red is the
// same shape as the failures the parity check exists to catch: it would stay green against a
// comparison that had started failing for an unrelated reason. So each mutation names the aspect
// that must report it and a fragment that must appear in the printed row.
//
// **This writes DDL to `gymlog-test`.** Three refusals stand in front of that, and the revert is in
// a `finally` so an assertion failure still cleans up. It is deliberately absent from every gate and
// from CI — `AGENTS.md`'s eight steps must stay incapable of mutating a database.
//
// Usage: node scripts/parity-selftest.mjs gymlog-test [--no-ci-check]

import { spawnSync } from "node:child_process";

import { compareEnvironments, AGREE, DIFFERS } from "./env-parity.mjs";

const API = "https://api.supabase.com/v1/projects";

/**
 * Each mutation names what must notice it. `revert` runs in a `finally`, so a failed assertion
 * still leaves the database as it was found.
 *
 * Two shapes on purpose: one structural and one access-control. They are different query shapes in
 * `env-parity.mjs`, so a single mutation would prove only one of them.
 */
const MUTATIONS = [
  {
    label: "structural — a new column",
    aspect: "columns",
    fragment: "parity_selftest_marker",
    apply: "alter table public.exercises add column parity_selftest_marker text",
    revert: "alter table public.exercises drop column if exists parity_selftest_marker",
  },
  {
    label: "access-control — a new policy",
    aspect: "policies",
    fragment: "parity_selftest_noop",
    // Permissive and `using (false)`, so it is OR-ed with the existing select policy and widens
    // nothing. A restrictive policy here would genuinely restrict reads on a shared database.
    apply: "create policy parity_selftest_noop on public.exercises for select to authenticated using (false)",
    revert: "drop policy if exists parity_selftest_noop on public.exercises",
  },
];

function refuse(message) {
  console.error(`\nparity-selftest REFUSING TO RUN\n  ${message}\n`);
  process.exit(1);
}

function refFor(variable) {
  const url = process.env[variable];
  if (!url) refuse(`${variable} is not set.`);
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    refuse(`${variable} is not a parseable URL.`);
  }
}

try {
  process.loadEnvFile();
} catch {
  /* no .env — the real environment is the source */
}

// ---------------------------------------------------------------- 1. it can only ever be aimed here
// The literal argument is the first refusal: nothing about this script's invocation can be varied
// into naming production. The ref comparison is the second, for the case where the two variables
// have been crossed in `.env`.
if (process.argv[2] !== "gymlog-test") {
  refuse(
    `the target must be the literal "gymlog-test", got ${JSON.stringify(process.argv[2] ?? null)}.\n` +
      `  This script writes DDL. There is deliberately no way to aim it at production.`,
  );
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse("SUPABASE_ACCESS_TOKEN is not set.");

const TEST = refFor("SUPABASE_TEST_URL");
const PRODUCTION = refFor("SUPABASE_URL");
if (TEST === PRODUCTION) {
  refuse("SUPABASE_TEST_URL and SUPABASE_URL resolve to the SAME project. Refusing to write anything.");
}

// -------------------------------------------------- 2. nothing of CI's may be running against it
// The `gymlog-test-fixtures` concurrency group serialises CI runs against each other. It knows
// nothing about a human at a terminal, so this is the half of that guarantee that has to live here.
// **Absent `gh` is a refusal, not a shrug**: continuing because the check could not be made is the
// exact move this repository keeps writing rules against.
if (!process.argv.includes("--no-ci-check")) {
  const gh = spawnSync("gh", ["run", "list", "--limit", "20", "--json", "status"], {
    encoding: "utf8",
    shell: true,
  });
  if (gh.status !== 0) {
    refuse(
      "could not ask `gh` whether a CI run is in flight, and this mutates a database CI also uses.\n" +
        "  Check by hand and pass --no-ci-check if it is clear.",
    );
  }
  const active = JSON.parse(gh.stdout).filter((run) => run.status !== "completed");
  if (active.length > 0) {
    refuse(
      `${active.length} CI run(s) are in flight against gymlog-test. Mutating its schema now would\n` +
        `  fail them for a reason nobody would find. Wait for them and re-run.`,
    );
  }
}

async function sql(query) {
  const response = await fetch(`${API}/${TEST}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: false }),
  });
  if (!response.ok) {
    const body = (await response.text()).split(TEST).join("<gymlog-test>");
    throw new Error(`${response.status} ${body.slice(0, 240)}`);
  }
}

// ---------------------------------------------- 3. a dirty starting state proves nothing either way
console.log("\n— baseline —");
if ((await compareEnvironments()) !== AGREE) {
  refuse(
    "the two projects do not agree before any mutation, so a red result below would prove nothing.\n" +
      "  Resolve the difference reported above first.",
  );
}

let failures = 0;

for (const mutation of MUTATIONS) {
  console.log(`\n— mutation: ${mutation.label} —`);
  await sql(mutation.apply);
  try {
    const report = [];
    const code = await compareEnvironments({ report });
    const entry = report.find((row) => row.name === mutation.aspect);

    // Three separate claims, because passing only the first is how a self-test rots into decoration.
    const problems = [];
    if (code !== DIFFERS) {
      problems.push(`expected exit ${DIFFERS} (DIFFERS), got ${code}`);
    }
    if (entry?.verdict !== "DIFF") {
      problems.push(`expected aspect "${mutation.aspect}" to report DIFF, got ${entry?.verdict ?? "nothing"}`);
    }
    if (!entry?.testOnly.some((row) => row.includes(mutation.fragment))) {
      problems.push(`expected a gymlog-test-only row naming "${mutation.fragment}"`);
    }
    // A mutation that reddens EVERY aspect would satisfy the three above while proving nothing about
    // this aspect in particular.
    const otherReds = report.filter((row) => row.verdict !== "OK" && row.name !== mutation.aspect);
    if (otherReds.length > 0) {
      problems.push(
        `only "${mutation.aspect}" should have moved; also red: ${otherReds.map((r) => r.name).join(", ")}`,
      );
    }

    if (problems.length === 0) {
      console.log(`parity-selftest: PASS — ${mutation.aspect} named ${mutation.fragment}, and nothing else moved.`);
    } else {
      failures += 1;
      console.error(`parity-selftest: FAIL — ${mutation.label}`);
      for (const problem of problems) console.error(`    ${problem}`);
    }
  } finally {
    // In a `finally` so a failed assertion above still leaves gymlog-test as it was found. `if
    // exists` so a partially-applied run is still revertible.
    await sql(mutation.revert);
    console.log(`parity-selftest: reverted (${mutation.label}).`);
  }
}

console.log("\n— after —");
if ((await compareEnvironments()) !== AGREE) {
  console.error(
    "\nparity-selftest: THE REVERT DID NOT RESTORE AGREEMENT. gymlog-test is left mutated —\n" +
      "  the aspects above name what survived. Fix it before running anything else against it.",
  );
  process.exit(1);
}

if (failures > 0) {
  console.error(`\nparity-selftest: ${failures} of ${MUTATIONS.length} mutations were NOT caught properly.`);
  console.error(`  The parity check is not proving what it claims to. Both databases are back as they were.`);
  process.exit(1);
}

console.log(`\nparity-selftest: all ${MUTATIONS.length} mutations were caught and named, and both reverts held.`);
