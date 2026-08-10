import { describe, expect, it } from "vitest";

import { todayIn } from "@/lib/services/calendar";

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
    // Kiritimati is UTC+14 and Niue is UTC-11 — twenty-five hours apart. This is the same check
    // src/pages/api/dev/tz-probe.ts makes against the real runtime, and it passing HERE proves
    // only that Node has full ICU data. Keep both.
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
