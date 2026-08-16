/**
 * The slice of `APIContext` that `src/middleware.ts` actually reads, plus a record of what it wrote.
 *
 * **THE SEAM, NAMED.** What is REAL here — and therefore what these suites can claim to have
 * tested — is: the `Cookie` header parse (`parseCookieHeader` inside `src/lib/supabase.ts`),
 * `createServerClient`, the `auth.getUser()` round trip to the real auth server, the derivation onto
 * `locals`, and both route arrays. What is DOUBLED is `AstroCookies` and `context.redirect`, because
 * `astro`'s package exports do not expose either as a constructible thing (no `./dist/*` export), and
 * neither carries product behaviour: `redirect` builds a 302 and `cookies.set` collects what
 * `@supabase/ssr`'s `setAll` handed it. Nothing about the identity decision passes through either.
 *
 * Underscore-prefixed directory so it cannot be mistaken for a suite; the include glob is
 * `tests/middleware/**\/*.test.ts`, which this file deliberately does not match.
 */

import type { APIContext, AstroCookies, MiddlewareNext } from "astro";

/** One `cookies.set(name, value, options)` call, in the order the middleware made it. */
export interface WrittenCookie {
  name: string;
  value: string;
  options: Record<string, unknown> | undefined;
}

export interface MiddlewareHarness {
  /** Pass this to `onRequest` as its first argument; read `context.locals` back afterwards. */
  context: APIContext;
  /** Pass this as its second. */
  next: MiddlewareNext;
  /** What `next()` resolves to, so a test can tell "rendered" from "redirected" by identity. */
  nextResponse: Response;
  /**
   * The pathname of every request that reached `next()`. Empty means the middleware answered
   * without ever handing the request on — "redirected" and "rendered then redirected" are different
   * facts about the system and only this distinguishes them.
   */
  reachedNext: string[];
  /** Every cookie `@supabase/ssr`'s `setAll` wrote, via the doubled `AstroCookies`. */
  cookiesWritten: WrittenCookie[];
  /** Every path `context.redirect` was called with. `onRequest` calls it at most once. */
  redirectedTo: string[];
}

export interface MiddlewareRequest {
  /** Absolute, e.g. `http://localhost/dashboard` — `context.url.pathname` is what is matched. */
  url: string;
  /** A real `Cookie` header. Omit for the absent-cookie case; do not pass `""` to mean that. */
  cookieHeader?: string;
}

/** The `AstroCookies` methods nothing under test calls. Reached = the seam moved; say so loudly. */
function notDoubled(method: string): never {
  throw new Error(
    `AstroCookies.${method}() was called, and this double only implements set(). The middleware ` +
      `reads cookies through the request's Cookie header, not through AstroCookies — if that has ` +
      `changed, the double has to grow with it rather than silently answering undefined.`,
  );
}

export function middlewareContext({ url, cookieHeader }: MiddlewareRequest): MiddlewareHarness {
  const parsed = new URL(url);
  const reachedNext: string[] = [];
  const cookiesWritten: WrittenCookie[] = [];
  const redirectedTo: string[] = [];

  const nextResponse = new Response("next() was reached", {
    status: 200,
    headers: { "x-middleware": "next" },
  });

  const cookies = {
    set(name: string, value: string, options?: Record<string, unknown>) {
      cookiesWritten.push({ name, value, options });
    },
    get: () => notDoubled("get"),
    has: () => notDoubled("has"),
    delete: () => notDoubled("delete"),
  } as unknown as AstroCookies;

  const request = new Request(url, {
    // A real Request with a real Cookie header: the parse under test is `parseCookieHeader`'s.
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  });

  const context = {
    request,
    url: parsed,
    cookies,
    locals: {} as App.Locals,
    params: {},
    redirect(path: string) {
      redirectedTo.push(path);
      return new Response(null, { status: 302, headers: { Location: path } });
    },
  } as unknown as APIContext;

  const next: MiddlewareNext = () => {
    reachedNext.push(parsed.pathname);
    return Promise.resolve(nextResponse);
  };

  return { context, next, nextResponse, reachedNext, cookiesWritten, redirectedTo };
}
