/**
 * Real `gymlog-test` session cookies: minting them, and taking them apart again.
 *
 * **Everything here goes through `@supabase/ssr`'s own exported functions** — `createServerClient`,
 * `combineChunks`, `createChunks`, `isChunkLike`, `parseCookieHeader`, `serializeCookieHeader`,
 * `stringToBase64URL`, `stringFromBase64URL`. Nothing is reimplemented. That matters twice over: the
 * cookie a suite sends is the one the library would have written, and a forged cookie is forged the
 * way an attacker holding the browser's jar could forge it, not the way a test double could.
 *
 * **THE CHUNK HANDLING IS A TRIPWIRE TODAY, NOT A GUARD, AND THAT IS SAID HERE RATHER THAN LEFT FOR
 * A READER TO DISCOVER** (`lessons.md` § "An assertion you keep because it cannot fail YET must say
 * so in the same words you'd use to refuse one"). `@supabase/ssr` splits a value longer than
 * `MAX_CHUNK_SIZE` (3180 URI-encoded chars) into `sb-<ref>-auth-token.0`, `.1`, … **Measured
 * 2026-08-16 against `gymlog-test`: a freshly signed-in account's cookie is 3034 chars in ONE
 * cookie** — 146 below the threshold, a 4.6% margin. So no test here currently exercises the
 * multi-chunk path, and no mutation available today breaks it.
 *
 * It is kept because the edits that cross that margin are ordinary and near: one more claim in the
 * JWT, a longer email address, any `user_metadata` at signup, or Supabase widening the token. The
 * failure it prevents is silent in the worst way — a suite reading only the unsuffixed name would
 * reassemble a PARTIAL session, fail to authenticate, and look exactly like a correctly refused
 * forgery. Going through `combineChunks`/`createChunks`/`isChunkLike`, the library's own functions,
 * costs nothing and removes the question.
 */

import type { Session } from "@supabase/supabase-js";
import {
  combineChunks,
  createChunks,
  createServerClient,
  isChunkLike,
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
  stringToBase64URL,
} from "@supabase/ssr";

import type { Database } from "@/db/database.types";

/** What `@supabase/ssr` prefixes a base64url-encoded cookie payload with (`cookies.js:7`). */
const BASE64_PREFIX = "base64-";

export type Jar = Map<string, string>;

/**
 * Apply a `setAll` batch to a jar the way a BROWSER would, which is not the same as recording it.
 *
 * `@supabase/ssr` clears a cookie by writing `value: ""` with `maxAge: 0`; a browser drops it. A jar
 * that merely collected those writes would still be holding the live session under the old value,
 * and a suite replaying it would prove nothing about signing out.
 *
 * **The direction matters and is the whole reason this is a function rather than two inline loops.**
 * A sign-out test must replay the writes ON TOP OF the live jar, never the writes alone: with the
 * writes alone, a `signOut()` that was never called produces an EMPTY header, the next request has
 * no session, and the assertion passes for exactly the wrong reason
 * (`lessons.md` § "A guard you have not mutated may not guard").
 */
export function applyCookieWrites(
  jar: Jar,
  writes: readonly { name: string; value: string; options?: unknown }[],
): Jar {
  for (const { name, value, options } of writes) {
    const maxAge = (options as { maxAge?: unknown } | undefined)?.maxAge;
    if (value === "" || (typeof maxAge === "number" && maxAge === 0)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  return jar;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. This project must never skip its way to green.`);
  }
  return value;
}

/**
 * `sb-<project ref>-auth-token` — supabase-js's default storage key, derived from the project URL.
 *
 * Derived rather than hardcoded, and then CHECKED against what the library actually wrote, so this
 * assumption cannot rot into a suite that reassembles nothing and reports green.
 */
export function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function jarFromCookieHeader(header: string): Jar {
  const jar: Jar = new Map();
  for (const { name, value } of parseCookieHeader(header)) {
    jar.set(name, value ?? "");
  }
  return jar;
}

/**
 * A `Cookie` request header from a jar.
 *
 * `serializeCookieHeader(name, value, {})` is the library's own encoder and emits `name=value` with
 * the value URI-encoded — which is what `parseCookieHeader` on the other side decodes. Hand-joining
 * with a raw value would round-trip fine for base64url payloads and break the first time one carried
 * a character that needs escaping.
 */
export function cookieHeaderFrom(jar: Jar): string {
  return [...jar].map(([name, value]) => serializeCookieHeader(name, value, {})).join("; ");
}

export interface MintedSession {
  /** A real `Cookie` header carrying this account's live session. */
  cookieHeader: string;
  /** The jar behind it, so a caller can replay or edit individual cookies. */
  jar: Jar;
  userId: string;
  email: string;
  storageKey: string;
}

/**
 * Sign in and collect the cookies `@supabase/ssr` writes for that session.
 *
 * The cookies come from `applyServerStorage`, fired by the client's own `SIGNED_IN` event and
 * awaited inside `signInWithPassword` — so the jar is fully written by the time this resolves. This
 * is the same code path a browser hitting `/api/auth/signin` would take.
 */
export async function mintSessionCookies(email: string, password: string): Promise<MintedSession> {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const jar: Jar = new Map();

  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        applyCookieWrites(jar, toSet);
      },
    },
  });

  // No `!data.session` guard: unlike `signUp`, this call's types make the session non-null whenever
  // the error is, and asserting it anyway is flagged as an impossible branch rather than caution.
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`could not sign ${email} in: ${error.message}`);
  }

  const storageKey = storageKeyFor(url);
  if (![...jar.keys()].some((name) => isChunkLike(name, storageKey))) {
    throw new Error(
      `signing in wrote no cookie under '${storageKey}' (jar: ${[...jar.keys()].join(", ") || "empty"}). ` +
        `The storage key is derived from SUPABASE_TEST_URL; if supabase-js has changed how it names ` +
        `the cookie, every reassembly in this project is reading the wrong name.`,
    );
  }

  return { cookieHeader: cookieHeaderFrom(jar), jar, userId: data.session.user.id, email, storageKey };
}

/**
 * Reassemble the session out of a `Cookie` header, let `edit` change it, and write it back.
 *
 * **This is deliberately ONE path used for both the forgery and its positive control.** Passing an
 * `edit` that changes nothing must still produce a cookie that authenticates; if it does not, the
 * reassembly is broken and a rejected forgery would prove nothing — a tamper that silently missed
 * and a tamper that was correctly refused are the same observation
 * (`lessons.md` § "A mutation that fails for the WRONG REASON has not confirmed the guard").
 */
export async function reEncodeSession(
  cookieHeader: string,
  storageKey: string,
  edit: (session: Session) => void,
): Promise<string> {
  const jar = jarFromCookieHeader(cookieHeader);

  const combined = await combineChunks(storageKey, (name) => jar.get(name) ?? null);
  if (!combined) {
    throw new Error(`no cookie chunks found under '${storageKey}' in: ${[...jar.keys()].join(", ")}`);
  }
  if (!combined.startsWith(BASE64_PREFIX)) {
    throw new Error(
      `the cookie under '${storageKey}' is not base64url-encoded. @supabase/ssr's default encoding ` +
        `is what this decode assumes; if that default has moved, so must this function.`,
    );
  }

  const session = JSON.parse(stringFromBase64URL(combined.slice(BASE64_PREFIX.length))) as Session;
  edit(session);

  // Drop every chunk of the old value before writing the new one: a shorter re-encode would
  // otherwise leave a stale trailing chunk that `combineChunks` would happily append.
  for (const name of [...jar.keys()]) {
    if (isChunkLike(name, storageKey)) {
      jar.delete(name);
    }
  }
  const encoded = BASE64_PREFIX + stringToBase64URL(JSON.stringify(session));
  for (const { name, value } of createChunks(storageKey, encoded)) {
    jar.set(name, value);
  }

  return cookieHeaderFrom(jar);
}

/**
 * Claim to be somebody else: rewrite the access token's `sub` claim AND the stored user id.
 *
 * **Both, because the two are read by different code and the point is to tell them apart.**
 * `getUser()` (`middleware.ts:26`) sends the access token to the auth server, which checks the
 * signature — untouched here, and therefore no longer matching the payload — and refuses. A
 * `getSession()` "optimisation" would instead return the stored session verbatim
 * (`GoTrueClient.js:__loadSession`, no signature check anywhere in it) and hand this id straight to
 * `locals.user`. Rewriting only one of the two would leave the mutation proof ambiguous.
 *
 * The signature is left exactly as it was: forging one is not possible without the project's JWT
 * secret, which is the guarantee, not a limitation of the test.
 */
export function claimAnotherAccount(session: Session, userId: string): void {
  const [header, payload, signature] = session.access_token.split(".");
  const claims = JSON.parse(stringFromBase64URL(payload)) as Record<string, unknown>;
  claims.sub = userId;
  session.access_token = [header, stringToBase64URL(JSON.stringify(claims)), signature].join(".");
  session.user.id = userId;
}
