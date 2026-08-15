import type { APIRoute } from "astro";

import { accountDeletionFailureCode, deleteOwnAccount } from "@/lib/services/accounts";
import type { AccountMessageCode } from "@/lib/validation/account";

export const prerender = false;

/** Failure bodies carry a CODE and nothing else — never provider prose, never the caller's words. */
const fail = (status: number, code: AccountMessageCode) =>
  new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });

/**
 * Delete the signed-in account and everything hanging off it.
 *
 * **No route parameter, and that is the whole of the access control.** Like `../profile/index.ts`,
 * this route does not reuse `../_shared/mutation-route.ts`: that helper exists to validate a `[id]`
 * before it reaches a uuid column, and there is no id here. The account deleted is named by
 * `auth.uid()` INSIDE the database function — not even by `locals.user.id` — so there is nothing a
 * caller could aim at somebody else's account, at this layer or any other.
 *
 * **The sign-out has to happen in THIS request.** `@supabase/ssr` writes its cookie changes onto the
 * response of the request that triggered them, so a caller left to sign out afterwards would keep a
 * cookie for an account that no longer exists — and every subsequent page would pay a failing round
 * trip to the auth server without anything on screen saying why. `signOut()` is safe here: GoTrue
 * tolerates 404/401/403 from `/logout` ("the user might not exist anymore") and clears the session
 * regardless.
 *
 * **It answers JSON, never a redirect.** The caller is a hydrated island doing `fetch`, which would
 * follow a redirect itself and leave the browser where it was.
 */
export const DELETE: APIRoute = async (context) => {
  const { supabase, user } = context.locals;

  // The middleware protects `/settings`, but an endpoint is reachable directly and must not lean on
  // a page guard. Reads the client the middleware built — never constructs a second one.
  if (!supabase) {
    return fail(500, "not_configured");
  }
  if (!user) {
    return fail(401, "unauthenticated");
  }

  const { error } = await deleteOwnAccount(supabase);

  if (error) {
    const code = accountDeletionFailureCode(error);
    if (code === "unexpected") {
      // eslint-disable-next-line no-console -- deliberate server-side diagnostic; nothing reaches the caller
      console.error("[account] unexpected deletion failure", { code: error.code, error });
    }
    // 409 for the blocked case: the request was well-formed and the state refused it, which is what
    // Postgres and PostgREST both call a conflict. The deletion runs in one transaction, so in either
    // branch NOTHING was deleted — the message says so, because a user who fears a half-deleted
    // account has no other way to find out.
    return fail(code === "account_delete_blocked" ? 409 : 500, code);
  }

  // **The try/catch is load-bearing, not defensive habit.** `signOut()` resolves `{ error }` for an
  // ordinary auth failure but RE-THROWS anything that is not an `AuthError`. Left unguarded, such a
  // throw escapes this handler after the deletion has already committed: Astro answers a generic
  // HTML 500, the panel's `response.json()` fails, and the user is told the deletion did not happen —
  // about an account that no longer exists. That is the one lie this endpoint must never tell.
  try {
    const signOut = await supabase.auth.signOut();
    if (signOut.error) {
      // Not a failure of the deletion — the account is genuinely gone, so the caller is still told
      // success. Logged because nothing else would notice a browser left holding a dead cookie.
      // eslint-disable-next-line no-console -- deliberate server-side diagnostic
      console.error("[account] deleted, but the session could not be ended", { error: signOut.error });
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic
    console.error("[account] deleted, but signOut threw", { error });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
