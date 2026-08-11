import type { APIRoute } from "astro";

import { deleteSet, getSetForEdit, updateSet } from "@/lib/services/workouts";
import { parseUpdateSet } from "@/lib/validation/workout-schemas";
import { isWeightAllowed } from "@/lib/validation/workout";
import { fail, isResponse, noContent, ok, readBody, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * Correct or remove one set (FR-010).
 *
 * Neither handler recomputes a record. Records are derived from the sets that survive, so the next
 * read of `/records` simply returns a different row — there is nothing stored to patch. The warning
 * the user saw before confirming came from `./impact`.
 */
export const PATCH: APIRoute = async (context) => {
  const resolved = resolve(context, "set_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  const parsed = parseUpdateSet(await readBody(context));
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    // Loaded before the update for the same reason `/api/sets` loads the entry: this is where the
    // bodyweight rule's answer lives, and it lives in another table.
    const existing = await getSetForEdit(supabase, userId, id);
    if (!existing) {
      return fail(404, "set_not_found");
    }

    // FR-014, third caller of the one definition. Editing a barbell lift down to 0 is the same typo
    // as logging it at 0, and must be refused in the same words.
    //
    // The embed is reached without an optional chain because it cannot be absent: it resolves
    // through the composite ownership key, which is `not null` on both columns, and the generated
    // types say so. A guard here would be dead code that reads as diligence.
    if (!isWeightAllowed(parsed.data.weight, existing.exercise_entries.exercises.is_bodyweight)) {
      return fail(400, "weight_needs_bodyweight");
    }

    const set = await updateSet(supabase, userId, id, parsed.data);
    if (!set) {
      return fail(404, "set_not_found");
    }
    return ok({ set });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[sets/:id] unexpected update failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};

export const DELETE: APIRoute = async (context) => {
  const resolved = resolve(context, "set_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    // **404, never 204, when nothing was deleted.** Under RLS a delete naming another account's row
    // matches zero rows and reports success; answering 204 there would tell one account it had just
    // removed another's data.
    return (await deleteSet(supabase, userId, id)) ? noContent() : fail(404, "set_not_found");
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[sets/:id] unexpected delete failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
