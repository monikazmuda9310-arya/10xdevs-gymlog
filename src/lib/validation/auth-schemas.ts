import { z } from "zod";
import {
  MIN_PASSWORD_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  isValidEmail,
  type AuthMessageCode,
} from "@/lib/validation/auth";

// The server half of the credential rules. Every rule here is *built from* the zod-free ./auth
// rather than restated, so there is still exactly one definition of each — see the header comment
// there for why the two are separate files and what merging them costs.
//
// Server-only: nothing hydrated may import this module, or zod ships to the browser.

// Each issue carries a MESSAGE CODE, not the sentence. The endpoints put it in the redirect and the
// page resolves it — see AUTH_MESSAGES in ./auth for why the text must never travel through a URL.
const code = (value: AuthMessageCode): string => value;

const emailField = z
  .string()
  .trim()
  .min(1, code("email_required"))
  .max(MAX_EMAIL_LENGTH, code("email_too_long"))
  .refine(isValidEmail, code("email_invalid"));

export const signInSchema = z.object({
  email: emailField,
  // No upper bound here, deliberately: an account created under any earlier rule must still be
  // able to sign in. bcrypt ignores everything past 72 bytes anyway, so a longer value still
  // matches the stored hash.
  password: z.string().min(1, code("password_required")),
});

export const signUpSchema = z
  .object({
    email: emailField,
    password: z
      .string()
      .min(1, code("password_required"))
      .min(MIN_PASSWORD_LENGTH, code("password_too_short"))
      .max(MAX_PASSWORD_LENGTH, code("password_too_long")),
    confirmPassword: z.string().min(1, code("confirm_required")),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: code("confirm_mismatch"),
    path: ["confirmPassword"],
  });

export type SignInCredentials = z.infer<typeof signInSchema>;
export type SignUpCredentials = z.infer<typeof signUpSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; code: AuthMessageCode };

// `FormData.get()` returns null for an absent field — the exact hole `form.get("email") as string`
// used to paper over, sending null all the way to Supabase. Absent and non-text values become the
// empty string here so the schema answers with "Email is required" rather than a type complaint.
function readField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): ParseResult<T> {
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  // The first issue is the one the user is shown: a redirect carries a single message, and a list
  // of everything wrong at once is not what the form displays either. Every issue's `message` is a
  // code by construction — every check above was built with `code()`.
  return { success: false, code: parsed.error.issues[0].message as AuthMessageCode };
}

export function parseSignInForm(form: FormData): ParseResult<SignInCredentials> {
  return toResult(
    signInSchema.safeParse({
      email: readField(form, "email"),
      password: readField(form, "password"),
    }),
  );
}

export function parseSignUpForm(form: FormData): ParseResult<SignUpCredentials> {
  return toResult(
    signUpSchema.safeParse({
      email: readField(form, "email"),
      password: readField(form, "password"),
      confirmPassword: readField(form, "confirmPassword"),
    }),
  );
}
