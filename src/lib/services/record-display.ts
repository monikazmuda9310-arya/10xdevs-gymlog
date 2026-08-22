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
import type { FallingRecord, RecordKind } from "./record-impact";
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
 * The two record kinds as a reader sees them named, and the sentence each one's future is written
 * into. Both lived in `RecordImpactDialog.tsx` until 2026-08-22; they moved here because a rule
 * living inside a `client:load` island is a rule the unit suite cannot reach, and this one shipped
 * a visible defect to the deployed app with every gate green.
 */
const RECORD_LABEL: Record<RecordKind, string> = {
  estimate: "best estimated 1RM",
  heaviest: "heaviest weight",
};

/**
 * One sentence, and **what that sentence is about** — which is the whole point of the type.
 *
 * `fallingRecords` emits one entry per record KIND, and it is right to: a set holding both records
 * really does take both of them down. But one of the three futures is not about a record at all.
 * "Back Squat will no longer appear in your records at all" is a fact about the **exercise**, so a
 * set that holds both records and is the last one logged for its lift produced that sentence twice,
 * word for word, on the deployed app.
 *
 * So a sentence declares its own scope and the caller collapses on it. The alternative — comparing
 * the rendered strings — works today only because the other branches happen to interpolate
 * `RECORD_LABEL`; the day one of them stops, two genuinely different records would collapse into one
 * row and nothing would say so.
 */
export interface ImpactSentence {
  /** `"record"`: true of one of the two records. `"exercise"`: true of the lift as a whole. */
  scope: "record" | "exercise";
  text: string;
}

/** A sentence with the identity of its subject attached — the collapse, and the React key. */
export interface ImpactRow extends ImpactSentence {
  key: string;
}

/**
 * One record's future, in one sentence.
 *
 * **An edit is stated conditionally and a deletion absolutely**, and the difference is not politeness.
 * The exact record after an edit is `max(the set's new estimate, the successor)`, and computing the
 * first in float64 to compare against the second — which Postgres produced in exact `numeric` — is
 * the one comparison this project forbids. So the dialog quotes the successor, which is exact, and
 * says "if this change takes the record off this set".
 *
 * **`no_sets_left` is a deletion's answer only.** The impact query excludes the set being edited, so
 * "nothing else survives" comes back for an exercise whose only set is the one being corrected — but
 * that set is not going anywhere, and the exercise will still be on `/records` afterwards. Telling
 * somebody their lift is about to vanish because they fixed its RPE would be exactly the invented
 * screen state the three-outcome successor type exists to prevent, so an edit reads both empty
 * outcomes as "nothing else could hold it". **That is also why only the delete path can return
 * `scope: "exercise"`**: every other branch interpolates `RECORD_LABEL` and therefore says something
 * true of one record only.
 */
export function impactSentence(
  record: FallingRecord,
  action: "delete" | "edit",
  unit: WeightUnit,
  formula: EstimationFormula,
): ImpactSentence {
  const label = RECORD_LABEL[record.kind];
  const fall = fallToFigure(record, unit, formula);

  if (action === "edit") {
    if (fall.kind !== "figure") {
      return {
        scope: "record",
        text: `If this change takes the ${label} for ${record.exerciseName} off this set, no other set can hold it — the exercise would show none.`,
      };
    }
    return {
      scope: "record",
      text: `If this change takes the ${label} for ${record.exerciseName} off this set, it falls to ${fall.figure.value} ${unit}, from ${fall.figure.reps} × ${fall.figure.weight} ${fall.figure.weightUnit} on ${fall.figure.performedOn}.`,
    };
  }

  switch (fall.kind) {
    case "figure":
      return {
        scope: "record",
        text: `Your ${label} for ${record.exerciseName} falls to ${fall.figure.value} ${unit}, from ${fall.figure.reps} × ${fall.figure.weight} ${fall.figure.weightUnit} on ${fall.figure.performedOn}.`,
      };
    case "no_qualifying_set":
      return {
        scope: "record",
        text: `${record.exerciseName} will have no ${label}: no other set you have logged for it qualifies.`,
      };
    case "no_sets_left":
      return {
        scope: "exercise",
        text: `${record.exerciseName} will no longer appear in your records at all — this removes the last set you have logged for it.`,
      };
  }
}

/**
 * The list the dialog prints: **one row per distinct future**, not one per affected record.
 *
 * A record-scoped sentence is identified by its exercise AND its kind, so two records falling for the
 * same lift stay two rows — they are different futures and the product's whole S-05 premise is that
 * different futures never share a sentence. An exercise-scoped sentence is identified by the exercise
 * alone, so the pair that produced the duplicate collapses to one.
 *
 * Order is the caller's, first occurrence wins: the rows read in the order the records were affected.
 */
export function impactSentences(
  records: readonly FallingRecord[],
  action: "delete" | "edit",
  unit: WeightUnit,
  formula: EstimationFormula,
): ImpactRow[] {
  const rows: ImpactRow[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const sentence = impactSentence(record, action, unit, formula);
    const key =
      sentence.scope === "exercise" ? `exercise-${record.exerciseId}` : `record-${record.kind}-${record.exerciseId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({ key, ...sentence });
  }

  return rows;
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
