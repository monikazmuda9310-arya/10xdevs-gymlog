// What a weekly total prints as. The boundaries here are different from every other display test in
// this repository, because a week's tonnage is a five-digit number where a set's weight is a
// two-digit one.

import { describe, expect, it } from "vitest";

import { kilogramsIn } from "@/lib/services/set-display";
import { tonnageFigure } from "@/lib/services/tonnage-display";

describe("kilogramsIn: the scalar converter", () => {
  it("leaves kilograms alone", () => {
    expect(kilogramsIn(1234.5, "kg")).toBe(1234.5);
  });

  it("converts to pounds through the one factor", () => {
    // 100 kg is 220.462… lb. The same number `set-display.test.ts` pins for a set, reached by a
    // different function, which is what proves the two share the constant rather than a value.
    expect(kilogramsIn(100, "lb")).toBeCloseTo(220.46226, 5);
  });

  it("is exact at zero in both units", () => {
    expect(kilogramsIn(0, "kg")).toBe(0);
    expect(kilogramsIn(0, "lb")).toBe(0);
  });
});

describe("tonnageFigure: a week's total", () => {
  it("prints a real week with a thousands separator", () => {
    // Five digits without a separator is the number nobody reads correctly at a glance.
    expect(tonnageFigure(12345.7, "kg")).toBe("12,346");
  });

  it("rounds to whole units, not to the one decimal place a set uses", () => {
    // `roundForDisplay` would answer 12345.7 here. A tenth of a kilogram is a real distinction on a
    // barbell and noise on a week's total.
    expect(tonnageFigure(12345.7, "kg")).not.toContain(".");
  });

  it("converts BEFORE rounding, so pounds are not rounded kilograms", () => {
    // 1000 kg is 2204.62 lb → "2,205". Rounding first would give 1000 → 2204.62 → "2,205" too, so
    // this case alone cannot tell them apart; the sub-unit case below is what does.
    expect(tonnageFigure(1000, "lb")).toBe("2,205");
    expect(tonnageFigure(1000, "kg")).toBe("1,000");
  });

  it("reads as zero for a week worth nothing", () => {
    // Reachable and ordinary: a week of planks. The SCREEN must pair this with a sentence saying
    // there was no external load — the figure alone would read as "you did not train".
    expect(tonnageFigure(0, "kg")).toBe("0");
    expect(tonnageFigure(0, "lb")).toBe("0");
  });

  it("rounds a sub-unit week to zero, which the screen must not confuse with no sets", () => {
    // 0.4 kg is reachable from one light set typed in pounds. The figure is "0" while the week
    // genuinely has sets — so `hasSets` and not the figure is what decides which sentence appears.
    // Rounding first and converting second would print "0" for the pounds case too and hide this.
    expect(tonnageFigure(0.4, "kg")).toBe("0");
    expect(tonnageFigure(0.4, "lb")).toBe("1");
  });

  it("never emits a locale-dependent separator", () => {
    // The whole reason the locale is passed explicitly. Under de-DE the default would render this
    // as "12.346", which a reader parses as twelve. Asserting the comma pins the choice; asserting
    // the absence of a dot pins the failure mode.
    const figure = tonnageFigure(12345.7, "kg");

    expect(figure).toBe("12,346");
    expect(figure).not.toContain(".");
  });
});
