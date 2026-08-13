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
 * would still be green — so it was measured there instead, through a temporary endpoint that
 * answered from real workerd with three distinct dates for Kiritimati (+14), UTC and Niue (−11).
 * The endpoint was deleted once it had answered; the record is in
 * `context/changes/log-workout-with-estimate/change.md` § Phase 2.
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

/** An inclusive span of calendar dates, both `YYYY-MM-DD`. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * The Monday of the week containing `isoDate`. `YYYY-MM-DD` in, `YYYY-MM-DD` out.
 *
 * **A training week runs Monday–Sunday**, so a Sunday belongs to the week that started six days
 * earlier, not to the one starting tomorrow. That off-by-one is the failure the PRD names by name.
 *
 * **Why `UTC` appears in a module about timezones, and why it is not a bug.** The input is a
 * calendar date with no zone and no instant behind it. Anchoring it at `T00:00:00Z` and using the
 * `getUTC*` accessors gives an arithmetic frame that **has no DST** — which is the point:
 * `Europe/Warsaw` has two transitions a year, so a week there is sometimes 167 or 169 hours, and
 * anything computed by subtracting `7 * 24 * 3600 * 1000` from a *local* Date is wrong twice a year.
 * `setUTCDate` handles month and year rollover for free.
 *
 * This is NOT "converting through UTC": there is no zone to convert from. It is also deliberately
 * free of `Intl` — asking for a weekday name would re-open the ICU question `todayIn` above had to
 * measure in real workerd, for no gain.
 */
export function mondayOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  // getUTCDay: Sunday is 0 and Monday is 1, so this maps Sunday to 6 and Monday to 0 — the number
  // of days to step back to reach the Monday that opened this week.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return date.toISOString().slice(0, 10);
}

/**
 * The current training week and the one before it, for a reader in `timeZone`.
 *
 * **This is the only place the profile timezone is allowed to matter**, and only for deciding what
 * "today" is: turning an instant into a calendar date genuinely needs a zone. Reinterpreting a
 * *stored* `workouts.performed_on` through a zone is a different operation and is forbidden — that
 * column is a date the user stated, with no instant behind it, so re-projecting it invents one and
 * moves dates by a day at the edges. Everything downstream of here receives four plain date strings.
 *
 * `now` is injectable for the same reason `todayIn`'s is: it is what makes the boundary testable at
 * exact instants, and what lets an integration suite aim at a week no other suite has written to.
 */
export function trainingWeeksFor(
  timeZone: string,
  now: Date = new Date(),
): { current: DateRange; previous: DateRange } {
  const currentStart = mondayOf(todayIn(timeZone, now));

  return {
    current: { start: currentStart, end: addDays(currentStart, 6) },
    previous: { start: addDays(currentStart, -7), end: addDays(currentStart, -1) },
  };
}

/** Calendar-day arithmetic on a zoneless date, in the same DST-free frame `mondayOf` uses. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
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
