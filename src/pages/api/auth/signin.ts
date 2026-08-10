import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseSignInForm } from "@/lib/validation/auth-schemas";
import { neutralAuthMessage } from "@/lib/validation/auth-errors";

const SIGN_IN_PAGE = "/auth/signin";

// The forms post application/x-www-form-urlencoded, so this reads formData(), not JSON. A JSON
// probe fails to parse and returns 500, which looks exactly like "Supabase is not configured" and
// is not that (recorded during F-03).
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  const parsed = parseSignInForm(form);
  if (!parsed.success) {
    return context.redirect(`${SIGN_IN_PAGE}?error=${encodeURIComponent(parsed.message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${SIGN_IN_PAGE}?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return context.redirect(`${SIGN_IN_PAGE}?error=${encodeURIComponent(neutralAuthMessage("signin", error))}`);
  }

  return context.redirect("/dashboard");
};
