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
  name: z.string().trim().min(1, code("name_required")).max(MAX_EXERCISE_NAME_LENGTH, code("name_too_long")),
  // Built from the tuple, so the six live in exactly one place.
  muscleGroup: z.enum(MUSCLE_GROUPS, {
    error: (issue) => (issue.input === undefined ? code("muscle_group_required") : code("muscle_group_invalid")),
  }),
  // Absent means false: an unchecked box is not an error, and the column defaults the same way.
  isBodyweight: z.boolean().default(false),
});

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; code: ExerciseMessageCode };

/**
 * Parse a decoded JSON body. Unlike the auth endpoints — which read `formData()` because they are
 * posted by plain HTML forms — this endpoint is called by a React island with `fetch`, so JSON is
 * the honest shape here. Anything non-object is rejected as a missing name rather than crashing.
 */
export function parseCreateExercise(body: unknown): ParseResult<CreateExerciseInput> {
  const parsed = createExerciseSchema.safeParse(body ?? {});
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  // The first issue is the one the caller is shown, matching how the form surfaces one message.
  return { success: false, code: parsed.error.issues[0].message as ExerciseMessageCode };
}
