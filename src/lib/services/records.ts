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
import type { RecordCandidate, Removal } from "./record-impact";

type Client = SupabaseClient<Database>;

/** The columns every ranking here selects, so the three queries cannot drift in what they return. */
const CANDIDATE_COLUMNS = "set_id, reps, weight, weight_unit, weight_kg, performed_on";

/**
 * Which column of `set_estimates` a removal excludes on.
 *
 * The view carries all three levels — `set_id` from the set, `exercise_entry_id` from the set, and
 * `workout_id` from the entry's workout — which is what lets one query shape answer "what survives"
 * for a set, an exercise entry and a whole workout without three different queries.
 */
function exclusionColumn(removal: Removal): "set_id" | "exercise_entry_id" | "workout_id" {
  switch (removal.level) {
    case "set":
      return "set_id";
    case "entry":
      return "exercise_entry_id";
    case "workout":
      return "workout_id";
  }
}

function exclusionValue(removal: Removal): string {
  switch (removal.level) {
    case "set":
      return removal.setId;
    case "entry":
      return removal.exerciseEntryId;
    case "workout":
      return removal.workoutId;
  }
}

/**
 * Drop a ranking row that is missing something the screen needs, rather than asserting it present.
 *
 * Every column of a view arrives `T | null` and no assertion can make that untrue. A row this
 * incomplete cannot be shown as "what your record falls to", so it is not a candidate.
 */
function toCandidate(row: {
  set_id: string | null;
  reps: number | null;
  weight: number | null;
  weight_unit: Database["public"]["Enums"]["weight_unit"] | null;
  weight_kg: number | null;
  performed_on: string | null;
}): RecordCandidate | null {
  if (row.set_id === null || row.reps === null || row.weight === null || row.weight_unit === null) {
    return null;
  }
  if (row.performed_on === null) {
    return null;
  }
  return {
    set_id: row.set_id,
    reps: row.reps,
    weight: row.weight,
    weight_unit: row.weight_unit,
    weight_kg: row.weight_kg,
    performed_on: row.performed_on,
  };
}

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

/**
 * The record rows for a named set of exercises — who holds each record right now (S-05).
 *
 * `personal_records` already reports the holding set AND the workout it belongs to, which is what
 * removes any need to compute "is this record affected". Reading it for the handful of exercises a
 * correction can touch costs one query regardless of how large the log grows.
 */
export async function recordHoldersForExercises(supabase: Client, userId: string, exerciseIds: readonly string[]) {
  if (exerciseIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("personal_records")
    .select("*")
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds);

  if (error) {
    throw error;
  }
  return data;
}

/**
 * The best set that would hold the ESTIMATE record for this exercise once `removal` no longer
 * counts — or `null` when none would.
 *
 * **The ordering is the domain rule and this is its third copy.** It must match the `distinct on`
 * inside `public.personal_records` and `topTwoEstimatesForExercise` above: `estimate_kg desc` decides
 * the record, `created_at asc` keeps an equal but older set in front, `set_id asc` is the
 * determinism the NFR requires when two sets share both. A disagreement between any two of the
 * three makes this function name a set that does not actually become the record.
 *
 * One query with an exclusion filter serves all three removal levels, which is why deleting an
 * exercise entry or a whole workout needs nothing of its own — and why `topTwoEstimatesForExercise`
 * is NOT reused here. Top-two is exact when a single set disappears; above that level a removal can
 * take the leader *and* the runner-up, and the record falls to the third-best.
 */
export async function bestSurvivingEstimate(
  supabase: Client,
  userId: string,
  exerciseId: string,
  removal: Removal,
): Promise<RecordCandidate | null> {
  const { data, error } = await supabase
    .from("set_estimates")
    .select(CANDIDATE_COLUMNS)
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .not("estimate_kg", "is", null)
    .neq(exclusionColumn(removal), exclusionValue(removal))
    .order("estimate_kg", { ascending: false })
    .order("created_at", { ascending: true })
    .order("set_id", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }
  return data.length > 0 ? toCandidate(data[0]) : null;
}

/**
 * The heaviest surviving set for this exercise once `removal` no longer counts — or `null`.
 *
 * **Deliberately not filtered by repetition count** (owner, 2026-08-11): "heaviest ever handled" is
 * a fact about the load, so a twenty-repetition set counts here while carrying no estimate at all.
 * `.gt("weight_kg", 0)` and not `.gte`: a zero load is not a heaviest record, and an assisted set is
 * negative. This is the ranking `topTwoEstimatesForExercise` cannot see, and the reason a warning
 * built on the estimate ranking alone would stay silent while a real record fell.
 */
export async function bestSurvivingHeaviest(
  supabase: Client,
  userId: string,
  exerciseId: string,
  removal: Removal,
): Promise<RecordCandidate | null> {
  const { data, error } = await supabase
    .from("set_estimates")
    .select(CANDIDATE_COLUMNS)
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .gt("weight_kg", 0)
    .neq(exclusionColumn(removal), exclusionValue(removal))
    .order("weight_kg", { ascending: false })
    .order("created_at", { ascending: true })
    .order("set_id", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }
  return data.length > 0 ? toCandidate(data[0]) : null;
}

/**
 * Whether ANY set for this exercise survives the removal — including sets that qualify for neither
 * record.
 *
 * This is the only thing that separates "the exercise stays on `/records` with no value for this
 * record" from "the exercise disappears from `/records` altogether", and those are two different
 * sentences to show somebody before they confirm.
 */
export async function anySetSurvives(
  supabase: Client,
  userId: string,
  exerciseId: string,
  removal: Removal,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("set_estimates")
    .select("set_id")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .neq(exclusionColumn(removal), exclusionValue(removal))
    .limit(1);

  if (error) {
    throw error;
  }
  return data.length > 0;
}
