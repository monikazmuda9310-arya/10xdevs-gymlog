import { z } from "zod";
import { MUSCLE_GROUPS } from "@/types";
import { MAX_EXERCISE_NAME_LENGTH, type ExerciseMessageCode } from "@/lib/validation/exercise";

// The server half of the catalogue rules, built FROM ./exercise rather than restating it — one
// definition of each rule. Server-only: nothing hydrated may import this module, or zod ships to
// the browser (measured at ~59 KB during S-01).
//
// Every issue carries a MESSAGE CODE, not a sentence; see EXERCISE_MESSAGES for why.
const code = (value: ExerciseMessageCode): string => value;

export const createExerciseSchema = z.object({
  // **The `error` argument to `z.string()` is not decoration.** `.min()` and `.max()` only run once
  // the value IS a string; an absent or non-string `name` fails the TYPE check first, and without
  // this that failure carries zod's own sentence ("Invalid input: expected string, received
  // undefined") into the `code` field. Found 2026-08-13 by the strengthened assertion in
  // `exercise.test.ts` — the older one checked only that parsing failed, which it did, loudly and
  // in the wrong words.
  name: z
    .string({ error: code("name_required") })
    .trim()
    .min(1, code("name_required"))
    .max(MAX_EXERCISE_NAME_LENGTH, code("name_too_long")),
  // Built from the tuple, so the six live in exactly one place.
  muscleGroup: z.enum(MUSCLE_GROUPS, {
    error: (issue) => (issue.input === undefined ? code("muscle_group_required") : code("muscle_group_invalid")),
  }),
  // Absent means false: an unchecked box is not an error, and the column defaults the same way. The
  // `error` covers a caller that sends something else entirely, for the reason `name` states.
  isBodyweight: z.boolean({ error: code("unexpected") }).default(false),
});

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; code: ExerciseMessageCode };

/**
 * Parse a decoded JSON body. Unlike the auth endpoints — which read `formData()` because they are
 * posted by plain HTML forms — this endpoint is called by a React island with `fetch`, so JSON is
 * the honest shape here. Anything non-object is rejected as a missing name rather than crashing.
 *
 * **The normalisation below is what makes that sentence true**, and until 2026-08-13 it was not
 * here: `safeParse(body ?? {})` handed a bare string or an array straight to zod, which answers with
 * its own prose (`"Invalid input: expected object, received string"`) — and that prose then
 * travelled in the `code` field, the one channel this project keeps free of provider wording. It was
 * reachable: `POST /api/exercises` with a body of `"x"`. Found by S-06's implementation review.
 *
 * `Array.isArray` earns its place separately: `typeof [] === "object"` and `[] !== null`, so the two
 * obvious guards both admit an array.
 */
export function parseCreateExercise(body: unknown): ParseResult<CreateExerciseInput> {
  const input = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};

  const parsed = createExerciseSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  // The first issue is the one the caller is shown, matching how the form surfaces one message.
  return { success: false, code: parsed.error.issues[0].message as ExerciseMessageCode };
}
