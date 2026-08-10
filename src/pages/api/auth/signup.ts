import type { APIRoute } from "astro";
import { parseSignUpForm } from "@/lib/validation/auth-schemas";
import { neutralAuthCode } from "@/lib/validation/auth-errors";
import { signUpDestination } from "@/lib/validation/auth-outcomes";
import type { AuthMessageCode } from "@/lib/validation/auth";

const SIGN_UP_PAGE = "/auth/signup";

// A code, never text — see signin.ts.
const back = (context: Parameters<APIRoute>[0], code: AuthMessageCode) =>
  context.redirect(`${SIGN_UP_PAGE}?error=${code}`);

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  const parsed = parseSignUpForm(form);
  if (!parsed.success) {
    return back(context, parsed.code);
  }

  // The middleware's client, not a second one — see signin.ts.
  const { supabase } = context.locals;
  if (!supabase) {
    return back(context, "not_configured");
  }

  const { email, password } = parsed.data;
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return back(context, neutralAuthCode("signup", error));
  }

  // Three outcomes, the third being the two above split by what the provider actually returned.
  // The decision lives in signUpDestination so it can be unit-tested; see the reasoning there,
  // including why an already-registered address and a genuine new signup share a destination.
  return context.redirect(signUpDestination(data));
};
