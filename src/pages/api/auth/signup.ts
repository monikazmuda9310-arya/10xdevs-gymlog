import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseSignUpForm } from "@/lib/validation/auth-schemas";
import { neutralAuthMessage } from "@/lib/validation/auth-errors";

const SIGN_UP_PAGE = "/auth/signup";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  const parsed = parseSignUpForm(form);
  if (!parsed.success) {
    return context.redirect(`${SIGN_UP_PAGE}?error=${encodeURIComponent(parsed.message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${SIGN_UP_PAGE}?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { email, password } = parsed.data;
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`${SIGN_UP_PAGE}?error=${encodeURIComponent(neutralAuthMessage("signup", error))}`);
  }

  // Three outcomes, and the branch reads the *actual* result rather than a build flag or an env
  // var — both of which can disagree with what the Supabase project is set to right now.
  //
  // A session means email confirmation is off: the account is usable immediately.
  if (data.session) {
    return context.redirect("/dashboard");
  }

  // No session and no error means a confirmation email is on its way. With confirmation on, this
  // is ALSO what an already-registered address produces: Supabase deliberately refuses to say the
  // address is taken and returns an obfuscated user with no session. Sending both cases here is
  // not a bug to fix later — it is the anti-enumeration property, granted by the provider.
  return context.redirect("/auth/confirm-email");
};
