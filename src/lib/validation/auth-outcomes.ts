// The sibling of ./auth-errors: that one interprets what the provider says when signup fails, this
// one interprets what it says when signup succeeds.
//
// The plan called this branch "the heart of this change and it is one line of logic". It lives here
// rather than inline in the endpoint for exactly that reason — a line that load-bearing needs a test
// that fails when it changes, and an endpoint is not directly unit-testable (AGENTS.md § Testing
// keeps decisions in plain, dependency-free functions).

/**
 * The shape of `supabase.auth.signUp`'s `data`, narrowed to what the decision actually reads.
 * Structural, so the real `AuthResponse["data"]` satisfies it and a test can pass a two-field stub.
 */
export interface SignUpOutcome {
  user: { id: string } | null;
  session: { access_token: string } | null;
}

export type SignUpDestination = "/dashboard" | "/auth/confirm-email";

/**
 * Where a successful `signUp` sends the caller.
 *
 * **Decided by the session, never by the user.** With email confirmation off, `signUp` returns a
 * session and the account is usable immediately. With it on, Supabase returns a `user` — an
 * *obfuscated* one, deliberately indistinguishable from the already-registered case — and no
 * session. Reading `user` instead of `session` therefore sends unconfirmed accounts to `/dashboard`,
 * where the middleware bounces them straight back to `/auth/signin`: an endless loop, on production,
 * that no gate can see.
 *
 * Do not reintroduce a config flag, an env var or `import.meta.env.DEV` here. All three can disagree
 * with what the Supabase project is set to right now; the returned session cannot.
 */
export function signUpDestination(data: SignUpOutcome): SignUpDestination {
  return data.session ? "/dashboard" : "/auth/confirm-email";
}
