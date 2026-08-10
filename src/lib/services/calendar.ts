/**
 * Calendar dates in the user's own timezone.
 *
 * This is the single place the profile timezone is needed while logging a workout, and getting it
 * wrong is invisible: at 01:00 in Warsaw, UTC still reads yesterday, so a session logged just after
 * midnight would default to the wrong day and the user would have no reason to look.
 *
 * Dependency-free and free of `astro:*` imports, so the unit suite can reach it. Note that passing
 * that suite proves less than it appears to — see the warning on `todayIn`.
 */

/**
 * The calendar date at `now`, as seen in `timeZone`, formatted `YYYY-MM-DD`.
 *
 * Built from `formatToParts` rather than from a locale that happens to produce ISO order, because
 * "a locale that happens to" is how a date silently becomes `11/08/2026` on somebody else's build.
 *
 * **A passing unit test does not prove this works where it runs.** `vitest.config.ts` uses
 * `environment: "node"`, and Node ships full ICU data for every IANA zone. The deployment target is
 * workerd. If that runtime carried reduced ICU, every zone would collapse to UTC here and the tests
 * would still be green. `src/pages/api/dev/tz-probe.ts` is what measures it in the real runtime.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return format(timeZone, now);
  } catch {
    // An invalid zone throws a RangeError. A profile carrying a bad timezone must not take a page
    // down over the default value of a date field — UTC is wrong by at most a day, and visibly so,
    // which is a better failure than a blank screen.
    return format("UTC", now);
  }
}

function format(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}
