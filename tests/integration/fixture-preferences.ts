// The preference columns every suite that reads a derived number depends on, and the one function
// that establishes them.
//
// **Not a `*.test.ts` file on purpose** — `vitest.integration.config.ts` collects
// `tests/integration/**/*.test.ts`, so this module is imported and never collected.
//
// WHY THIS EXISTS, since a reset that looks redundant is the first thing somebody deletes.
//
// `preferences-derive.test.ts` and `profile-mutations-rls.test.ts` flip `weight_unit` and
// `estimation_formula` on `rls-owner-a`, and both restore in a `finally`. That is correct and it is
// not enough: `finally` is application-level, so a **process kill** — Ctrl-C, a cancelled CI job, an
// OOM — between the flip and the restore skips it, as does a network failure inside the restore's
// own write. Their closing tripwire assertions never run either, so the damage does not surface
// where it was caused. It surfaces on the NEXT run, in a suite that has nothing to do with
// preferences: `workout-endpoints.test.ts` asserts that a set logged through the endpoint is stamped
// `"kg"`, which is read from the profile at insert.
//
// **Teardown protects the happy path; only setup protects the next run.** So every suite that
// DEPENDS on these values establishes them itself rather than trusting the suite that changes them
// to put them back. See `context/foundation/lessons.md` — "A `finally` that restores shared state
// does not survive a killed process".

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

/** The column defaults from F-03's migration, which every assertion downstream assumes. */
export const FIXTURE_PREFERENCES = {
  timezone: "Europe/Warsaw",
  weight_unit: "kg",
  estimation_formula: "brzycki",
} as const;

/**
 * Put the account's three preferences back on the defaults.
 *
 * An `update`, never an `upsert`: it affects zero rows when no profile exists, so it cannot
 * manufacture a row that a suite asserting "the trigger created one" is there to find.
 *
 * Throws rather than warning. A suite that could not establish its own precondition is a suite whose
 * result means nothing, and "it must never skip its way to green" is the rule the whole integration
 * check is written under.
 */
export async function resetPreferences(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await client.from("profiles").update(FIXTURE_PREFERENCES).eq("id", userId);
  if (error) {
    throw new Error(`could not reset fixture preferences for ${userId}: ${error.code} ${error.message}`);
  }
}
