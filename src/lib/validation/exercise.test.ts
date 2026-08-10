// The catalogue's input rules at their boundaries, plus the LIKE-escaping that decides whether a
// search for "100%" means what the person typing it meant.

import { describe, expect, it } from "vitest";

import { MUSCLE_GROUPS } from "@/types";
import {
  MAX_EXERCISE_NAME_LENGTH,
  EXERCISE_MESSAGES,
  exerciseMessageForCode,
  isMuscleGroup,
} from "@/lib/validation/exercise";
import { parseCreateExercise } from "@/lib/validation/exercise-schemas";
import { escapeLikePattern, assertUserId } from "@/lib/services/exercises";

const VALID = { name: "Zercher Squat", muscleGroup: "legs", isBodyweight: false };

describe("isMuscleGroup", () => {
  it("accepts every one of the six the owner chose", () => {
    for (const group of MUSCLE_GROUPS) {
      expect(isMuscleGroup(group)).toBe(true);
    }
  });

  it("rejects a group that was considered and declined", () => {
    // Glutes and a biceps/triceps split were both declined on 2026-08-10. If either is ever added,
    // it goes in the Postgres enum and MUSCLE_GROUPS together — not into a caller's request body.
    expect(isMuscleGroup("glutes")).toBe(false);
    expect(isMuscleGroup("biceps")).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    expect(isMuscleGroup(null)).toBe(false);
    expect(isMuscleGroup(undefined)).toBe(false);
    expect(isMuscleGroup(7)).toBe(false);
    expect(isMuscleGroup({})).toBe(false);
  });
});

describe("parseCreateExercise", () => {
  it("accepts a well-formed exercise", () => {
    const result = parseCreateExercise(VALID);

    expect(result).toEqual({ success: true, data: { ...VALID, isBodyweight: false } });
  });

  it("defaults isBodyweight to false when absent — an unticked box is not an error", () => {
    const result = parseCreateExercise({ name: "Zercher Squat", muscleGroup: "legs" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBodyweight).toBe(false);
    }
  });

  it("trims the name it stores", () => {
    const result = parseCreateExercise({ ...VALID, name: "  Zercher Squat  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Zercher Squat");
    }
  });

  it("rejects an empty name", () => {
    expect(parseCreateExercise({ ...VALID, name: "" })).toEqual({ success: false, code: "name_required" });
  });

  it("rejects a whitespace-only name — trimmed first, so this is empty", () => {
    expect(parseCreateExercise({ ...VALID, name: "   " })).toEqual({ success: false, code: "name_required" });
  });

  it(`accepts a name of exactly ${String(MAX_EXERCISE_NAME_LENGTH)} characters`, () => {
    const result = parseCreateExercise({ ...VALID, name: "a".repeat(MAX_EXERCISE_NAME_LENGTH) });

    expect(result.success).toBe(true);
  });

  it("rejects a name one character over the limit — the database check would too", () => {
    // The schema and the `exercises_name_length` constraint must agree: if the schema were looser,
    // the user would get a 500 from Postgres instead of a message they can act on.
    const result = parseCreateExercise({ ...VALID, name: "a".repeat(MAX_EXERCISE_NAME_LENGTH + 1) });

    expect(result).toEqual({ success: false, code: "name_too_long" });
  });

  it("rejects an absent muscle group", () => {
    expect(parseCreateExercise({ name: "Zercher Squat" })).toEqual({
      success: false,
      code: "muscle_group_required",
    });
  });

  it("rejects a muscle group outside the six", () => {
    expect(parseCreateExercise({ ...VALID, muscleGroup: "glutes" })).toEqual({
      success: false,
      code: "muscle_group_invalid",
    });
  });

  it("does not crash on a body that is not an object", () => {
    // A caller can post anything. None of these may reach Postgres or raise.
    for (const body of [null, undefined, "string", 42, []]) {
      expect(parseCreateExercise(body).success).toBe(false);
    }
  });
});

describe("escapeLikePattern", () => {
  it("escapes the three characters LIKE treats as special", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves an ordinary search term alone", () => {
    expect(escapeLikePattern("bench press")).toBe("bench press");
  });

  it("means what the person typing it meant", () => {
    // Unescaped, "100%" would match every name starting with "100", and "_" would match every
    // single-character name — a search box that quietly does something else.
    expect(escapeLikePattern("%")).not.toBe("%");
    expect(escapeLikePattern("_")).not.toBe("_");
  });
});

describe("exerciseMessageForCode", () => {
  it("resolves a known code to this project's text", () => {
    expect(exerciseMessageForCode("duplicate_name")).toBe(EXERCISE_MESSAGES.duplicate_name);
  });

  it("renders nothing when there is no code", () => {
    expect(exerciseMessageForCode(null)).toBeNull();
    expect(exerciseMessageForCode("")).toBeNull();
  });

  it("refuses to repeat a caller's own words back as a system message", () => {
    expect(exerciseMessageForCode("Your account is locked, call 500-123-456")).toBe(EXERCISE_MESSAGES.unexpected);
    expect(exerciseMessageForCode("__proto__")).toBe(EXERCISE_MESSAGES.unexpected);
  });
});

describe("assertUserId", () => {
  it("accepts a Supabase user id", () => {
    const id = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

    expect(assertUserId(id)).toBe(id);
  });

  it("refuses a value carrying PostgREST filter syntax", () => {
    // The reason the guard exists. `.or()` takes an expression, where `,` separates terms — so a
    // value containing one would stop being data and start being syntax.
    expect(() => assertUserId("00000000-0000-0000-0000-000000000000,user_id.not.is.null")).toThrow();
    expect(() => assertUserId("*")).toThrow();
    expect(() => assertUserId("")).toThrow();
  });

  it("refuses a value that merely looks close", () => {
    // Truncated, over-long, and non-hex all fail — the shape is checked, not just the punctuation.
    expect(() => assertUserId("0a1b2c3d-4e5f-6789-abcd-ef012345678")).toThrow();
    expect(() => assertUserId("0a1b2c3d4e5f6789abcdef0123456789")).toThrow();
    expect(() => assertUserId("zzzzzzzz-4e5f-6789-abcd-ef0123456789")).toThrow();
  });
});
