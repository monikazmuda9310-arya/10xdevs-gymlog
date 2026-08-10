import type { APIRoute } from "astro";

export const POST: APIRoute = async (context) => {
  // The middleware's client, not a second one — see signin.ts. Null when credentials are absent,
  // in which case there is no session to end and the redirect below is still the right answer.
  const { supabase } = context.locals;
  if (supabase) {
    await supabase.auth.signOut();
  }
  // Sign-in, not "/": returning must require authenticating again (US-04's third criterion).
  return context.redirect("/auth/signin");
};
