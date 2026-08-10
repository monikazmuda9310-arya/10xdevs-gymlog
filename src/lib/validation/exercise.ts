// One definition of each catalogue rule, shared by the server (through the zod schema in
// ./exercise-schemas, built from these) and by the hydrated React form (which imports the constants
// and the messages directly). The same split as ./auth, for the same reason.
//
// **The only value this module imports is MUSCLE_GROUPS**, which is a six-element tuple. Everything
// else it touches is a type and erases at compile time. `ExerciseForm` is a hydrated island, so
// whatever is reachable from here ships to the browser — keep the zod schema one file away.
//
// It must also stay free of `astro:*` imports so the hermetic unit suite can import it
// (AGENTS.md § Testing).

import { MUSCLE_GROUPS, type MuscleGroup } from "@/types";

/** Matches the `exercises_name_length` check constraint in the migration. Both, or neither holds. */
export const MAX_EXERCISE_NAME_LENGTH = 80;

/**
 * Every message a catalogue screen can show, and its code.
 *
 * **The response carries the code, never the text** — the same rule S-01's implementation review
 * forced onto the auth pages after finding that prose travelling through a URL turns any screen
 * into a phishing kit. Here the channel is a JSON body rather than a query string, which is
 * narrower, but the discipline is worth keeping uniform: one catalogue of wording, resolved
 * server-side or by the island from this module.
 */
export const EXERCISE_MESSAGES = {
  // Caused by the user, and deliberately specific.
  name_required: "Exercise name is required",
  name_too_long: `Name must be at most ${MAX_EXERCISE_NAME_LENGTH} characters`,
  muscle_group_required: "Choose a muscle group",
  muscle_group_invalid: "That is not one of the six muscle groups",
  duplicate_name: "You already have an exercise with that name",
  // Outcomes the user did not cause.
  unauthenticated: "You need to be signed in to add an exercise",
  not_configured: "Supabase is not configured",
  unexpected: "Something went wrong. Please try again.",
} as const;

export type ExerciseMessageCode = keyof typeof EXERCISE_MESSAGES;

/** Absent → no message; unrecognised → the generic one, never the caller's own words. */
export function exerciseMessageForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(EXERCISE_MESSAGES, code)
    ? EXERCISE_MESSAGES[code as ExerciseMessageCode]
    : EXERCISE_MESSAGES.unexpected;
}

/**
 * The one muscle-group predicate. Derived from MUSCLE_GROUPS rather than restating the six, so the
 * compile-time assertion in `@/types` covers this too: add a seventh group to the database without
 * adding it to the tuple and the build fails rather than the value silently failing validation.
 */
export function isMuscleGroup(value: unknown): value is MuscleGroup {
  return typeof value === "string" && (MUSCLE_GROUPS as readonly string[]).includes(value);
}
