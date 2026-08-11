import type { APIRoute } from "astro";

import { deleteWorkout, updateWorkout } from "@/lib/services/workouts";
import { parseUpdateWorkout } from "@/lib/validation/workout-schemas";
import { fail, isResponse, noContent, ok, readBody, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * Change a workout's date and note (FR-006).
 *
 * Moving a session across a Monday changes which training week its sets belong to — and there is
 * nothing to recompute, because no weekly figure is stored anywhere. The next read simply groups it
 * differently. `tests/integration/record-impact.test.ts` assertion 9 proves that rather than
 * assuming it.
 */
export const PATCH: APIRoute = async (context) => {
  const resolved = resolve(context, "workout_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  const parsed = parseUpdateWorkout(await readBody(context));
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    const workout = await updateWorkout(supabase, userId, id, parsed.data);
    return workout ? ok({ workout }) : fail(404, "workout_not_found");
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[workouts/:id] unexpected update failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};

/**
 * Delete a workout with every exercise entry and set beneath it (FR-007).
 *
 * The cascade is declarative, so this is one statement and no orphan is possible. It is also the
 * only operation in the product that can take several records at once, which is why `./impact`
 * answers about every exercise the workout touches rather than one.
 */
export const DELETE: APIRoute = async (context) => {
  const resolved = resolve(context, "workout_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    // 404, never 204, when nothing was deleted — see the note in `sets/[id]/index.ts`.
    return (await deleteWorkout(supabase, userId, id)) ? noContent() : fail(404, "workout_not_found");
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[workouts/:id] unexpected delete failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
