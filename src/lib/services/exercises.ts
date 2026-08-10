import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Exercise, MuscleGroup } from "@/types";

// The one place that knows how to read and write the catalogue, so a page and an endpoint cannot
// drift in how they query it (AGENTS.md § Conventions puts business logic here).
//
// Every function takes an already-built client. Never build one here: the middleware puts a
// request-scoped client on `context.locals.supabase`, and constructing a second is waste under the
// Workers Free 10 ms CPU cap plus a duplicate copy of cookie plumbing that is easy to get subtly
// wrong — the rule S-01's implementation review established.

type Client = SupabaseClient<Database>;

export interface ListExercisesOptions {
  /** Case-insensitive substring match on the name. Empty or absent means no name filter. */
  search?: string;
  muscleGroup?: MuscleGroup;
}

/**
 * `%`, `_` and `\` are wildcards to LIKE. Without escaping, a user searching for "100%" would match
 * everything beginning with "100", and a search for "_" would match every single-character name.
 * Escaped, they mean what the person typing them meant.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The caller's visible catalogue: the seeded rows plus their own, never anybody else's.
 *
 * The RLS policy is what *guarantees* that; the `user_id` filter below is the index path. Carrying
 * both is required by AGENTS.md § Access control — without the explicit filter every read leans on
 * the policy predicate to do the filtering, which is the full-scan trap under the CPU cap.
 */
export async function listExercises(
  supabase: Client,
  userId: string,
  { search, muscleGroup }: ListExercisesOptions = {},
): Promise<Exercise[]> {
  let query = supabase.from("exercises").select("*").or(`user_id.is.null,user_id.eq.${userId}`);

  if (muscleGroup) {
    query = query.eq("muscle_group", muscleGroup);
  }

  const trimmed = search?.trim();
  if (trimmed) {
    query = query.ilike("name", `%${escapeLikePattern(trimmed)}%`);
  }

  const { data, error } = await query.order("name");
  if (error) {
    throw error;
  }
  return data;
}

export interface CreateExerciseFields {
  name: string;
  muscleGroup: MuscleGroup;
  isBodyweight: boolean;
}

/**
 * Insert an exercise owned by `userId`.
 *
 * `user_id` is always the caller's — never null, never taken from the request body. The policy
 * would refuse anything else anyway (a null owner fails `auth.uid() = user_id`, which is what keeps
 * the seeded catalogue read-only), but passing it explicitly means the intent is visible here
 * rather than resting on a database rule three files away.
 */
export async function createExercise(
  supabase: Client,
  userId: string,
  { name, muscleGroup, isBodyweight }: CreateExerciseFields,
): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .insert({ user_id: userId, name, muscle_group: muscleGroup, is_bodyweight: isBodyweight })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

/** Postgres unique-violation. The partial index on (user_id, lower(name)) raises it. */
export const UNIQUE_VIOLATION = "23505";
