import { describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH, isWeightAllowed, workoutMessageForCode } from "@/lib/validation/workout";
import { parseAddSet, parseCreateWorkout } from "@/lib/validation/workout-schemas";

const UUID = "6f1c9d5e-6b1a-4a3f-9d2e-1c0b5a7e8f34";

describe("isWeightAllowed: the bodyweight rule", () => {
  // All four combinations of sign and flag. The third row is the one that earns its place: a squat
  // logged at 0 is a typo that would otherwise zero out a week's tonnage with nobody noticing.
  it.each([
    { weight: 100, isBodyweight: false, allowed: true, why: "a loaded barbell lift" },
    { weight: 100, isBodyweight: true, allowed: true, why: "a weighted pull-up" },
    { weight: 0, isBodyweight: false, allowed: false, why: "a squat logged at zero" },
    { weight: 0, isBodyweight: true, allowed: true, why: "a plank" },
    { weight: -20, isBodyweight: false, allowed: false, why: "an assisted barbell lift, which is nonsense" },
    { weight: -20, isBodyweight: true, allowed: true, why: "an assisted pull-up" },
  ])("$why: $weight kg, bodyweight=$isBodyweight -> $allowed", ({ weight, isBodyweight, allowed }) => {
    expect(isWeightAllowed(weight, isBodyweight)).toBe(allowed);
  });
});

describe("parseCreateWorkout", () => {
  it("accepts a date and no note", () => {
    const result = parseCreateWorkout({ performedOn: "2026-08-11" });
    expect(result).toEqual({ success: true, data: { performedOn: "2026-08-11", note: null } });
  });

  it("normalises an empty and a whitespace-only note to null", () => {
    // The `workouts_note_length` constraint starts at one character, so "" would be refused by the
    // database as a violation the user cannot act on. This is where the two agree.
    expect(parseCreateWorkout({ performedOn: "2026-08-11", note: "" })).toEqual({
      success: true,
      data: { performedOn: "2026-08-11", note: null },
    });
    expect(parseCreateWorkout({ performedOn: "2026-08-11", note: "   " })).toEqual({
      success: true,
      data: { performedOn: "2026-08-11", note: null },
    });
  });

  it("trims a real note but keeps it", () => {
    const result = parseCreateWorkout({ performedOn: "2026-08-11", note: "  gym was busy  " });
    expect(result).toEqual({ success: true, data: { performedOn: "2026-08-11", note: "gym was busy" } });
  });

  it("rejects a note one character over the limit", () => {
    const result = parseCreateWorkout({ performedOn: "2026-08-11", note: "x".repeat(MAX_NOTE_LENGTH + 1) });
    expect(result).toEqual({ success: false, code: "note_too_long" });
  });

  it("rejects a date that has the right shape but is not a day", () => {
    // 2026-02-30 passes a regex and would silently land on 2026-03-02.
    expect(parseCreateWorkout({ performedOn: "2026-02-30" })).toEqual({ success: false, code: "date_invalid" });
    expect(parseCreateWorkout({ performedOn: "11-08-2026" })).toEqual({ success: false, code: "date_invalid" });
  });

  it("rejects a missing date and a non-object body", () => {
    expect(parseCreateWorkout({})).toEqual({ success: false, code: "date_required" });
    expect(parseCreateWorkout(null)).toEqual({ success: false, code: "date_required" });
    expect(parseCreateWorkout("2026-08-11")).toEqual({ success: false, code: "date_required" });
  });
});

describe("parseAddSet", () => {
  const base = { exerciseEntryId: UUID, reps: 5, weight: 100 };

  it("accepts a set with no RPE", () => {
    expect(parseAddSet(base)).toEqual({ success: true, data: { ...base, rpe: null } });
  });

  it("accepts a half-point RPE", () => {
    expect(parseAddSet({ ...base, rpe: 8.5 })).toEqual({ success: true, data: { ...base, rpe: 8.5 } });
  });

  it.each([0, 101, 5.5])("rejects %s repetitions", (reps) => {
    expect(parseAddSet({ ...base, reps })).toEqual({ success: false, code: "reps_out_of_range" });
  });

  it("accepts the repetition boundaries themselves", () => {
    expect(parseAddSet({ ...base, reps: 1 }).success).toBe(true);
    expect(parseAddSet({ ...base, reps: 100 }).success).toBe(true);
  });

  it("accepts a negative weight — the assisted case the endpoint decides on", () => {
    // The sign rule needs the exercise's bodyweight flag, which lives in another table, so the
    // schema must not pre-judge it. isWeightAllowed is where that call is made.
    expect(parseAddSet({ ...base, weight: -20 }).success).toBe(true);
    expect(parseAddSet({ ...base, weight: 0 }).success).toBe(true);
  });

  it("accepts two decimal places and rejects three", () => {
    // The limit exists because `sets.weight` stores exactly what arrives, which is what makes the
    // round-trip promise true. Accepting more precision than the column holds would break it.
    expect(parseAddSet({ ...base, weight: 102.25 }).success).toBe(true);
    expect(parseAddSet({ ...base, weight: 100.1 }).success).toBe(true);
    expect(parseAddSet({ ...base, weight: 102.058 })).toEqual({ success: false, code: "weight_too_precise" });
  });

  it("rejects a weight beyond the bounds and a non-finite one", () => {
    expect(parseAddSet({ ...base, weight: 2001 })).toEqual({ success: false, code: "weight_out_of_range" });
    expect(parseAddSet({ ...base, weight: -1001 })).toEqual({ success: false, code: "weight_out_of_range" });
    expect(parseAddSet({ ...base, weight: Number.NaN })).toEqual({ success: false, code: "weight_required" });
  });

  it("rejects an RPE above the scale", () => {
    expect(parseAddSet({ ...base, rpe: 10.5 })).toEqual({ success: false, code: "rpe_out_of_range" });
  });

  it("rejects a malformed entry id before it reaches a query", () => {
    expect(parseAddSet({ ...base, exerciseEntryId: "not-a-uuid" })).toEqual({
      success: false,
      code: "entry_not_found",
    });
  });
});

describe("workoutMessageForCode", () => {
  it("resolves a known code and returns null for an absent one", () => {
    expect(workoutMessageForCode("reps_required")).toBe("Repetitions are required");
    expect(workoutMessageForCode(null)).toBeNull();
    expect(workoutMessageForCode(undefined)).toBeNull();
  });

  it("never echoes the caller's own words", () => {
    // The anti-phishing rule from S-01: an unrecognised code resolves to the generic message, so a
    // server that started sending prose could not put words on this screen.
    const injected = "Account locked. Call 500-123-456";
    expect(workoutMessageForCode(injected)).toBe("Something went wrong. Please try again.");
    expect(workoutMessageForCode("__proto__")).toBe("Something went wrong. Please try again.");
  });
});
