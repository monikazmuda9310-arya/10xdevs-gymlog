import { describe, expect, it } from "vitest";

import { bestEstimateFigure, fallToFigure, heaviestFigure } from "@/lib/services/record-display";
import type { FallingRecord, RecordCandidate } from "@/lib/services/record-impact";
import type { PersonalRecordRow } from "@/types";

/** A records row with nothing in it — the plank case — overridden per test. */
function row(overrides: Partial<PersonalRecordRow> = {}): PersonalRecordRow {
  return {
    user_id: "user",
    exercise_id: "exercise",
    exercise_name: "Bench Press",
    muscle_group: "chest",
    is_bodyweight: false,
    best_estimate_set_id: null,
    best_estimate_kg: null,
    best_estimate_reps: null,
    best_estimate_weight: null,
    best_estimate_weight_unit: null,
    best_estimate_weight_kg: null,
    best_estimate_workout_id: null,
    best_estimate_performed_on: null,
    heaviest_set_id: null,
    heaviest_reps: null,
    heaviest_weight: null,
    heaviest_weight_unit: null,
    heaviest_weight_kg: null,
    heaviest_workout_id: null,
    heaviest_performed_on: null,
    last_record_on: null,
    ...overrides,
  };
}

describe("bestEstimateFigure", () => {
  it("re-derives the estimate from the winning set rather than reading the ranked value", () => {
    // `best_estimate_kg` is deliberately absurd: if the figure came from SQL's own number this test
    // would print 999. It must come from 5 x 100 through the same estimator the workout screen uses.
    const figure = bestEstimateFigure(
      row({
        best_estimate_reps: 5,
        best_estimate_weight: 100,
        best_estimate_weight_unit: "kg",
        best_estimate_weight_kg: 100,
        best_estimate_kg: 999,
        best_estimate_performed_on: "2026-08-11",
      }),
      "kg",
      "brzycki",
    );

    expect(figure?.value).toBe(112.5);
    expect(figure?.reps).toBe(5);
    expect(figure?.performedOn).toBe("2026-08-11");
  });

  it("answers null for an exercise with no estimate rather than a zero", () => {
    // A plank: recorded, real training, and no strength score. Showing 0 would be a number the user
    // would believe.
    expect(bestEstimateFigure(row(), "kg", "brzycki")).toBeNull();
  });

  it("expresses the figure in the reader's unit when the set was stored in the other one", () => {
    const figure = bestEstimateFigure(
      row({
        best_estimate_reps: 1,
        best_estimate_weight: 225,
        best_estimate_weight_unit: "lb",
        best_estimate_weight_kg: 102.05828325,
        best_estimate_performed_on: "2026-08-11",
      }),
      "kg",
      "brzycki",
    );

    // At one repetition the estimate IS the weight lifted, so this is 225 lb in kilograms.
    expect(figure?.value).toBe(102.1);
    // The set behind it still reads back as the number that was typed, in the unit it was typed in.
    expect(figure?.weight).toBe(225);
    expect(figure?.weightUnit).toBe("lb");
  });
});

describe("heaviestFigure", () => {
  it("counts a set the estimate refuses, because heaviest-ever is a fact about the load", () => {
    // Twenty repetitions carries no estimate at all; it is still the heaviest thing lifted.
    const figure = heaviestFigure(
      row({
        heaviest_reps: 20,
        heaviest_weight: 150,
        heaviest_weight_unit: "kg",
        heaviest_weight_kg: 150,
        heaviest_performed_on: "2026-08-04",
      }),
      "kg",
    );

    expect(figure?.value).toBe(150);
    expect(figure?.reps).toBe(20);
  });

  it("answers null when every set was at zero or assisted load", () => {
    expect(heaviestFigure(row(), "kg")).toBeNull();
  });
});

describe("fallToFigure", () => {
  function falling(kind: "estimate" | "heaviest", successor: FallingRecord["successor"]): FallingRecord {
    return { kind, exerciseId: "exercise", exerciseName: "Bench Press", holderSetId: "holder", successor };
  }

  function successorSet(overrides: Partial<RecordCandidate> = {}): RecordCandidate {
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

  it("re-derives the estimate the record falls to from the surviving set's typed weight", () => {
    // Brzycki at 5 x 90 is 90 * 36 / 32 = 101.25, rounded to one decimal for the screen. Nothing
    // here reads a number Postgres computed — that is what keeps the dialog's promise identical to
    // what /records shows once the deletion lands.
    const result = fallToFigure(falling("estimate", { kind: "candidate", candidate: successorSet() }), "kg", "brzycki");

    expect(result.kind).toBe("figure");
    expect(result.kind === "figure" && result.figure.value).toBe(101.3);
    expect(result.kind === "figure" && result.figure.reps).toBe(5);
    expect(result.kind === "figure" && result.figure.performedOn).toBe("2026-08-01");
  });

  it("prints the load itself for the heaviest record, at any repetition count", () => {
    const result = fallToFigure(
      falling("heaviest", { kind: "candidate", candidate: successorSet({ reps: 20, weight: 150, weight_kg: 150 }) }),
      "kg",
      "brzycki",
    );

    expect(result.kind === "figure" && result.figure.value).toBe(150);
    expect(result.kind === "figure" && result.figure.reps).toBe(20);
  });

  it("expresses the fall value in the unit the reader is reading", () => {
    // Stored in kilograms, read in pounds: the successor's canonical weight_kg is converted, and
    // the dialog therefore cannot quote a number in a unit the user is not looking at.
    const result = fallToFigure(
      falling("heaviest", { kind: "candidate", candidate: successorSet({ weight: 100, weight_kg: 100 }) }),
      "lb",
      "brzycki",
    );

    expect(result.kind === "figure" && result.figure.value).toBeCloseTo(220.5, 1);
    // The set is still described as it was typed, so the evidence line does not lie about it.
    expect(result.kind === "figure" && result.figure.weightUnit).toBe("kg");
  });

  it("passes the two empty outcomes through as themselves", () => {
    expect(fallToFigure(falling("estimate", { kind: "no_qualifying_set" }), "kg", "brzycki")).toEqual({
      kind: "no_qualifying_set",
    });
    expect(fallToFigure(falling("estimate", { kind: "no_sets_left" }), "kg", "brzycki")).toEqual({
      kind: "no_sets_left",
    });
  });
});
