/**
 * The IANA timezones this deployment recognises — one list, read by the `<select>` that offers them
 * and by the validator that accepts them.
 *
 * **They must be one source.** If the page rendered its options from one list and the endpoint
 * checked membership against another, the form could offer a value the server then refused, and the
 * user would have no way to tell which of the two was wrong.
 *
 * Dependency-free and free of `astro:*` imports, so the hermetic unit suite can reach it
 * (AGENTS.md § Testing). Computed once at module scope: the answer cannot change within a
 * deployment, and `Intl.supportedValuesOf` is not free enough to call per request under the 10 ms
 * CPU cap.
 *
 * **Measured in real workerd before this was written**, not assumed — `calendar.ts` warns in writing
 * that ICU behaviour there cannot be inferred from a green Node test. Through a temporary endpoint
 * served by `astro dev` (which runs the real runtime), deleted once it had answered:
 *
 *     hasSupportedValuesOf: true   count: 418   hasWarsaw: true   hasKiritimati: true
 *     joined names: 6825 bytes
 */

/**
 * The tripwire list, and **not a supported mode**.
 *
 * It exists only so that a runtime without `Intl.supportedValuesOf` degrades to a usable screen
 * rather than an empty `<select>` nobody can submit. The measurement above says this branch is
 * unreachable on the deployment target today; if it ever becomes reachable, the symptom is a
 * timezone list that has collapsed from 418 entries to seven, which is visible on screen — unlike
 * the failure it replaces.
 *
 * Deliberately small. Growing it towards completeness by hand would turn a tripwire into a second
 * source of truth, which is the exact thing this module exists to prevent.
 */
const FALLBACK_TIME_ZONES = [
  "UTC",
  "Europe/Warsaw",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const ZONES: readonly string[] = readSupportedTimeZones();

// A Set for the membership test: the list is ~418 entries and `isSupportedTimeZone` runs on the
// request path of every profile write.
const ZONE_SET: ReadonlySet<string> = new Set(ZONES);

function readSupportedTimeZones(): readonly string[] {
  // `supportedValuesOf` is ES2022 and present in workerd; the guard is what makes the fallback a
  // tripwire rather than a crash on a runtime that lacks it.
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported !== "function") {
    return [...FALLBACK_TIME_ZONES].sort((a, b) => a.localeCompare(b, "en"));
  }

  try {
    return [...supported.call(Intl, "timeZone")].sort((a, b) => a.localeCompare(b, "en"));
  } catch {
    return [...FALLBACK_TIME_ZONES].sort((a, b) => a.localeCompare(b, "en"));
  }
}

/** Every zone the `<select>` offers, sorted for a human scanning it. */
export function supportedTimeZones(): readonly string[] {
  return ZONES;
}

/**
 * Whether `value` names a zone this deployment knows.
 *
 * **Not a regex and not a length check.** The failure this closes is a well-formed string that is
 * not a real zone: `todayIn` catches the `RangeError` an unknown zone raises and falls back to UTC
 * (`calendar.ts:29`), deliberately, so a bad profile cannot take a page down. The consequence is
 * that `Europe/Warsawa` would produce a wrong week boundary with nothing on screen saying so. Until
 * this slice nobody could write the column; now a form can, so the refusal has to happen here.
 */
export function isSupportedTimeZone(value: unknown): value is string {
  return typeof value === "string" && ZONE_SET.has(value);
}
