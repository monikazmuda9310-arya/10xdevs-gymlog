import { z } from "zod";

import { isSupportedTimeZone } from "@/lib/services/timezones";
import { ESTIMATION_FORMULAS, WEIGHT_UNITS } from "@/types";
import type { ProfileMessageCode } from "@/lib/validation/profile";

// The server half of the preference rules, built FROM ./profile and from the enum tuples rather
// than restating either — one definition of each rule. Server-only: nothing hydrated may import
// this module, or zod ships to the browser (measured at ~59 KB during S-01), and with it the whole
// timezone list.
//
// Every issue carries a MESSAGE CODE, not a sentence; see PROFILE_MESSAGES for why.
const code = (value: ProfileMessageCode): string => value;

/**
 * The three preferences, as a FULL replacement rather than a patch.
 *
 * The same decision `updateWorkoutSchema` made and for the same reason: a partial patch needs
 * "absent" and "explicitly set" to mean different things, which is invisible in JSON. One Save
 * sends all three, so every value in the row came from something the user was looking at.
 *
 * **The timezone is checked for membership, not for shape.** A regex would pass `Europe/Warsawa`,
 * which `todayIn` then answers for in UTC without complaint (`calendar.ts:29`) — a wrong week
 * boundary with nothing on screen saying so. The check reads the same list the page rendered its
 * options from, so the form cannot offer a value the endpoint refuses.
 */
export const updateProfileSchema = z.object({
  timezone: z
    .string({ error: code("timezone_required") })
    .min(1, code("timezone_required"))
    .refine(isSupportedTimeZone, code("timezone_unknown")),
  // Built from the tuples, so each enum's values live in exactly one place and the compile-time
  // assertions in `@/types` cover this module too.
  weightUnit: z.enum(WEIGHT_UNITS, { error: code("weight_unit_invalid") }),
  estimationFormula: z.enum(ESTIMATION_FORMULAS, { error: code("estimation_formula_invalid") }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export type ParseResult<T> = { success: true; data: T } | { success: false; code: ProfileMessageCode };

/**
 * Parse a decoded JSON body. The settings form is a React island calling `fetch`, so JSON is the
 * honest shape here — unlike the auth endpoints, which read `formData()` because plain HTML forms
 * post them.
 *
 * Anything that is not a plain object is treated as an empty one, so the failure comes from the
 * FIELD schemas and carries a code. Handing zod a string instead makes it raise its own top-level
 * type error, whose `.message` is prose — and that prose would then travel in the `code` field,
 * which is the one channel this project keeps free of provider wording.
 *
 * **`Array.isArray` is not belt-and-braces here.** `typeof [] === "object"` and `[] !== null`, so
 * the two obvious guards both pass an array straight through, and zod answers
 * `"Invalid input: expected object, received array"` — a sentence, in the code field. Measured, not
 * assumed: the unit suite failed on exactly that body before this clause existed.
 */
export function parseUpdateProfile(body: unknown): ParseResult<UpdateProfileInput> {
  const input = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};

  const parsed = updateProfileSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  // The first issue is the one the caller is shown, matching how a form surfaces one message.
  return { success: false, code: parsed.error.issues[0].message as ProfileMessageCode };
}
