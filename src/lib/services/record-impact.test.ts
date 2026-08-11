import { describe, expect, it } from "vitest";

import {
  affectedRecords,
  fallingRecords,
  type AffectedRecord,
  type RecordCandidate,
  type SurvivingFor,
} from "@/lib/services/record-impact";
import type { PersonalRecordRow } from "@/types";

// Every assertion here is about IDENTIFIERS. Nothing in this module compares a weight or an
// estimate, and nothing in this file computes one — that is the seam these tests exist to protect
// (see the module header, and records-verdict.ts for the same rule from the other side).

const SET_ESTIMATE = "set-estimate";
const SET_HEAVIEST = "set-heaviest";
const WORKOUT = "workout-1";
const OTHER_WORKOUT = "workout-2";
const EXERCISE = "exercise-1";

/**
 * A records row where the SAME set holds both records — the ordinary case.
 *
 * Overrides split them apart where a test needs them split.
 */
function holder(overrides: Partial<PersonalRecordRow> = {}): PersonalRecordRow {
  return {
    user_id: "user",
    exercise_id: EXERCISE,
    exercise_name: "Bench Press",
    muscle_group: "chest",
    is_bodyweight: false,
    best_estimate_set_id: SET_ESTIMATE,
    best_estimate_kg: 120,
    best_estimate_reps: 5,
    best_estimate_weight: 100,
    best_estimate_weight_unit: "kg",
    best_estimate_weight_kg: 100,
    best_estimate_workout_id: WORKOUT,
    best_estimate_performed_on: "2026-08-11",
    heaviest_set_id: SET_ESTIMATE,
    heaviest_reps: 5,
    heaviest_weight: 100,
    heaviest_weight_unit: "kg",
    heaviest_weight_kg: 100,
    heaviest_workout_id: WORKOUT,
    heaviest_performed_on: "2026-08-11",
    last_record_on: "2026-08-11",
    ...overrides,
  };
}

function candidate(overrides: Partial<RecordCandidate> = {}): RecordCandidate {
  return {
    set_id: "successor",
    reps: 5,
    weight: 90,
    weight_unit: "kg",
    weight_kg: 90,
    performed_on: "2026-08-01",
    ...overrides,
  };
}

function affected(kind: "estimate" | "heaviest", holderSetId = SET_ESTIMATE): AffectedRecord {
  return { kind, exerciseId: EXERCISE, exerciseName: "Bench Press", holderSetId };
}

function surviving(overrides: Partial<SurvivingFor> = {}): ReadonlyMap<string, SurvivingFor> {
  return new Map([[EXERCISE, { estimate: null, heaviest: null, anySetSurvives: false, ...overrides }]]);
}

describe("affectedRecords", () => {
  it("says nothing falls when the removed set holds neither record", () => {
    const result = affectedRecords([holder()], { level: "set", setId: "some-other-set" });

    expect(result).toEqual([]);
  });

  it("names both records when one set holds both", () => {
    const result = affectedRecords([holder()], { level: "set", setId: SET_ESTIMATE });

    expect(result.map((record) => record.kind).sort()).toEqual(["estimate", "heaviest"]);
    expect(result.every((record) => record.holderSetId === SET_ESTIMATE)).toBe(true);
    expect(result[0].exerciseName).toBe("Bench Press");
  });

  it("names the heaviest record alone when the estimate record belongs to a different set", () => {
    // THE CASE THAT MADE THIS MODULE NECESSARY. With 100 kg x 1 (estimate 100) and 90 kg x 10
    // (estimate 120) logged, the heaviest record belongs to the single and the estimate record to
    // the ten. Deleting the single takes the heaviest record and leaves the estimate record alone —
    // and `topTwoEstimatesForExercise`, which ranks estimates only, would report "not the leader"
    // and warn about nothing at all.
    const result = affectedRecords([holder({ heaviest_set_id: SET_HEAVIEST })], {
      level: "set",
      setId: SET_HEAVIEST,
    });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("heaviest");
    expect(result[0].holderSetId).toBe(SET_HEAVIEST);
  });

  it("takes every record held inside the workout being deleted", () => {
    const result = affectedRecords([holder({ heaviest_set_id: SET_HEAVIEST })], {
      level: "workout",
      workoutId: WORKOUT,
    });

    expect(result).toHaveLength(2);
  });

  it("leaves records held in a different workout alone", () => {
    const result = affectedRecords([holder()], { level: "workout", workoutId: OTHER_WORKOUT });

    expect(result).toEqual([]);
  });

  it("narrows an entry removal to the one exercise inside that workout", () => {
    // An entry is (workout, exercise) and unique, so the two together identify it — which is why
    // `personal_records` does not need to carry an entry id for this decision to be exact.
    const rows = [holder(), holder({ exercise_id: "exercise-2", exercise_name: "Squat" })];

    const result = affectedRecords(rows, {
      level: "entry",
      exerciseEntryId: "entry-1",
      workoutId: WORKOUT,
      exerciseId: EXERCISE,
    });

    expect(result).toHaveLength(2);
    expect(result.every((record) => record.exerciseId === EXERCISE)).toBe(true);
  });

  it("ignores an exercise that holds no record at all", () => {
    // The plank case: logged only at zero load, so it appears in `personal_records` with both
    // records empty. There is nothing to lose and nothing to warn about.
    const plank = holder({
      exercise_name: "Plank",
      best_estimate_set_id: null,
      best_estimate_workout_id: null,
      heaviest_set_id: null,
      heaviest_workout_id: null,
    });

    expect(affectedRecords([plank], { level: "workout", workoutId: WORKOUT })).toEqual([]);
  });

  it("skips a row whose identifiers a view left null rather than asserting them present", () => {
    const incomplete = holder({ exercise_id: null });

    expect(affectedRecords([incomplete], { level: "set", setId: SET_ESTIMATE })).toEqual([]);
  });
});

describe("fallingRecords", () => {
  it("pairs a record with the set that survives it", () => {
    const successor = candidate();
    const result = fallingRecords([affected("estimate")], surviving({ estimate: successor, anySetSurvives: true }));

    expect(result[0].successor).toEqual({ kind: "candidate", candidate: successor });
  });

  it("reads the successor for the record kind being asked about, not the other one", () => {
    const heaviest = candidate({ set_id: "heaviest-successor" });
    const result = fallingRecords(
      [affected("heaviest")],
      surviving({ estimate: candidate({ set_id: "estimate-successor" }), heaviest, anySetSurvives: true }),
    );

    expect(result[0].successor).toEqual({ kind: "candidate", candidate: heaviest });
  });

  it("says no qualifying set when sets remain but none can hold the record", () => {
    // A lift left with only zero-load sets. The exercise STAYS on /records, showing no value for
    // this record — a different future from disappearing, and a different sentence.
    const result = fallingRecords([affected("estimate")], surviving({ anySetSurvives: true }));

    expect(result[0].successor).toEqual({ kind: "no_qualifying_set" });
  });

  it("says no sets left when nothing at all survives", () => {
    // The exercise leaves /records entirely, because that view is anchored on the exercises the
    // account has logged. Collapsing this into the case above would promise a screen state that
    // will not happen.
    const result = fallingRecords([affected("estimate")], surviving({ anySetSurvives: false }));

    expect(result[0].successor).toEqual({ kind: "no_sets_left" });
  });

  it("keeps the two empty outcomes distinct", () => {
    const stays = fallingRecords([affected("estimate")], surviving({ anySetSurvives: true }));
    const goes = fallingRecords([affected("estimate")], surviving({ anySetSurvives: false }));

    expect(stays[0].successor.kind).not.toBe(goes[0].successor.kind);
  });

  it("treats an exercise missing from the lookup as having nothing left", () => {
    const result = fallingRecords([affected("estimate")], new Map());

    expect(result[0].successor).toEqual({ kind: "no_sets_left" });
  });

  it("carries the affected record's own fields through unchanged", () => {
    const result = fallingRecords([affected("heaviest", SET_HEAVIEST)], surviving());

    expect(result[0].kind).toBe("heaviest");
    expect(result[0].exerciseId).toBe(EXERCISE);
    expect(result[0].exerciseName).toBe("Bench Press");
    expect(result[0].holderSetId).toBe(SET_HEAVIEST);
  });
});
