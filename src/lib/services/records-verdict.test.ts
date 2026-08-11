import { describe, expect, it } from "vitest";

import { verdictForSet, type RankedSet } from "@/lib/services/records-verdict";

/**
 * The ranking arrives already ordered `estimate desc, created_at asc, set_id asc` — the view's own
 * ordering. These fixtures therefore state the ORDER as the input; re-sorting here would test a
 * sort this function does not perform.
 */
function ranked(setId: string, estimateKg: number, overrides: Partial<RankedSet> = {}): RankedSet {
  return {
    set_id: setId,
    estimate_kg: estimateKg,
    reps: 5,
    weight: 100,
    weight_unit: "kg",
    weight_kg: 100,
    performed_on: "2026-08-11",
    ...overrides,
  };
}

describe("verdictForSet", () => {
  it("announces a record when the saved set tops the ranking and something is behind it", () => {
    const verdict = verdictForSet([ranked("new", 120), ranked("old", 112.5)], "new");

    expect(verdict.kind).toBe("record");
    // The runner-up travels with the verdict: the message quotes what was beaten, and S-05's
    // "what will this record fall to" is the same row asked from the other side.
    expect(verdict.kind === "record" && verdict.previousBest.set_id).toBe("old");
  });

  it("calls the first estimable set for an exercise a baseline, not a record", () => {
    // US-02: "The first-ever set for an exercise establishes the baseline and is NOT announced."
    const verdict = verdictForSet([ranked("first", 112.5)], "first");

    expect(verdict.kind).toBe("baseline");
  });

  it("does not announce a set that lost to an existing one", () => {
    const verdict = verdictForSet([ranked("standing", 140), ranked("new", 112.5)], "new");

    expect(verdict.kind).toBe("none");
  });

  it("does not announce a set that merely EQUALS the previous best", () => {
    // The tie-break lives in the ordering, so an equal older set arrives first and the new one is
    // simply not on top. This is the assertion that pins "unit conversion and rounding cannot by
    // themselves produce a record" at this level — there is no epsilon to get wrong.
    const verdict = verdictForSet([ranked("older", 112.5), ranked("new", 112.5)], "new");

    expect(verdict.kind).toBe("none");
  });

  it("answers none for a set that carries no estimate at all", () => {
    // A bodyweight, assisted or out-of-range set never enters the ranking, so it needs no branch of
    // its own — it simply is not there. Same exclusion as `isEstimable`, reached by absence.
    const verdict = verdictForSet([ranked("someone-else", 140)], "unestimable");

    expect(verdict.kind).toBe("none");
  });

  it("answers none when the exercise has no estimable set at all", () => {
    // An account whose only sets on this exercise are planks: the ranking is empty and the set just
    // saved is not a baseline either, because there is no number to be the baseline OF.
    const verdict = verdictForSet([], "plank-set");

    expect(verdict.kind).toBe("none");
  });
});
