import type { APIRoute } from "astro";

import { getProfile } from "@/lib/services/profiles";
import { addSet, getEntryForSet } from "@/lib/services/workouts";
import { parseAddSet } from "@/lib/validation/workout-schemas";
import { isWeightAllowed, type WorkoutMessageCode } from "@/lib/validation/workout";

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
    return fail(400, "reps_required");
  }

  const parsed = parseAddSet(body);
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    // Scoped by user_id, so another account's entry reads as absent — same answer as "does not
    // exist", which is what keeps this from telling one account about another's ids.
    const entry = await getEntryForSet(supabase, user.id, parsed.data.exerciseEntryId);
    if (!entry) {
      return fail(404, "entry_not_found");
    }

    // The bodyweight rule (FR-014). It cannot be a check constraint — the answer lives in
    // `exercises.is_bodyweight`, a different table — so it is enforced here, where the entry has
    // already been loaded to verify ownership. The form pre-checks with the same predicate.
    if (!isWeightAllowed(parsed.data.weight, entry.exercises.is_bodyweight)) {
      return fail(400, "weight_needs_bodyweight");
    }

    // **The unit is not in the request body.** A client that could name it could store `100` marked
    // as pounds while the user typed kilograms, and the generated `weight_kg` would then be wrong
    // for every derived number built on it. It comes from the account's own profile.
    const profile = await getProfile(supabase, user.id);
    if (!profile) {
      return fail(500, "unexpected");
    }

    const set = await addSet(supabase, user.id, entry.id, {
      reps: parsed.data.reps,
      weight: parsed.data.weight,
      weightUnit: profile.weight_unit,
      rpe: parsed.data.rpe,
    });

    return new Response(JSON.stringify({ set }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[sets] unexpected insert failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
