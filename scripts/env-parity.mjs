// Compare the SCHEMAS of the two Supabase projects — not their migration histories.
//
// Why this exists (context/changes/testing-environment-parity/research.md):
//   * `npm run db:status` runs `supabase migration list` per project. That compares which migration
//     VERSIONS are recorded, never what they produced. Two documented paths let the histories agree
//     while the schemas do not: the dashboard SQL editor writes no history row, and a production
//     push that fails after the test push succeeded gets repaired by hand.
//   * Every Supabase-CLI route to a real comparison needs a container runtime. Measured 2026-08-21:
//     `supabase db dump --db-url` answers `failed to run docker. Docker Desktop is a prerequisite`.
//     This machine has no docker, no pg_dump, no psql, and no Postgres driver in node_modules —
//     the same wall `db:types` met and worked around (supabase-db.mjs, `types`).
//   * So the comparison goes through the Management API's query endpoint, which needs only
//     SUPABASE_ACCESS_TOKEN — the token `db:types` already uses — and `fetch`.
//
// **Every query is sent with `read_only: true`, and that is a refusal rather than a decoration.**
// Measured 2026-08-21: a no-op `update ... where false` answered
// `ERROR: 25006: cannot execute UPDATE in a read-only transaction`, with a `select 1` under the
// identical flag answering 201 as the positive control. The endpoint also runs as
// `supabase_read_only_user` rather than `postgres`, which is defence in depth — and is why the
// `grants` aspect below cannot use `information_schema`.
//
// Usage: node scripts/env-parity.mjs
// Exit:  0 the projects agree · 1 at least one aspect differs · 2 the comparison could not be made

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const API = "https://api.supabase.com/v1/projects";

// Ordered deliberately, matching supabase-db.mjs: the disposable database is named first everywhere
// a human reads a list, and production is the schema of record it is compared against.
const TARGETS = [
  { key: "production", label: "gymlog", variable: "SUPABASE_URL" },
  { key: "test", label: "gymlog-test", variable: "SUPABASE_TEST_URL" },
];

// Exit codes are part of this script's interface: `db:push` treats "differs" and "could not be
// made" differently, and a caller that collapsed them would let an unverifiable state read as a
// verified one.
export const AGREE = 0;
export const DIFFERS = 1;
export const UNVERIFIABLE = 2;

/**
 * Aspects. Each is a name, a read-only query, and a FLOOR.
 *
 * **The floor is the load-bearing part and it exists because of a measured near-miss.** The first
 * draft of this check sourced grants from `information_schema.role_table_grants`, which filters to
 * grants the CURRENT USER is grantor, grantee or a member of — and the endpoint runs as
 * `supabase_read_only_user`, which is none of those for `anon`/`authenticated`. It answered ZERO
 * rows on both projects and the comparison reported parity it had never performed. That is the same
 * failure shape as `{ impact: [] }` read as reassurance (AGENTS.md § Known state) and as "a route
 * that ALWAYS fails satisfies a failure assertion perfectly" (test-plan.md § 6.2).
 *
 * **Floors are structural minimums taken from documented invariants, never from today's row
 * counts.** A floor fitted to what the schema happens to hold right now is not a floor — it is a
 * snapshot that turns the next legitimate migration into a false alarm (lessons.md § "Write the
 * threshold into the plan BEFORE taking the measurement"). Each `minRows` below cites the invariant
 * it comes from, and lowering one should require changing the invariant in AGENTS.md first.
 */
const ASPECTS = [
  {
    name: "columns",
    // `generation_expression` is here on purpose: it carries `weight_kg`'s kg/lb conversion, one of
    // the two production copies of 0.45359237 (AGENTS.md § Domain rules). A history comparison is
    // blind to it.
    minRows: 9, // at least one column per relation: five tables + four views
    sql: `select table_name || '.' || column_name || ' :: ' || data_type
                 || ' null=' || is_nullable
                 || ' default=' || coalesce(column_default, '-')
                 || ' generated=' || coalesce(generation_expression, '-') as x
          from information_schema.columns
          where table_schema = 'public'
          order by 1`,
  },
  {
    name: "constraints",
    minRows: 5, // every table has at least a primary key
    sql: `select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as x
          from pg_constraint
          where connamespace = 'public'::regnamespace
          order by 1`,
  },
  {
    name: "indexes",
    minRows: 5, // every table's primary key is backed by an index
    sql: `select indexdef as x from pg_indexes where schemaname = 'public' order by 1`,
  },
  {
    name: "rls_enabled",
    minRows: 5, // five tables, and RLS on every one is a hard guardrail (AGENTS.md § Access control)
    sql: `select relname || ' rls=' || relrowsecurity || ' forced=' || relforcerowsecurity as x
          from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r'
          order by 1`,
  },
  {
    name: "policies",
    // `qual` and `with_check` are the policy PREDICATES. Comparing only policy names would pass a
    // project whose `using` clause had been widened to `true`.
    minRows: 5, // at least one policy per table, or the table is unreachable to `authenticated`
    sql: `select tablename || ' | ' || policyname || ' | ' || cmd
                 || ' | ' || coalesce(array_to_string(roles, ','), '-')
                 || ' | using=' || coalesce(qual, '-')
                 || ' | check=' || coalesce(with_check, '-') as x
          from pg_policies
          where schemaname = 'public'
          order by 1`,
  },
  {
    name: "views",
    // `reloptions` is where `security_invoker = true` lives. Without it a view executes as its OWNER
    // and hands every account's training to every account, with no error (AGENTS.md § derived-view
    // variant) — so this column matters more than the view body it sits beside.
    minRows: 4, // four views (AGENTS.md § Known state)
    sql: `select relname || ' options=' || coalesce(array_to_string(reloptions, ','), '-')
                 || ' body=' || md5(pg_get_viewdef(oid)) as x
          from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'v'
          order by 1`,
  },
  {
    name: "triggers",
    minRows: 1, // the access-control trigger on exercise_entries, at minimum
    sql: `select tgrelid::regclass::text || ' ' || tgname || ' ' || pg_get_triggerdef(oid) as x
          from pg_trigger
          where not tgisinternal and tgrelid::regclass::text not like 'pg_%'
          order by 1`,
  },
  {
    name: "functions",
    // `prosecdef` is the whole point: `security definer` on the access-control trigger's function
    // would disable it while the SQL still read correctly (AGENTS.md § the access-control trigger).
    minRows: 1, // public.delete_own_account(), at minimum
    sql: `select proname || ' secdef=' || prosecdef
                 || ' args=' || pg_get_function_identity_arguments(oid)
                 || ' body=' || md5(prosrc) as x
          from pg_proc
          where pronamespace = 'public'::regnamespace
          order by 1`,
  },
  {
    name: "enums",
    minRows: 3, // weight_unit, estimation_formula, muscle_group (AGENTS.md § Known state)
    sql: `select t.typname || ' = ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as x
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          where t.typnamespace = 'public'::regnamespace
          group by t.typname
          order by 1`,
  },
  {
    name: "grants",
    // `pg_class.relacl`, NOT `information_schema.role_table_grants` — see the block comment above
    // ASPECTS for the measurement that forced this. The template's "revoke before granting" rule
    // (AGENTS.md § the table template) is visible here as `anon` appearing in no ACL at all.
    minRows: 9, // five tables + four views, each carrying an ACL
    sql: `select relname || ' ' || coalesce(array_to_string(relacl, ' '), 'NULL') as x
          from pg_class
          where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')
          order by 1`,
  },
  {
    name: "migrations",
    // Kept even though `db:status` already prints both histories: this one is machine-comparable,
    // and a history that agrees while a schema does not is precisely the case this script exists
    // for. Seeing both lines in one report is what makes that distinction legible.
    minRows: 1, // a project with no migration history is not this project
    sql: `select version || ' ' || coalesce(name, '-') as x
          from supabase_migrations.schema_migrations
          order by version`,
  },
  {
    name: "seeded_catalogue",
    // **`user_id is null` is load-bearing, not tidiness.** Measured 2026-08-21: production holds 0
    // custom exercises and gymlog-test holds 75, so an unscoped comparison reports a 75-row
    // difference every single run and trains its reader to ignore it. The seeded rows come from a
    // migration rather than from a user, which is what makes them part of the schema in practice —
    // and `is_bodyweight` decides whether a zero load is a plank or a typo (FR-014), so a drift here
    // changes behaviour with no difference in any DDL.
    minRows: 38, // the seeded exercise count (AGENTS.md § Known state)
    sql: `select name || ' | ' || muscle_group || ' | bodyweight=' || is_bodyweight as x
          from public.exercises
          where user_id is null
          order by 1`,
  },
];

const MAX_PRINTED_ROWS = 12;

function fail(message) {
  console.error(`env-parity: ${message}`);
  return UNVERIFIABLE;
}

function banner(text) {
  console.log(`\n— ${text} —`);
}

// CI has no .env and must fall through to the real environment. Same shape as supabase-db.mjs.
function loadEnv() {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env here — the real environment is the source */
  }
}

/**
 * Derive a project ref from its URL, exactly as supabase-db.mjs does for type generation.
 *
 * Deriving rather than configuring is what makes the targets un-aimable: there is no variable that
 * could point this script at a third project, and no way to compare production against itself.
 */
function refFor(target) {
  const url = process.env[target.variable];
  if (!url) {
    return { error: `${target.variable} is not set. It holds the ${target.label} project URL; put it in .env.` };
  }
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return {
      error: `${target.variable} is not a parseable URL, so the ${target.label} project ref cannot be derived.`,
    };
  }
  const ref = host.split(".")[0];
  if (!ref || !host.includes(".supabase.")) {
    return {
      error: `cannot derive a project ref from ${target.variable}. Expected https://<project-ref>.supabase.co.`,
    };
  }
  return { ref };
}

/**
 * Replace anything credential-shaped before it reaches the terminal.
 *
 * Same defence-in-depth reasoning as `maskCredentials` in supabase-db.mjs: the value is validated at
 * the source, and whatever a failure path happens to interpolate still passes through here. Project
 * refs are masked alongside the token — they are not secret, but a report that names them invites
 * the next reader to paste one into a command, and the labels are what a human actually needs.
 */
function makeMasker(token, refs) {
  return (text) => {
    let out = String(text ?? "");
    if (token) out = out.split(token).join("<ACCESS_TOKEN>");
    for (const [label, ref] of refs) out = out.split(ref).join(`<${label}>`);
    return out;
  };
}

const digest = (rows) => createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 12);

async function query(ref, token, sql) {
  const response = await fetch(`${API}/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // read_only is not advisory here — the endpoint opens a read-only transaction and Postgres
    // refuses any write with SQLSTATE 25006. This script is incapable of changing either project.
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text).map((row) => row.x);
}

/**
 * Compare both projects across every aspect.
 *
 * **Everything is collected before anything is compared, and that ordering is the guarantee.** A
 * per-aspect "fetch, then compare" loop would let a mid-run HTTP failure leave earlier aspects
 * reported as agreeing, which reads as a partial success — and a failed read must never be able to
 * look like agreement. Same discipline as e2e-serve.mjs requiring the build output to exist BEFORE
 * asserting its credential file is absent.
 *
 * Exported so `db:push` can call it in-process: spawning this as a child would put a shell between
 * the exit code and its caller, and a swallowed non-zero exit is the failure the wrapper exists to
 * prevent.
 */
export async function compareEnvironments() {
  loadEnv();

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return fail(
      "SUPABASE_ACCESS_TOKEN is not set. It is the same personal access token `npm run db:types` " +
        "uses; generate one at https://supabase.com/dashboard/account/tokens and put it in .env. " +
        "Never add it to .dev.vars, to CI or to the Worker — it is account-wide.",
    );
  }

  const resolved = [];
  for (const target of TARGETS) {
    const { ref, error } = refFor(target);
    if (error) {
      return fail(error);
    }
    resolved.push({ ...target, ref });
  }

  const mask = makeMasker(
    token,
    resolved.map((target) => [target.label, target.ref]),
  );

  // ---------------------------------------------------------------- collect, then compare
  const collected = new Map();
  for (const aspect of ASPECTS) {
    for (const target of resolved) {
      try {
        collected.set(`${aspect.name}:${target.key}`, await query(target.ref, token, aspect.sql));
      } catch (error) {
        return fail(
          `could not read "${aspect.name}" from ${target.label} — ${mask(error.message)}\n` +
            `  Nothing was compared. An unreadable project is not an agreeing one.`,
        );
      }
    }
  }

  banner("schema parity: gymlog vs gymlog-test");

  let differing = 0;
  let unverifiable = 0;

  for (const aspect of ASPECTS) {
    const production = collected.get(`${aspect.name}:production`);
    const test = collected.get(`${aspect.name}:test`);
    const belowFloor = [production.length < aspect.minRows, test.length < aspect.minRows];
    const counts = `prod=${production.length} test=${test.length}`;

    // **Below the floor on BOTH sides means the QUERY is suspect; on ONE side it is real drift.**
    // The distinction matters and it is easy to get backwards. A query that has stopped matching
    // returns nothing everywhere and would otherwise match trivially — that is what the floor
    // catches. But a project that genuinely lost four views answers fewer rows on that side alone,
    // and reporting it as "could not verify" would hide the exact drift this script exists to find.
    //
    // **The BOTH-sides branch was proven by mutation; the ONE-sided branch has never executed, and
    // that is stated rather than left implied** (lessons.md § "An assertion you keep because it
    // cannot fail YET must say so in the same words you'd use to refuse one"). Raising `views` to a
    // floor of 99 on 2026-08-21 produced UNVERIFIED and exit 2 with the aspect NOT reported as
    // agreeing. The one-sided case cannot be constructed while the projects agree, because both
    // sides run the identical query and answer identical counts — reaching it means one project
    // genuinely losing objects, which is Phase 2's territory and only if that mutation happens to
    // cross a floor. The edit that would make it bite in normal use is a migration that drops a
    // view, a table or an enum on one project alone.
    if (belowFloor[0] && belowFloor[1]) {
      unverifiable += 1;
      console.log(`UNVERIFIED  ${aspect.name.padEnd(17)} ${counts} — below the floor of ${aspect.minRows} on BOTH`);
      console.log(`            the query returned almost nothing on both projects, so it proved nothing.`);
      console.log(`            Fix the query or the invariant behind minRows — do not lower the floor to match.`);
      continue;
    }

    if (digest(production) === digest(test)) {
      console.log(`OK          ${aspect.name.padEnd(17)} ${counts}`);
      continue;
    }

    differing += 1;
    console.log(`DIFF        ${aspect.name.padEnd(17)} ${counts}`);
    if (belowFloor[0] || belowFloor[1]) {
      const side = belowFloor[0] ? "gymlog" : "gymlog-test";
      console.log(`            ${side} is below the floor of ${aspect.minRows} while the other is not — real drift.`);
    }

    // Print WHAT differs, both directions. A report that says only "differs" sends its reader back
    // to a psql prompt they do not have.
    const inTest = new Set(test);
    const inProduction = new Set(production);
    const only = [
      ["gymlog only     ", production.filter((row) => !inTest.has(row))],
      ["gymlog-test only", test.filter((row) => !inProduction.has(row))],
    ];
    for (const [side, rows] of only) {
      for (const row of rows.slice(0, MAX_PRINTED_ROWS)) {
        console.log(`            ${side}: ${mask(row)}`);
      }
      if (rows.length > MAX_PRINTED_ROWS) {
        console.log(`            ${side}: … and ${rows.length - MAX_PRINTED_ROWS} more`);
      }
    }
  }

  console.log("");
  if (unverifiable > 0) {
    console.error(
      `env-parity: ${unverifiable} aspect(s) COULD NOT BE VERIFIED. The projects may or may not agree —\n` +
        `  this run does not know, and that is a different answer from "they agree".`,
    );
    return UNVERIFIABLE;
  }
  if (differing > 0) {
    console.error(
      `env-parity: ${differing} aspect(s) DIFFER between gymlog and gymlog-test.\n` +
        `  Migration histories agreeing does not mean schemas agree — that is what this check is for.`,
    );
    return DIFFERS;
  }
  console.log(`env-parity: gymlog and gymlog-test agree across all ${ASPECTS.length} aspects.`);
  return AGREE;
}

// Only run when invoked directly, so `db:push` can import compareEnvironments without this firing.
// Compared as file URLs rather than by path string: argv[1] is a Windows path here and
// import.meta.url is a file:// URL, so a naive comparison never matches on this machine.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await compareEnvironments());
}
