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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one email predicate. The forms call it directly; the schemas are built from it, so the
 * browser and the server cannot drift.
 */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

// User-facing text. The forms render these same strings, so a rule broken in the browser and the
// same rule broken by a scripted POST read identically.
export const EMAIL_REQUIRED_MESSAGE = "Email is required";
export const EMAIL_INVALID_MESSAGE = "Enter a valid email address";
export const PASSWORD_REQUIRED_MESSAGE = "Password is required";
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
export const CONFIRM_REQUIRED_MESSAGE = "Please confirm your password";
export const CONFIRM_MISMATCH_MESSAGE = "Passwords do not match";
