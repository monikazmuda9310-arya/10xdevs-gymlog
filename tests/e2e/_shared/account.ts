/**
 * The one account a browser run owns, and the only thing that removes it.
 *
 * **One account per run, never a shared fixture.** `rls-owner-a/b@gymlog-test.dev` and every `s09i-`
 * address are permanent fixtures other suites read; damage to them surfaces later, somewhere else,
 * as a suite failing for reasons unrelated to the code it tests. This suite creates its own address
 * and deletes it through `public.delete_own_account()` — the account acting on itself, which is what
 * makes throwaway accounts affordable at all.
 *
 * **`delete_own_account()` cannot rescue an interrupted run.** The RPC call IS the cleanup, so a
 * killed process skips it exactly the way a `finally` is skipped
 * (`lessons.md` § "A `finally` that restores shared state does not survive a killed process").
 * What survives an interruption is the `t2e-` mark: it makes the leak identifiable by name, and
 * keeping the run to ONE account means an interruption leaks one rather than seven.
 */

import { createClient } from "@supabase/supabase-js";

// `import type`, and it has to stay one. Playwright resolves modules itself and is given no `@/`
// alias, so a VALUE imported through that path would fail at run time — the type is erased before
// anything tries. Relative paths for anything a spec actually executes.
import type { Database } from "@/db/database.types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The browser suite must never skip its way to green.`);
  }
  return value;
}

/** Named by `playwright.config.ts` in the parent process, so spec and teardown agree on one address. */
export const RUN_ACCOUNT_EMAIL = required("E2E_ACCOUNT_EMAIL");
export const RUN_ACCOUNT_PASSWORD = required("GYMLOG_TEST_PASSWORD");

/**
 * The same run id the address is built from, for marking rows a spec writes INSIDE the account.
 *
 * They need no cleanup of their own — deleting the account takes its workouts, entries and sets with
 * it — but an interrupted run leaks the account, and then the mark is what identifies the training
 * inside it as this suite's rather than a person's.
 */
export const RUN_ID = required("E2E_RUN_ID");

function testProjectClient() {
  // `SUPABASE_TEST_URL`, never `SUPABASE_URL`. The two are equal here by construction — the config
  // seeds one from the other — and reading the test-project name directly is what keeps this module
  // honest if that ever stops being true.
  return createClient<Database>(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Remove the run's account, and prove from OUTSIDE that it is gone.
 *
 * Returns a sentence for the log rather than throwing on "no such account": a run that never got as
 * far as signing up (the smoke spec alone, or a failure before the form was submitted) has nothing
 * to remove, and that is not a failure. A deletion that reports success while the address still
 * authenticates IS one, which is why the re-check is a separate sign-in attempt on a fresh client.
 */
export async function removeRunAccount(): Promise<string> {
  const client = testProjectClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: RUN_ACCOUNT_EMAIL,
    password: RUN_ACCOUNT_PASSWORD,
  });
  if (signInError) {
    return `nothing to remove: ${RUN_ACCOUNT_EMAIL} does not sign in (${signInError.message})`;
  }

  const { error: rpcError } = await client.rpc("delete_own_account");
  if (rpcError) {
    throw new Error(`could not delete ${RUN_ACCOUNT_EMAIL}: ${rpcError.code} ${rpcError.message}`);
  }

  const { error: afterError } = await testProjectClient().auth.signInWithPassword({
    email: RUN_ACCOUNT_EMAIL,
    password: RUN_ACCOUNT_PASSWORD,
  });
  if (!afterError) {
    throw new Error(
      `${RUN_ACCOUNT_EMAIL} still signs in after delete_own_account() reported success. The account ` +
        `is LEAKED in gymlog-test and must be removed by hand.`,
    );
  }
  return `removed ${RUN_ACCOUNT_EMAIL} (it no longer signs in: ${afterError.message})`;
}
