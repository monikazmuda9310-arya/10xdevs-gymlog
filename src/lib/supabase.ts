import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

/**
 * The cookie attributes this project's session cookies are written with — **one definition, handed
 * to both the client that SETS them and the function below that CLEARS them.**
 *
 * A browser only drops a cookie when the clearing `Set-Cookie` matches the original on `path` (and
 * on `domain`), so the two must agree or a sign-out leaves the session in the jar. They used to
 * agree **by coincidence**: the clear hardcoded `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS` while
 * `createServerClient` was passed nothing, so the library filled in the same values independently.
 * The edit that would have broken it is somebody passing `cookieOptions` here for an ordinary
 * reason — `httpOnly: true`, a shorter lifetime — after which the clear no longer matched.
 *
 * **Two things now stop that, and only one of them is a test.** Structurally, both sides read this
 * object, so they cannot drift apart. And assertion 6 of `tests/middleware/session-lifecycle.test.ts`
 * asserts the cleared cookie's options directly, which is what pins the `path` LITERAL — measured
 * 2026-08-20 by setting it to `/wrong` and watching that assertion fail. **What no test here can
 * see** is whether a browser actually drops the cookie: `applyCookieWrites` models `value` and
 * `maxAge` and no `path` at all, so the jar simulation would accept a wrong path happily. The
 * assertion is the guard; the simulation is not.
 *
 * The values are `@supabase/ssr`'s own defaults, read from
 * `@supabase/ssr/dist/main/utils/constants.js` on 2026-08-20 rather than assumed. Stating them here
 * means this project owns them: a future library default change no longer moves them silently, in
 * either direction.
 */
const SESSION_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: false } as const;

// Returning null when credentials are absent is load-bearing, not an oversight: it is the
// documented missing-secret behaviour (AGENTS.md § Cloudflare traps). Do not "fix" it into a throw.
export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}

/**
 * `sb-<project ref>-auth-token` — supabase-js's default storage key, derived from the project URL
 * exactly as the library derives it. Kept here rather than at a call site so the cookie name has one
 * definition, beside the plumbing that reads and writes it.
 */
function storageKey(): string | null {
  if (!SUPABASE_URL) {
    return null;
  }
  try {
    return `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  } catch {
    // **`envField.string()` does not validate a URL** (`astro.config.mjs`), so a malformed value
    // reaches this line — and this function is reached only from the FAILURE branch of
    // `/api/auth/signout`, which sits OUTSIDE that route's `try`. An escaping throw there answers a
    // generic HTML 500 to a form POST: the browser shows an error page instead of a sign-in screen,
    // which is the outcome assertion 7 of `session-lifecycle.test.ts` exists to eliminate. Degraded
    // credentials answer null here for the same reason `createClient` does — see the note above it.
    return null;
  }
}

/**
 * Clear this project's session cookies from the response, and answer which names were cleared.
 *
 * **Why this exists at all.** `supabase.auth.signOut()` clears the session inside `_removeSession()`,
 * and `_signOut` has two early returns ahead of it — a session error, and any `admin.signOut()`
 * failure that is not 404/401/403. On either, the provider has refused and the cookie survives.
 * `{ scope: "local" }` is not a way out: `admin.signOut(accessToken, scope)` runs BEFORE the
 * `scope !== 'others'` branch, so it makes the same network call and dies at the same return.
 * Ending the session on this device without the provider's cooperation means clearing the cookie
 * ourselves, and this is the only place that knows how.
 *
 * **Cleared through `set`, never `delete`.** `@supabase/ssr` removes a cookie by writing `value: ""`
 * with `maxAge: 0`, so mirroring that shape means a refused sign-out writes exactly what a
 * successful one writes and the two are comparable. The attributes come from
 * `SESSION_COOKIE_OPTIONS` above — the same object `createServerClient` is given — because a
 * different `path` here would leave the browser holding the cookie while every test still passed.
 *
 * **Reads the names from the request rather than reconstructing them.** A session payload too large
 * for one cookie is split into `<key>.0`, `<key>.1`, … and how many chunks exist depends on the
 * payload, not on anything this module can know.
 *
 * Answers `[]` when credentials are absent, matching `createClient`'s documented null behaviour
 * (AGENTS.md § Cloudflare traps) rather than throwing on a path that is already degraded.
 */
export function clearSessionCookies(requestHeaders: Headers, cookies: AstroCookies): string[] {
  const key = storageKey();
  if (!key) {
    return [];
  }

  const cleared: string[] = [];
  for (const { name } of parseCookieHeader(requestHeaders.get("Cookie") ?? "")) {
    if (name === key || name.startsWith(`${key}.`)) {
      cookies.set(name, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
      cleared.push(name);
    }
  }
  return cleared;
}
