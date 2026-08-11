import { describe, expect, it } from "vitest";

import {
  KG_PER_LB,
  bestEstimateOf,
  estimateForLoggedSet,
  roundForDisplay,
  weightInUnit,
  type DisplayableSet,
} from "@/lib/services/set-display";

// The rule under test is "which column feeds the estimate", so every fixture below carries a
// `weight_kg` that DISAGREES with `weight` wherever the two could be confused. A test where both
// columns hold the same number would pass no matter which one the code read.

const set = (fields: Partial<DisplayableSet>): DisplayableSet => ({
  reps: 1,
  weight: 100,
  weight_unit: "kg",
  weight_kg: 100,
  ...fields,
});

describe("weightInUnit", () => {
  it("returns the number the user typed when the set is stored in the unit being read", () => {
    // weight_kg is deliberately absurd: if it were read here, the assertion would fail.
    const value = weightInUnit(set({ weight: 102.5, weight_unit: "kg", weight_kg: 999 }), "kg");
    expect(value).toBe(102.5);
  });

  it("converts through the canonical kilogram column when the units differ", () => {
    const value = weightInUnit(set({ weight: 225, weight_unit: "lb", weight_kg: 102.0582 }), "kg");
    expect(value).toBe(102.0582);
  });

  it("converts kilograms into pounds with the same factor the generated column uses", () => {
    const value = weightInUnit(set({ weight: 100, weight_unit: "kg", weight_kg: 100 }), "lb");
    expect(value).toBeCloseTo(100 / KG_PER_LB, 9);
    expect(roundForDisplay(value)).toBe(220.5);
  });

  it("re-derives the canonical value when the generated column is absent", () => {
    // The types allow null even though the database always fills it; a missing value must not
    // silently become an estimate computed from pounds labelled as kilograms.
    const value = weightInUnit(set({ weight: 225, weight_unit: "lb", weight_kg: null }), "kg");
    expect(value).toBeCloseTo(225 * KG_PER_LB, 9);
  });
});

describe("estimateForLoggedSet", () => {
  it("estimates from the typed weight when the set's unit matches the reader's", () => {
    const estimate = estimateForLoggedSet(
      set({ reps: 1, weight: 140, weight_unit: "kg", weight_kg: 1 }),
      "kg",
      "epley",
    );
    // A single repetition estimates to the weight lifted — here, the number typed, not the
    // canonical column. Both halves of the rule are pinned by this one assertion.
    expect(estimate).toEqual({ kind: "estimate", oneRepMax: 140 });
  });

  it("estimates from the canonical column, converted, when the units differ", () => {
    // Unreachable from the S-03 screen — every set is stored in the profile's unit and the profile
    // cannot be changed yet. Asserted anyway, because S-06 is what makes it reachable.
    const estimate = estimateForLoggedSet(
      set({ reps: 1, weight: 225, weight_unit: "lb", weight_kg: 102.0582 }),
      "kg",
      "brzycki",
    );
    expect(estimate).toEqual({ kind: "estimate", oneRepMax: 102.0582 });
  });

  it("still answers bodyweight, assisted and out-of-range through the unit rule", () => {
    expect(estimateForLoggedSet(set({ weight: 0, weight_kg: 0, reps: 20 }), "kg", "brzycki").kind).toBe("bodyweight");
    expect(estimateForLoggedSet(set({ weight: -20, weight_kg: -20 }), "kg", "brzycki").kind).toBe("assisted");
    expect(estimateForLoggedSet(set({ reps: 15 }), "kg", "brzycki").kind).toBe("out-of-range");
  });
});

describe("bestEstimateOf", () => {
  it("takes the highest estimate among an entry's sets", () => {
    const best = bestEstimateOf(
      [set({ reps: 5, weight: 100, weight_kg: 100 }), set({ reps: 3, weight: 110, weight_kg: 110 })],
      "kg",
      "brzycki",
    );
    // 110 × 36 / 34 beats 100 × 36 / 32 — the heavier set is not automatically the better one, which
    // is the whole reason a record is decided on the estimate rather than on raw weight.
    expect(best).toBeCloseTo((110 * 36) / 34, 9);
  });

  it("skips the sets that carry no number rather than treating them as zero", () => {
    const best = bestEstimateOf(
      [set({ reps: 20, weight: 0, weight_kg: 0 }), set({ reps: 5, weight: 80, weight_kg: 80 })],
      "kg",
      "brzycki",
    );
    expect(best).toBeCloseTo((80 * 36) / 32, 9);
  });

  it("answers null when nothing in the entry is estimable", () => {
    expect(bestEstimateOf([set({ reps: 30, weight: 0, weight_kg: 0 })], "kg", "brzycki")).toBeNull();
    expect(bestEstimateOf([], "kg", "brzycki")).toBeNull();
  });
});

describe("roundForDisplay", () => {
  it("rounds to one decimal place, for the screen only", () => {
    expect(roundForDisplay(112.5)).toBe(112.5);
    expect(roundForDisplay((100 * 36) / 32)).toBe(112.5);
    expect(roundForDisplay(102.05821)).toBe(102.1);
  });
});
