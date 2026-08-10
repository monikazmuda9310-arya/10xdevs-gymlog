/**
 * Reading and writing the training record.
 *
 * One place that knows how to query it, so a page and three endpoints cannot drift in how they do
 * it. Business logic lives in `src/lib/services/` (AGENTS.md § Conventions).
 *
 * **Every read carries an explicit `.eq("user_id", userId)`.** The RLS policy is the guarantee; the
 * filter is the index path. Without it a read leans on the policy predicate to do the filtering,
 * which on `sets` is a full scan under the Workers Free 10 ms CPU cap — the documented trap.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

/**
 * The middleware already built a request-scoped client and put it on `context.locals.supabase`.
 * Every function takes it rather than constructing a second one.
 */
type Client = SupabaseClient<Database>;

/** Postgres error codes this module maps onto message codes rather than letting them reach a 500. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

export interface CreateWorkoutFields {
  performedOn: string;
  note: string | null;
}

export interface AddSetFields {
  reps: number;
  weight: number;
  weightUnit: Database["public"]["Enums"]["weight_unit"];
  rpe: number | null;
}

/**
 * The workout list, most recent first (FR-005), each row carrying how many exercises it holds.
 *
 * The count is aggregated by Postgres through the embed rather than by fetching entries and
 * counting them here — the same discipline S-07's weekly tonnage will need, applied to the first
 * aggregate that exists. `created_at` breaks ties so two workouts on one day have a stable order.
 */
export async function listWorkouts(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, performed_on, note, created_at, exercise_entries(count)")
    .eq("user_id", userId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }
  return data;
}

export type WorkoutListItem = Awaited<ReturnType<typeof listWorkouts>>[number];

/**
 * One workout with everything under it, in a single nested select rather than a query per level.
 *
 * Returns `null` when the workout is absent **or belongs to somebody else** — deliberately the same
 * answer, so the page cannot be used to learn whether an id exists.
 *
 * The embeds resolve through the composite foreign keys. That works because each pair of tables has
 * exactly one foreign-key path between them; a second, "clarifying" key would turn every one of
 * these into `PGRST201`. See the migration's header comment.
 */
export async function getWorkout(supabase: Client, userId: string, workoutId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select(
      `id, performed_on, note, created_at,
       exercise_entries (
         id, exercise_id, created_at,
         exercises ( id, name, muscle_group, is_bodyweight ),
         sets ( id, reps, weight, weight_unit, weight_kg, rpe, created_at )
       )`,
    )
    .eq("user_id", userId)
    .eq("id", workoutId)
    .order("created_at", { referencedTable: "exercise_entries", ascending: true })
    .order("created_at", { referencedTable: "exercise_entries.sets", ascending: true })
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export type WorkoutDetail = NonNullable<Awaited<ReturnType<typeof getWorkout>>>;
export type WorkoutEntry = WorkoutDetail["exercise_entries"][number];

export async function createWorkout(supabase: Client, userId: string, { performedOn, note }: CreateWorkoutFields) {
  const { data, error } = await supabase
    .from("workouts")
    .insert({ user_id: userId, performed_on: performedOn, note })
    .select("id, performed_on, note, created_at")
    .single();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Add an exercise to a workout — or hand back the entry that is already there.
 *
 * `unique (workout_id, exercise_id)` makes a second entry for the same lift impossible, which is
 * what gives "the best estimate of that entry" (FR-015) one meaning. Rather than surfacing that as
 * an error the user can do nothing useful with, the duplicate is resolved into the existing entry,
 * so choosing an exercise twice is idempotent from the caller's side.
 *
 * A `workoutId` belonging to another account raises a foreign-key violation instead — the composite
 * key refuses it — and the caller maps that to "not found".
 */
export async function addExerciseEntry(supabase: Client, userId: string, workoutId: string, exerciseId: string) {
  const inserted = await supabase
    .from("exercise_entries")
    .insert({ user_id: userId, workout_id: workoutId, exercise_id: exerciseId })
    .select("id, workout_id, exercise_id, created_at")
    .single();

  if (!inserted.error) {
    return { entry: inserted.data, created: true };
  }

  if (inserted.error.code !== UNIQUE_VIOLATION) {
    throw inserted.error;
  }

  const existing = await supabase
    .from("exercise_entries")
    .select("id, workout_id, exercise_id, created_at")
    .eq("user_id", userId)
    .eq("workout_id", workoutId)
    .eq("exercise_id", exerciseId)
    .single();

  if (existing.error) {
    throw existing.error;
  }
  return { entry: existing.data, created: false };
}

/**
 * The entry a set is about to hang off, together with the one fact the weight rule needs.
 *
 * Scoped by `user_id`, so another account's entry reads as absent — and the caller answers "not
 * found" for both cases, which is what keeps it from being an existence oracle.
 */
export async function getEntryForSet(supabase: Client, userId: string, entryId: string) {
  const { data, error } = await supabase
    .from("exercise_entries")
    .select("id, exercises ( id, is_bodyweight )")
    .eq("user_id", userId)
    .eq("id", entryId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function addSet(
  supabase: Client,
  userId: string,
  entryId: string,
  { reps, weight, weightUnit, rpe }: AddSetFields,
) {
  // `weight_kg` is never written: it is generated, and Postgres refuses a non-DEFAULT value for it.
  const { data, error } = await supabase
    .from("sets")
    .insert({ user_id: userId, exercise_entry_id: entryId, reps, weight, weight_unit: weightUnit, rpe })
    .select("id, reps, weight, weight_unit, weight_kg, rpe, created_at")
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export type LoggedSet = Awaited<ReturnType<typeof addSet>>;
