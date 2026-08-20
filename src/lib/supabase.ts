import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// Returning null when credentials are absent is load-bearing, not an oversight: it is the
// documented missing-secret behaviour (AGENTS.md § Cloudflare traps). Do not "fix" it into a throw.
export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
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
  return `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
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
 * with `{ ...DEFAULT_COOKIE_OPTIONS, maxAge: 0 }`, and `DEFAULT_COOKIE_OPTIONS` is
 * `{ path: "/", sameSite: "lax", httpOnly: false }` — read from
 * `@supabase/ssr/dist/main/utils/constants.js` on 2026-08-20, not assumed. Mirroring that shape
 * means a refused sign-out writes exactly what a successful one writes, so the two are comparable;
 * a different `path` would leave the browser holding the cookie while every test still passed.
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
      cookies.set(name, "", { path: "/", sameSite: "lax", httpOnly: false, maxAge: 0 });
      cleared.push(name);
    }
  }
  return cleared;
}
