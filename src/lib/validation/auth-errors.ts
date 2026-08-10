import type { AuthError } from "@supabase/supabase-js";

// Provider prose is an account-existence oracle: "User already registered" tells an attacker which
// addresses have accounts, and US-04 requires that boundary to be real rather than apparent. Every
// message a caller sees on an auth failure is written here, by this project.
//
// This does NOT apply to validation failures. "Password must be at least 8 characters" is caused by
// the user and must stay specific, or the form becomes unusable — see the plan's § Critical
// Implementation Details. Only the provider's *identity* errors are flattened.

/** Sign-in: one message for every cause — wrong password, no such account, unconfirmed address. */
export const SIGN_IN_FAILED_MESSAGE = "Invalid email or password";

/** Sign-up: says nothing about whether the address was already taken. */
export const SIGN_UP_FAILED_MESSAGE = "We could not create that account. Check your details and try again.";

export const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a moment and try again.";

/** Shown when the provider returned something this project has never seen. Also logged. */
export const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Please try again.";

export type AuthAction = "signin" | "signup";

// Codes we have decided about, per action. Matching on `code` rather than on `message` is
// deliberate: Supabase's prose changes between releases, its codes are the stable contract.
const IDENTITY_CODES: Record<AuthAction, ReadonlySet<string>> = {
  signin: new Set(["invalid_credentials", "invalid_grant", "email_not_confirmed", "user_not_found", "user_banned"]),
  signup: new Set([
    "user_already_exists",
    "email_exists",
    "weak_password",
    "email_address_invalid",
    "email_address_not_authorized",
    "signup_disabled",
    "validation_failed",
  ]),
};

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

/**
 * Map a Supabase auth failure onto one of this project's fixed messages.
 *
 * Anything unrecognised falls through to the generic message and is logged server-side, so a
 * provider that renames an error is diagnosable without the new string reaching a screen.
 */
export function neutralAuthMessage(action: AuthAction, error: AuthError): string {
  if ((error.code && RATE_LIMIT_CODES.has(error.code)) || error.status === 429) {
    return RATE_LIMITED_MESSAGE;
  }

  if (error.code && IDENTITY_CODES[action].has(error.code)) {
    return action === "signin" ? SIGN_IN_FAILED_MESSAGE : SIGN_UP_FAILED_MESSAGE;
  }

  // Unmapped provider errors must be visible in the Worker log precisely because they are never
  // shown to the caller — that is what keeps a renamed Supabase code diagnosable.
  // eslint-disable-next-line no-console -- deliberate server-side diagnostic, see above
  console.error("[auth] unmapped provider error", {
    action,
    code: error.code,
    status: error.status,
    message: error.message,
  });
  return UNEXPECTED_ERROR_MESSAGE;
}
