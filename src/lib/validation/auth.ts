// One definition of each credential rule, shared by the server (through the zod schemas in
// ./auth-schemas, which are built from these) and by the hydrated React forms (which import the
// constants and `isValidEmail` directly). Before this module the forms said 6 characters and the
// server said nothing at all.
//
// **This module deliberately imports nothing.** `SignInForm` and `SignUpForm` are hydrated with
// `client:load`, so everything reachable from here is bundled for the browser on the two most
// visited unauthenticated pages. Keeping the zod schemas one file away is worth ~59 KB of client
// bundle, measured: with them in this file the shared chunk built to 96 746 B, without them to
// 36 135 B. What can actually drift between client and server is the minimum length and the email
// pattern; both live here. The parser stays on the server, which is also what AGENTS.md asks for —
// it mandates zod for API routes, not for React components.
//
// It must also stay free of `astro:*` imports so the hermetic unit suite can import it
// (AGENTS.md § Testing).

/**
 * Minimum password length for a NEW account. Supabase's own floor is 6; 8 is this project's
 * (Decision 7 — length over composition rules). Existing accounts are never re-validated.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** RFC 5321's maximum forward-path length. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * bcrypt — which is what Supabase hashes with — reads at most 72 bytes and silently ignores the
 * rest. Rejecting a longer password is honest; accepting it would mean the tail the user typed
 * never protected anything.
 */
export const MAX_PASSWORD_LENGTH = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one email predicate. The forms call it directly; the schemas are built from it, so the
 * browser and the server cannot drift.
 */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Every message this product will ever show on an auth screen, and its code.
 *
 * **The redirect carries the code, never the text.** `/auth/signin?error=<code>` is resolved here,
 * server-side, so a crafted link cannot put words in the application's mouth. Before this, the
 * pages rendered `?error=` verbatim: `?error=Account+locked.+Call+500-123-456` displayed as a
 * genuine system message in the real product — not XSS, since React escapes it, but a ready-made
 * phishing page hosted on our own domain. Building a fixed set of project-owned messages (US-04)
 * is pointless while the channel that delivers them accepts arbitrary text.
 */
export const AUTH_MESSAGES = {
  // Caused by the user, and deliberately specific — a form that says "something went wrong" when
  // you typed seven characters is unusable.
  email_required: "Email is required",
  email_invalid: "Enter a valid email address",
  password_required: "Password is required",
  password_too_short: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  confirm_required: "Please confirm your password",
  confirm_mismatch: "Passwords do not match",
  email_too_long: `Email must be at most ${MAX_EMAIL_LENGTH} characters`,
  password_too_long: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
  // Provider outcomes, deliberately uninformative about whether an address has an account.
  sign_in_failed: "Invalid email or password",
  sign_up_failed: "We could not create that account. Check your details and try again.",
  // **Deliberately partial, because the truth is partial.** When the provider refuses a sign-out the
  // route clears this browser's session anyway, so the device IS signed out — but the refresh token
  // survives at the provider and nothing here can recall it. A sentence claiming "you have been
  // signed out" would overstate it; one claiming the sign-out failed would understate it and send
  // the user looking for a session that is, locally, already gone.
  sign_out_failed:
    "We signed you out on this device, but could not end the session everywhere. Sign in again to retry.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  unexpected: "Something went wrong. Please try again.",
  not_configured: "Supabase is not configured",
} as const;

export type AuthMessageCode = keyof typeof AUTH_MESSAGES;

/**
 * Neutral outcomes, kept in a SEPARATE catalogue from the failures above — and the separation is the
 * point rather than tidiness.
 *
 * `/auth/signin` renders `?error=` inside a red box. If "your account has been deleted" lived in
 * `AUTH_MESSAGES`, then `?error=account_deleted` would render a deliberate, successful action as a
 * system failure — on the one screen the user reaches immediately after taking it. Two catalogues
 * and two query parameters make that combination unreachable rather than merely unlikely.
 */
export const AUTH_NOTICES = {
  account_deleted: "Your account and all of its training data have been deleted.",
} as const;

export type AuthNoticeCode = keyof typeof AUTH_NOTICES;

/**
 * Resolve a neutral notice from the query string.
 *
 * **An unrecognised code renders NOTHING, which is the opposite of `messageForCode`'s fall-back and
 * is deliberate.** A generic failure sentence is a safe answer to a mangled URL; a generic
 * reassurance is not — "something completed successfully" is a positive claim, and inventing one for
 * a code we do not recognise would tell the user an action succeeded when nothing is known about it.
 */
export function noticeForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(AUTH_NOTICES, code) ? AUTH_NOTICES[code as AuthNoticeCode] : null;
}

/**
 * Resolve a code from the query string. Absent → no message at all; unrecognised → the generic
 * one, so a hand-edited URL yields our text rather than the visitor's.
 */
export function messageForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(AUTH_MESSAGES, code) ? AUTH_MESSAGES[code as AuthMessageCode] : AUTH_MESSAGES.unexpected;
}

// The forms render these same strings, so a rule broken in the browser and the same rule broken by
// a scripted POST read identically. Aliases of the catalogue above — still one definition each.
export const EMAIL_REQUIRED_MESSAGE = AUTH_MESSAGES.email_required;
export const EMAIL_INVALID_MESSAGE = AUTH_MESSAGES.email_invalid;
export const PASSWORD_REQUIRED_MESSAGE = AUTH_MESSAGES.password_required;
export const PASSWORD_TOO_SHORT_MESSAGE = AUTH_MESSAGES.password_too_short;
export const CONFIRM_REQUIRED_MESSAGE = AUTH_MESSAGES.confirm_required;
export const CONFIRM_MISMATCH_MESSAGE = AUTH_MESSAGES.confirm_mismatch;
