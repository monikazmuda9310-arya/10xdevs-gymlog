/**
 * Weekly training volume (FR-017, US-03) — this training week's total tonnage and the previous
 * week's, in kilograms.
 *
 * TWO THINGS IN THIS MODULE READ AS RULE VIOLATIONS AND ARE NOT. Both are stated here rather than
 * discovered.
 *
 * **1. The Worker adds up to fourteen numbers, and "aggregate in Postgres" still holds.** The rule
 * exists because work proportional to THE NUMBER OF SETS grows without bound under the Workers Free
 * 10 ms CPU cap — a hard kill, not a throttle. That work stays in SQL: `public.daily_tonnage` sums
 * `reps * greatest(weight_kg, 0)` per account per day. What crosses into the Worker is work
 * proportional to THE NUMBER OF DAYS IN TWO WEEKS, which is fourteen, forever, whatever the log
 * grows to. Folding here is what lets the view stay ignorant of weeks and timezones — the single
 * definition of "a training week" lives in `calendar.ts`, where the hermetic suite can reach it.
 *
 * **2. This module displays a number computed by SQL, which `record-display.ts` forbids.** That rule
 * ("no number computed by SQL is ever displayed") is right for a record: the view ranks, and
 * TypeScript re-derives the printed figure from the set's own columns. A weekly total cannot be
 * re-derived without walking every set, which is the exact thing this slice exists to avoid. So the
 * summed number is displayed, converted and rounded. The compensating control is assertion 1 of
 * `tests/integration/weekly-tonnage.test.ts`, which sums the same fixture independently in
 * TypeScript and compares — the role `personal-records.test.ts` assertion 4 plays for the 1RM
 * formula. That TypeScript sum lives in the test and must never move into `src/`: a second
 * production implementation is how the 1RM two-implementations hazard was created.
 *
 * **S-08 adds a second read, `weeklyBreakdown`, and both exemptions carry over with one change.**
 * The breakdown reads `public.daily_exercise_tonnage` at `(day, exercise)` grain, so the number of
 * rows crossing into the Worker is no longer the constant fourteen — it is `days × distinct
 * exercises per day`, bounded by training habit rather than by arithmetic. The bound is therefore
 * asserted rather than assumed: `MAX_BREAKDOWN_ROWS` in `tonnage-breakdown.ts`, a `throw` and never
 * a `.limit()`. The per-set arithmetic still stays in SQL, which is the rule's actual subject. And
 * the compensating control for the displayed figures is assertion 2 of
 * `tests/integration/tonnage-breakdown.test.ts`, which plays for the breakdown the role assertion 1
 * of `weekly-tonnage.test.ts` plays for the total — and lives in the test, for the same reason.
 *
 * **The read is here; every decision is in `tonnage-breakdown.ts`.** This module does I/O.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { trainingWeeksFor, type DateRange } from "@/lib/services/calendar";
import { foldBreakdown, type WeekBreakdown } from "@/lib/services/tonnage-breakdown";

type Client = SupabaseClient<Database>;

/** One week's total, and whether the account logged anything in it at all. */
export interface WeekTonnage extends DateRange {
  kilograms: number;
  /**
   * `false` only when the account logged NO sets that week. A week whose sets were all at zero or
   * assisted load has `hasSets: true` and `kilograms: 0` — the screen must say "no external load",
   * not "you did not train". Derived from row presence, because the view emits a row if and only if
   * a day has at least one set.
   */
  hasSets: boolean;
}

/** The number of days the read spans: two whole weeks. */
const DAYS_IN_TWO_WEEKS = 14;

/** What `weeklyBreakdown` spans: one week, because US-03 breaks down the current week only. */
const DAYS_IN_A_WEEK = 7;

/**
 * This week's and last week's tonnage for `userId`, as a reader in `timeZone` counts weeks.
 *
 * `now` is injectable for the same reason `trainingWeeksFor`'s is: it makes the boundary testable at
 * an exact instant, and it lets the integration suite aim at a historical week no other suite has
 * written into — which matters more here than anywhere else, because this read aggregates by DATE
 * RANGE and would otherwise pick up every fixture another suite left near today.
 *
 * Throws on a read failure rather than answering zero. **An emitted zero is a positive claim** — "you
 * did no work this week" — and handing that to a screen when the database is unreachable is the same
 * defect S-05 refused for `impact_unavailable`.
 */
export async function weeklyTonnage(
  supabase: Client,
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ current: WeekTonnage; previous: WeekTonnage }> {
  const { current, previous } = trainingWeeksFor(timeZone, now);

  // Asserted, not assumed. If `trainingWeeksFor` ever returned a wider range the fold below would
  // silently do unbounded work — the one thing this design exists to prevent. A throw, never a
  // `.limit(14)`: a limit is a silent truncation, which is the same defect wearing a seatbelt.
  const span = daysBetween(previous.start, current.end) + 1;
  if (span !== DAYS_IN_TWO_WEEKS) {
    throw new Error(`weeklyTonnage: expected a ${DAYS_IN_TWO_WEEKS}-day window, got ${span}`);
  }

  const { data, error } = await supabase
    .from("daily_tonnage")
    .select("performed_on, tonnage_kg")
    // The policy is the guarantee, the filter is the index path (AGENTS.md § Access control). Here
    // it is also what makes the range travel on `workouts_user_performed_on_idx`.
    .eq("user_id", userId)
    .gte("performed_on", previous.start)
    .lte("performed_on", current.end);

  if (error) {
    throw error;
  }

  // **This is what makes the `.gte`/`.lte` bounds load-bearing, and without it they are not.**
  // `fold` filters by week again in TypeScript, so deleting both bounds from the query changes no
  // answer — every assertion still passes while the Worker quietly receives one row per training day
  // in the account's entire history. That is unbounded work under a 10 ms CPU cap: the precise thing
  // this module's header claims to prevent. Found by implementation review; the query promised a
  // window, so a row outside it is a broken promise rather than a row to ignore.
  for (const row of data) {
    if (row.performed_on !== null && (row.performed_on < previous.start || row.performed_on > current.end)) {
      throw new Error(
        `weeklyTonnage: daily_tonnage returned ${row.performed_on}, outside the requested ` +
          `${previous.start}..${current.end} window`,
      );
    }
  }

  return {
    current: fold(current, data),
    previous: fold(previous, data),
  };
}

/**
 * One week's tonnage broken down per muscle group and per exercise (FR-018, FR-019, US-03).
 *
 * `week` is a range `trainingWeeksFor` produced and `weekTotalKg` is the figure `weeklyTonnage`
 * already returned for that same range — the number the screen is printing above the breakdown.
 * Handing both in is what lets `foldBreakdown` reconcile against what the user can actually see,
 * rather than against a second read of the same data.
 *
 * Throws on a read failure rather than answering an empty breakdown, for the reason `weeklyTonnage`
 * throws rather than answering zero: an empty list is a positive claim — "you trained nothing this
 * week" — and it is the same claim S-05 refused to make with `impact_unavailable`. `/dashboard`
 * catches this separately from the tonnage read, so a breakdown failure costs the breakdown and
 * leaves both totals on screen.
 */
export async function weeklyBreakdown(
  supabase: Client,
  userId: string,
  week: DateRange,
  weekTotalKg: number,
): Promise<WeekBreakdown> {
  // Asserted for the reason above: a wider range would be unbounded work under a 10 ms CPU cap.
  // `MAX_BREAKDOWN_ROWS` guards the other axis — how many exercises a day may hold.
  const span = daysBetween(week.start, week.end) + 1;
  if (span !== DAYS_IN_A_WEEK) {
    throw new Error(`weeklyBreakdown: expected a ${String(DAYS_IN_A_WEEK)}-day window, got ${String(span)}`);
  }

  const { data, error } = await supabase
    .from("daily_exercise_tonnage")
    .select("performed_on, exercise_id, exercise_name, muscle_group, tonnage_kg")
    // The policy is the guarantee, the filter is the index path (AGENTS.md § Access control). Both
    // columns are GROUP BY columns of the view, which is what keeps the range on
    // `workouts_user_performed_on_idx`.
    .eq("user_id", userId)
    .gte("performed_on", week.start)
    .lte("performed_on", week.end);

  if (error) {
    throw error;
  }

  return foldBreakdown(data, week, weekTotalKg);
}

interface DailyRow {
  performed_on: string | null;
  tonnage_kg: number | null;
}

/**
 * Total the rows falling inside `week`.
 *
 * **A null column is a read error, not a day worth nothing.** `records.ts` narrows by DROPPING
 * incomplete rows, and that is right there: a candidate missing its columns is one the ranking
 * cannot reason about. Here a row is one day OF THIS WEEK, and dropping it understates the total
 * silently — a query shape exact for one row is wrong for a set of them (`lessons.md`). The view's
 * `coalesce` should make this unreachable; the throw is what says so if it ever is not.
 */
function fold(week: DateRange, rows: DailyRow[]): WeekTonnage {
  const inWeek = rows.filter((row) => {
    if (row.performed_on === null || row.tonnage_kg === null) {
      throw new Error("weeklyTonnage: daily_tonnage returned a null column; refusing to understate a week");
    }
    return row.performed_on >= week.start && row.performed_on <= week.end;
  });

  const kilograms = inWeek.reduce((total, row) => total + Number(row.tonnage_kg), 0);
  // A non-finite total would render as the string "NaN" — not a crash, but a number the user would
  // believe. This module refuses to understate a week; refusing to invent one costs a line.
  if (!Number.isFinite(kilograms)) {
    throw new Error(`weeklyTonnage: ${week.start}..${week.end} summed to a non-finite value`);
  }

  return { ...week, kilograms, hasSets: inWeek.length > 0 };
}

/** Whole days between two `YYYY-MM-DD` dates, in the same zoneless frame `calendar.ts` uses. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}
