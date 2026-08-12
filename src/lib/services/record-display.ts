/**
 * What a record row shows — or why it shows nothing.
 *
 * `personal_records` decides WHICH set holds each record; this module decides WHAT NUMBER the
 * screen prints for it. The split is deliberate and is the whole reason the two implementations of
 * the one-rep-max formula cannot contradict each other on screen: the ranking happened in exact
 * `numeric` inside Postgres, and every figure rendered here is re-derived in TypeScript from the
 * winning set's own `weight` and `weight_unit` through the same `set-display.ts` the workout screen
 * uses. **No number computed by SQL is ever displayed.**
 *
 * It also absorbs the one accident of reading through a view: every column arrives `T | null`,
 * because `supabase gen types` cannot prove not-null through one. Narrowing here keeps that out of
 * the page, and turns "this record does not exist" into a value the template can branch on rather
 * than six null checks inline.
 */

import type { EstimationFormula, PersonalRecordRow, WeightUnit } from "@/types";
import type { FallingRecord } from "./record-impact";
import { estimateForLoggedSet, roundForDisplay, weightInUnit } from "./set-display";

/** One record, ready to print: the figure, and the set that still backs it (US-02). */
export interface RecordFigure {
  /** In the unit the reader asked for, rounded at the last possible moment. */
  value: number;
  /** The set behind the record — what it was, as typed, and when. */
  reps: number;
  weight: number;
  weightUnit: WeightUnit;
  performedOn: string;
}

/**
 * The best estimated one-rep max, or `null` when this exercise has none.
 *
 * `null` is the honest answer for an exercise trained only at zero load or only above twelve
 * repetitions — never a 0, which the user would read as "your best here is nothing".
 */
export function bestEstimateFigure(
  row: PersonalRecordRow,
  unit: WeightUnit,
  formula: EstimationFormula,
): RecordFigure | null {
  const reps = row.best_estimate_reps;
  const weight = row.best_estimate_weight;
  const weightUnit = row.best_estimate_weight_unit;
  const performedOn = row.best_estimate_performed_on;

  if (reps === null || weight === null || weightUnit === null || performedOn === null) {
    return null;
  }

  // Re-derived, not read from `best_estimate_kg`: the view ranked in kilograms, and the reader may
  // be reading pounds. Going through the typed weight is what keeps the displayed estimate the same
  // number the workout screen shows for that very set.
  const estimate = estimateForLoggedSet(
    { reps, weight, weight_unit: weightUnit, weight_kg: row.best_estimate_weight_kg },
    unit,
    formula,
  );
  if (estimate.kind !== "estimate") {
    return null;
  }

  return { value: roundForDisplay(estimate.oneRepMax), reps, weight, weightUnit, performedOn };
}

/**
 * What the confirmation dialog prints for a record that is about to fall (S-05).
 *
 * Three outcomes, because there are three: a value it falls to, or one of the two ways of having no
 * successor — which are **different futures for the user** and must not share a sentence.
 * `no_qualifying_set` leaves the exercise on `/records` with nothing shown for this record;
 * `no_sets_left` removes the exercise from that screen entirely, because `personal_records` is
 * anchored on the exercises the account has logged.
 *
 * The figure is re-derived here from the surviving set's own typed `weight` and `weight_unit`,
 * exactly as the two functions above do — **no number Postgres computed is ever displayed**, so the
 * value promised in the dialog is the same value `/records` will show afterwards.
 */
export type FallTo =
  | { kind: "figure"; figure: RecordFigure }
  | { kind: "no_qualifying_set" }
  | { kind: "no_sets_left" };

export function fallToFigure(record: FallingRecord, unit: WeightUnit, formula: EstimationFormula): FallTo {
  if (record.successor.kind !== "candidate") {
    return { kind: record.successor.kind };
  }

  const { set_id: _ignored, performed_on: performedOn, ...set } = record.successor.candidate;
  const shared = { reps: set.reps, weight: set.weight, weightUnit: set.weight_unit, performedOn };

  if (record.kind === "heaviest") {
    return { kind: "figure", figure: { value: roundForDisplay(weightInUnit(set, unit)), ...shared } };
  }

  const estimate = estimateForLoggedSet(set, unit, formula);
  if (estimate.kind !== "estimate") {
    // Unreachable in practice — the successor came out of a ranking that excludes everything
    // unestimable. Written rather than asserted because the alternative is a non-null assertion that
    // would be wrong exactly once, and "sets remain but none qualifies" is the honest answer if it
    // ever were.
    return { kind: "no_qualifying_set" };
  }
  return { kind: "figure", figure: { value: roundForDisplay(estimate.oneRepMax), ...shared } };
}

/**
 * The heaviest absolute load ever handled, or `null` when every set was at zero or assisted.
 *
 * **No repetition limit, deliberately** (owner, 2026-08-11): "heaviest ever handled" is a fact about
 * the load, not an estimate, so a twenty-repetition set counts here while carrying no estimate at
 * all. The two records may therefore belong to different sets, which US-02 requires.
 */
export function heaviestFigure(row: PersonalRecordRow, unit: WeightUnit): RecordFigure | null {
  const reps = row.heaviest_reps;
  const weight = row.heaviest_weight;
  const weightUnit = row.heaviest_weight_unit;
  const performedOn = row.heaviest_performed_on;

  if (reps === null || weight === null || weightUnit === null || performedOn === null) {
    return null;
  }

  return {
    value: roundForDisplay(
      weightInUnit({ reps, weight, weight_unit: weightUnit, weight_kg: row.heaviest_weight_kg }, unit),
    ),
    reps,
    weight,
    weightUnit,
    performedOn,
  };
}
