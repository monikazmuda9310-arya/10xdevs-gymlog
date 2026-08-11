/**
 * What a correction costs: which personal records it takes off their current holder, and what each
 * one falls to (US-02, FR-006, FR-007, FR-010).
 *
 * **This module compares identifiers and nothing else.** Postgres ranks the sets in exact `numeric`
 * and JavaScript computes in binary float64, so a record decided by comparing one against the other
 * could be invented or erased — the same hazard `records-verdict.ts` exists to avoid, arriving from
 * the other side. Here the ranking has already happened: `public.personal_records` says which set
 * holds each record today, and the successor queries say which set would hold it afterwards. All
 * this module does is match ids and pair them up.
 *
 * **Two functions rather than one, and the split is forced by the data flow.** Deciding *which*
 * records a removal affects needs only ids. Fetching each successor needs that answer first —
 * otherwise every read would walk exercises nothing is going to happen to. So `affectedRecords`
 * answers the first question, the caller fetches only what it now knows it needs, and
 * `fallingRecords` pairs the two together.
 *
 * Browser-safe and dependency-free at runtime: the only imports are types, erased at build, so the
 * confirmation dialog can import these shapes without pulling in the Supabase client.
 */

import type { PersonalRecordRow } from "@/types";
import type { DisplayableSet } from "./set-display";

/**
 * The two records this product keeps, which have **different exclusion rules on purpose**
 * (AGENTS.md § Domain rules). The estimate record takes sets of 1–12 repetitions with a positive
 * load; the heaviest record takes every set with a positive load at any repetition count, because
 * "heaviest ever handled" is a fact about the load rather than an estimate.
 *
 * They are therefore ranked separately and can be held by different sets — which is exactly why a
 * warning built on the estimate ranking alone would miss a real fall.
 */
export type RecordKind = "estimate" | "heaviest";

/** One set as a ranking returns it — enough to re-derive its figure and to name it on screen. */
export interface RecordCandidate extends DisplayableSet {
  set_id: string;
  performed_on: string;
}

/**
 * What is about to stop counting, at one of the three levels the product can remove.
 *
 * An **edit** uses the `set` level too: the question "what happens if this set stops holding the
 * record" is the same question whether the set is being deleted or changed, and it is the only one
 * that can be answered without comparing a TypeScript number against a Postgres one.
 *
 * The `entry` level carries `workoutId` and `exerciseId` rather than the entry id alone, because
 * `personal_records` does not report which entry a record's set belongs to — and it does not need
 * to. `unique (workout_id, exercise_id)` on `exercise_entries` means an exercise appears at most
 * once per workout, so "this exercise, in this workout" identifies the entry exactly.
 */
export type Removal =
  | { level: "set"; setId: string }
  | { level: "entry"; exerciseEntryId: string; workoutId: string; exerciseId: string }
  | { level: "workout"; workoutId: string };

/** A record this removal takes off its current holder. Ids only — no figure has been read yet. */
export interface AffectedRecord {
  kind: RecordKind;
  exerciseId: string;
  exerciseName: string;
  /** The set holding this record today, which will stop holding it. */
  holderSetId: string;
}

/**
 * Where a record lands, with the two empty outcomes kept apart.
 *
 * They are different futures and must not share a sentence: `no_qualifying_set` means the exercise
 * stays on `/records` showing no value for this record (a lift trained on at zero load, say),
 * while `no_sets_left` means the exercise disappears from that screen altogether, because
 * `personal_records` is anchored on the exercises the account has actually logged. Collapsing both
 * into a bare `null` would let the dialog promise a screen state that will not happen.
 */
export type Successor =
  | { kind: "candidate"; candidate: RecordCandidate }
  | { kind: "no_qualifying_set" }
  | { kind: "no_sets_left" };

export interface FallingRecord extends AffectedRecord {
  successor: Successor;
}

/** What survives a removal, for one exercise. Supplied by the caller from the ranking queries. */
export interface SurvivingFor {
  /** Best surviving set for the estimate record, or `null` when none qualifies. */
  estimate: RecordCandidate | null;
  /** Best surviving set for the heaviest record, or `null` when none qualifies. */
  heaviest: RecordCandidate | null;
  /**
   * Whether ANY set for this exercise survives — including sets that qualify for neither record.
   * This is the only thing that tells `no_qualifying_set` and `no_sets_left` apart.
   */
  anySetSurvives: boolean;
}

/**
 * Whether this removal takes the record described by `holderSetId` / `holderWorkoutId` away.
 *
 * The three levels answer three different questions, and only the `set` level can be decided from
 * the set id alone. A workout removal takes every record whose holder lives in that workout; an
 * entry removal takes those, narrowed to the one exercise.
 */
function removalTakes(removal: Removal, holderSetId: string, holderWorkoutId: string, exerciseId: string): boolean {
  switch (removal.level) {
    case "set":
      return holderSetId === removal.setId;
    case "entry":
      return holderWorkoutId === removal.workoutId && exerciseId === removal.exerciseId;
    case "workout":
      return holderWorkoutId === removal.workoutId;
  }
}

/**
 * Which records this removal takes off their current holder.
 *
 * `holders` are rows of `public.personal_records` — one per exercise the account has logged, each
 * naming the set behind each record and the workout that set belongs to. Every column of a view
 * arrives nullable (`supabase gen types` cannot prove not-null through one), and a row missing the
 * ids this decision needs is a row it cannot reason about: it is skipped rather than asserted
 * non-null, which is the same discipline `records.ts` applies to the ranking rows.
 *
 * An exercise with no record at all — logged only at zero load — yields nothing here, correctly:
 * there is no record to lose.
 */
export function affectedRecords(holders: readonly PersonalRecordRow[], removal: Removal): AffectedRecord[] {
  const affected: AffectedRecord[] = [];

  for (const holder of holders) {
    const exerciseId = holder.exercise_id;
    const exerciseName = holder.exercise_name;
    if (exerciseId === null || exerciseName === null) {
      continue;
    }

    const candidates: readonly { kind: RecordKind; setId: string | null; workoutId: string | null }[] = [
      { kind: "estimate", setId: holder.best_estimate_set_id, workoutId: holder.best_estimate_workout_id },
      { kind: "heaviest", setId: holder.heaviest_set_id, workoutId: holder.heaviest_workout_id },
    ];

    for (const { kind, setId, workoutId } of candidates) {
      if (setId === null || workoutId === null) {
        continue;
      }
      if (removalTakes(removal, setId, workoutId, exerciseId)) {
        affected.push({ kind, exerciseId, exerciseName, holderSetId: setId });
      }
    }
  }

  return affected;
}

/**
 * Pair each affected record with what survives it.
 *
 * `surviving` is keyed by exercise id and supplied by the caller, which fetched it for exactly the
 * exercises `affectedRecords` named. An exercise missing from the map is treated as having nothing
 * left — the conservative reading, and unreachable when the caller fetches what it was told to.
 */
export function fallingRecords(
  affected: readonly AffectedRecord[],
  surviving: ReadonlyMap<string, SurvivingFor>,
): FallingRecord[] {
  return affected.map((record) => {
    const remaining = surviving.get(record.exerciseId);
    if (!remaining) {
      return { ...record, successor: { kind: "no_sets_left" } };
    }

    const candidate = record.kind === "estimate" ? remaining.estimate : remaining.heaviest;
    if (candidate) {
      return { ...record, successor: { kind: "candidate", candidate } };
    }

    return {
      ...record,
      successor: remaining.anySetSurvives ? { kind: "no_qualifying_set" } : { kind: "no_sets_left" },
    };
  });
}
