/**
 * What a logged set shows.
 *
 * `one-rep-max.ts` answers "what is the number". This answers "is there a number, and if not, why
 * not" — and the difference matters because three of the four answers are not numbers. A set that
 * simply shows nothing teaches the user nothing; a set that says "bodyweight" or "outside 1–12
 * repetitions" tells them why the product is declining to guess.
 *
 * A separate module rather than an addition to `one-rep-max.ts`, whose stated character is no
 * rounding and no unit awareness. That file is arithmetic; this one is presentation, and it must
 * stay importable by a hydrated island — so it imports the estimator and nothing else.
 */

import { estimateOneRepMax, type EstimationFormula } from "./one-rep-max";

export type SetEstimate =
  | { kind: "estimate"; oneRepMax: number }
  | { kind: "bodyweight" }
  | { kind: "assisted" }
  | { kind: "out-of-range" };

/**
 * Decide what a set displays, in the unit the caller passed the weight in — this function is
 * unit-blind, exactly like the estimator underneath it.
 *
 * **The order of these branches is the contract, not an implementation detail.** Zero weight is
 * answered FIRST, whatever the repetition count: a plank held for twenty is a bodyweight set, not
 * an unestimable one, and telling the user "outside 1–12" there would answer a question they did
 * not ask. Negative load is next, because an assisted lift has no meaningful strength score at any
 * repetition count. Only then does the repetition range get a say.
 */
export function estimateForSet(weight: number, reps: number, formula: EstimationFormula): SetEstimate {
  if (weight === 0) {
    return { kind: "bodyweight" };
  }

  if (weight < 0) {
    return { kind: "assisted" };
  }

  // Covers the repetition range, non-integer repetitions and non-finite weights alike: the
  // estimator returns null for every set it refuses to fabricate a number for.
  const oneRepMax = estimateOneRepMax(weight, reps, formula);
  if (oneRepMax === null) {
    return { kind: "out-of-range" };
  }

  return { kind: "estimate", oneRepMax };
}
