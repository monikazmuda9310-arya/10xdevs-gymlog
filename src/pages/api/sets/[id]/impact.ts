import type { APIRoute } from "astro";

import { impactOf } from "@/lib/services/records";
import { getSetForEdit } from "@/lib/services/workouts";
import { fail, isResponse, ok, resolve } from "@/pages/api/_shared/mutation-route";

export const prerender = false;

/**
 * What editing or deleting this set would cost — the warning US-02 requires before confirmation.
 *
 * The same answer serves both actions. For a deletion it is exact: the set stops counting and the
 * record falls to what survives. For an edit it is the value the record falls to **if** the change
 * takes the record off this set — which is the only figure available without computing the set's new
 * estimate in float64 and comparing it against one Postgres produced in exact `numeric`, the single
 * comparison this project forbids. The screen states it conditionally; see the dialog.
 */
export const GET: APIRoute = async (context) => {
  const resolved = resolve(context, "set_not_found");
  if (isResponse(resolved)) {
    return resolved;
  }
  const { supabase, userId, id } = resolved;

  try {
    const set = await getSetForEdit(supabase, userId, id);
    if (!set) {
      return fail(404, "set_not_found");
    }

    // No optional chain: the embed resolves through the composite ownership key, whose columns are
    // both `not null`, so it cannot be absent for a set this account owns.
    const exerciseId = set.exercise_entries.exercise_id;

    return ok({ impact: await impactOf(supabase, userId, [exerciseId], { level: "set", setId: id }) });
  } catch (error) {
    // **Never `{ impact: [] }` on failure.** An empty list is a positive claim — "no record is at
    // stake" — and answering it here would reassure the user at the exact moment we cannot know.
    // The action stays available; the dialog says the consequence is unknown.
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[sets/:id/impact] could not determine the impact", {
      code: (error as { code?: string }).code,
      error,
    });
    return fail(503, "impact_unavailable");
  }
};
