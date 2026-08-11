import type { APIRoute } from "astro";

import { impactOf } from "@/lib/services/records";
import { getEntry } from "@/lib/services/workouts";
import { fail, isResponse, ok, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * What removing this exercise from this workout would cost.
 *
 * Scoped to the one exercise, but it removes **every set of it in this workout** — so, like the
 * workout-level answer and unlike a single set, it can take the leader and the runner-up together.
 */
export const GET: APIRoute = async (context) => {
  const resolved = resolve(context, "entry_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    const entry = await getEntry(supabase, userId, id);
    if (!entry) {
      return fail(404, "entry_not_found");
    }

    const impact = await impactOf(supabase, userId, [entry.exercise_id], {
      level: "entry",
      exerciseEntryId: entry.id,
      workoutId: entry.workout_id,
      exerciseId: entry.exercise_id,
    });
    return ok({ impact });
  } catch (error) {
    // Never `{ impact: [] }` on failure — see `sets/[id]/impact.ts`.
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[exercise-entries/:id/impact] could not determine the impact", {
      code: (error as { code?: string }).code,
      error,
    });
    return fail(503, "impact_unavailable");
  }
};
