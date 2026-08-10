import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
// Constants and the predicate only — never the zod schemas. This component is hydrated with
// `client:load` on one of the two most-visited unauthenticated pages, so anything it imports is
// bundled for the browser. The parser stays on the server; what can actually drift between the
// two sides is the minimum length and the email pattern, and those are shared.
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

interface Props {
  serverError?: string | null;
}

export default function SignUpForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!email.trim()) {
      next.email = EMAIL_REQUIRED_MESSAGE;
    } else if (!isValidEmail(email)) {
      next.email = EMAIL_INVALID_MESSAGE;
    }

    if (!password) {
      next.password = PASSWORD_REQUIRED_MESSAGE;
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = PASSWORD_TOO_SHORT_MESSAGE;
    }

    if (!confirmPassword) {
      next.confirmPassword = CONFIRM_REQUIRED_MESSAGE;
    } else if (password !== confirmPassword) {
      next.confirmPassword = CONFIRM_MISMATCH_MESSAGE;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="mt-1 text-xs text-blue-100/50">
        {MIN_PASSWORD_LENGTH - password.length} more character
        {MIN_PASSWORD_LENGTH - password.length !== 1 ? "s" : ""} needed
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label="Email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="you@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        label="Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Re-enter your password"
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Creating account..." icon={<UserPlus className="size-4" />}>
        Create account
      </SubmitButton>
    </form>
  );
}
