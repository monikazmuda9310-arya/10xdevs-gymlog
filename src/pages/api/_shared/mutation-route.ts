/**
 * The preamble every S-05 resource route repeats, written once.
 *
 * Underscore-prefixed so Astro does not route it: `src/pages/api/_shared/` is a module directory,
 * not an endpoint. The three POST endpoints from S-03 are deliberately NOT refactored onto this —
 * they are pinned by assertions that would have to move with them, and this slice's job is to add
 * operations, not to churn the ones that work.
 */

import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { UUID_PATTERN, type WorkoutMessageCode } from "@/lib/validation/workout";

/** Failure bodies carry a CODE and nothing else — never provider prose, never the caller's words. */
export const fail = (status: number, code: WorkoutMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

export const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 204 carries no body by definition, so it cannot be confused with an empty result. */
export const noContent = () => new Response(null, { status: 204 });

interface Resolved {
  supabase: SupabaseClient<Database>;
  userId: string;
  id: string;
}

/**
 * Signed in, configured, and given a well-formed id — or the response to send instead.
 *
 * **The uuid check is not belt-and-braces.** Postgres answers `22P02` for a uuid column handed
 * something that is not one, which would surface as a 500 for what is really "no such row" — and a
 * 500 is a different fact about the system than a 404. The malformed id never reaches a query.
 *
 * The middleware already protects `/workouts`, but an API route is reachable directly and must not
 * lean on a page guard. Reads the client the middleware built rather than constructing a second one.
 */
export function resolve(context: APIContext, notFound: WorkoutMessageCode): Resolved | Response {
  const { supabase, user } = context.locals;

  if (!supabase) {
    return fail(500, "not_configured");
  }
  if (!user) {
    return fail(401, "unauthenticated");
  }

  const id = context.params.id ?? "";
  if (!UUID_PATTERN.test(id)) {
    return fail(404, notFound);
  }

  return { supabase, userId: user.id, id };
}

export const isResponse = (value: Resolved | Response): value is Response => value instanceof Response;

/** JSON body, or `{}` — the parse failure is left to the schema so the caller gets a code. */
export async function readBody(context: APIContext): Promise<unknown> {
  try {
    return await context.request.json();
  } catch {
    return {};
  }
}
