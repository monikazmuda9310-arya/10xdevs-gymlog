import type { APIRoute } from "astro";
import { parseSignInForm } from "@/lib/validation/auth-schemas";
import { neutralAuthCode } from "@/lib/validation/auth-errors";
import type { AuthMessageCode } from "@/lib/validation/auth";

const SIGN_IN_PAGE = "/auth/signin";

// The query string carries a message CODE, never message text: the page resolves it against
// AUTH_MESSAGES. A redirect that passes prose lets anyone craft a link that puts words in the
// application's mouth.
const back = (context: Parameters<APIRoute>[0], code: AuthMessageCode) =>
  context.redirect(`${SIGN_IN_PAGE}?error=${code}`);

// The forms post application/x-www-form-urlencoded, so this reads formData(), not JSON. A JSON
// probe fails to parse and returns 500, which looks exactly like "Supabase is not configured" and
// is not that (recorded during F-03).
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  const parsed = parseSignInForm(form);
  if (!parsed.success) {
    return back(context, parsed.code);
  }

  // The middleware already built a request-scoped client and put it here; building a second one is
  // waste under the Workers Free 10 ms CPU cap and duplicates cookie plumbing that is easy to get
  // subtly wrong (src/middleware.ts). Null in exactly the same conditions — absent credentials, the
  // documented silent-failure mode (AGENTS.md § Cloudflare traps) — so this branch is unchanged.
  const { supabase } = context.locals;
  if (!supabase) {
    return back(context, "not_configured");
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return back(context, neutralAuthCode("signin", error));
  }

  return context.redirect("/dashboard");
};
