import { describe, expect, it } from "vitest";

import {
  estimateOneRepMax,
  isEstimable,
  MAX_ESTIMABLE_REPS,
  MIN_ESTIMABLE_REPS,
  type EstimationFormula,
} from "@/lib/services/one-rep-max";

const FORMULAS: EstimationFormula[] = ["brzycki", "epley"];

describe("estimateOneRepMax", () => {
  it("returns the weight lifted at exactly one repetition, for both formulas", () => {
    expect(estimateOneRepMax(100, 1, "brzycki")).toBe(100);
    expect(estimateOneRepMax(100, 1, "epley")).toBe(100);
  });

  it("applies Brzycki inside the estimable range", () => {
    expect(estimateOneRepMax(100, 5, "brzycki")).toBe(112.5);
    expect(estimateOneRepMax(60, 8, "brzycki")).toBeCloseTo(74.48275862068965, 10);
  });

  it("applies Epley inside the estimable range", () => {
    expect(estimateOneRepMax(100, 5, "epley")).toBeCloseTo(116.66666666666667, 10);
    expect(estimateOneRepMax(60, 8, "epley")).toBe(76);
  });

  it("includes the twelve-repetition upper edge", () => {
    expect(estimateOneRepMax(100, MAX_ESTIMABLE_REPS, "brzycki")).toBe(144);
    expect(estimateOneRepMax(100, MAX_ESTIMABLE_REPS, "epley")).toBe(140);
  });

  it("gives no estimate outside one to twelve repetitions", () => {
    for (const formula of FORMULAS) {
      expect(estimateOneRepMax(100, 0, formula)).toBeNull();
      expect(estimateOneRepMax(100, MAX_ESTIMABLE_REPS + 1, formula)).toBeNull();
      // 37 would divide by zero under Brzycki, 40 would return a negative estimate.
      expect(estimateOneRepMax(100, 37, formula)).toBeNull();
      expect(estimateOneRepMax(100, 40, formula)).toBeNull();
    }
  });

  it("gives no estimate for a non-integer repetition count", () => {
    for (const formula of FORMULAS) {
      expect(estimateOneRepMax(100, 2.5, formula)).toBeNull();
    }
  });

  it("estimates a zero-load set at zero rather than excluding it", () => {
    for (const formula of FORMULAS) {
      expect(estimateOneRepMax(0, 5, formula)).toBe(0);
      expect(estimateOneRepMax(0, 1, formula)).toBe(0);
    }
  });

  it("gives no estimate for an assisted (negative-load) set", () => {
    for (const formula of FORMULAS) {
      expect(estimateOneRepMax(-20, 5, formula)).toBeNull();
      expect(estimateOneRepMax(-20, 1, formula)).toBeNull();
    }
  });

  it("gives no estimate for a non-finite load", () => {
    for (const formula of FORMULAS) {
      expect(estimateOneRepMax(Number.NaN, 5, formula)).toBeNull();
      expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 5, formula)).toBeNull();
    }
  });

  it("is deterministic across the whole estimable range", () => {
    for (const formula of FORMULAS) {
      for (let reps = MIN_ESTIMABLE_REPS; reps <= MAX_ESTIMABLE_REPS; reps += 1) {
        const first = estimateOneRepMax(97.5, reps, formula);
        const second = estimateOneRepMax(97.5, reps, formula);

        expect(first).not.toBeNull();
        expect(second).toBe(first);
      }
    }
  });
});

describe("isEstimable", () => {
  it("accepts every integer repetition count from one to twelve", () => {
    for (let reps = MIN_ESTIMABLE_REPS; reps <= MAX_ESTIMABLE_REPS; reps += 1) {
      expect(isEstimable(100, reps)).toBe(true);
    }
  });

  it("rejects repetition counts outside the range and non-integers", () => {
    expect(isEstimable(100, 0)).toBe(false);
    expect(isEstimable(100, MAX_ESTIMABLE_REPS + 1)).toBe(false);
    expect(isEstimable(100, 2.5)).toBe(false);
    expect(isEstimable(100, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts a zero load but rejects an assisted (negative) load", () => {
    expect(isEstimable(0, 5)).toBe(true);
    expect(isEstimable(-20, 5)).toBe(false);
  });

  it("rejects a non-finite load", () => {
    expect(isEstimable(Number.NaN, 5)).toBe(false);
    expect(isEstimable(Number.POSITIVE_INFINITY, 5)).toBe(false);
  });
});
