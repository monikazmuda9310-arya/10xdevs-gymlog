// One definition of each preference message, shared by the server (through the zod schemas in
// ./profile-schemas, built from these) and by the hydrated settings form (which imports the
// catalogue directly). The same split as ./auth, ./exercise and ./workout, for the same reason.
//
// **The only import here is type-only and erases at compile time.** The settings form is a
// `client:load` island, so whatever is reachable from here ships to the browser — keep the zod
// schemas, and with them the timezone list, one file away. It must also stay free of `astro:*`
// imports so the hermetic unit suite can reach it (AGENTS.md § Testing).

import type { EstimationFormula, WeightUnit } from "@/types";

/**
 * Every message the settings screen can show, and its code.
 *
 * **The response carries the code, never the text** — S-01's implementation review found that prose
 * travelling through a URL turns any screen into a phishing kit, and the discipline is kept uniform
 * even where the channel is a JSON body.
 *
 * The generic codes repeat what `workout.ts` and `exercise.ts` already carry. That is the
 * established pattern here rather than duplication: one catalogue per domain, so the wording of
 * "you need to be signed in" can say what the user was trying to do.
 */
export const PROFILE_MESSAGES = {
  // Caused by the user, and deliberately specific — a preference refused with a generic message is
  // a form the user cannot get past.
  timezone_required: "Choose the timezone your training week runs in",
  // Refused against the same list the screen offered, so this can only be reached by a caller that
  // did not use the form. See `isSupportedTimeZone` for why a shape check would not do.
  timezone_unknown: "That is not a timezone we recognise",
  weight_unit_invalid: "Choose kilograms or pounds",
  estimation_formula_invalid: "Choose one of the two estimation formulas",
  // Absent, or somebody else's — the same answer on purpose, so neither is an existence oracle.
  profile_not_found: "Your preferences could not be found",
  // Outcomes the user did not cause.
  unauthenticated: "You need to be signed in to change your preferences",
  not_configured: "Supabase is not configured",
  unexpected: "Something went wrong. Please try again.",
} as const;

export type ProfileMessageCode = keyof typeof PROFILE_MESSAGES;

/**
 * What each enum value is called on screen.
 *
 * Typed as a `Record` over the enum rather than as a loose object, so adding a value to the Postgres
 * enum stops the build here too. The tuple assertions in `@/types` guarantee the value is offered;
 * these guarantee it is offered with a name, rather than as the raw `lb` the column happens to hold.
 */
export const WEIGHT_UNIT_LABELS: Record<WeightUnit, string> = {
  kg: "Kilograms",
  lb: "Pounds",
};

/**
 * The formula names are the authors', so they are not translated or prettified — a lifter who knows
 * one of them by name must be able to find it. The hint says what each does differently, because
 * "Brzycki or Epley" is not a choice most people can make from the names alone.
 */
export const ESTIMATION_FORMULA_LABELS: Record<EstimationFormula, string> = {
  brzycki: "Brzycki",
  epley: "Epley",
};

export const ESTIMATION_FORMULA_HINTS: Record<EstimationFormula, string> = {
  brzycki: "Reads higher as the repetitions climb. Above ten reps it is the more generous of the two.",
  epley: "Reads higher at low repetitions. Below ten reps it is the more generous of the two.",
};

/** Absent → no message; unrecognised → the generic one, never the caller's own words. */
export function profileMessageForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(PROFILE_MESSAGES, code)
    ? PROFILE_MESSAGES[code as ProfileMessageCode]
    : PROFILE_MESSAGES.unexpected;
}
