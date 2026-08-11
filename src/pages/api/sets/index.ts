import type { APIRoute } from "astro";

import { getProfile } from "@/lib/services/profiles";
import { topTwoEstimatesForExercise } from "@/lib/services/records";
import { verdictForSet, type RecordAnnouncement } from "@/lib/services/records-verdict";
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

    // FR-020: the record verdict arrives with the save, on the set that earned it.
    //
    // **Its own try/catch, and never a non-2xx.** The set is already committed by the time this
    // runs, so a failed verdict must cost the badge and nothing else. Reporting an error for a set
    // that IS in the database would invite the retry `AddSetForm` deliberately makes easy — and a
    // retry after a successful write logs the same set twice, inflating tonnage and inventing a
    // record nobody performed. A missing badge is recoverable by reloading; a duplicated set is not.
    let record: RecordAnnouncement | null = null;
    try {
      // The exercise id is already in hand: the ownership read above loaded it to answer the
      // bodyweight question, so the verdict costs one query rather than two.
      const topTwo = await topTwoEstimatesForExercise(supabase, user.id, entry.exercises.id);
      const verdict = verdictForSet(topTwo, set.id);
      // `baseline` and `none` collapse to null on the wire, deliberately: the screen renders
      // nothing for either, and shipping the distinction would invite an announcement on the
      // first-ever set, which US-02 forbids. The distinction stays where it is testable.
      record = verdict.kind === "record" ? { previousBest: verdict.previousBest } : null;
    } catch (error) {
      // eslint-disable-next-line no-console -- deliberate server-side diagnostic
      console.error("[sets] record verdict failed after a successful insert", {
        code: (error as { code?: string }).code,
        error,
      });
    }

    return new Response(JSON.stringify({ set, record }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[sets] unexpected insert failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
