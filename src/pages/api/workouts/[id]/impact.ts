import type { APIRoute } from "astro";

import { impactOf } from "@/lib/services/records";
import { exerciseIdsInWorkout, getWorkout } from "@/lib/services/workouts";
import { fail, isResponse, ok, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * What deleting this whole workout would cost.
 *
 * The only operation here that can take several records with one click, so the answer covers every
 * exercise the workout touches. It is also the case a two-row "top two" query could not have
 * answered: a workout can hold the leader **and** the runner-up for the same exercise, and the
 * record then falls to the third-best.
 */
export const GET: APIRoute = async (context) => {
  const resolved = resolve(context, "workout_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    // Existence and ownership in one read, and the same answer for "absent" and "somebody else's".
    const workout = await getWorkout(supabase, userId, id);
    if (!workout) {
      return fail(404, "workout_not_found");
    }

    const exerciseIds = await exerciseIdsInWorkout(supabase, userId, id);
    return ok({ impact: await impactOf(supabase, userId, exerciseIds, { level: "workout", workoutId: id }) });
  } catch (error) {
    // Never `{ impact: [] }` on failure — see `sets/[id]/impact.ts`.
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[workouts/:id/impact] could not determine the impact", {
      code: (error as { code?: string }).code,
      error,
    });
    return fail(503, "impact_unavailable");
  }
};
