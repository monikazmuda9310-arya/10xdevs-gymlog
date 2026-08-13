import { describe, expect, it } from "vitest";

import { mondayOf, todayIn, trainingWeeksFor } from "@/lib/services/calendar";

describe("todayIn: the zone decides the date", () => {
  it("just after midnight in Warsaw, UTC still reads yesterday", () => {
    // 22:30 UTC is 00:30 the next day in Warsaw (UTC+2 in August). This is the whole reason the
    // profile timezone exists in this slice: a session logged just after midnight must default to
    // the day the lifter thinks it is, not the day a clock in Greenwich thinks it is.
    const instant = new Date("2026-08-10T22:30:00Z");

    expect(todayIn("Europe/Warsaw", instant)).toBe("2026-08-11");
    expect(todayIn("UTC", instant)).toBe("2026-08-10");
  });

  it("crosses a month boundary, not just a day one", () => {
    const instant = new Date("2026-08-31T23:30:00Z");

    expect(todayIn("Europe/Warsaw", instant)).toBe("2026-09-01");
    expect(todayIn("UTC", instant)).toBe("2026-08-31");
  });

  it("puts the two extreme zones on three different dates at one instant", () => {
    // Kiritimati is UTC+14 and Niue is UTC-11 — twenty-five hours apart. Passing HERE proves only
    // that Node has full ICU data. The same three dates were measured in real workerd during
    // Phase 2, through a temporary endpoint deleted in Phase 5; see change.md § Phase 2.
    const instant = new Date("2026-08-11T10:00:00Z");

    expect(todayIn("Pacific/Kiritimati", instant)).toBe("2026-08-12");
    expect(todayIn("UTC", instant)).toBe("2026-08-11");
    expect(todayIn("Pacific/Niue", instant)).toBe("2026-08-10");
  });

  it("always formats as YYYY-MM-DD, zero-padded", () => {
    // Guards against a locale-dependent format sneaking in: 11/08/2026 and 2026-8-1 are both
    // rejected by a date input and neither would fail a looser assertion.
    expect(todayIn("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("todayIn: a bad zone must not take a page down", () => {
  it("falls back to UTC rather than throwing", () => {
    const instant = new Date("2026-08-10T22:30:00Z");

    expect(() => todayIn("Nowhere/Nowhere", instant)).not.toThrow();
    expect(todayIn("Nowhere/Nowhere", instant)).toBe(todayIn("UTC", instant));
  });

  it("falls back on an empty zone too", () => {
    const instant = new Date("2026-08-10T22:30:00Z");

    expect(todayIn("", instant)).toBe(todayIn("UTC", instant));
  });
});

describe("mondayOf: a training week runs Monday to Sunday", () => {
  it("puts a Sunday in the week that STARTED, not the one about to", () => {
    // The one boundary the PRD names by name: "a session logged on Sunday evening belongs to that
    // week, not the next". 2026-08-09 is a Sunday; its week opened on Monday the 3rd. Getting this
    // backwards moves a whole session into the following week and nothing on screen says so.
    expect(mondayOf("2026-08-09")).toBe("2026-08-03");
  });

  it("leaves a Monday where it is", () => {
    // The `(getUTCDay() + 6) % 7` mapping evaluates to 0 here. Shift the mapping by one and this is
    // the case that goes a week wrong in the quietest direction.
    expect(mondayOf("2026-08-10")).toBe("2026-08-10");
  });

  it("covers every weekday of one week, all landing on the same Monday", () => {
    // Non-vacuous by construction: seven different inputs, one answer. A mapping that is right for
    // some days and wrong for others cannot pass this.
    for (const day of [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]) {
      expect(mondayOf(day), `${day} belongs to the week of 2026-08-10`).toBe("2026-08-10");
    }
  });

  it("steps back across a month boundary", () => {
    // 2026-09-02 is a Wednesday; its Monday is in August. Hand-rolled date arithmetic that decrements
    // the day number without borrowing produces 2026-09-00 or 2026-08-31 depending on how it fails.
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
  });

  it("steps back across a year boundary", () => {
    // 2027-01-01 is a Friday; its week opened on 2026-12-28. Both the year and the month have to roll.
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("is stable across a leap day", () => {
    // 2024-03-01 is a Friday; its Monday is 2024-02-26, and reaching it crosses 29 February.
    expect(mondayOf("2024-03-01")).toBe("2024-02-26");
  });
});

describe("trainingWeeksFor: the two weeks the dashboard compares", () => {
  it("returns Monday-to-Sunday spans that meet exactly, with no gap and no overlap", () => {
    // 2026-08-13 is a Thursday in Warsaw at this instant.
    const weeks = trainingWeeksFor("Europe/Warsaw", new Date("2026-08-13T10:00:00Z"));

    expect(weeks.current).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(weeks.previous).toEqual({ start: "2026-08-03", end: "2026-08-09" });
  });

  it("rolls over on Sunday night, in the reader's zone and not in UTC", () => {
    // 22:30 UTC on Sunday 2026-08-09 is already 00:30 Monday in Warsaw. A reader in Warsaw is in a
    // new training week; a reader in UTC is not. This is the whole reason the zone is read at all.
    const instant = new Date("2026-08-09T22:30:00Z");

    expect(trainingWeeksFor("Europe/Warsaw", instant).current.start).toBe("2026-08-10");
    expect(trainingWeeksFor("UTC", instant).current.start).toBe("2026-08-03");
  });

  it("spans a spring DST transition without losing or gaining a day", () => {
    // Europe/Warsaw goes GMT+1 → GMT+2 during Sunday 2026-03-29, so that week is 167 hours long.
    // Any implementation that reaches its Monday by subtracting 7 × 24 hours from a LOCAL date lands
    // an hour short and, at the wrong time of day, a whole day early.
    const weeks = trainingWeeksFor("Europe/Warsaw", new Date("2026-03-29T12:00:00Z"));

    expect(weeks.current).toEqual({ start: "2026-03-23", end: "2026-03-29" });
    expect(weeks.previous).toEqual({ start: "2026-03-16", end: "2026-03-22" });
  });

  it("spans an autumn DST transition too, where the week is 169 hours", () => {
    // The mirror case: GMT+2 → GMT+1 during Sunday 2026-10-25. Both directions, because an
    // implementation can be wrong in only one.
    const weeks = trainingWeeksFor("Europe/Warsaw", new Date("2026-10-25T12:00:00Z"));

    expect(weeks.current).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(weeks.previous).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("spans a year boundary", () => {
    const weeks = trainingWeeksFor("Europe/Warsaw", new Date("2027-01-01T12:00:00Z"));

    expect(weeks.current).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(weeks.previous).toEqual({ start: "2026-12-21", end: "2026-12-27" });
  });

  it("always yields exactly fourteen days across both weeks", () => {
    // The bound the tonnage service relies on: the read spans previous.start to current.end and must
    // never be wider than 14 rows. Asserted over a year of instants rather than one, because a
    // boundary bug that only shows in some weeks is exactly the kind this suite exists to catch.
    for (let day = 0; day < 365; day++) {
      const instant = new Date(Date.UTC(2026, 0, 1 + day, 12));
      const { current, previous } = trainingWeeksFor("Europe/Warsaw", instant);

      const span = (range: { start: string; end: string }) =>
        (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000;

      expect(span(current), `current week at ${instant.toISOString()}`).toBe(6);
      expect(span(previous), `previous week at ${instant.toISOString()}`).toBe(6);
      // The two weeks meet: the day after previous.end is current.start.
      expect(Date.parse(`${current.start}T00:00:00Z`) - Date.parse(`${previous.end}T00:00:00Z`)).toBe(86_400_000);
    }
  });

  it("falls back with todayIn rather than throwing on an unknown zone", () => {
    // Inherited behaviour, asserted so it is a decision rather than an accident: a bad zone yields a
    // week that is wrong by at most a day, visibly, instead of a blank screen.
    const instant = new Date("2026-08-13T10:00:00Z");

    expect(() => trainingWeeksFor("Nowhere/Nowhere", instant)).not.toThrow();
    expect(trainingWeeksFor("Nowhere/Nowhere", instant)).toEqual(trainingWeeksFor("UTC", instant));
  });
});
