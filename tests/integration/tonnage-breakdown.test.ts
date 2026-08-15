// Proves `public.daily_exercise_tonnage` against real rows in gymlog-test: that the per-exercise and
// per-muscle-group breakdown RECONCILES with the weekly total the dashboard prints above it, and that
// it keeps reconciling under the one condition that can silently break it.
//
// **THIS SUITE OWNS ITS DATES**, for the reason `weekly-tonnage.test.ts` states first and at length:
// it aggregates by DATE RANGE, so anything any suite ever logged inside a window lands in the figure,
// and a name prefix cannot help because the range does not care what a row is called. Every test
// passes its own anchor and writes its own workouts there.
//
// **ONE ANCHOR PER ASSERTION THAT NEEDS ITS OWN WINDOW, MAPPED IN `ANCHORS` BELOW.** Two assertions
// share a window in exactly two places and both are deliberate (see the comments there). The failure
// mode this guards against is not a red suite: it is two assertions quietly reading each other's
// fixtures and BOTH passing for the wrong reason.
//
// **Assertion 9 was RETIRED on 2026-08-15 and its reasoning is preserved at the foot of this file.**
// Read that block before concluding the `left join` in `public.daily_exercise_tonnage` is decorative:
// it is load-bearing and, since the trigger `cross-account-isolation` added, no longer test-guarded.
//
// MARK is `s08-`, free and neither a prefix of nor prefixed by any existing mark (`s01-signup-`,
// `s03-`, `s03-endpoints-`, `s03-page-`, `s07-`).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { trainingWeeksFor, type DateRange } from "@/lib/services/calendar";
import type { MuscleGroup } from "@/types";
import { PATCH as updateWorkoutRoute } from "@/pages/api/workouts/[id]/index";
import { resetPreferences } from "./fixture-preferences";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";
const MARK = "s08-";
const ZONE = "Europe/Warsaw";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * **The window map. One anchor per assertion that needs its own, and the two shared ones justified.**
 *
 * All Wednesdays, exactly four weeks apart so no two windows touch, in months no other suite writes
 * to: 2024 is entirely free and `weekly-tonnage.test.ts` holds June–December 2025 (its earliest
 * window opens 2025-06-02, one day after `hazard`'s closes).
 *
 * | Anchor       | Assertion(s) |
 * |--------------|--------------|
 * | `2024-12-11` | 7 and 8 — both access probes over one fixture. Shared deliberately: neither
 * |              |   mutates anything, and 8 does not even read a window. Separating them would prove
 * |              |   nothing and would cost a fourth fixture write.
 * | `2025-01-08` | 1 and 2 — the same fixture is the subject of both BY DESIGN: 1 compares the two
 * |              |   views against each other, 2 compares the breakdown against a TypeScript sum of
 * |              |   the very same rows. Two windows would make them two different claims.
 * | `2025-02-05` | 3 — mixed units in one workout
 * | `2025-03-05` | 4 — zero-load and assisted sets
 * | `2025-04-02` | 5 — two workouts, one date, one exercise
 * | `2025-04-30` | 6 — the moved workout. **Its own window, non-negotiable**: it mutates `performed_on`
 * | `2025-05-28` | *(retired with assertion 9 — left out of this map rather than reused, so a future
 * |              |   assertion that wants a window does not silently inherit one that older rows in
 * |              |   `gymlog-test` may still occupy)*
 */
const ANCHORS = {
  access: "2024-12-11",
  reconcile: "2025-01-08",
  units: "2025-02-05",
  bodyweight: "2025-03-05",
  sameDay: "2025-04-02",
  moved: "2025-04-30",
} as const;

/** The factor the generated `sets.weight_kg` column applies. Compared against, never used to write. */
const KG_PER_LB = 0.45359237;

/**
 * The tolerance for every cross-view comparison here: **a thousand times tighter than the runtime
 * guard `foldBreakdown` will carry (0.001 kg), and that asymmetry is deliberate.** Postgres sums in
 * `numeric`, which is exact; the Worker sums in `double`, and totalling per-day rows is a different
 * summation ORDER over the same values than totalling per-exercise rows, so the two can differ in the
 * last bits. The runtime guard has to tolerate whatever a real log produces. This suite sums a
 * fixture of a few dozen sets, where the achievable error is far below a microgram — so a looser
 * bound here would hide a real defect that the runtime guard cannot afford to reject.
 */
const PRECISION = 6;

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;
let anonymous: SupabaseClient<Database>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.data.session) {
    throw new Error(`could not sign in ${email}: ${signIn.error?.message ?? "no session"}`);
  }
  return { client, userId: signIn.data.session.user.id };
}

/** The slice of APIContext the handler actually reads. Cast rather than mocked wholesale. */
function context(owner: Owner, id: string, body: unknown) {
  return {
    locals: { supabase: owner.client, user: { id: owner.userId } },
    params: { id },
    request: new Request(`http://localhost/api/workouts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

interface Weeks {
  now: Date;
  current: DateRange;
  previous: DateRange;
}

/** The two weeks around an anchor, computed the same way the product computes them. */
function weeksAround(anchor: string): Weeks {
  const now = new Date(`${anchor}T12:00:00Z`);
  const { current, previous } = trainingWeeksFor(ZONE, now);
  return { now, current, previous };
}

/**
 * A fixture exercise, always owned. **Never seeded** (`user_id: null`): `exercises-rls.test.ts`
 * asserts `toHaveLength(38)` over the seeded catalogue, so a stray null-owner row fails a suite that
 * has nothing to do with tonnage.
 */
async function makeExercise(owner: Owner, label: string, group: MuscleGroup): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: group, is_bodyweight: true })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  }
  return data.id;
}

interface LoggedSet {
  reps: number;
  weight: number;
  unit?: "kg" | "lb";
}

interface LoggedEntry {
  exerciseId: string;
  sets: LoggedSet[];
}

/**
 * A workout on `performedOn` carrying one entry per element of `entries`, written straight to the
 * tables.
 *
 * Not through `/api/sets`, deliberately: that endpoint stamps the unit from the profile, and
 * assertion 3 needs a single workout carrying BOTH units. Not through `/api/exercise-entries`
 * either, because assertion 9 needs an entry the service would happily create but the UI never
 * would. Both endpoint paths have their own suites.
 */
async function logWorkout(owner: Owner, performedOn: string, entries: LoggedEntry[]): Promise<string> {
  const workout = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: performedOn, note: `${MARK}${RUN_ID}` })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`could not create a workout on ${performedOn}: ${workout.error.message}`);
  }

  for (const { exerciseId, sets } of entries) {
    const entry = await owner.client
      .from("exercise_entries")
      .insert({ user_id: owner.userId, workout_id: workout.data.id, exercise_id: exerciseId })
      .select("id")
      .single();
    if (entry.error) {
      throw new Error(`could not create an entry for ${exerciseId}: ${entry.error.message}`);
    }

    for (const set of sets) {
      const { error } = await owner.client.from("sets").insert({
        user_id: owner.userId,
        exercise_entry_id: entry.data.id,
        reps: set.reps,
        weight: set.weight,
        weight_unit: set.unit ?? "kg",
      });
      if (error) {
        throw new Error(`could not log ${set.reps}x${set.weight}: ${error.message}`);
      }
    }
  }

  return workout.data.id;
}

/** The tonnage the product should report, computed independently of either view. */
function expectedKilograms(sets: LoggedSet[]): number {
  return sets.reduce((total, set) => {
    const kilograms = (set.unit ?? "kg") === "kg" ? set.weight : set.weight * KG_PER_LB;
    return total + set.reps * Math.max(kilograms, 0);
  }, 0);
}

interface BreakdownRow {
  performed_on: string | null;
  exercise_id: string | null;
  exercise_name: string | null;
  muscle_group: MuscleGroup | null;
  tonnage_kg: number | null;
}

/**
 * The breakdown rows for one week, read DIRECTLY from the view.
 *
 * No service sits in front of it on purpose: `weeklyBreakdown` does not exist until Phase 2, and
 * assertion 7 specifically needs a read that no `.eq("user_id", …)` of ours has already filtered.
 */
async function readBreakdown(owner: Owner, week: DateRange, userId = owner.userId): Promise<BreakdownRow[]> {
  const { data, error } = await owner.client
    .from("daily_exercise_tonnage")
    .select("performed_on, exercise_id, exercise_name, muscle_group, tonnage_kg")
    .eq("user_id", userId)
    .gte("performed_on", week.start)
    .lte("performed_on", week.end);
  if (error) {
    throw new Error(`could not read daily_exercise_tonnage: ${error.code} ${error.message}`);
  }
  return data;
}

/** The same week's total from `public.daily_tonnage` — the figure the breakdown must reconcile with. */
async function readWeekTotal(owner: Owner, week: DateRange): Promise<number> {
  const { data, error } = await owner.client
    .from("daily_tonnage")
    .select("performed_on, tonnage_kg")
    .eq("user_id", owner.userId)
    .gte("performed_on", week.start)
    .lte("performed_on", week.end);
  if (error) {
    throw new Error(`could not read daily_tonnage: ${error.code} ${error.message}`);
  }
  return data.reduce((total, row) => total + (row.tonnage_kg ?? 0), 0);
}

const sumRows = (rows: BreakdownRow[]): number => rows.reduce((total, row) => total + (row.tonnage_kg ?? 0), 0);

/** Fold the view's `(day, exercise)` rows by whichever key a given assertion is about. */
function totalBy<K extends string | null>(rows: BreakdownRow[], key: (row: BreakdownRow) => K): Map<K, number> {
  const totals = new Map<K, number>();
  for (const row of rows) {
    const k = key(row);
    totals.set(k, (totals.get(k) ?? 0) + (row.tonnage_kg ?? 0));
  }
  return totals;
}

/**
 * The fixture assertions 1 and 2 share — written **once**, by whichever of them runs first.
 *
 * Sharing a window is the design (see the ANCHORS map); sharing it by having assertion 2 read rows
 * assertion 1 happened to write is not. That shape makes `-t "2."` fail on its own, which
 * `weekly-tonnage.test.ts:345-347` records as a mistake already made once here. A memoised builder
 * gives both assertions the same rows and leaves each of them runnable alone.
 */
let reconcileFixture: Promise<Record<"legs" | "back" | "chest", string>> | undefined;

function theReconcileFixture(): Promise<Record<"legs" | "back" | "chest", string>> {
  reconcileFixture ??= (async () => {
    const legs = await makeExercise(ownerA, "reconcile-legs", "legs");
    const back = await makeExercise(ownerA, "reconcile-back", "back");
    const chest = await makeExercise(ownerA, "reconcile-chest", "chest");

    // The anchor's week runs Mon 2025-01-06 to Sun 2025-01-12.
    await logWorkout(ownerA, ANCHORS.reconcile, [
      { exerciseId: legs, sets: [{ reps: 5, weight: 100 }] },
      { exerciseId: back, sets: [{ reps: 8, weight: 60 }] },
    ]);
    // A second day in the SAME week, repeating one exercise — so the fold in assertion 2 has to add
    // two rows for `legs` rather than read one.
    await logWorkout(ownerA, "2025-01-10", [
      { exerciseId: chest, sets: [{ reps: 3, weight: 80 }] },
      { exerciseId: legs, sets: [{ reps: 4, weight: 90 }] },
    ]);

    return { legs, back, chest };
  })();
  return reconcileFixture;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);
  anonymous = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // This suite's own precondition (see `./fixture-preferences.ts`): the timezone decides where a week
  // starts, so a run left flipped by another suite would move every window.
  for (const owner of [ownerA, ownerB]) {
    await resetPreferences(owner.client, owner.userId);
  }

  // **BOTH accounts' workouts before EITHER account's exercises, and the two passes are not
  // tidiness.** `exercise_id` carries `on delete restrict`, so deleting an exercise while any entry
  // still points at it fails outright; deleting workouts cascades to entries and sets, which is what
  // releases the restrict. Retired assertion 9 built such an entry ACROSS the two accounts, which is
  // why the passes are also ordered across owners — and this run may still meet one of its rows,
  // because that fixture survived from one run to the beginning of the next. Kept after the
  // retirement: the single-owner case still needs the ordering, and the cross-owner pass costs one
  // extra statement.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", owner.userId);
  }
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", owner.userId);
  }
});

describe("tonnage breakdown: it reconciles", () => {
  it("1. the breakdown sums to daily_tonnage over the same week", async () => {
    // **US-03's headline criterion.** The two views carry two copies of
    // `sum(reps * greatest(weight_kg, 0))` — one in each migration — and this is the assertion that
    // makes them checkable rather than merely documented. It compares across the boundary the
    // breakdown adds: `daily_tonnage` never joins `exercises`, this one does.
    const weeks = weeksAround(ANCHORS.reconcile);
    await theReconcileFixture();

    const rows = await readBreakdown(ownerA, weeks.current);
    const weekTotal = await readWeekTotal(ownerA, weeks.current);

    // Non-vacuous: an empty window would satisfy `0 === 0`.
    expect(weekTotal).toBeGreaterThan(0);
    expect(sumRows(rows)).toBeCloseTo(weekTotal, PRECISION);
  });

  it("2. every group and every exercise matches a TypeScript sum of the same fixture", async () => {
    // The compensating control for DISPLAYING a number computed by SQL — the role
    // `personal-records.test.ts` assertion 4 plays for the 1RM formula and `weekly-tonnage.test.ts`
    // assertion 1 plays for the total. **This sum lives here and must never move into `src/`**: a
    // second production implementation is exactly how the 1RM two-implementations hazard was made.
    //
    // Shares assertion 1's window and fixture on purpose — see the ANCHORS map. Assertion 1 asks "do
    // the two views agree"; this one asks "is either of them right", which no cross-view comparison
    // can answer. The fixture is memoised rather than inherited, so this assertion runs alone.
    const weeks = weeksAround(ANCHORS.reconcile);
    await theReconcileFixture();
    const rows = await readBreakdown(ownerA, weeks.current);

    const byGroup = totalBy(rows, (row) => row.muscle_group);
    expect(byGroup.get("legs")).toBeCloseTo(
      expectedKilograms([
        { reps: 5, weight: 100 },
        { reps: 4, weight: 90 },
      ]),
      PRECISION,
    );
    expect(byGroup.get("back")).toBeCloseTo(expectedKilograms([{ reps: 8, weight: 60 }]), PRECISION);
    expect(byGroup.get("chest")).toBeCloseTo(expectedKilograms([{ reps: 3, weight: 80 }]), PRECISION);
    // Exactly three groups this week, so nothing is being attributed twice or landing in a bucket
    // nobody trained.
    expect([...byGroup.keys()].sort()).toEqual(["back", "chest", "legs"]);

    // And per exercise — `legs` spans two days, so this is the half that fails if the view were
    // grouped without `exercise_id` or the fold read one row and stopped.
    const byExercise = totalBy(rows, (row) => row.exercise_name);
    expect(byExercise.get(`${MARK}reconcile-legs-${RUN_ID}`)).toBeCloseTo(860, PRECISION);
    expect(byExercise.get(`${MARK}reconcile-back-${RUN_ID}`)).toBeCloseTo(480, PRECISION);
    expect(byExercise.get(`${MARK}reconcile-chest-${RUN_ID}`)).toBeCloseTo(240, PRECISION);
    // The three differ, so a fold that dumped everything into one bucket could not pass.
    expect(new Set(byExercise.values()).size).toBe(3);
  });

  it("3. sums mixed units through weight_kg, not through the number typed", async () => {
    // Since S-06 one account can hold both units at once. Summing `weight` across a mixed account
    // produces a figure with no unit and no meaning, and nothing but a reader would catch it — the
    // role assertion 3 of `weekly-tonnage.test.ts` plays for the total, re-made at this grain because
    // the breakdown is a second `sum(...)` expression in a second file.
    const weeks = weeksAround(ANCHORS.units);
    const exerciseId = await makeExercise(ownerA, "units-back", "back");
    const sets: LoggedSet[] = [
      { reps: 5, weight: 100, unit: "kg" },
      { reps: 5, weight: 100, unit: "lb" },
    ];
    await logWorkout(ownerA, ANCHORS.units, [{ exerciseId, sets }]);

    const rows = await readBreakdown(ownerA, weeks.current);

    expect(sumRows(rows)).toBeCloseTo(expectedKilograms(sets), PRECISION);
    // The naive answer — summing `weight` — would be 1000. The right one is ~726.8.
    expect(sumRows(rows)).not.toBeCloseTo(1000, 3);
  });

  it("4. a zero-load and an assisted set contribute zero, and the exercise still gets a row", async () => {
    // Both halves of the domain rule, in the one term `greatest(weight_kg, 0)` implements. `toBe(0)`
    // covers both directions at once, so there is no second assertion here pretending to add one:
    // without `greatest` this row reads −160, which is the figure S-07's mutation protocol measured.
    //
    // **The row's PRESENCE is the other half.** A group whose only sets this week were planks must
    // read `0` on screen rather than vanish — "you did no work" and "you lifted no external load" are
    // different sentences, and only a row can carry the difference.
    const weeks = weeksAround(ANCHORS.bodyweight);
    const exerciseId = await makeExercise(ownerA, "bodyweight-core", "core");
    await logWorkout(ownerA, ANCHORS.bodyweight, [
      {
        exerciseId,
        sets: [
          { reps: 60, weight: 0 },
          { reps: 8, weight: -20 },
        ],
      },
    ]);

    const rows = await readBreakdown(ownerA, weeks.current);
    const core = rows.filter((row) => row.exercise_id === exerciseId);

    expect(core).toHaveLength(1);
    expect(Number(core[0].tonnage_kg)).toBe(0);
    expect(core[0].muscle_group).toBe("core");
  });

  it("5. two workouts on one date with the same exercise fold into a single row", async () => {
    // `unique (workout_id, exercise_id)` scopes uniqueness to a WORKOUT, so two workouts on one day
    // can both carry the same exercise — a morning and an evening session. What makes that one line
    // on screen is the GROUP BY, not a "one entry per day" rule that does not exist.
    const weeks = weeksAround(ANCHORS.sameDay);
    const exerciseId = await makeExercise(ownerA, "sameday-shoulders", "shoulders");
    await logWorkout(ownerA, ANCHORS.sameDay, [{ exerciseId, sets: [{ reps: 5, weight: 50 }] }]);
    await logWorkout(ownerA, ANCHORS.sameDay, [{ exerciseId, sets: [{ reps: 3, weight: 40 }] }]);

    const rows = await readBreakdown(ownerA, weeks.current);
    const mine = rows.filter((row) => row.exercise_id === exerciseId);

    expect(mine).toHaveLength(1);
    expect(Number(mine[0].tonnage_kg)).toBeCloseTo(370, PRECISION);
    expect(mine[0].performed_on).toBe(ANCHORS.sameDay);
  });

  it("6. moving a workout across a Monday moves its tonnage between weeks, and both still reconcile", async () => {
    // US-03's recompute criterion at the new grain. Nothing is stored, so the move is a re-derivation:
    // no write to any figure, nothing to invalidate.
    const weeks = weeksAround(ANCHORS.moved);
    const exerciseId = await makeExercise(ownerA, "moved-arms", "arms");
    const workoutId = await logWorkout(ownerA, weeks.previous.end, [{ exerciseId, sets: [{ reps: 4, weight: 75 }] }]);

    const before = {
      current: await readBreakdown(ownerA, weeks.current),
      previous: await readBreakdown(ownerA, weeks.previous),
    };
    expect(sumRows(before.previous)).toBeCloseTo(300, PRECISION);
    expect(before.current).toEqual([]);

    // **The note is re-sent, not nulled.** `updateWorkoutSchema` is a full replacement, so `note: null`
    // would clear the very column `beforeAll` cleans up by — the moved workout would survive every
    // future teardown and poison this window permanently. `weekly-tonnage.test.ts` measured that the
    // hard way and the orphan had to be deleted by hand.
    const moved = await updateWorkoutRoute(
      context(ownerA, workoutId, { performedOn: weeks.current.start, note: `${MARK}${RUN_ID}` }),
    );
    expect(moved.status).toBe(200);

    const after = {
      current: await readBreakdown(ownerA, weeks.current),
      previous: await readBreakdown(ownerA, weeks.previous),
    };
    // Both walls move together, which is the property — asserting only one would pass against code
    // that added to this week without removing from last.
    expect(after.previous).toEqual([]);
    expect(sumRows(after.current)).toBeCloseTo(300, PRECISION);
    expect(after.current[0]?.muscle_group).toBe("arms");

    // And each week still agrees with `daily_tonnage`, which is the claim a moved row could break
    // without changing either figure's plausibility.
    expect(sumRows(after.current)).toBeCloseTo(await readWeekTotal(ownerA, weeks.current), PRECISION);
    expect(sumRows(after.previous)).toBeCloseTo(await readWeekTotal(ownerA, weeks.previous), PRECISION);
  });
});

describe("tonnage breakdown: the access boundary", () => {
  it("7. one account's breakdown is unreachable by another, even by naming the id", async () => {
    // The `security_invoker` boundary, and here it is a GUARD rather than a tripwire: this view reads
    // `sets`, `exercise_entries`, `workouts` and `exercises` DIRECTLY, so it stands where
    // `daily_tonnage` and `set_estimates` stand. Without the flag it executes as `postgres`, which
    // owns every table and is not subject to their policies. Mutation (b) removes the flag and this
    // is what fails.
    const weeks = weeksAround(ANCHORS.access);
    const exerciseId = await makeExercise(ownerA, "access-legs", "legs");
    await logWorkout(ownerA, ANCHORS.access, [{ exerciseId, sets: [{ reps: 5, weight: 100 }] }]);

    // Non-vacuity control: the rows exist and A can see them.
    expect(await readBreakdown(ownerA, weeks.current)).not.toEqual([]);

    // **The probe. B names A's user_id directly against the view** — not through a service, whose own
    // `.eq("user_id", ownerB.userId)` would filter a leak out before B ever saw it.
    const asB = await readBreakdown(ownerB, weeks.current, ownerA.userId);
    expect(asB).toEqual([]);
  });

  it("8. an unauthenticated client has no read path to the view at all", async () => {
    const { data, error } = await anonymous.from("daily_exercise_tonnage").select("*");

    // With `revoke all … from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

// ------------------------------------------------------------------------------------------------
// RETIRED — assertion 9, "tonnage whose exercise this account cannot read survives, unattributed".
// Removed by `cross-account-isolation` on 2026-08-15. Not deleted silently, and not replaced by a
// weaker assertion that would read as coverage: `lessons.md` § "A guard you have not mutated may not
// guard" calls a test that cannot fail worse than an obvious gap, and the honest shape here is a
// named gap.
//
// **What it asserted.** `exercise_entries.exercise_id references exercises (id)` is single-column
// and NOT ownership-scoped, and foreign-key checks run with RLS bypassed — so the database permitted
// an entry of account A's naming a PRIVATE exercise of account B's. The assertion built exactly that
// row and proved that `public.daily_exercise_tonnage` still counted its kilograms, as an
// `Unattributed` row with a null `muscle_group`, agreeing with `daily_tonnage` at 680 kg. Under an
// **inner** join it read 500 against 680 — short by precisely the 180 kg of the unreadable exercise.
//
// **Why it cannot be written any more.** The migration
// `20260815..._scope_exercise_entries_to_visible_exercises.sql` refuses that row at insert and at
// update. The assertion did not merely stop being interesting: it died in SETUP, because `logWorkout`
// throws when an insert is refused, and `npm run test:integration` runs every suite — so leaving it
// in place would have reddened the gate rather than reported a finding. There is also no weaker
// version to fall back on: under RLS the hazard row is, by construction, visible to neither account,
// and constructing one needs a `service_role` key that `vitest.integration.config.ts` strips from
// the process on purpose.
//
// **THE GUARANTEE IT WAS HOLDING IS STILL LOAD-BEARING AND IS NOW UNGUARDED.** The `left join` in
// `public.daily_exercise_tonnage` must stay. The trigger is a `before` trigger, so it does not
// validate rows already stored; and it runs its visibility check as the caller, so `postgres` and
// `service_role` — which bypass RLS — are not constrained by it at all. A hazard row therefore
// remains possible from those two directions and from any row predating 2026-08-15.
//
// **No mutation available today breaks the guarantee.** The exact future edit that would is
// `left join public.exercises` → `join public.exercises` inside that view. Nothing in this repository
// would notice it. Whoever makes that edit is removing the only thing that keeps such a row's
// kilograms in the account's own weekly figure, and will see two plausible numbers stop agreeing
// with no error anywhere.
//
// The closure of the source defect is proven instead by `tests/integration/account-boundary.test.ts`
// assertions 1 and 2 — which is a different claim, and does not restore this one.
// ------------------------------------------------------------------------------------------------
