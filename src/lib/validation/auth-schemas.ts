import { z } from "zod";
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

// The server half of the credential rules. Every rule here is *built from* the zod-free ./auth
// rather than restated, so there is still exactly one definition of each — see the header comment
// there for why the two are separate files and what merging them costs.
//
// Server-only: nothing hydrated may import this module, or zod ships to the browser.

const emailField = z.string().trim().min(1, EMAIL_REQUIRED_MESSAGE).refine(isValidEmail, EMAIL_INVALID_MESSAGE);

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, PASSWORD_REQUIRED_MESSAGE),
});

export const signUpSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, PASSWORD_REQUIRED_MESSAGE).min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
    confirmPassword: z.string().min(1, CONFIRM_REQUIRED_MESSAGE),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: CONFIRM_MISMATCH_MESSAGE,
    path: ["confirmPassword"],
  });

export type SignInCredentials = z.infer<typeof signInSchema>;
export type SignUpCredentials = z.infer<typeof signUpSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; message: string };

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
  // of everything wrong at once is not what the form displays either.
  return { success: false, message: parsed.error.issues[0].message };
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
