// The preference rules at their boundaries: the message catalogue, and the schema that decides
// which strings may reach `profiles`.

import { describe, expect, it } from "vitest";

import { ESTIMATION_FORMULAS, WEIGHT_UNITS } from "@/types";
import { PROFILE_MESSAGES, profileMessageForCode } from "@/lib/validation/profile";
import { parseUpdateProfile } from "@/lib/validation/profile-schemas";

const VALID = { timezone: "Europe/Warsaw", weightUnit: "kg", estimationFormula: "brzycki" };

describe("profileMessageForCode", () => {
  it("resolves a known code to its sentence", () => {
    expect(profileMessageForCode("timezone_unknown")).toBe(PROFILE_MESSAGES.timezone_unknown);
  });

  it("returns null for an absent code rather than a sentence nobody asked for", () => {
    expect(profileMessageForCode(null)).toBeNull();
    expect(profileMessageForCode(undefined)).toBeNull();
    expect(profileMessageForCode("")).toBeNull();
  });

  it("never echoes the caller's own words back onto the screen", () => {
    // The phishing shape S-01's review found: prose arriving from outside, rendered as a genuine
    // system message on our own domain. An unrecognised code resolves to the generic sentence.
    const attack = "Account locked. Call 500-123-456";
    expect(profileMessageForCode(attack)).toBe(PROFILE_MESSAGES.unexpected);
    expect(profileMessageForCode("__proto__")).toBe(PROFILE_MESSAGES.unexpected);
    expect(profileMessageForCode("toString")).toBe(PROFILE_MESSAGES.unexpected);
  });
});

describe("parseUpdateProfile", () => {
  it("accepts the three preferences together", () => {
    const parsed = parseUpdateProfile(VALID);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(VALID);
  });

  it("accepts every value of both enums, so no preference is unreachable", () => {
    for (const weightUnit of WEIGHT_UNITS) {
      for (const estimationFormula of ESTIMATION_FORMULAS) {
        expect(parseUpdateProfile({ ...VALID, weightUnit, estimationFormula }).success).toBe(true);
      }
    }
  });

  it("refuses a well-formed timezone that is not a real zone", () => {
    // The whole reason the check is membership rather than shape. Before this slice the column was
    // unwritable, so `todayIn`'s UTC fallback was unreachable; a form makes it reachable.
    const parsed = parseUpdateProfile({ ...VALID, timezone: "Europe/Warsawa" });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.code).toBe("timezone_unknown");
  });

  it("tells a missing timezone apart from an unknown one", () => {
    const missing = parseUpdateProfile({ weightUnit: "kg", estimationFormula: "brzycki" });
    expect(!missing.success && missing.code).toBe("timezone_required");

    const empty = parseUpdateProfile({ ...VALID, timezone: "" });
    expect(!empty.success && empty.code).toBe("timezone_required");
  });

  it("refuses a unit and a formula that are not in the enum", () => {
    const unit = parseUpdateProfile({ ...VALID, weightUnit: "stone" });
    expect(!unit.success && unit.code).toBe("weight_unit_invalid");

    const formula = parseUpdateProfile({ ...VALID, estimationFormula: "lombardi" });
    expect(!formula.success && formula.code).toBe("estimation_formula_invalid");
  });

  it("refuses a partial payload — the update is a replacement, not a patch", () => {
    // Sending one field would leave the other two to mean "unchanged", which JSON cannot express
    // apart from "explicitly absent". One Save sends all three.
    expect(parseUpdateProfile({ timezone: "Europe/Warsaw" }).success).toBe(false);
    expect(parseUpdateProfile({ weightUnit: "lb" }).success).toBe(false);
  });

  it("answers with a CODE for a body that is not an object, never with zod's own prose", () => {
    // Handing zod a string raises its own top-level type error, whose `.message` is a sentence —
    // and that sentence would then travel in the `code` field, the one channel this project keeps
    // free of provider wording.
    for (const body of ["nonsense", 7, null, undefined, []]) {
      const parsed = parseUpdateProfile(body);
      expect(parsed.success).toBe(false);
      expect(!parsed.success && Object.hasOwn(PROFILE_MESSAGES, parsed.code)).toBe(true);
    }
  });
});
