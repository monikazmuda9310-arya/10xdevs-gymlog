// The rules that decide whether credentials are acceptable, at their boundaries. These are pure
// functions with no network and no `astro:*` imports, which is what keeps `npm test` hermetic.
//
// The case worth staring at is `FormData` with the fields absent: `form.get("email") as string`
// used to cast that null into a string, and it travelled all the way to Supabase.

import { AuthError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_INVALID_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  CONFIRM_REQUIRED_MESSAGE,
  CONFIRM_MISMATCH_MESSAGE,
} from "@/lib/validation/auth";
import { parseSignInForm, parseSignUpForm } from "@/lib/validation/auth-schemas";
import {
  neutralAuthMessage,
  SIGN_IN_FAILED_MESSAGE,
  SIGN_UP_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
} from "@/lib/validation/auth-errors";

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  return form;
}

const VALID_PASSWORD = "a".repeat(MIN_PASSWORD_LENGTH);

describe("MIN_PASSWORD_LENGTH", () => {
  it("is 8 — above Supabase's own floor of 6, which the form used to claim", () => {
    // Pinned deliberately: the number is the rule, and lowering it silently would weaken every
    // account created afterwards without any other test noticing.
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe("isValidEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmail("lifter@example.com")).toBe(true);
  });

  it("ignores surrounding whitespace, because a pasted address carries it", () => {
    expect(isValidEmail("  lifter@example.com  ")).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["no at sign", "lifter.example.com"],
    ["no domain dot", "lifter@example"],
    ["no local part", "@example.com"],
    ["inner space", "two words@example.com"],
  ])("rejects %s", (_label, value) => {
    expect(isValidEmail(value)).toBe(false);
  });
});

describe("parseSignInForm", () => {
  it("rejects a form with no fields at all — the null FormData.get() case", () => {
    const result = parseSignInForm(new FormData());

    expect(result.success).toBe(false);
    // Not a type complaint from the parser, and not a 500: a message the user can act on.
    expect(result).toEqual({ success: false, message: EMAIL_REQUIRED_MESSAGE });
  });

  it("rejects an empty email", () => {
    const result = parseSignInForm(formOf({ email: "   ", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, message: EMAIL_REQUIRED_MESSAGE });
  });

  it("rejects a malformed email", () => {
    const result = parseSignInForm(formOf({ email: "not-an-address", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, message: EMAIL_INVALID_MESSAGE });
  });

  it("rejects an absent password", () => {
    const result = parseSignInForm(formOf({ email: "lifter@example.com" }));

    expect(result).toEqual({ success: false, message: PASSWORD_REQUIRED_MESSAGE });
  });

  it("accepts a short password — sign-in must not re-impose the signup floor", () => {
    // An account created before the floor moved from 6 to 8 still has to be able to sign in.
    const result = parseSignInForm(formOf({ email: "lifter@example.com", password: "abc123" }));

    expect(result.success).toBe(true);
  });

  it("trims the email it hands to the provider", () => {
    const result = parseSignInForm(formOf({ email: "  lifter@example.com ", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: true, data: { email: "lifter@example.com", password: VALID_PASSWORD } });
  });
});

describe("parseSignUpForm", () => {
  it("rejects a form with no fields at all", () => {
    const result = parseSignUpForm(new FormData());

    expect(result).toEqual({ success: false, message: EMAIL_REQUIRED_MESSAGE });
  });

  it(`rejects a password one character below the floor (${String(MIN_PASSWORD_LENGTH - 1)})`, () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: short, confirmPassword: short }));

    expect(result).toEqual({ success: false, message: PASSWORD_TOO_SHORT_MESSAGE });
  });

  it(`accepts a password of exactly ${String(MIN_PASSWORD_LENGTH)} characters`, () => {
    const result = parseSignUpForm(
      formOf({ email: "lifter@example.com", password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects a mismatched confirmation — the browser check a scripted POST used to bypass", () => {
    const result = parseSignUpForm(
      formOf({ email: "lifter@example.com", password: VALID_PASSWORD, confirmPassword: `${VALID_PASSWORD}x` }),
    );

    expect(result).toEqual({ success: false, message: CONFIRM_MISMATCH_MESSAGE });
  });

  it("rejects an absent confirmation", () => {
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, message: CONFIRM_REQUIRED_MESSAGE });
  });

  it("does not hand confirmPassword's own value to the provider", () => {
    const result = parseSignUpForm(
      formOf({ email: "lifter@example.com", password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("lifter@example.com");
      expect(result.data.password).toBe(VALID_PASSWORD);
    }
  });
});

describe("neutralAuthMessage", () => {
  it("collapses every sign-in identity failure to one message", () => {
    // The whole anti-enumeration point: "no such user" and "wrong password" must be one string.
    const messages = ["invalid_credentials", "user_not_found", "email_not_confirmed", "user_banned"].map((code) =>
      neutralAuthMessage("signin", new AuthError("provider prose that must not reach a screen", 400, code)),
    );

    expect(new Set(messages)).toEqual(new Set([SIGN_IN_FAILED_MESSAGE]));
  });

  it("does not let 'User already registered' through on signup", () => {
    const message = neutralAuthMessage("signup", new AuthError("User already registered", 422, "user_already_exists"));

    expect(message).toBe(SIGN_UP_FAILED_MESSAGE);
    expect(message).not.toContain("registered");
  });

  it("names rate limiting, which is neither an identity leak nor a mystery", () => {
    expect(neutralAuthMessage("signin", new AuthError("too many", 429, "over_request_rate_limit"))).toBe(
      RATE_LIMITED_MESSAGE,
    );
    // Falls back to the status when the code is one we have not seen.
    expect(neutralAuthMessage("signup", new AuthError("too many", 429, "some_future_limit_code"))).toBe(
      RATE_LIMITED_MESSAGE,
    );
  });

  it("logs an unrecognised provider error rather than displaying it", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const message = neutralAuthMessage("signin", new AuthError("something nobody has mapped", 500, "brand_new_code"));

      expect(message).toBe(UNEXPECTED_ERROR_MESSAGE);
      // Visible in the Worker log precisely because it is invisible to the caller.
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });
});
