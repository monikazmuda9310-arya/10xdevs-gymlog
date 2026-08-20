// Build the worker for the browser suite, then REMOVE the credentials the build writes to disk.
//
// `npm run build` emits `dist/server/.dev.vars` holding PRODUCTION's `SUPABASE_URL` / `SUPABASE_KEY`
// — written by `@cloudflare/vite-plugin` from the repository root's `.dev.vars`, and read back by
// `wrangler dev` / `astro preview` **relative to the config file's directory**. Measured on
// 2026-08-16: 118 bytes, both key names present (plan.md § Measurement record, P4.0). It is
// gitignored, so nothing leaks — but any harness pointed at the build output inherits production
// through a file no test author would think to look at. That is what this script deletes.
//
// **THIS SCRIPT DELETES AND DOES NOT ASSERT. `scripts/e2e-serve.mjs` ASSERTS AND DOES NOT DELETE.**
// The separation is the whole point: a launcher that deleted the file and then checked its absence
// would hold an assertion that can never fire, and a check that never fires is indistinguishable
// from a check that passes (`lessons.md` § "A hook that never fires and a hook that passes are the
// SAME observation"). Kept in different processes, the refusal is provable — plant the file, run the
// launcher directly, watch it refuse.
//
// An ORDINARY `npm run build` re-creates the file, which is why the launcher re-asserts before every
// single launch rather than once at setup.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEV_VARS = fileURLToPath(new URL("../dist/server/.dev.vars", import.meta.url));

const build = spawnSync("npx", ["astro", "build"], { cwd: ROOT, stdio: "inherit", shell: true });
if (build.status !== 0) {
  console.error("e2e-build: `astro build` failed; the browser suite has nothing to serve.");
  process.exit(build.status ?? 1);
}

if (existsSync(DEV_VARS)) {
  // The byte count goes in the log so the record shows the file EXISTED and was removed, rather than
  // leaving "nothing to delete" and "deleted something" looking alike in a transcript.
  const { size } = statSync(DEV_VARS);
  rmSync(DEV_VARS);
  console.log(`e2e-build: deleted dist/server/.dev.vars (${size} bytes) — it named production.`);
} else {
  // Not an error: a build can legitimately emit nothing here if the root `.dev.vars` is absent (CI).
  // Reported anyway, because a silent no-op is how the delete stops happening without anybody noticing.
  console.log("e2e-build: dist/server/.dev.vars was not emitted by this build; nothing to delete.");
}
