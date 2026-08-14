// Every guard and every shape rule of the breakdown fold, with rows injected.
//
// **This is the coverage S-07 could not have.** Its equivalent guards sit inside `weeklyTonnage`,
// behind a Supabase client, so only an integration suite can reach them — which is why S-08 put the
// decisions in a pure module and the I/O somewhere else. Nothing here touches a network, a database
// or an `astro:*` module.

import { describe, expect, it } from "vitest";

import type { DateRange } from "@/lib/services/calendar";
import {
  foldBreakdown,
  MAX_BREAKDOWN_ROWS,
  RECONCILIATION_TOLERANCE_KG,
  type BreakdownRow,
} from "@/lib/services/tonnage-breakdown";
import { MUSCLE_GROUPS } from "@/types";

/** A real Monday–Sunday week, so the window guard is tested against the shape it will really see. */
const WEEK: DateRange = { start: "2025-01-06", end: "2025-01-12" };

function row(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    performed_on: "2025-01-08",
    exercise_id: "ex-squat",
    exercise_name: "Squat",
    muscle_group: "legs",
    tonnage_kg: 100,
    ...overrides,
  };
}

describe("foldBreakdown: what it produces", () => {
  it("totals a week per group and per exercise, folding an exercise across days", () => {
    const breakdown = foldBreakdown(
      [
        row({ performed_on: "2025-01-06", tonnage_kg: 1000 }),
        row({ performed_on: "2025-01-08", tonnage_kg: 500 }),
        row({ exercise_id: "ex-row", exercise_name: "Barbell Row", muscle_group: "back", tonnage_kg: 600 }),
      ],
      WEEK,
      2100,
    );

    expect(breakdown.kilograms).toBe(2100);
    // Two days of squats are one exercise row, not two — the view's grain is (day, exercise) and the
    // screen's is the week.
    expect(breakdown.exercises).toEqual([
      { exerciseId: "ex-squat", name: "Squat", muscleGroup: "legs", kilograms: 1500 },
      { exerciseId: "ex-row", name: "Barbell Row", muscleGroup: "back", kilograms: 600 },
    ]);
    expect(breakdown.groups.map((group) => [group.group, group.kilograms])).toEqual([
      ["legs", 1500],
      ["back", 600],
      ["chest", 0],
      ["shoulders", 0],
      ["arms", 0],
      ["core", 0],
    ]);
  });

  it("keeps all six groups present, so an untrained group reads as zero rather than vanishing", () => {
    // The imbalance FR-019 exists to show is only visible if the empty rows are there. A screen
    // rendering four rows cannot say "you did not train your back this week".
    const breakdown = foldBreakdown([row({ tonnage_kg: 500 })], WEEK, 500);

    expect(breakdown.groups).toHaveLength(MUSCLE_GROUPS.length);
    expect(breakdown.groups.map((group) => group.group).sort()).toEqual([...MUSCLE_GROUPS].sort());
  });

  it("orders groups by tonnage descending, breaking ties in the enum's own order", () => {
    // Deterministic on purpose: the input order comes from a Map fed by whatever order PostgREST
    // returned, so without the tie-break two equal groups could swap between reads and a render
    // assertion on positions would be flaky rather than wrong.
    const breakdown = foldBreakdown(
      [
        row({ exercise_id: "ex-curl", exercise_name: "Curl", muscle_group: "arms", tonnage_kg: 300 }),
        row({ exercise_id: "ex-row", exercise_name: "Row", muscle_group: "back", tonnage_kg: 300 }),
        row({ exercise_id: "ex-squat", muscle_group: "legs", tonnage_kg: 100 }),
      ],
      WEEK,
      700,
    );

    // `back` precedes `arms` on the tie because the enum declares it earlier — not because it was
    // read first, which is the opposite order the rows arrive in here.
    expect(breakdown.groups.map((group) => group.group)).toEqual([
      "back",
      "arms",
      "legs",
      "chest",
      "shoulders",
      "core",
    ]);
  });

  it("orders exercises by tonnage descending, breaking ties by name", () => {
    const breakdown = foldBreakdown(
      [
        row({ exercise_id: "ex-z", exercise_name: "Zercher Squat", tonnage_kg: 400 }),
        row({ exercise_id: "ex-a", exercise_name: "Ab Wheel", muscle_group: "core", tonnage_kg: 400 }),
      ],
      WEEK,
      800,
    );

    expect(breakdown.exercises.map((exercise) => exercise.name)).toEqual(["Ab Wheel", "Zercher Squat"]);
  });

  it("marks a group that has rows but no external load as having sets", () => {
    // A week of planks. `kilograms` cannot carry this distinction and `hasSets` is what does — the
    // screen must say "no external load", never "you did not train it".
    const breakdown = foldBreakdown(
      [row({ exercise_id: "ex-plank", exercise_name: "Plank", muscle_group: "core", tonnage_kg: 0 })],
      WEEK,
      0,
    );

    const core = breakdown.groups.find((group) => group.group === "core");
    const legs = breakdown.groups.find((group) => group.group === "legs");

    expect(core).toEqual({ group: "core", kilograms: 0, hasSets: true });
    expect(legs).toEqual({ group: "legs", kilograms: 0, hasSets: false });
  });

  it("folds an empty week without dividing by zero or inventing a group", () => {
    const breakdown = foldBreakdown([], WEEK, 0);

    expect(breakdown.kilograms).toBe(0);
    expect(breakdown.exercises).toEqual([]);
    expect(breakdown.groups).toHaveLength(MUSCLE_GROUPS.length);
    expect(breakdown.groups.every((group) => group.kilograms === 0 && !group.hasSets)).toBe(true);
  });
});

describe("foldBreakdown: the Unattributed row", () => {
  it("carries tonnage whose exercise this account cannot read, keeping the column reconciled", () => {
    // The `left join` in the view is what preserves these kilograms; this is what shows them. An
    // inner join would have dropped the set entirely and the group column would silently be short.
    const breakdown = foldBreakdown(
      [
        row({ tonnage_kg: 700 }),
        row({ exercise_id: "ex-hidden", exercise_name: null, muscle_group: null, tonnage_kg: 300 }),
      ],
      WEEK,
      1000,
    );

    const unattributed = breakdown.groups.find((group) => group.group === null);

    expect(unattributed).toEqual({ group: null, kilograms: 300, hasSets: true });
    // Ranked by tonnage like any other row — it is not a footnote pinned to the bottom.
    expect(breakdown.groups.map((group) => group.group)).toEqual([
      "legs",
      null,
      "back",
      "chest",
      "shoulders",
      "arms",
      "core",
    ]);
    expect(breakdown.exercises.find((exercise) => exercise.exerciseId === "ex-hidden")?.name).toBeNull();
  });

  it("sorts behind all six on a tie, because it is not one of them", () => {
    const breakdown = foldBreakdown(
      [
        row({ tonnage_kg: 700 }),
        row({ exercise_id: "ex-plank", exercise_name: "Plank", muscle_group: "core", tonnage_kg: 300 }),
        row({ exercise_id: "ex-hidden", exercise_name: null, muscle_group: null, tonnage_kg: 300 }),
      ],
      WEEK,
      1300,
    );

    // `core` is the LAST of the six in the enum, so this is the tie that would go the other way if
    // the null group were ranked by anything but "after every named group".
    expect(breakdown.groups.map((group) => group.group)).toEqual([
      "legs",
      "core",
      null,
      "back",
      "chest",
      "shoulders",
      "arms",
    ]);
  });

  it("is absent when the unreadable exercise carries no tonnage", () => {
    // A zero-load set whose exercise cannot be read is a row in the exercise list and nothing on the
    // group chart: `Unattributed: 0` asks the reader to think about a state that costs them nothing.
    const breakdown = foldBreakdown(
      [
        row({ tonnage_kg: 700 }),
        row({ exercise_id: "ex-hidden", exercise_name: null, muscle_group: null, tonnage_kg: 0 }),
      ],
      WEEK,
      700,
    );

    expect(breakdown.groups.some((group) => group.group === null)).toBe(false);
    expect(breakdown.groups).toHaveLength(MUSCLE_GROUPS.length);
    expect(breakdown.exercises.some((exercise) => exercise.exerciseId === "ex-hidden")).toBe(true);
  });
});

describe("foldBreakdown: the guards", () => {
  it("refuses a row outside the window it asked for", () => {
    // The query promised a window, so a row outside it is a broken promise. Without this, deleting
    // the `.gte`/`.lte` bounds from `weeklyBreakdown` would change no answer while the Worker
    // quietly received the account's entire history — unbounded work under a 10 ms CPU cap.
    expect(() => foldBreakdown([row({ performed_on: "2025-01-13", tonnage_kg: 100 })], WEEK, 100)).toThrow(
      /outside the requested 2025-01-06\.\.2025-01-12 window/,
    );
  });

  it("refuses a null performed_on, exercise_id or tonnage_kg", () => {
    // A null column is a read error, not a row worth nothing. Dropping it would understate the
    // breakdown, which the reconciliation guard would then report as an arithmetic failure —
    // blaming the wrong thing.
    expect(() => foldBreakdown([row({ performed_on: null })], WEEK, 100)).toThrow(/null performed_on/);
    expect(() => foldBreakdown([row({ exercise_id: null })], WEEK, 100)).toThrow(/null exercise_id/);
    expect(() => foldBreakdown([row({ tonnage_kg: null })], WEEK, 100)).toThrow(/null tonnage_kg/);
  });

  it("tolerates a null exercise_name and a null muscle_group, which are ordinary", () => {
    // The counterpart to the assertion above, and the reason it names three columns rather than
    // five: null is these two columns' ordinary meaning, and is exactly what the `left join`
    // preserves.
    expect(() =>
      foldBreakdown([row({ exercise_name: null, muscle_group: null, tonnage_kg: 100 })], WEEK, 100),
    ).not.toThrow();
  });

  it("refuses more rows than a training week can plausibly hold, and does not truncate", () => {
    // A `throw`, never a `.limit()`: "a limit is a silent truncation, which is the same defect
    // wearing a seatbelt" (S-07). Here it would be worse — a truncated breakdown fails its own
    // reconciliation guard and gets blamed on the arithmetic.
    const rows = Array.from({ length: MAX_BREAKDOWN_ROWS + 1 }, (_, index) =>
      row({ exercise_id: `ex-${String(index)}`, tonnage_kg: 1 }),
    );

    expect(() => foldBreakdown(rows, WEEK, rows.length)).toThrow(/exceeds 210/);
  });

  it("accepts exactly the row cap, so the bound is not off by one", () => {
    const rows = Array.from({ length: MAX_BREAKDOWN_ROWS }, (_, index) =>
      row({ exercise_id: `ex-${String(index)}`, tonnage_kg: 1 }),
    );

    expect(foldBreakdown(rows, WEEK, MAX_BREAKDOWN_ROWS).kilograms).toBe(MAX_BREAKDOWN_ROWS);
  });

  it("refuses a non-finite sum rather than printing the string NaN", () => {
    // Not a crash — a number the user would believe. Checked before the reconciliation comparison,
    // so the message names the real cause instead of an infinite drift.
    expect(() =>
      foldBreakdown([row({ tonnage_kg: Number.POSITIVE_INFINITY })], WEEK, Number.POSITIVE_INFINITY),
    ).toThrow(/non-finite/);
  });
});

describe("foldBreakdown: reconciliation with the week total already on screen", () => {
  it("refuses a breakdown that does not add up to the total the user can see", () => {
    // US-03's criterion, made a runtime property rather than a claim. Half a kilogram is three
    // orders of magnitude above the float artefact the tolerance exists for.
    expect(() => foldBreakdown([row({ tonnage_kg: 100 })], WEEK, 100.5)).toThrow(/does not reconcile/);
  });

  it("absorbs a drift smaller than the tolerance, because that drift is a float artefact", () => {
    // The two views sum in `numeric`, which is exact; the Worker sums in `double`, and totalling
    // per-day rows and per-(day, exercise) rows are two different summation orders over the same
    // values. That is the ONLY difference the tolerance is here to absorb — a single dropped set
    // would be off by kilograms, not by grams.
    expect(() => foldBreakdown([row({ tonnage_kg: 100 })], WEEK, 100.0005)).not.toThrow();
    expect(RECONCILIATION_TOLERANCE_KG).toBe(0.001);
  });

  it("takes its threshold from the constant, so raising the constant is what moves it", () => {
    // **Deliberately half and double, never the boundary itself.** `100 + 0.001` does not differ
    // from `100` by exactly `0.001` in binary floating point — it differs by
    // `0.0010000000000047748` — so an assertion pinned to the boundary would be testing IEEE 754
    // rather than this guard, and would fail for a reason the criterion never described
    // (`lessons.md`: a test that fails for the wrong reason has confirmed nothing).
    expect(() => foldBreakdown([row({ tonnage_kg: 100 })], WEEK, 100 + RECONCILIATION_TOLERANCE_KG / 2)).not.toThrow();
    expect(() => foldBreakdown([row({ tonnage_kg: 100 })], WEEK, 100 + RECONCILIATION_TOLERANCE_KG * 2)).toThrow(
      /does not reconcile/,
    );
  });

  it("refuses a NaN week total instead of comparing against it and passing", () => {
    // `NaN > tolerance` is false, so a comparison written the obvious way would let this through and
    // render a breakdown against a total that is not a number. The guard is written as
    // `!(drift <= tolerance)` for exactly this case.
    expect(() => foldBreakdown([row({ tonnage_kg: 100 })], WEEK, Number.NaN)).toThrow(/does not reconcile/);
  });
});
