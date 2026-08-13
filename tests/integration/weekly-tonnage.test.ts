// Proves the weekly tonnage aggregation against real rows in gymlog-test.
//
// **THIS SUITE OWNS ITS DATES, AND IT IS THE FIRST ONE THAT HAS TO.** Every other integration suite
// filters by a name prefix, so leftovers from a neighbour are invisible to it. This one aggregates by
// DATE RANGE: anything any suite ever logged inside the window lands in the total. "The current
// training week" is by definition around today, which is exactly where those fixtures live — so every
// test passes an explicit `now` anchored in 2025 and writes its own workouts there. That is what the
// injectable parameter on `trainingWeeksFor` and `weeklyTonnage` is for, and it is also why each test
// gets its OWN pair of weeks rather than sharing one.
//
// MARK is `s07-`, chosen so it is neither a prefix of nor prefixed by an existing mark. `s03-` is a
// strict prefix of `s03-endpoints-` and `s03-page-`, so `workout-log-rls` already deletes two other
// suites' fixtures; that is benign only because `fileParallelism: false` orders them, and it is a
// trap worth not walking into twice.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { trainingWeeksFor } from "@/lib/services/calendar";
import { weeklyTonnage } from "@/lib/services/tonnage";
import { PATCH as updateWorkoutRoute } from "@/pages/api/workouts/[id]/index";
import { resetPreferences } from "./fixture-preferences";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";
const MARK = "s07-";
const ZONE = "Europe/Warsaw";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * **Every test gets its OWN pair of weeks, and this is not tidiness — it is the only thing that
 * makes the assertions independent.** This suite aggregates by DATE RANGE, so two tests sharing a
 * window share an answer: the second one reads the first one's fixtures added to its own. Every
 * other integration suite is immune to that because it filters by name prefix; this one is not, and
 * a per-test exercise (the trick `personal-records.test.ts` uses) does not help either, because the
 * range does not care which exercise a set belongs to.
 *
 * The anchors are Wednesdays in 2025, four or more weeks apart so no two windows touch, and far from
 * every date any other suite writes (2020-01-01, 2024-02-29, 2026-01-01, 2026-08-04, 2026-08-09/10/11
 * — checked, not assumed).
 */
const ANCHORS = {
  sum: "2025-06-11",
  bodyweight: "2025-07-09",
  units: "2025-08-13",
  boundary: "2025-09-10",
  moved: "2025-10-08",
  empty: "2025-11-12",
  access: "2025-12-10",
} as const;

interface Weeks {
  now: Date;
  thisMonday: string;
  thisSunday: string;
  lastMonday: string;
  lastSunday: string;
}

/** The two weeks around an anchor, computed the same way the product computes them. */
function weeksAround(anchor: string): Weeks {
  const now = new Date(`${anchor}T12:00:00Z`);
  const { current, previous } = trainingWeeksFor(ZONE, now);

  return {
    now,
    thisMonday: current.start,
    thisSunday: current.end,
    lastMonday: previous.start,
    lastSunday: previous.end,
  };
}

/** The factor the generated `sets.weight_kg` column applies. Compared against, never used to write. */
const KG_PER_LB = 0.45359237;

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

async function makeExercise(owner: Owner, label: string): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "back", is_bodyweight: true })
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

/**
 * A workout on `performedOn` with the given sets, written straight to the tables.
 *
 * Not through `/api/sets`, deliberately: that endpoint stamps the unit from the profile, and two of
 * the assertions below need a single workout carrying BOTH units. The endpoint path has its own suite.
 */
async function logWorkout(owner: Owner, exerciseId: string, performedOn: string, sets: LoggedSet[]): Promise<string> {
  const workout = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: performedOn, note: `${MARK}${RUN_ID}` })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`could not create a workout on ${performedOn}: ${workout.error.message}`);
  }

  const entry = await owner.client
    .from("exercise_entries")
    .insert({ user_id: owner.userId, workout_id: workout.data.id, exercise_id: exerciseId })
    .select("id")
    .single();
  if (entry.error) {
    throw new Error(`could not create an entry: ${entry.error.message}`);
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

  return workout.data.id;
}

/** The tonnage the product should report, computed independently of the view. */
function expectedKilograms(sets: LoggedSet[]): number {
  return sets.reduce((total, set) => {
    const kilograms = (set.unit ?? "kg") === "kg" ? set.weight : set.weight * KG_PER_LB;
    return total + set.reps * Math.max(kilograms, 0);
  }, 0);
}

const read = (owner: Owner, now: Date) => weeklyTonnage(owner.client, owner.userId, ZONE, now);

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);
  anonymous = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // This suite's own precondition (see `./fixture-preferences.ts`): the timezone decides which week
  // is "current", so a run left flipped by another suite would move the whole window.
  for (const owner of [ownerA, ownerB]) {
    await resetPreferences(owner.client, owner.userId);
    // Workouts first: deleting them cascades to entries and sets, which is what releases the
    // `on delete restrict` on the exercises this suite created. The reverse order fails.
    await owner.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", owner.userId);
    await owner.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", owner.userId);
  }
});

describe("weekly tonnage: the sum itself", () => {
  it("1. matches a TypeScript sum over the same fixture, computed independently", async () => {
    // The compensating control for displaying a number computed by SQL — the role
    // `personal-records.test.ts` assertion 4 plays for the 1RM formula. This TypeScript sum lives
    // HERE and must never move into `src/`: a second production implementation is exactly how the
    // two-implementations hazard was created for the estimate.
    const weeks = weeksAround(ANCHORS.sum);
    const exerciseId = await makeExercise(ownerA, "sum");
    const thisWeek: LoggedSet[] = [
      { reps: 5, weight: 100 },
      { reps: 8, weight: 62.5 },
    ];
    const lastWeek: LoggedSet[] = [{ reps: 3, weight: 140 }];

    await logWorkout(ownerA, exerciseId, ANCHORS.sum, thisWeek);
    await logWorkout(ownerA, exerciseId, weeks.lastMonday, lastWeek);

    const { current, previous } = await read(ownerA, weeks.now);

    expect(current.kilograms).toBeCloseTo(expectedKilograms(thisWeek), 6);
    expect(previous.kilograms).toBeCloseTo(expectedKilograms(lastWeek), 6);
    // Non-vacuous: the two weeks differ, so a fold that put everything in one bucket cannot pass.
    expect(current.kilograms).not.toBeCloseTo(previous.kilograms, 6);
    expect(current.hasSets && previous.hasSets).toBe(true);
  });

  it("2. counts a zero-load set as zero and an assisted set as zero, never as a negative", async () => {
    // Both halves of the domain rule, in the one term `greatest(weight_kg, 0)` implements. A plank
    // and an assisted pull-up are real work whose repetitions are recorded; they add no kilograms.
    // `hasSets` must still be true, or the screen tells somebody who trained that they did not.
    const weeks = weeksAround(ANCHORS.bodyweight);
    const exerciseId = await makeExercise(ownerA, "bodyweight");
    await logWorkout(ownerA, exerciseId, ANCHORS.bodyweight, [
      { reps: 60, weight: 0 },
      { reps: 8, weight: -20 },
    ]);

    const { current } = await read(ownerA, weeks.now);

    // Zero, not a negative number: `toBe(0)` already covers both, so there is no second assertion
    // here pretending to add one. `hasSets` is the half that matters — the week HAS sets, so the
    // screen must say "no external load" rather than "you did not train".
    expect(current.kilograms).toBe(0);
    expect(current.hasSets).toBe(true);
  });

  it("3. sums mixed units through weight_kg, not through the number typed", async () => {
    // Since S-06 one account can hold both units at once. Summing `weight` across a mixed account
    // produces a figure with no unit and no meaning, and nothing but a reader would catch it.
    const weeks = weeksAround(ANCHORS.units);
    const exerciseId = await makeExercise(ownerA, "units");
    const sets: LoggedSet[] = [
      { reps: 5, weight: 100, unit: "kg" },
      { reps: 5, weight: 100, unit: "lb" },
    ];
    await logWorkout(ownerA, exerciseId, ANCHORS.units, sets);

    const { current } = await read(ownerA, weeks.now);

    expect(current.kilograms).toBeCloseTo(expectedKilograms(sets), 6);
    // The naive answer — summing `weight` — would be 1000. The right one is ~726.8.
    expect(current.kilograms).not.toBeCloseTo(1000, 3);
  });
});

describe("weekly tonnage: the week boundary", () => {
  it("4. a Sunday belongs to the week that started, and the Monday after it does not", async () => {
    // The boundary the PRD names by name, asserted against the database rather than against two
    // hardcoded constants. Nothing in this repository could answer this question before S-07.
    const weeks = weeksAround(ANCHORS.boundary);
    const exerciseId = await makeExercise(ownerA, "boundary");
    await logWorkout(ownerA, exerciseId, weeks.lastSunday, [{ reps: 5, weight: 100 }]);
    await logWorkout(ownerA, exerciseId, weeks.thisMonday, [{ reps: 5, weight: 50 }]);

    const { current, previous } = await read(ownerA, weeks.now);

    // 5 × 100 landed in the week that ended on that Sunday; 5 × 50 in the week that opened the
    // next day. Swap the boundary by one day and these two numbers trade places.
    expect(previous.kilograms).toBeCloseTo(500, 6);
    expect(current.kilograms).toBeCloseTo(250, 6);
  });

  it("5. moving a workout across a Monday moves its tonnage between the two weeks", async () => {
    // **US-03's fifth acceptance criterion**, and it was uncovered before this assertion existed:
    // `record-impact.test.ts` assertion 9 checks that a record survives a date change and that
    // `performed_on` propagates, but computes no week and no tonnage.
    const weeks = weeksAround(ANCHORS.moved);
    const exerciseId = await makeExercise(ownerA, "moved");
    const workoutId = await logWorkout(ownerA, exerciseId, weeks.lastSunday, [{ reps: 4, weight: 75 }]);

    const before = await read(ownerA, weeks.now);
    expect(before.previous.kilograms).toBeCloseTo(300, 6);
    expect(before.current.kilograms).toBe(0);
    expect(before.current.hasSets).toBe(false);

    // **The note is re-sent, not nulled, and that is not cosmetic.** `updateWorkoutSchema` is a full
    // replacement, so `note: null` would clear the very column `beforeAll` cleans up by — the moved
    // workout would survive every future run's teardown and poison this window permanently. Measured
    // the hard way: it did, and the leftovers had to be deleted by hand.
    const moved = await updateWorkoutRoute(
      context(ownerA, workoutId, { performedOn: weeks.thisMonday, note: `${MARK}${RUN_ID}` }),
    );
    expect(moved.status).toBe(200);

    const after = await read(ownerA, weeks.now);
    // Both walls move together, which is the property — asserting only one would pass against code
    // that added to this week without removing from last.
    expect(after.previous.kilograms).toBe(0);
    expect(after.previous.hasSets).toBe(false);
    expect(after.current.kilograms).toBeCloseTo(300, 6);
    expect(after.current.hasSets).toBe(true);
  });

  it("6. a week with no sets reads as zero with hasSets false, and the read did not fail", async () => {
    // The zero a screen shows for an empty week is SYNTHESISED here — the view emits no row at all.
    // It is a positive claim ("you did no work"), so it must be distinguishable from a failed read,
    // which throws. This is S-05's `impact_unavailable` rule applied to a screen.
    const weeks = weeksAround(ANCHORS.empty);
    const { current, previous } = await read(ownerB, weeks.now);

    expect(current.kilograms).toBe(0);
    expect(current.hasSets).toBe(false);
    expect(previous.kilograms).toBe(0);
    expect(previous.hasSets).toBe(false);
    // The window is still reported, so the screen can name the weeks it is talking about.
    expect(current.start).toBe(weeks.thisMonday);
    expect(current.end).toBe(weeks.thisSunday);
    expect(previous.start).toBe(weeks.lastMonday);
    expect(previous.end).toBe(weeks.lastSunday);
  });
});

describe("weekly tonnage: the access boundary", () => {
  it("7. one account's sets are not in another's total, through the view or by naming the id", async () => {
    // The `security_invoker` boundary. Without the flag the view runs as its owner — `postgres`,
    // which owns every table and is not subject to their policies — and hands every account's
    // training volume to every account. The S-07 mutation protocol removes the flag and this is
    // what fails.
    // **Its own window and its own fixture.** This used to reuse assertion 1's, which made an
    // access-control test fail whenever an arithmetic test did — and made `-t "7."` fail on its own.
    // AGENTS.md § Testing: every test its own setup, action, assertion.
    const weeks = weeksAround(ANCHORS.access);
    const exerciseId = await makeExercise(ownerA, "access");
    await logWorkout(ownerA, exerciseId, ANCHORS.access, [{ reps: 5, weight: 100 }]);

    const mine = await read(ownerA, weeks.now);
    expect(mine.current.kilograms).toBeGreaterThan(0);

    // **This read is the non-vacuity control for the probe below, NOT a leak test.** `read()` scopes
    // by `.eq("user_id", ownerB.userId)`, so even a leaking view would be filtered by PostgREST
    // before B saw anything. Only naming A's identifier directly can observe the leak.
    const theirs = await read(ownerB, weeks.now);
    expect(theirs.current.kilograms).toBe(0);

    // And naming A's identifier directly — the request US-04 warns about — returns nothing.
    const asB = await ownerB.client
      .from("daily_tonnage")
      .select("performed_on, tonnage_kg")
      .eq("user_id", ownerA.userId);
    expect(asB.error).toBeNull();
    expect(asB.data).toEqual([]);
  });

  it("8. an unauthenticated client has no read path to the view at all", async () => {
    const { data, error } = await anonymous.from("daily_tonnage").select("*");

    // With `revoke all … from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});
