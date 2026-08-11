import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// Route protection lives here, in one place, not in per-page checks (AGENTS.md § Auth wiring).
// `/workouts` covers `/workouts/<id>` too — the check below is a prefix match, so training data is
// behind authentication at every depth from one array entry.
const PROTECTED_ROUTES = ["/dashboard", "/exercises", "/workouts"];

// The mirror image of PROTECTED_ROUTES: a signed-in visitor has no business staring at a login
// form. `/auth/confirm-email` is deliberately absent, and the reason is checkable rather than
// precautionary — with confirmation on, `signUp` returns no session, so somebody who has just
// signed up is not authenticated and this guard would never fire on them anyway. Excluding it
// costs nothing today and keeps the page reachable if that ever changes; bouncing someone off the
// page that explains what to do next would be actively unhelpful.
const AUTH_ROUTES = ["/auth/signin", "/auth/signup"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  // Hand the client on rather than building a second one per page: the cookie plumbing is easy to
  // get subtly wrong, and a duplicate construction is waste under the Workers Free 10 ms CPU cap.
  context.locals.supabase = supabase;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (context.locals.user && AUTH_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    return context.redirect("/dashboard");
  }

  return next();
});
