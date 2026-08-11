import type { APIRoute } from "astro";

import { deleteExerciseEntry } from "@/lib/services/workouts";
import { fail, isResponse, noContent, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * Remove one exercise from a workout, with its sets.
 *
 * Named by no FR, and added deliberately (owner, 2026-08-11): without it, deleting an entry's last
 * set leaves a row on screen that only deleting the whole workout could clear — the same
 * "uncorrectable" shape this slice exists to remove, one level down.
 *
 * There is no PATCH here on purpose. Changing which exercise an entry points at is removing it and
 * picking another, with no extra surface and no question about what happens to the sets underneath.
 */
export const DELETE: APIRoute = async (context) => {
  const resolved = resolve(context, "entry_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    // 404, never 204, when nothing was deleted — see the note in `sets/[id]/index.ts`.
    return (await deleteExerciseEntry(supabase, userId, id)) ? noContent() : fail(404, "entry_not_found");
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[exercise-entries/:id] unexpected delete failure", {
      code: (error as { code?: string }).code,
      error,
    });
    return fail(500, "unexpected");
  }
};
