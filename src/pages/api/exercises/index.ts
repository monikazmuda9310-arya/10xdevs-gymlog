import type { APIRoute } from "astro";
import { parseCreateExercise } from "@/lib/validation/exercise-schemas";
import type { ExerciseMessageCode } from "@/lib/validation/exercise";
import { createExercise, UNIQUE_VIOLATION } from "@/lib/services/exercises";

export const prerender = false;

// This endpoint reads JSON, NOT formData(). That is a deliberate difference from
// src/pages/api/auth/*, which read form posts because plain HTML forms submit them; here the caller
// is a React island using fetch, so JSON is the honest shape. The F-03 note that "a JSON probe
// returns 500" applies to the auth endpoints only.
//
// The body carries a message CODE on failure, never prose — same rule as the auth pages.

const fail = (status: number, code: ExerciseMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async (context) => {
  // The middleware already resolved both and protects /exercises, but an endpoint is reachable
  // directly and must not lean on a page guard.
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
    // Malformed JSON is a caller error, not a server fault — and it must not surface as a 500,
    // which is indistinguishable from "Supabase is not configured".
    return fail(400, "name_required");
  }

  const parsed = parseCreateExercise(body);
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    const exercise = await createExercise(supabase, user.id, parsed.data);
    return new Response(JSON.stringify({ exercise }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      return fail(409, "duplicate_name");
    }
    // Anything unrecognised is logged server-side and shown as the generic message, so a provider
    // change stays diagnosable without its text reaching a caller.
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic, see above
    console.error("[exercises] unexpected insert failure", { code, error });
    return fail(500, "unexpected");
  }
};
