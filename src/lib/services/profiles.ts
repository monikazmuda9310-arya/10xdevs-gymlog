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
