import type { APIRoute } from "astro";

import { createWorkout } from "@/lib/services/workouts";
import { parseCreateWorkout } from "@/lib/validation/workout-schemas";
import type { WorkoutMessageCode } from "@/lib/validation/workout";

export const prerender = false;

/** Failure bodies carry a CODE and nothing else — never provider prose, never the caller's words. */
const fail = (status: number, code: WorkoutMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const { supabase, user } = context.locals;

  // The middleware already protects /workouts, but an endpoint is reachable directly and must not
  // lean on a page guard. Reads the client the middleware built — never constructs a second one.
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
    return fail(400, "date_required");
  }

  const parsed = parseCreateWorkout(body);
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    const workout = await createWorkout(supabase, user.id, parsed.data);
    return new Response(JSON.stringify({ workout }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic; nothing reaches the caller
    console.error("[workouts] unexpected insert failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
