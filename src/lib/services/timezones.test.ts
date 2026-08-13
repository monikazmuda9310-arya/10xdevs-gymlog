// The one source the settings `<select>` and the profile validator both read.
//
// **What this suite cannot prove**: that the list is the same size where it runs. `vitest.config.ts`
// uses `environment: "node"`, and Node ships full ICU for every IANA zone; the deployment target is
// workerd, which was measured separately and answered 418 zones including Warsaw and Kiritimati
// (see the module header, and `calendar.ts` for the same warning about the same runtime). So these
// assertions cover the CONTRACT — sorted, non-empty, and refusing a well-formed impostor — and the
// count is deliberately not asserted.

import { describe, expect, it } from "vitest";

import { isSupportedTimeZone, supportedTimeZones } from "@/lib/services/timezones";

describe("supportedTimeZones", () => {
  it("offers a real list, not an empty select nobody can submit", () => {
    // Ten is far below the measured 418 and far above the seven-entry fallback, so this fails if
    // the runtime hands back nothing without also failing when the tripwire list is in use.
    expect(supportedTimeZones().length).toBeGreaterThan(10);
  });

  it("contains the column default, which every account starts on", () => {
    // `profiles.timezone` defaults to 'Europe/Warsaw'. If the list ever stopped carrying it, the
    // settings screen would refuse to re-save the value the account already holds.
    expect(supportedTimeZones()).toContain("Europe/Warsaw");
  });

  it("is sorted, because a human scans it rather than searches it", () => {
    const zones = supportedTimeZones();
    const sorted = [...zones].sort((a, b) => a.localeCompare(b, "en"));
    expect(zones).toEqual(sorted);
  });

  it("carries no duplicates, so an option cannot appear twice", () => {
    const zones = supportedTimeZones();
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("isSupportedTimeZone", () => {
  it("accepts every zone the select will offer", () => {
    for (const zone of supportedTimeZones()) {
      expect(isSupportedTimeZone(zone)).toBe(true);
    }
  });

  it("refuses a well-formed impostor", () => {
    // This is the failure the check exists for, and the reason it is not a regex or a length test:
    // `Europe/Warsawa` has the shape of a zone and is not one. `todayIn` would catch the RangeError
    // it raises and answer in UTC (`calendar.ts:29`) — a wrong week boundary, silently.
    expect(isSupportedTimeZone("Europe/Warsawa")).toBe(false);
    expect(isSupportedTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isSupportedTimeZone("europe/warsaw")).toBe(false);
  });

  it("refuses non-strings and empty input without throwing", () => {
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone(null)).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
    expect(isSupportedTimeZone(7)).toBe(false);
    expect(isSupportedTimeZone({})).toBe(false);
  });

  it("refuses the prototype's own property names, which a Set membership test does not", () => {
    // A plain-object lookup would answer true for `constructor` and `toString`. The module uses a
    // Set; this pins that it stays one.
    expect(isSupportedTimeZone("constructor")).toBe(false);
    expect(isSupportedTimeZone("toString")).toBe(false);
  });
});
