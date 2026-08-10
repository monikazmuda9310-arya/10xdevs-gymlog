import type { APIRoute } from "astro";

import { FOREIGN_KEY_VIOLATION, addExerciseEntry } from "@/lib/services/workouts";
import { parseAddExerciseEntry } from "@/lib/validation/workout-schemas";
import type { WorkoutMessageCode } from "@/lib/validation/workout";

export const prerender = false;

const fail = (status: number, code: WorkoutMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const { supabase, user } = context.locals;

  if (!supabase) {
    return fail(500, "not_configured");
  }
  if (!user) {
    return fail(401, "unauthenticated");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return fail(400, "exercise_required");
  }

  const parsed = parseAddExerciseEntry(body);
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    const { entry, created } = await addExerciseEntry(supabase, user.id, parsed.data.workoutId, parsed.data.exerciseId);
    // 200 rather than 201 when the exercise was already in the workout: the caller gets the entry
    // it asked for either way, and the status says which of the two happened.
    return new Response(JSON.stringify({ entry, created }), {
      status: created ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;

    // A workout belonging to another account is refused by the composite ownership key, and an
    // exercise that does not exist by the plain one. Both answer "not found" — the same answer for
    // "absent" and "somebody else's", so this endpoint is not an existence oracle.
    if (code === FOREIGN_KEY_VIOLATION) {
      return fail(404, "workout_not_found");
    }

    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[exercise-entries] unexpected insert failure", { code, error });
    return fail(500, "unexpected");
  }
};
