import { z } from "zod";

import {
  MAX_NOTE_LENGTH,
  MAX_REPS,
  MAX_RPE,
  MAX_WEIGHT,
  MAX_WEIGHT_DECIMALS,
  MIN_REPS,
  MIN_RPE,
  MIN_WEIGHT,
  UUID_PATTERN,
  type WorkoutMessageCode,
} from "@/lib/validation/workout";

// The server half of the logging rules, built FROM ./workout rather than restating it — one
// definition of each rule. Server-only: nothing hydrated may import this module, or zod ships to
// the browser (measured at ~59 KB during S-01).
//
// Every issue carries a MESSAGE CODE, not a sentence; see WORKOUT_MESSAGES for why.
const code = (value: WorkoutMessageCode): string => value;

const uuid = (missing: WorkoutMessageCode, malformed: WorkoutMessageCode) =>
  z.string({ error: code(missing) }).regex(UUID_PATTERN, code(malformed));

/**
 * A calendar date the user stated, `YYYY-MM-DD`. The shape check is not enough on its own —
 * `2026-02-30` has the right shape and is not a day — so the parsed value is required to survive a
 * round trip through Date. Without that, a workout lands on 2026-03-02 and nobody knows why.
 */
const performedOn = z
  .string({ error: code("date_required") })
  .regex(/^\d{4}-\d{2}-\d{2}$/, code("date_invalid"))
  .refine(isRealDate, code("date_invalid"));

/**
 * True when the string names a day that exists.
 *
 * The `Invalid Date` guard is not decoration: `new Date("2026-02-30T00:00:00Z")` does not roll over
 * to March, it produces an invalid date, and calling `.toISOString()` on that **throws** — turning a
 * refinement that should answer "no" into an unhandled RangeError inside the parser. The
 * `startsWith` half then catches the shapes that parse but land elsewhere.
 */
function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Trimmed, and an empty result becomes `null` rather than `""`.
 *
 * The `workouts_note_length` constraint starts at one character, so an untouched note field would
 * otherwise be refused by the database as a violation the user cannot act on. `null` is what "no
 * note" means in this schema, and the transform is where the two agree.
 */
const note = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, code("note_too_long"))
  .nullish()
  .transform((value) => (value === undefined || value === null || value === "" ? null : value));

const reps = z
  .number({ error: code("reps_required") })
  .int(code("reps_out_of_range"))
  .min(MIN_REPS, code("reps_out_of_range"))
  .max(MAX_REPS, code("reps_out_of_range"));

/**
 * The weight as typed, bounded and limited to two decimal places.
 *
 * The precision limit is not fussiness: `sets.weight` is `numeric(7,3)` and stores exactly what
 * arrives, which is what makes "a weight entered in pounds reads back as the number typed" true.
 * Accepting more precision than the column holds would quietly break that on the first value that
 * needed rounding.
 */
// No `.finite()`: zod v4's `z.number()` already rejects NaN and both infinities, so the call is a
// deprecated no-op. The unit suite pins that NaN is refused, which is what makes removing it safe.
const weight = z
  .number({ error: code("weight_required") })
  .min(MIN_WEIGHT, code("weight_out_of_range"))
  .max(MAX_WEIGHT, code("weight_out_of_range"))
  .refine(
    (value) => Math.abs(value * 10 ** MAX_WEIGHT_DECIMALS - Math.round(value * 10 ** MAX_WEIGHT_DECIMALS)) < 1e-9,
    code("weight_too_precise"),
  );

const rpe = z
  .number()
  .min(MIN_RPE, code("rpe_out_of_range"))
  .max(MAX_RPE, code("rpe_out_of_range"))
  .nullish()
  .transform((value) => (value === undefined ? null : value));

export const createWorkoutSchema = z.object({ performedOn, note });
export const addExerciseEntrySchema = z.object({
  workoutId: uuid("workout_not_found", "workout_not_found"),
  exerciseId: uuid("exercise_required", "exercise_not_found"),
});
export const addSetSchema = z.object({
  exerciseEntryId: uuid("entry_not_found", "entry_not_found"),
  reps,
  weight,
  rpe,
});

/**
 * The editable fields of a workout and of a set (S-05), as FULL replacements rather than patches.
 *
 * A partial patch would need "absent" and "explicitly null" to mean different things — and `note` is
 * exactly the field where that distinction is invisible in JSON and easy to get backwards. Sending
 * both fields every time keeps one meaning per value.
 *
 * **`updateSetSchema` carries no weight unit, and that is the point.** The unit is a property of the
 * row being edited, not of the account editing it: re-stamping a set with the profile's current unit
 * would turn 100 lb into 100 kg the first time somebody fixes a typo after changing that preference
 * in S-06, silently corrupting `weight_kg` and every figure derived from it. The service reads the
 * stored unit instead.
 */
export const updateWorkoutSchema = z.object({ performedOn, note });
export const updateSetSchema = z.object({ reps, weight, rpe });

export type UpdateWorkoutInput = z.infer<typeof updateWorkoutSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;

export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type AddExerciseEntryInput = z.infer<typeof addExerciseEntrySchema>;
export type AddSetInput = z.infer<typeof addSetSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; code: WorkoutMessageCode };

function parse<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  // Anything that is not an object is treated as an empty one, so the failure comes from the FIELD
  // schemas and carries a code. Handing zod a string instead makes it raise its own top-level type
  // error, whose `.message` is prose — and that prose would then travel in the `code` field, which
  // is the one channel this project keeps free of provider wording. A unit test pins this.
  const input = typeof body === "object" && body !== null ? body : {};

  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  // The first issue is the one the caller is shown, matching how a form surfaces one message.
  return { success: false, code: parsed.error.issues[0].message as WorkoutMessageCode };
}

// All three endpoints are called by hydrated islands with `fetch`, so JSON is the honest shape —
// unlike the auth endpoints, which read `formData()` because plain HTML forms post them.
export const parseCreateWorkout = (body: unknown): ParseResult<CreateWorkoutInput> => parse(createWorkoutSchema, body);
export const parseAddExerciseEntry = (body: unknown): ParseResult<AddExerciseEntryInput> =>
  parse(addExerciseEntrySchema, body);
export const parseAddSet = (body: unknown): ParseResult<AddSetInput> => parse(addSetSchema, body);
export const parseUpdateWorkout = (body: unknown): ParseResult<UpdateWorkoutInput> => parse(updateWorkoutSchema, body);
export const parseUpdateSet = (body: unknown): ParseResult<UpdateSetInput> => parse(updateSetSchema, body);
