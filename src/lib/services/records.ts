/**
 * Reading the two record views.
 *
 * One place that knows how to ask the database about a record, so the endpoint and the records
 * screen cannot drift in how they ask. Business logic lives in `src/lib/services/`
 * (AGENTS.md § Conventions); this module is **server-only** — it takes the request-scoped Supabase
 * client the middleware built, and nothing hydrated may import it.
 *
 * **Every read carries an explicit `.eq("user_id", userId)`.** The `security_invoker` views are
 * subject to the caller's own policies, so the filter is not the guarantee — it is the index path,
 * exactly as on the tables (AGENTS.md § Access control).
 *
 * **View columns arrive nullable and are narrowed here, once.** `supabase gen types` cannot prove
 * not-null through a view, so every column of both views is typed `T | null`. Narrowing at this
 * boundary is what keeps that accident out of the endpoint, the page and the island.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { RankedSet } from "./records-verdict";

type Client = SupabaseClient<Database>;

/**
 * The two best estimable sets for one exercise, best first.
 *
 * **The ordering is the domain rule, not a preference, and it must match the `distinct on` ordering
 * inside `public.personal_records`.** `estimate_kg desc` decides the record; `created_at asc` is the
 * equality rule, keeping an equal but older set in front so a tie is not a record; `set_id asc` is
 * the determinism the NFR requires when two sets share both.
 *
 * Two rows rather than one, because the announcement quotes what was beaten. S-05's "what will this
 * record fall to" is the same runner-up asked from the other side — which is why that slice needs
 * nothing added here.
 */
export async function topTwoEstimatesForExercise(
  supabase: Client,
  userId: string,
  exerciseId: string,
): Promise<RankedSet[]> {
  const { data, error } = await supabase
    .from("set_estimates")
    .select("set_id, estimate_kg, reps, weight, weight_unit, weight_kg, performed_on")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .not("estimate_kg", "is", null)
    .order("estimate_kg", { ascending: false })
    .order("created_at", { ascending: true })
    .order("set_id", { ascending: true })
    .limit(2);

  if (error) {
    throw error;
  }

  // `flatMap` rather than a cast: a row missing one of these columns is a row this ranking cannot
  // reason about, and dropping it is honest where asserting non-null would be a guess.
  //
  // `estimate_kg` is deliberately NOT re-checked here — the `.not("estimate_kg", "is", null)` filter
  // above is what removes those rows, and supabase-js narrows the column to non-null because of it.
  // Checking it again would be dead code that reads as diligence.
  return data.flatMap((row) =>
    row.set_id === null ||
    row.reps === null ||
    row.weight === null ||
    row.weight_unit === null ||
    row.performed_on === null
      ? []
      : [
          {
            set_id: row.set_id,
            estimate_kg: row.estimate_kg,
            reps: row.reps,
            weight: row.weight,
            weight_unit: row.weight_unit,
            weight_kg: row.weight_kg,
            performed_on: row.performed_on,
          },
        ],
  );
}

/**
 * Every exercise the account has logged, with both of its records (FR-021).
 *
 * Most recently improved first, and the exercises holding no record at all — a plank logged only at
 * zero load — sink to the bottom rather than disappearing, so the screen can say why they have
 * none. Name breaks the tie, so the order is stable between reads.
 *
 * **Bounded by the catalogue, not by history**: one row per exercise logged, which is why this has
 * none of the unbounded-growth caveat `listWorkouts` carries.
 */
export async function listPersonalRecords(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("personal_records")
    .select("*")
    .eq("user_id", userId)
    .order("last_record_on", { ascending: false, nullsFirst: false })
    .order("exercise_name", { ascending: true });

  if (error) {
    throw error;
  }
  return data;
}

export type PersonalRecordListItem = Awaited<ReturnType<typeof listPersonalRecords>>[number];
