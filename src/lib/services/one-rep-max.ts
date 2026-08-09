/**
 * Estimated one-repetition maximum.
 *
 * Plain, dependency-free arithmetic: no imports, no I/O, no rounding, no unit awareness. Rounding
 * is a presentation concern — record comparison must happen on the unrounded value, so that a
 * rounding step can never invent a record or erase one.
 */

export type EstimationFormula = "epley" | "brzycki";

/** Below this many repetitions there is no set to estimate from. */
export const MIN_ESTIMABLE_REPS = 1;

/**
 * Above this many repetitions an estimate is not trustworthy, and Brzycki stops being defined at
 * all: `36 / (37 - reps)` divides by zero at 37 repetitions and goes negative beyond it.
 */
export const MAX_ESTIMABLE_REPS = 12;

/**
 * Whether a set can carry an estimate at all. Sets that fail this are excluded from estimation and
 * from record detection — never given a fabricated number.
 *
 * Assisted sets carry a negative load and are excluded here. A zero load is *not* excluded: a
 * bodyweight set is recorded honestly and estimates to 0.
 */
export function isEstimable(weight: number, reps: number): boolean {
  return (
    Number.isInteger(reps) &&
    reps >= MIN_ESTIMABLE_REPS &&
    reps <= MAX_ESTIMABLE_REPS &&
    Number.isFinite(weight) &&
    weight >= 0
  );
}

/**
 * Estimated one-repetition maximum for a set, or `null` when the set is not estimable.
 *
 * At exactly one repetition the estimate is the weight lifted. Brzycki yields that naturally;
 * Epley does not (it returns `1.0333 × weight`), so it is pinned here.
 */
export function estimateOneRepMax(weight: number, reps: number, formula: EstimationFormula): number | null {
  if (!isEstimable(weight, reps)) {
    return null;
  }

  if (reps === 1) {
    return weight;
  }

  return formula === "brzycki" ? (weight * 36) / (37 - reps) : weight * (1 + reps / 30);
}
