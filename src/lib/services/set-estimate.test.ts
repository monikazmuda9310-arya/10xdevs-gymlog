import { describe, expect, it } from "vitest";

import { estimateForSet } from "@/lib/services/set-estimate";
import type { EstimationFormula } from "@/lib/services/one-rep-max";

const FORMULAS: EstimationFormula[] = ["brzycki", "epley"];

describe("estimateForSet: zero load is answered first", () => {
  // The branch order is the contract. These three look like one test written three times and are
  // not: the third is the one that fails if zero weight is ever checked AFTER the repetition range.
  it.each([1, 5, 20])("a set of %i repetitions at zero load reads as bodyweight", (reps) => {
    for (const formula of FORMULAS) {
      expect(estimateForSet(0, reps, formula)).toEqual({ kind: "bodyweight" });
    }
  });

  it("twenty repetitions at zero load is bodyweight, NOT out-of-range", () => {
    // A plank held for twenty is a bodyweight set. Answering "outside 1-12" here would be replying
    // to a question the user did not ask.
    expect(estimateForSet(0, 20, "brzycki")).toEqual({ kind: "bodyweight" });
  });
});

describe("estimateForSet: assisted sets have no strength score", () => {
  it.each([1, 8, 20])("a set of %i repetitions at negative load reads as assisted", (reps) => {
    for (const formula of FORMULAS) {
      expect(estimateForSet(-20, reps, formula)).toEqual({ kind: "assisted" });
    }
  });
});

describe("estimateForSet: the validity range", () => {
  it("shows no number above twelve repetitions", () => {
    for (const formula of FORMULAS) {
      expect(estimateForSet(100, 13, formula)).toEqual({ kind: "out-of-range" });
    }
  });

  it("shows no number where Brzycki breaks outright", () => {
    // 36 / (37 - reps) divides by zero at 37 and goes negative beyond it.
    for (const formula of FORMULAS) {
      expect(estimateForSet(100, 37, formula)).toEqual({ kind: "out-of-range" });
      expect(estimateForSet(100, 40, formula)).toEqual({ kind: "out-of-range" });
    }
  });

  it("shows no number for zero repetitions or a fractional set", () => {
    for (const formula of FORMULAS) {
      expect(estimateForSet(100, 0, formula)).toEqual({ kind: "out-of-range" });
      expect(estimateForSet(100, 2.5, formula)).toEqual({ kind: "out-of-range" });
    }
  });

  it("shows no number for a non-finite weight", () => {
    expect(estimateForSet(Number.NaN, 5, "brzycki")).toEqual({ kind: "out-of-range" });
    expect(estimateForSet(Number.POSITIVE_INFINITY, 5, "brzycki")).toEqual({ kind: "out-of-range" });
  });
});

describe("estimateForSet: the numbers themselves", () => {
  it("a single repetition estimates to exactly the weight lifted, in both formulas", () => {
    // The most visible place this product can be wrong: reporting a 100 kg single as 103 kg.
    expect(estimateForSet(100, 1, "brzycki")).toEqual({ kind: "estimate", oneRepMax: 100 });
    expect(estimateForSet(100, 1, "epley")).toEqual({ kind: "estimate", oneRepMax: 100 });
  });

  it("twelve repetitions is inside the range and carries a number", () => {
    expect(estimateForSet(100, 12, "brzycki")).toEqual({ kind: "estimate", oneRepMax: 144 });
    expect(estimateForSet(100, 12, "epley")).toEqual({ kind: "estimate", oneRepMax: 140 });
  });

  it("is unit-blind — it estimates from whatever number it was handed", () => {
    // The caller decides which unit the weight is in; this function never converts. 225 lb at one
    // repetition is a 225 lb estimate, not a 102 kg one.
    expect(estimateForSet(225, 1, "brzycki")).toEqual({ kind: "estimate", oneRepMax: 225 });
  });

  it("does not round", () => {
    // Rounding is presentation. A record comparison that ran on a rounded value could invent a
    // record or erase one, which is why it does not happen here.
    const result = estimateForSet(100, 5, "brzycki");
    expect(result).toEqual({ kind: "estimate", oneRepMax: 112.5 });

    const epley = estimateForSet(100, 7, "epley");
    expect(epley.kind).toBe("estimate");
    expect(epley.kind === "estimate" && Number.isInteger(epley.oneRepMax)).toBe(false);
  });
});
