/**
 * The account's preferences — the three values every derived number in this product depends on.
 *
 * Until now the only read of a profile was an inline single-column query in `dashboard.astro` that
 * printed the timezone as text and could not be reused. From S-03 onward the estimate needs the
 * formula, the set form needs the unit, and the date field needs the timezone, so it becomes a
 * service like every other read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { Profile } from "@/types";

/**
 * The middleware already built a request-scoped client and put it on `context.locals.supabase`.
 * Every function here takes it rather than constructing a second one: a second client duplicates
 * the cookie plumbing and spends CPU the Workers Free plan caps at 10 ms per request.
 */
type Client = SupabaseClient<Database>;

/**
 * The signed-in account's profile row, or `null` when there is none.
 *
 * `.eq("id", userId)` is explicit even though the policy already restricts the read to one row —
 * `AGENTS.md` § Access control: the policy is the guarantee, the filter is the index path. Here it
 * is a primary-key lookup either way, so the cost is nil and the habit is worth more than the
 * exception.
 *
 * `maybeSingle()` rather than `single()`: a missing profile is a missing value, not a 500. A real
 * failure still throws, because a caller that cannot tell "no row" from "the database is
 * unreachable" will render the wrong thing confidently.
 */
export async function getProfile(supabase: Client, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/** The three preferences a settings screen writes, in the shape the schema parses them into. */
export interface ProfilePreferences {
  timezone: string;
  weightUnit: Database["public"]["Enums"]["weight_unit"];
  estimationFormula: Database["public"]["Enums"]["estimation_formula"];
}

/**
 * Replace the account's three preferences (FR-016, FR-022, US-03). `null` when nothing was updated.
 *
 * **It writes exactly these three columns.** `id`, `created_at` and `updated_at` are not the user's
 * to state, and a wider update is how a screen starts overwriting fields it never showed.
 *
 * **Nothing stored is converted, and this is the function where that would happen if it ever did.**
 * Changing `weight_unit` changes the unit NEW sets are stamped with; every set already logged keeps
 * the unit it was typed in, so it still reads back as the number the user typed. Re-stamping the
 * `sets` rows here would turn 100 lb into 100 kg and silently corrupt every figure derived from the
 * generated `weight_kg` (AGENTS.md § Domain rules → unit round-trip). Likewise changing
 * `estimation_formula` is a **re-derivation**: `public.set_estimates` reads the column per row, so
 * the next read of a record recomputes it, with no write and nothing to invalidate.
 *
 * `.eq("id", userId)` is the index path; the update policy is the guarantee (AGENTS.md § Access
 * control). `.select()` is not decoration either — under RLS an update naming a row the caller does
 * not own matches zero rows and reports SUCCESS, so "nothing happened" has to be built from the
 * returned rows rather than from the absence of an error.
 */
export async function updateProfile(
  supabase: Client,
  userId: string,
  { timezone, weightUnit, estimationFormula }: ProfilePreferences,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ timezone, weight_unit: weightUnit, estimation_formula: estimationFormula })
    .eq("id", userId)
    .select("*");

  if (error) {
    throw error;
  }

  return data.length > 0 ? data[0] : null;
}
