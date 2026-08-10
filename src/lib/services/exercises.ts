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

/**
 * **Both options are currently unused by the application**, and that is worth stating rather than
 * leaving a reader to discover it. `/exercises` renders the whole catalogue and filters it in the
 * browser (tens of rows; a request per keystroke would be slower and would spend CPU the free plan
 * caps at 10 ms), so the only caller passes no options at all.
 *
 * They stay because S-03 needs the server-side path: an exercise picker inside a workout form
 * queries rather than rendering the catalogue whole. The unit tests around `escapeLikePattern`
 * therefore prove the escaping is correct — **not** that a live search path works, since nothing
 * exercises one yet.
 */
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `.or()` takes a filter EXPRESSION, not a value — `,` separates terms and `.` separates operator
 * parts — so anything interpolated into it is syntax, not data. Everywhere else in this file the
 * value is passed as an argument (`.eq("muscle_group", muscleGroup)`) and PostgREST encodes it;
 * this is the one place that cannot, because `or` has no argument form.
 *
 * Today the value is a Supabase user id from a verified JWT, so it cannot be influenced, and RLS
 * constrains the rows regardless of what this filter says. The guard is here for the next reader:
 * **if you copy this line for a value that is not a JWT claim, it is an injection.** Failing loudly
 * on an unexpected shape is cheaper than the alternative of nobody noticing.
 */
export function assertUserId(userId: string): string {
  if (!UUID.test(userId)) {
    throw new Error("listExercises: userId is not a UUID; refusing to interpolate it into a filter");
  }
  return userId;
}

/**
 * The caller's visible catalogue: the seeded rows plus their own, never anybody else's.
 *
 * The RLS policy is what *guarantees* that; the `user_id` filter below is the index path. Carrying
 * both is required by AGENTS.md § Access control — without the explicit filter every read leans on
 * the policy predicate to do the filtering, which is the full-scan trap under the CPU cap.
 *
 * **Deliberately unbounded**, and the threshold is worth knowing: the caller renders every row it
 * gets, so the page grows with the catalogue. Correct at 38 seeded rows plus a handful of custom
 * ones — pagination would add a request per page to a list a person can scroll. Somewhere in the
 * low hundreds it stops being correct, and S-03 will run this on a hotter path.
 */
export async function listExercises(
  supabase: Client,
  userId: string,
  { search, muscleGroup }: ListExercisesOptions = {},
): Promise<Exercise[]> {
  let query = supabase
    .from("exercises")
    .select("*")
    .or(`user_id.is.null,user_id.eq.${assertUserId(userId)}`);

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
