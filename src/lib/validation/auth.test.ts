// The rules that decide whether credentials are acceptable, at their boundaries. These are pure
// functions with no network and no `astro:*` imports, which is what keeps `npm test` hermetic.
//
// The case worth staring at is `FormData` with the fields absent: `form.get("email") as string`
// used to cast that null into a string, and it travelled all the way to Supabase.

import { AuthError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  isValidEmail,
  AUTH_MESSAGES,
  AUTH_NOTICES,
  messageForCode,
  noticeForCode,
} from "@/lib/validation/auth";
import { parseSignInForm, parseSignUpForm } from "@/lib/validation/auth-schemas";
import { neutralAuthCode } from "@/lib/validation/auth-errors";
import { signUpDestination } from "@/lib/validation/auth-outcomes";

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
    expect(result).toEqual({ success: false, code: "email_required" });
  });

  it("rejects an empty email", () => {
    const result = parseSignInForm(formOf({ email: "   ", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, code: "email_required" });
  });

  it("rejects a malformed email", () => {
    const result = parseSignInForm(formOf({ email: "not-an-address", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, code: "email_invalid" });
  });

  it("rejects an absent password", () => {
    const result = parseSignInForm(formOf({ email: "lifter@example.com" }));

    expect(result).toEqual({ success: false, code: "password_required" });
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

    expect(result).toEqual({ success: false, code: "email_required" });
  });

  it(`rejects a password one character below the floor (${String(MIN_PASSWORD_LENGTH - 1)})`, () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: short, confirmPassword: short }));

    expect(result).toEqual({ success: false, code: "password_too_short" });
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

    expect(result).toEqual({ success: false, code: "confirm_mismatch" });
  });

  it("rejects an absent confirmation", () => {
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, code: "confirm_required" });
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

describe("neutralAuthCode", () => {
  it("collapses every sign-in identity failure to one code", () => {
    // The whole anti-enumeration point: "no such user" and "wrong password" must be one answer.
    const codes = ["invalid_credentials", "user_not_found", "email_not_confirmed", "user_banned"].map((code) =>
      neutralAuthCode("signin", new AuthError("provider prose that must not reach a screen", 400, code)),
    );

    expect(new Set(codes)).toEqual(new Set(["sign_in_failed"]));
  });

  it("does not let 'User already registered' through on signup", () => {
    const code = neutralAuthCode("signup", new AuthError("User already registered", 422, "user_already_exists"));

    expect(code).toBe("sign_up_failed");
    expect(AUTH_MESSAGES[code]).not.toContain("registered");
  });

  it("names rate limiting, which is neither an identity leak nor a mystery", () => {
    expect(neutralAuthCode("signin", new AuthError("too many", 429, "over_request_rate_limit"))).toBe("rate_limited");
    // Falls back to the status when the code is one we have not seen.
    expect(neutralAuthCode("signup", new AuthError("too many", 429, "some_future_limit_code"))).toBe("rate_limited");
  });

  it("logs an unrecognised provider error rather than displaying it", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const code = neutralAuthCode("signin", new AuthError("something nobody has mapped", 500, "brand_new_code"));

      expect(code).toBe("unexpected");
      // Visible in the Worker log precisely because it is invisible to the caller.
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });

  it("only ever returns codes the catalogue can resolve", () => {
    // A code with no entry would render as the generic message, silently swallowing a real outcome.
    for (const action of ["signin", "signup"] as const) {
      for (const provider of ["invalid_credentials", "user_already_exists", "over_request_rate_limit", "unknown_xyz"]) {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
          expect(AUTH_MESSAGES).toHaveProperty(neutralAuthCode(action, new AuthError("p", 400, provider)));
        } finally {
          logged.mockRestore();
        }
      }
    }
  });
});

describe("messageForCode", () => {
  it("resolves a known code to this project's text", () => {
    expect(messageForCode("sign_in_failed")).toBe(AUTH_MESSAGES.sign_in_failed);
  });

  it("renders nothing when there is no code", () => {
    expect(messageForCode(null)).toBeNull();
    expect(messageForCode("")).toBeNull();
  });

  it("resolves sign_out_failed to its own sentence rather than the generic one", () => {
    // **The failure this catches is silent by construction.** `/api/auth/signout` redirects with
    // `?error=sign_out_failed` when the provider refuses; a code with no catalogue entry does not
    // throw, does not warn, and does not render blank — it falls through to `unexpected` and reads
    // as an ordinary hiccup. The user would then be told "something went wrong" about a session
    // that is half-ended, which is the one thing this whole phase exists to prevent.
    expect(messageForCode("sign_out_failed")).toBe(AUTH_MESSAGES.sign_out_failed);
    expect(messageForCode("sign_out_failed")).not.toBe(AUTH_MESSAGES.unexpected);
    // It must not overclaim: the session survives at the provider, and the sentence says so.
    expect(AUTH_MESSAGES.sign_out_failed).toContain("this device");
  });

  it("refuses to put a crafted link's words in the application's mouth", () => {
    // The finding this exists for: `?error=Account+locked.+Call+500-123-456` used to render
    // verbatim, styled as a genuine system message on our own domain.
    const crafted = "Account locked. Call 500-123-456 to restore access.";

    expect(messageForCode(crafted)).toBe(AUTH_MESSAGES.unexpected);
    expect(messageForCode("__proto__")).toBe(AUTH_MESSAGES.unexpected);
    expect(messageForCode("constructor")).toBe(AUTH_MESSAGES.unexpected);
  });
});

describe("noticeForCode", () => {
  // **This function's fall-back is the OPPOSITE of `messageForCode`'s, deliberately — and that is
  // the line somebody will one day "harmonise", with a diff that reads as a simplification.**
  // A generic failure sentence is a safe answer to a mangled URL; a generic REASSURANCE is not.
  // "Something completed successfully" is a positive claim, and inventing one for a code we do not
  // recognise would tell the user an action succeeded when nothing is known about it. Three comments
  // say so; these assertions are what make the rule survive a reader who does not reach them.

  it("resolves a known code to this project's text", () => {
    expect(noticeForCode("account_deleted")).toBe(AUTH_NOTICES.account_deleted);
  });

  it("renders nothing when there is no code", () => {
    expect(noticeForCode(null)).toBeNull();
    expect(noticeForCode(undefined)).toBeNull();
    expect(noticeForCode("")).toBeNull();
  });

  it("renders NOTHING for an unrecognised code — never a generic reassurance", () => {
    expect(noticeForCode("not_a_notice")).toBeNull();
    expect(noticeForCode("sign_in_failed")).toBeNull();
    expect(noticeForCode("__proto__")).toBeNull();
    expect(noticeForCode("constructor")).toBeNull();
  });

  it("shares no key with AUTH_MESSAGES, so no code can grow a red-box twin", () => {
    // `/auth/signin` renders `?error=` in a red box and `?notice=` in a neutral one. A key in both
    // catalogues would let one code be rendered either way depending on which parameter a link
    // happened to use — the failure the two-catalogue split exists to make unreachable rather than
    // merely unwritten.
    const shared = Object.keys(AUTH_NOTICES).filter((key) => Object.hasOwn(AUTH_MESSAGES, key));
    expect(shared).toEqual([]);
  });
});

describe("signUpDestination", () => {
  const SESSION = { access_token: "token" };
  const USER = { id: "1a2b3c" };

  it("sends an immediately usable account to the dashboard", () => {
    // Email confirmation off: signUp returned a session, so the account works right now.
    expect(signUpDestination({ user: USER, session: SESSION })).toBe("/dashboard");
  });

  it("sends an account with no session to the confirm-email page", () => {
    // Email confirmation on: a link is on its way.
    expect(signUpDestination({ user: USER, session: null })).toBe("/auth/confirm-email");
  });

  it("decides on the session, not on the user — the mutation no other test catches", () => {
    // This is the whole point of extracting the function. With confirmation on, Supabase returns an
    // obfuscated user and NO session; reading `user` here would send unconfirmed accounts to
    // /dashboard, where the middleware bounces them back to /auth/signin — an endless loop, on
    // production, that every test in this repository would still call green.
    expect(signUpDestination({ user: USER, session: null })).not.toBe("/dashboard");
  });

  it("treats an already-registered address exactly like a new one", () => {
    // Not a bug to fix later: it IS the anti-enumeration property, and it comes from the provider.
    const newSignup = signUpDestination({ user: { id: "new" }, session: null });
    const alreadyTaken = signUpDestination({ user: { id: "obfuscated" }, session: null });

    expect(newSignup).toBe(alreadyTaken);
  });

  it("does not crash when the provider returns neither", () => {
    expect(signUpDestination({ user: null, session: null })).toBe("/auth/confirm-email");
  });
});

describe("upper bounds", () => {
  it("rejects an email past RFC 5321's limit", () => {
    const long = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
    const result = parseSignInForm(formOf({ email: long, password: VALID_PASSWORD }));

    expect(result).toEqual({ success: false, code: "email_too_long" });
  });

  it("rejects a signup password past bcrypt's 72 bytes", () => {
    // Accepting it would mean the tail the user typed never protected anything: bcrypt reads 72
    // bytes and silently ignores the rest.
    const long = "a".repeat(MAX_PASSWORD_LENGTH + 1);
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: long, confirmPassword: long }));

    expect(result).toEqual({ success: false, code: "password_too_long" });
  });

  it("accepts a signup password of exactly the maximum", () => {
    const exact = "a".repeat(MAX_PASSWORD_LENGTH);
    const result = parseSignUpForm(formOf({ email: "lifter@example.com", password: exact, confirmPassword: exact }));

    expect(result.success).toBe(true);
  });

  it("does not bound the sign-in password — older accounts must still get in", () => {
    const long = "a".repeat(MAX_PASSWORD_LENGTH + 50);
    const result = parseSignInForm(formOf({ email: "lifter@example.com", password: long }));

    expect(result.success).toBe(true);
  });
});
