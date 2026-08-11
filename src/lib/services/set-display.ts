/**
 * Which number a stored set is read in, and what that number estimates to.
 *
 * `one-rep-max.ts` is the arithmetic, `set-estimate.ts` decides whether there is a number at all,
 * and this module answers the question those two deliberately do not: **which of a set's three
 * weight columns feeds them.** A set stores what the user typed (`weight`) together with the unit
 * they typed it in (`weight_unit`), and the database derives `weight_kg` from both.
 *
 * The rule: **the estimate is always expressed in the unit the reader is currently reading.** So it
 * is computed from `weight` when the set was stored in that unit — which is the exact number typed,
 * and the reason the round-trip promise is true — and from the canonical `weight_kg` otherwise.
 *
 * In S-03 the second branch is unreachable: every set is stored in the profile's unit and the
 * profile's unit cannot yet be changed. It is written and tested now anyway, because leaving it
 * implicit is how S-06 inherits a screen that quietly estimates in kilograms for somebody reading
 * pounds.
 *
 * Browser-safe: this is imported by a hydrated island, so it pulls in the estimator and types only.
 */

import { estimateForSet, type SetEstimate } from "./set-estimate";
import type { EstimationFormula, WeightUnit } from "@/types";

/**
 * The exact factor the `sets.weight_kg` generated column uses.
 *
 * **There are two copies of this number and they must agree**: this one and the `case weight_unit
 * when 'kg' then weight else weight * 0.45359237 end` expression in
 * `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql`. A second, rounder
 * constant written elsewhere would make two answers possible for the same set — see the plan's
 * § Open Risks.
 */
export const KG_PER_LB = 0.45359237;

/** The columns of a set this module reads. Structural, so both a row and a DTO satisfy it. */
export interface DisplayableSet {
  reps: number;
  weight: number;
  weight_unit: WeightUnit;
  weight_kg: number | null;
}

/**
 * The set's load, expressed in `unit`.
 *
 * When the set was stored in that unit the answer is `weight` itself — not a conversion round trip,
 * which is what keeps "read back the number you typed" exactly true. Otherwise the canonical
 * kilogram value is converted. `weight_kg` is generated and therefore always present in practice;
 * the generated types cannot say so, and re-deriving it is cheaper than a non-null assertion that
 * would be wrong exactly once.
 */
export function weightInUnit(set: DisplayableSet, unit: WeightUnit): number {
  if (set.weight_unit === unit) {
    return set.weight;
  }

  const kilograms = set.weight_kg ?? toKilograms(set.weight, set.weight_unit);
  return unit === "kg" ? kilograms : kilograms / KG_PER_LB;
}

function toKilograms(weight: number, unit: WeightUnit): number {
  return unit === "kg" ? weight : weight * KG_PER_LB;
}

/** What a stored set displays, in the reader's unit and with the reader's formula. */
export function estimateForLoggedSet(set: DisplayableSet, unit: WeightUnit, formula: EstimationFormula): SetEstimate {
  return estimateForSet(weightInUnit(set, unit), set.reps, formula);
}

/**
 * The best estimate among an exercise entry's sets (FR-015), or `null` when none of them carries a
 * number.
 *
 * The three non-numeric kinds are skipped rather than treated as zero: a bodyweight set estimating
 * to 0 must not become "your best on this exercise is 0", which is a number the user would believe.
 */
export function bestEstimateOf(
  sets: readonly DisplayableSet[],
  unit: WeightUnit,
  formula: EstimationFormula,
): number | null {
  let best: number | null = null;

  for (const set of sets) {
    const estimate = estimateForLoggedSet(set, unit, formula);
    if (estimate.kind === "estimate" && (best === null || estimate.oneRepMax > best)) {
      best = estimate.oneRepMax;
    }
  }

  return best;
}

/**
 * One decimal place, for the screen only.
 *
 * Rounding never touches a stored value or a comparison — `AGENTS.md` § Domain rules requires that
 * rounding can neither create nor erase a record, so it happens here, at the last possible moment,
 * and nowhere upstream.
 */
export function roundForDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}
