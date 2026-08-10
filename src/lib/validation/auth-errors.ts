import type { AuthError } from "@supabase/supabase-js";
import type { AuthMessageCode } from "@/lib/validation/auth";

// Provider prose is an account-existence oracle: "User already registered" tells an attacker which
// addresses have accounts, and US-04 requires that boundary to be real rather than apparent. This
// maps a Supabase failure onto one of the codes in AUTH_MESSAGES — never onto text, and never onto
// the provider's own words.
//
// This does NOT apply to validation failures. "Password must be at least 8 characters" is caused by
// the user and must stay specific, or the form becomes unusable — see the plan's § Critical
// Implementation Details. Only the provider's *identity* errors are flattened.

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
 * Map a Supabase auth failure onto one of this project's message codes.
 *
 * Sign-in identity failures all collapse to `sign_in_failed` — wrong password, no such account and
 * unconfirmed address are one answer. Rate limiting is reported honestly because it is not an
 * account-existence oracle: Supabase limits `signInWithPassword` per IP, not per address, and
 * telling a throttled user "invalid email or password" would send them to reset a working password.
 *
 * Anything unrecognised falls through to `unexpected` and is logged server-side, so a provider that
 * renames an error is diagnosable without the new string reaching a screen.
 */
export function neutralAuthCode(action: AuthAction, error: AuthError): AuthMessageCode {
  if ((error.code && RATE_LIMIT_CODES.has(error.code)) || error.status === 429) {
    return "rate_limited";
  }

  if (error.code && IDENTITY_CODES[action].has(error.code)) {
    return action === "signin" ? "sign_in_failed" : "sign_up_failed";
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
  return "unexpected";
}
