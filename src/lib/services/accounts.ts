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

/** What the confirmation dialog names, so the user can weigh what they are about to lose. */
export interface AccountFootprint {
  workouts: number;
  sets: number;
  customExercises: number;
}

/**
 * How much training the account holds.
 *
 * **Returns `null` when any of the three reads fails, and never a zero.** A zero here is a positive
 * claim — "you have nothing to lose" — offered at the exact moment the user is deciding whether to
 * lose it, and it is the same mistake `AGENTS.md` records for an emitted tonnage of zero and for an
 * empty `impact` list. The dialog drops the numbers and says so instead.
 *
 * Counted with `head: true`, so no rows cross the wire — three counts, not three result sets.
 * Explicit `.eq("user_id", …)` on every one: the policy is the guarantee, the filter is the index
 * path (`AGENTS.md` § Access control).
 */
export async function accountFootprint(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AccountFootprint | null> {
  const [workouts, sets, customExercises] = await Promise.all([
    supabase.from("workouts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("sets").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("exercises").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  if (workouts.error || sets.error || customExercises.error) {
    return null;
  }
  // **`typeof !== "number"`, not `=== null`.** PostgREST types `count` as `number | null`, but a
  // read that never produced one at all leaves it `undefined`, and `undefined === null` is false —
  // so a null-check alone lets a non-count through and the dialog renders "undefined workouts".
  // Caught by `tests/render/settings-delete-panel.test.ts`; the distinction is the whole reason
  // this function returns `null` rather than a partially-filled object.
  //
  // Written out one binding at a time rather than over an array, because `typeof` on a local const
  // is what NARROWS the type — an `.every()` over an array proves nothing to the compiler, and the
  // cast or `!` needed to paper over that is forbidden here by two separate lint rules.
  const workoutCount = workouts.count;
  const setCount = sets.count;
  const exerciseCount = customExercises.count;
  if (typeof workoutCount !== "number" || typeof setCount !== "number" || typeof exerciseCount !== "number") {
    return null;
  }
  return { workouts: workoutCount, sets: setCount, customExercises: exerciseCount };
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
