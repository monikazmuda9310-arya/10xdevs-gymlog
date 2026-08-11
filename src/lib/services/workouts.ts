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

/**
 * The composite ownership key on `exercise_entries`, by the name the migration gives it.
 *
 * Two different foreign keys raise `23503` when an entry is inserted — this one, when the workout is
 * not the caller's, and the plain `exercise_id` key, when the exercise does not exist — and they are
 * different mistakes deserving different words. The only thing that tells them apart is the
 * constraint named in the error.
 *
 * **This is not the prose-matching that `auth-errors.ts` forbids.** That rule exists because a
 * provider's wording changes between releases; this string is declared in our own migration, and
 * `tests/integration/workout-endpoints.test.ts` asserts both branches, so renaming the constraint
 * fails the gate rather than silently degrading a message. And if the match ever did misfire, both
 * outcomes are a 404 saying "not found" — the failure is a wrong sentence, never a disclosure.
 */
export const WORKOUT_OWNER_CONSTRAINT = "exercise_entries_workout_owner_fkey";

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
 *
 * **Deliberately unbounded, and this one has a real expiry date.** `listExercises` is unbounded too,
 * but a catalogue is bounded by curation — this is not: the caller for whom this product exists logs
 * three or four sessions a week, so the list grows by roughly **200 rows a year and never shrinks**.
 * The page renders every row it gets and each carries a nested count aggregate, against a 2 s p95
 * mobile budget and a hard 10 ms CPU cap per invocation.
 *
 * The threshold worth knowing: **somewhere in the low hundreds — call it one to two years of real
 * training — this stops being correct**, and it will degrade slowly enough that nobody notices until
 * the data is real. Bounding it is deliberately NOT done here: a bare `.limit()` would hide the
 * oldest sessions with nothing on screen saying so, in a product whose promise is that a logged
 * session is never lost. Whichever slice adds history or pagination owns both halves at once.
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

// ---------------------------------------------------------------------------------------------
// Correcting what was logged (S-05).
//
// **Every mutation below carries `.eq("user_id", userId)` AND `.select()`s what it touched, and the
// second half is not decoration.** Under RLS an update or a delete naming another account's row does
// not raise: it matches ZERO ROWS and reports success. A handler that answered 204 to that would be
// telling one account it had just deleted another's data — a lie, and an existence oracle at the
// same time. Returning the affected rows is what lets the endpoint answer 404 instead.
//
// Nothing here recomputes a record. Records are derived by two views over the surviving sets, so the
// next read simply returns a different row — there is no stored figure to patch and nothing to
// invalidate (AGENTS.md § Access control → the derived-view variant).
// ---------------------------------------------------------------------------------------------

export interface UpdateWorkoutFields {
  performedOn: string;
  note: string | null;
}

export interface UpdateSetFields {
  reps: number;
  weight: number;
  rpe: number | null;
}

/**
 * The set an edit is about to touch, with the two facts the edit needs beyond its own columns: the
 * exercise's bodyweight flag, and the ids the impact query excludes on.
 *
 * Scoped by `user_id`, so another account's set reads as absent — and the caller answers "not found"
 * for both, which is what keeps it from being an existence oracle.
 */
export async function getSetForEdit(supabase: Client, userId: string, setId: string) {
  const { data, error } = await supabase
    .from("sets")
    .select(
      `id, reps, weight, weight_unit, weight_kg, rpe, exercise_entry_id,
       exercise_entries ( id, workout_id, exercise_id, exercises ( id, is_bodyweight ) )`,
    )
    .eq("user_id", userId)
    .eq("id", setId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Change a set's repetitions, weight and RPE.
 *
 * **`weight_unit` is deliberately absent from the payload.** It stays whatever the row already
 * holds, because the unit belongs to the set rather than to the account: re-reading it from the
 * profile would restamp a set typed in pounds as kilograms the first time somebody corrected it
 * after changing that preference, and every figure built on `weight_kg` would be wrong afterwards.
 * `weight_kg` is generated and is never written.
 *
 * Answers `null` when nothing was updated — absent, or not this account's.
 */
export async function updateSet(supabase: Client, userId: string, setId: string, fields: UpdateSetFields) {
  const { data, error } = await supabase
    .from("sets")
    .update({ reps: fields.reps, weight: fields.weight, rpe: fields.rpe })
    .eq("user_id", userId)
    .eq("id", setId)
    .select("id, reps, weight, weight_unit, weight_kg, rpe, created_at");

  if (error) {
    throw error;
  }
  return data.length > 0 ? data[0] : null;
}

/** Answers `false` when nothing was deleted — absent, or not this account's. */
export async function deleteSet(supabase: Client, userId: string, setId: string): Promise<boolean> {
  const { data, error } = await supabase.from("sets").delete().eq("user_id", userId).eq("id", setId).select("id");

  if (error) {
    throw error;
  }
  return data.length > 0;
}

/** Change a workout's date and note (FR-006). Answers `null` when nothing was updated. */
export async function updateWorkout(
  supabase: Client,
  userId: string,
  workoutId: string,
  { performedOn, note }: UpdateWorkoutFields,
) {
  const { data, error } = await supabase
    .from("workouts")
    .update({ performed_on: performedOn, note })
    .eq("user_id", userId)
    .eq("id", workoutId)
    .select("id, performed_on, note, created_at");

  if (error) {
    throw error;
  }
  return data.length > 0 ? data[0] : null;
}

/**
 * Delete a workout with everything under it (FR-007).
 *
 * The cascade is declarative — `exercise_entries` and `sets` reference their parent's `(id, user_id)`
 * `on delete cascade` — so one statement removes all three levels and no orphan is possible.
 */
export async function deleteWorkout(supabase: Client, userId: string, workoutId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("workouts")
    .delete()
    .eq("user_id", userId)
    .eq("id", workoutId)
    .select("id");

  if (error) {
    throw error;
  }
  return data.length > 0;
}

/**
 * Remove one exercise from a workout, with its sets.
 *
 * Not named by any FR — added because deleting an entry's last set otherwise leaves a row on screen
 * that only deleting the whole workout could clear (owner decision, 2026-08-11).
 */
export async function deleteExerciseEntry(supabase: Client, userId: string, entryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("exercise_entries")
    .delete()
    .eq("user_id", userId)
    .eq("id", entryId)
    .select("id");

  if (error) {
    throw error;
  }
  return data.length > 0;
}

/**
 * One exercise entry, with the two ids an entry-level removal is expressed in.
 *
 * `personal_records` does not report which entry a record's set belongs to, and does not need to:
 * `unique (workout_id, exercise_id)` means an exercise appears at most once per workout, so the pair
 * identifies the entry exactly.
 */
export async function getEntry(supabase: Client, userId: string, entryId: string) {
  const { data, error } = await supabase
    .from("exercise_entries")
    .select("id, workout_id, exercise_id")
    .eq("user_id", userId)
    .eq("id", entryId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

/** The exercise ids logged in one workout — what a workout-level impact read has to cover. */
export async function exerciseIdsInWorkout(supabase: Client, userId: string, workoutId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("exercise_entries")
    .select("exercise_id")
    .eq("user_id", userId)
    .eq("workout_id", workoutId);

  if (error) {
    throw error;
  }
  return [...new Set(data.map((row) => row.exercise_id))];
}
