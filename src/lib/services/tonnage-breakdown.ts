/**
 * Where the week's work went (FR-018, FR-019, US-03) — one week's tonnage folded per muscle group
 * and per exercise, from the `(day, exercise)` rows `public.daily_exercise_tonnage` emits.
 *
 * **Pure, dependency-free, and free of `astro:*` imports**, so the hermetic unit suite reaches every
 * guard below with injected rows. That is the whole reason this module is separate from
 * `tonnage.ts`: S-07 put its equivalent guards behind a Supabase client, where only an integration
 * suite could exercise them, and this phase does not repeat that.
 *
 * **The reconciliation guard is the point of the module, not a detail of it.** US-03's criterion is
 * that the group figures sum to the week's total, and this is the layer that makes that a runtime
 * property rather than a claim: `foldBreakdown` compares its own sum against the total
 * `weeklyTonnage` already produced and throws when they differ. A breakdown that does not add up is
 * never rendered — the dashboard degrades the breakdown alone and keeps the two totals, which are
 * S-07's proven feature.
 */

import type { DateRange } from "@/lib/services/calendar";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/types";

/**
 * One row of `public.daily_exercise_tonnage`, as the view hands it over.
 *
 * Every column arrives `T | null` because Postgres cannot prove not-null through a view. Narrowed
 * here, once, by throwing — see `assertPresent` for why a null is a read error rather than a row
 * worth nothing.
 */
export interface BreakdownRow {
  performed_on: string | null;
  exercise_id: string | null;
  exercise_name: string | null;
  muscle_group: MuscleGroup | null;
  tonnage_kg: number | null;
}

/** One exercise's tonnage for the week. `name` and `muscleGroup` are null when the account can no
 * longer read the exercise behind its own set — see `groups` below. */
export interface ExerciseTonnage {
  exerciseId: string;
  name: string | null;
  muscleGroup: MuscleGroup | null;
  kilograms: number;
}

/** One muscle group's tonnage for the week. `group: null` is the `Unattributed` row. */
export interface GroupTonnage {
  group: MuscleGroup | null;
  kilograms: number;
  /**
   * `false` only when the account logged NO sets in this group that week. The same distinction
   * `WeekTonnage.hasSets` carries: a group of planks has sets and zero kilograms, and the screen
   * must say "no external load" rather than "you did not train it".
   */
  hasSets: boolean;
}

export interface WeekBreakdown {
  groups: GroupTonnage[];
  exercises: ExerciseTonnage[];
  /** The folded total. Equal to the week total passed in, within `RECONCILIATION_TOLERANCE_KG`. */
  kilograms: number;
}

/**
 * The bound S-07's constant `14` cannot be carried over to.
 *
 * A breakdown at `(day, exercise)` grain returns `days × distinct exercises per day` rows — bounded
 * by training habit rather than by a constant. Thirty distinct exercises in one day is not a
 * training day, so seven days of that is the ceiling above which the read has stopped being what
 * this module claims it is.
 *
 * **A `throw`, never a `.limit()`.** S-07's words: "a limit is a silent truncation, which is the
 * same defect wearing a seatbelt" — and here it would be worse, because a truncated breakdown would
 * fail its own reconciliation guard and be blamed on the arithmetic. Because a breakdown failure
 * degrades only the breakdown, an implausibly wide day costs the user the breakdown and keeps their
 * totals.
 */
export const MAX_BREAKDOWN_ROWS = 7 * 30;

/**
 * **A float artefact, not a data allowance.**
 *
 * Both views sum in `numeric`, which is exact. The Worker sums in `double`, and totalling per-day
 * rows (`weeklyTonnage`) and totalling per-`(day, exercise)` rows (here) are two different summation
 * orders over the same values, so they may differ in the last bits. That is the only difference this
 * tolerance is here to absorb.
 *
 * A thousandth of a kilogram is three orders of magnitude below the display resolution (whole units)
 * and many orders above the achievable float error, so it cannot mask a real discrepancy: a single
 * dropped set would be off by kilograms, not by grams.
 *
 * **`tests/integration/tonnage-breakdown.test.ts` compares within `1e-6` instead, a thousand times
 * tighter, and the asymmetry is deliberate.** That suite sums a fixture of a few dozen sets, where
 * the achievable error is far below a microgram, so a looser bound there would hide a defect this
 * runtime guard cannot afford to reject. Two similar decisions made differently and silently is what
 * leaves the next reader guessing (`lessons.md`), so both places say so.
 */
export const RECONCILIATION_TOLERANCE_KG = 0.001;

/**
 * Fold one week's `(day, exercise)` rows into what a screen needs, or refuse.
 *
 * `weekTotalKg` is the figure `weeklyTonnage` already produced for the same week and the screen is
 * already printing. Passing it in is what makes the reconciliation a comparison against the number
 * the user can actually see, rather than against a second read of the same view.
 */
export function foldBreakdown(rows: BreakdownRow[], week: DateRange, weekTotalKg: number): WeekBreakdown {
  if (rows.length > MAX_BREAKDOWN_ROWS) {
    throw new Error(
      `foldBreakdown: ${String(rows.length)} rows for ${week.start}..${week.end} exceeds ` +
        `${String(MAX_BREAKDOWN_ROWS)}; refusing to fold an implausible week`,
    );
  }

  const byExercise = new Map<string, ExerciseTonnage>();
  const byGroup = new Map<MuscleGroup | null, GroupTonnage>();
  // Every one of the six is present from the start, so an untrained group reads as `0` rather than
  // vanishing — the imbalance FR-019 exists to show is only visible if the empty rows are there.
  // The null group is NOT seeded: it is a specific claim about tonnage this account cannot name, and
  // it is added below only if such tonnage exists.
  for (const group of MUSCLE_GROUPS) {
    byGroup.set(group, { group, kilograms: 0, hasSets: false });
  }

  let kilograms = 0;

  for (const row of rows) {
    const performedOn = assertPresent(row.performed_on, "performed_on");
    const exerciseId = assertPresent(row.exercise_id, "exercise_id");
    const tonnage = assertPresent(row.tonnage_kg, "tonnage_kg");

    // The query promised a window, so a row outside it is a broken promise rather than a row to
    // ignore — S-07's reason, unchanged. Without this, deleting the `.gte`/`.lte` bounds from the
    // read would change no answer while the Worker quietly received the account's entire history.
    if (performedOn < week.start || performedOn > week.end) {
      throw new Error(
        `foldBreakdown: daily_exercise_tonnage returned ${performedOn}, outside the requested ` +
          `${week.start}..${week.end} window`,
      );
    }

    kilograms += tonnage;

    const exercise = byExercise.get(exerciseId);
    if (exercise === undefined) {
      byExercise.set(exerciseId, {
        exerciseId,
        name: row.exercise_name,
        muscleGroup: row.muscle_group,
        kilograms: tonnage,
      });
    } else {
      exercise.kilograms += tonnage;
    }

    const group = byGroup.get(row.muscle_group);
    if (group === undefined) {
      byGroup.set(row.muscle_group, { group: row.muscle_group, kilograms: tonnage, hasSets: true });
    } else {
      group.kilograms += tonnage;
      group.hasSets = true;
    }
  }

  // A non-finite total would render as the string "NaN" — not a crash, but a number the user would
  // believe. `weeklyTonnage` refuses the same thing for the same reason.
  if (!Number.isFinite(kilograms)) {
    throw new Error(`foldBreakdown: ${week.start}..${week.end} summed to a non-finite value`);
  }

  const drift = Math.abs(kilograms - weekTotalKg);
  if (!(drift <= RECONCILIATION_TOLERANCE_KG)) {
    throw new Error(
      `foldBreakdown: ${week.start}..${week.end} breaks down to ${String(kilograms)} kg against a ` +
        `week total of ${String(weekTotalKg)} kg (off by ${String(drift)}); refusing to show a ` +
        `breakdown that does not reconcile`,
    );
  }

  // The `Unattributed` row is dropped unless it carries tonnage. A zero-load set whose exercise this
  // account cannot read is a row in the exercise list and nothing on the group chart: `Unattributed:
  // 0` would ask the reader to think about a state that costs them nothing.
  const unattributed = byGroup.get(null);
  if (unattributed?.kilograms === 0) {
    byGroup.delete(null);
  }

  return {
    groups: [...byGroup.values()].sort(byKilogramsThen(canonicalGroupOrder)),
    exercises: [...byExercise.values()].sort(byKilogramsThen(byNameThenId)),
    kilograms,
  };
}

/**
 * **A null column is a read error, not a row worth nothing.**
 *
 * `records.ts` narrows by DROPPING incomplete rows, and that is right there: a candidate missing its
 * columns is one the ranking cannot reason about. Here a row is a share of a total this module then
 * claims reconciles, and dropping it understates the breakdown — which the reconciliation guard
 * would report as an arithmetic failure, blaming the wrong thing. The view's own `coalesce` should
 * make this unreachable; the throw is what says so if it ever is not.
 *
 * `exercise_name` and `muscle_group` are deliberately NOT checked: null is their ordinary meaning
 * here — an exercise this account can no longer read — and is what the `left join` exists to
 * preserve.
 */
function assertPresent<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new Error(`foldBreakdown: daily_exercise_tonnage returned a null ${column}; refusing to fold a partial row`);
  }
  return value;
}

/**
 * Descending by kilograms, with a total order underneath.
 *
 * The tie-break is not cosmetic: `Array.prototype.sort` is stable, but the input order here comes
 * from a `Map`'s insertion order, which comes from whatever order PostgREST returned — so without
 * it, two groups on equal tonnage could swap places between reads and a render assertion on
 * positions would be flaky rather than wrong.
 */
function byKilogramsThen<T extends { kilograms: number }>(tieBreak: (a: T, b: T) => number) {
  return (a: T, b: T): number => (b.kilograms === a.kilograms ? tieBreak(a, b) : b.kilograms - a.kilograms);
}

/** The enum's own declaration order, with the `Unattributed` row last. */
function canonicalGroupOrder(a: GroupTonnage, b: GroupTonnage): number {
  return groupRank(a.group) - groupRank(b.group);
}

function groupRank(group: MuscleGroup | null): number {
  return group === null ? MUSCLE_GROUPS.length : MUSCLE_GROUPS.indexOf(group);
}

/** By name, with unreadable exercises last and their ids deciding between them. */
function byNameThenId(a: ExerciseTonnage, b: ExerciseTonnage): number {
  if (a.name === null || b.name === null) {
    return a.name === b.name ? a.exerciseId.localeCompare(b.exerciseId) : a.name === null ? 1 : -1;
  }
  return a.name === b.name ? a.exerciseId.localeCompare(b.exerciseId) : a.name.localeCompare(b.name);
}
