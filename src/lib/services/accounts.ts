import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { AccountMessageCode } from "@/lib/validation/account";

/**
 * What Postgres answers when `exercise_entries.exercise_id`'s `on delete restrict` refuses the
 * cascade into `public.exercises` — the one thing that can block an account from deleting itself.
 */
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Which message code a failed deletion becomes.
 *
 * **Kept as a plain function, apart from the call that produces the error, so it can be tested
 * without a database** (`lessons.md` § "A criterion that demands a unit test must name the module
 * that will hold it"). The claim it carries is small and load-bearing: a blocked deletion is the one
 * failure the user can act on — waiting, or asking why — and collapsing it into `unexpected` would
 * make the product answer "something went wrong" to the single case it can explain.
 *
 * Everything else is `unexpected` on purpose. `src/lib/validation/account.ts` states the line:
 * outcomes the user did not cause get one generic sentence, and no provider prose ever reaches them.
 */
export function accountDeletionFailureCode(error: { code?: string } | null | undefined): AccountMessageCode {
  return error?.code === FOREIGN_KEY_VIOLATION ? "account_delete_blocked" : "unexpected";
}

/**
 * Delete the calling account through `public.delete_own_account()`.
 *
 * **The uid is not passed and cannot be.** The function takes no parameters and reads `auth.uid()`
 * itself, so there is no argument this layer could get wrong — which is why this wrapper is three
 * lines and has nothing to validate. See the migration header for why that shape was chosen over a
 * parameterised function with an ownership check.
 *
 * Returns the raw error rather than throwing, because the endpoint has to tell a blocked deletion
 * apart from an unexpected one and both are ordinary outcomes of a real request.
 */
export async function deleteOwnAccount(
  supabase: SupabaseClient<Database>,
): Promise<{ error: { code?: string; message?: string } | null }> {
  const { error } = await supabase.rpc("delete_own_account");
  return { error };
}
