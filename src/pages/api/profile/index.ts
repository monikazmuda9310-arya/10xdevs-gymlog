import type { APIRoute } from "astro";

import { updateProfile } from "@/lib/services/profiles";
import { parseUpdateProfile } from "@/lib/validation/profile-schemas";
import type { ProfileMessageCode } from "@/lib/validation/profile";

export const prerender = false;

/** Failure bodies carry a CODE and nothing else — never provider prose, never the caller's words. */
const fail = (status: number, code: ProfileMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

/**
 * Replace the signed-in account's three preferences.
 *
 * **This route deliberately does not reuse `../_shared/mutation-route.ts`.** That helper's main job
 * is validating a `[id]` route param before it can reach a uuid column and surface a `22P02` as a
 * 500 — and this route has no id. The row it writes is named by `locals.user.id` and by nothing
 * else, which is the whole of its access control: there is no parameter a caller could aim at
 * somebody else's row. The short preamble below is that difference, not duplication.
 */
export const PATCH: APIRoute = async (context) => {
  const { supabase, user } = context.locals;

  // The middleware protects `/settings`, but an endpoint is reachable directly and must not lean on
  // a page guard. Reads the client the middleware built — never constructs a second one.
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
    // An unparseable body has no timezone in it, which is the first thing the schema would say.
    return fail(400, "timezone_required");
  }

  const parsed = parseUpdateProfile(body);
  if (!parsed.success) {
    return fail(400, parsed.code);
  }

  try {
    const profile = await updateProfile(supabase, user.id, parsed.data);
    // Zero rows is a SUCCESS under RLS, so the 404 is built here rather than reported by Postgres.
    // A real caller cannot reach it — a trigger creates a profile for every account and there is no
    // delete path — but answering 200 to an update that touched nothing would be a lie either way.
    if (!profile) {
      return fail(404, "profile_not_found");
    }
    return new Response(JSON.stringify({ profile }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic; nothing reaches the caller
    console.error("[profile] unexpected update failure", { code: (error as { code?: string }).code, error });
    return fail(500, "unexpected");
  }
};
