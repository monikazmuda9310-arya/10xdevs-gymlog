// One definition of each logging rule, shared by the server (through the zod schemas in
// ./workout-schemas, built from these) and by the hydrated React forms (which import the constants,
// the messages and `isWeightAllowed` directly). The same split as ./auth and ./exercise, for the
// same reason.
//
// **This module imports nothing.** The set form is a hydrated island, so whatever is reachable from
// here ships to the browser — keep the zod schemas one file away. It must also stay free of
// `astro:*` imports so the hermetic unit suite can reach it (AGENTS.md § Testing).

/** Matches the `sets_reps_range` check constraint. Both, or neither holds. */
export const MIN_REPS = 1;
export const MAX_REPS = 100;

/** Matches `sets_weight_range`. Negative is assisted load and is legal — on a bodyweight exercise. */
export const MIN_WEIGHT = -1000;
export const MAX_WEIGHT = 2000;

/**
 * Two decimal places, which is finer than any plate anybody stacks and finer than the one decimal
 * place the product displays. The limit is what makes the round-trip promise checkable: `weight`
 * stores exactly what was typed, so what is typed must be something the column can hold exactly.
 */
export const MAX_WEIGHT_DECIMALS = 2;

/** Matches `workouts_note_length`. The constraint starts at 1, so an empty note must become null. */
export const MAX_NOTE_LENGTH = 500;

/** Matches `sets_rpe_range`. Recorded for the human reader only; excluded from every computation. */
export const MIN_RPE = 1;
export const MAX_RPE = 10;

/** Ids arrive from the client, so their shape is checked before they reach a query. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every message a logging screen can show, and its code.
 *
 * **The response carries the code, never the text** — S-01's implementation review found that prose
 * travelling through a URL turns any screen into a phishing kit, and the discipline is kept uniform
 * even where the channel is a JSON body.
 *
 * Note what is deliberately NOT collapsed into `unexpected`: everything the user can act on. A set
 * refused for a load a barbell lift may not carry has to say so, or the form becomes unusable.
 */
export const WORKOUT_MESSAGES = {
  // Caused by the user, and deliberately specific.
  date_required: "Pick a date for this workout",
  date_invalid: "That is not a real date",
  note_too_long: `A note must be at most ${MAX_NOTE_LENGTH} characters`,
  exercise_required: "Choose an exercise",
  reps_required: "Repetitions are required",
  reps_out_of_range: `Repetitions must be a whole number between ${MIN_REPS} and ${MAX_REPS}`,
  weight_required: "Weight is required",
  weight_out_of_range: `Weight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT}`,
  weight_too_precise: `Weight can carry at most ${MAX_WEIGHT_DECIMALS} decimal places`,
  weight_needs_bodyweight:
    "Only an exercise marked as bodyweight can carry a zero or assisted load. Add your own copy of it with that flag set.",
  rpe_out_of_range: `RPE must be between ${MIN_RPE} and ${MAX_RPE}`,
  // Absent, or somebody else's — the same answer on purpose, so neither is an existence oracle.
  workout_not_found: "That workout could not be found",
  entry_not_found: "That exercise is not part of this workout",
  exercise_not_found: "That exercise could not be found",
  // Outcomes the user did not cause.
  unauthenticated: "You need to be signed in to log a workout",
  not_configured: "Supabase is not configured",
  unexpected: "Something went wrong. Please try again.",
} as const;

export type WorkoutMessageCode = keyof typeof WORKOUT_MESSAGES;

/** Absent → no message; unrecognised → the generic one, never the caller's own words. */
export function workoutMessageForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(WORKOUT_MESSAGES, code)
    ? WORKOUT_MESSAGES[code as WorkoutMessageCode]
    : WORKOUT_MESSAGES.unexpected;
}

/**
 * Whether a load is permitted on this exercise (FR-014).
 *
 * A zero or assisted load is meaningful only where the lifter's own bodyweight is the resistance —
 * a plank logged at 0 must not be a validation error, and a squat logged at 0 almost certainly is a
 * typo that would otherwise zero out a week's tonnage without anybody noticing.
 *
 * **This rule cannot be a check constraint**: the answer lives in `exercises.is_bodyweight`, a
 * different table, and copying the flag onto the set would be the snapshot S-02 forbade for the
 * muscle group. So it is enforced in the endpoint — which already loads the entry to verify
 * ownership — and pre-checked by the form from this one definition.
 */
export function isWeightAllowed(weight: number, isBodyweight: boolean): boolean {
  return weight > 0 || isBodyweight;
}
