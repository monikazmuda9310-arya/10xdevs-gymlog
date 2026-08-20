import type { APIRoute } from "astro";

import { clearSessionCookies } from "@/lib/supabase";

const SIGN_IN_PAGE = "/auth/signin";

/**
 * End the session.
 *
 * **The result of `signOut()` is read, and that is the whole point of this route's shape.** It used
 * to be discarded. `@supabase/auth-js`'s `_signOut` has two early returns ahead of
 * `_removeSession()` — a session error, and any `admin.signOut()` failure that is not 404/401/403 —
 * and `_removeSession()` is the only thing that clears the cookie. So a provider hiccup left the
 * browser holding a live session while this route answered "signed out", and `src/middleware.ts`
 * then bounced the user off `/auth/signin` back to `/dashboard`. What that looks like is a UI
 * glitch; what it is, is an unended session on a shared machine — the exact failure US-04's third
 * criterion exists to prevent.
 *
 * **Failure does two things, and both are necessary.** It clears the jar, so the sign-out is TRUE
 * on this device and the middleware has no session left to bounce; and it names the outcome in the
 * destination, because a redirect-shaped endpoint answers `302` whether it worked or not — the
 * status cannot carry the difference and the destination can.
 *
 * **Two failure shapes.** `signOut()` resolves `{ error }` for an ordinary auth failure and
 * re-throws anything that is not an `AuthError`; `src/pages/api/account/index.ts` handles the same
 * pair for the same reason. Both land here.
 */
export const POST: APIRoute = async (context) => {
  // The middleware's client, not a second one — see signin.ts. Null when credentials are absent,
  // in which case there is no session to end and the plain redirect below is still the right answer.
  const { supabase } = context.locals;
  if (!supabase) {
    return context.redirect(SIGN_IN_PAGE);
  }

  let failure: unknown = null;
  try {
    const { error } = await supabase.auth.signOut();
    failure = error;
  } catch (error) {
    failure = error;
  }

  if (failure) {
    // The session did not end at the provider, so end it here. Anything less would report a
    // sign-out that did not happen.
    // **The result is read, not discarded** — which is the whole subject of this route. It answers
    // `[]` when credentials are absent AND when the request carried no matching cookie, so a log
    // asserting "cleared" without checking would be a claim the code never made.
    const cleared = clearSessionCookies(context.request.headers, context.cookies);
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic; nothing reaches the caller
    console.error("[auth/signout] the provider refused; ended this device's session instead", {
      cleared,
      error: failure,
    });
    // A message CODE, never prose: the page resolves it against AUTH_MESSAGES. Passing text through
    // the query string turns this page into a phishing kit (AGENTS.md § Architecture).
    return context.redirect(`${SIGN_IN_PAGE}?error=sign_out_failed`);
  }

  // Sign-in, not "/": returning must require authenticating again (US-04's third criterion).
  return context.redirect(SIGN_IN_PAGE);
};
