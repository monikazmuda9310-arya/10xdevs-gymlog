// THE STORED COLUMN DECIDES WHICH WEEK A REAL SET IS COUNTED IN.
//
// Rollout Phase 4 of `context/foundation/test-plan.md`, Risk #1, closing the loop the render project
// cannot: `tests/render/week-boundary.test.ts` stubs the database, so it can prove which days
// `/dashboard` ASKS for and nothing about which set comes back. This suite writes real rows, writes
// the zone the way a user writes it, and reads the answer out of `public.daily_tonnage`.
//
// **The stored column is the INPUT here, and that is the one thing every existing tonnage suite
// avoids doing.** `weekly-tonnage.test.ts:29` and `tonnage-breakdown.test.ts:35` hardcode
// `ZONE = "Europe/Warsaw"` and pass the literal straight to the service; they call
// `resetPreferences` to establish the column as a PRECONDITION and then never read it. So a
// `/dashboard` that ignored `profile.timezone` entirely would leave both of them green. Here the
// zone goes in through `PATCH /api/profile` and comes back out of the row before every read — a
// write that silently did nothing cannot pass.
//
// **Every expected date is a literal, and `trainingWeeksFor` is deliberately not imported.** That is
// the circularity rule Phase 4 exists to establish: `weekly-tonnage.test.ts:273` makes this suite's
// first claim — "a Sunday belongs to the week that started" — with `weeks.lastSunday` and
// `weeks.thisMonday` computed by the function under test, so an off-by-one in `mondayOf` moves the
// fixture and the expectation together and the assertion cannot fail. The literals below were
// verified by computation, not assumed.
//
// **THIS SUITE OWNS 2023, and it has to** — like `weekly-tonnage.test.ts` it aggregates by DATE
// RANGE, so a name prefix protects nothing: anything any suite ever logged inside the window lands
// in the total. Measured across `tests/` and `src/`: 2024 holds 4 date literals, 2025 holds 16, 2026
// holds 29, 2027 holds 2, and **2023 holds none**. `weekly-tonnage` owns 2025-06→2025-12 and
// `tonnage-breakdown` owns 2024-12→2025-05. The two windows below are seven weeks apart, because two
// tests sharing a window share an answer.
//
// MARK is `t4w-` — a prefix of no existing mark and prefixed by none. Re-derive that with
// `grep -rn "const MARK" tests/` rather than trusting this sentence; `s03-` is a strict prefix of
// `s03-endpoints-` and `s03-page-`, and that trap is live.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { weeklyTonnage } from "@/lib/services/tonnage";
import { PATCH as updateProfileRoute } from "@/pages/api/profile/index";
import { FIXTURE_PREFERENCES, resetPreferences } from "./fixture-preferences";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const MARK = "t4w-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The three preferences in the shape `PATCH /api/profile` parses, since it replaces all three. */
const DEFAULTS = { timezone: "Europe/Warsaw", weightUnit: "kg", estimationFormula: "brzycki" } as const;

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;

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
function context(owner: Owner, body: unknown) {
  return {
    locals: { supabase: owner.client, user: { id: owner.userId } },
    params: {},
    request: new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

/**
 * Change the zone **through the endpoint a user changes it through**, not by writing the column.
 *
 * A direct `update` would skip the membership validation and the ownership scoping the real path
 * applies, and would prove nothing about the seam this suite is named after. It throws on a non-200
 * for the reason `preferences-derive.test.ts:84-90` does: a suite that could not establish its own
 * precondition is a suite whose result means nothing.
 */
async function setTimeZone(owner: Owner, timezone: string): Promise<void> {
  const response = await updateProfileRoute(context(owner, { ...DEFAULTS, timezone }));
  if (response.status !== 200) {
    const body = (await response.json()) as { code?: string };
    throw new Error(`could not set timezone to ${timezone} (${String(response.status)}): ${body.code ?? "no code"}`);
  }
}

/**
 * The zone as the ROW holds it — the value every read below is driven by.
 *
 * **This read is what makes the suite non-vacuous.** Passing the same literal to `setTimeZone` and
 * to `weeklyTonnage` would assert that the service honours its own argument, which nobody doubts.
 * Going out through the endpoint and back through the column is the only shape that fails when the
 * write silently does nothing.
 */
async function storedTimeZone(owner: Owner): Promise<string> {
  const { data, error } = await owner.client.from("profiles").select("timezone").eq("id", owner.userId).maybeSingle();
  if (error) {
    throw new Error(`could not read the stored timezone: ${error.code} ${error.message}`);
  }
  if (!data) {
    throw new Error("no profile row for the fixture account; the suite cannot establish its input");
  }
  return data.timezone;
}

async function makeExercise(owner: Owner, label: string): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "back", is_bodyweight: false })
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
}

/**
 * A workout on `performedOn` with the given sets, written straight to the tables.
 *
 * Note carries the mark, which is what `beforeAll` deletes by — and it is never cleared afterwards
 * (`AGENTS.md` § Testing: "never mutate the column your own cleanup keys on").
 */
async function logWorkout(owner: Owner, exerciseId: string, performedOn: string, sets: LoggedSet[]): Promise<void> {
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
      weight_unit: "kg",
    });
    if (error) {
      throw new Error(`could not log ${String(set.reps)}x${String(set.weight)}: ${error.message}`);
    }
  }
}

/** Read the two weeks at `instant`, driven by whatever the profile row currently says. */
async function readWeeksAt(owner: Owner, instant: string) {
  return weeklyTonnage(owner.client, owner.userId, await storedTimeZone(owner), new Date(instant));
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);

  // **Setup, not only teardown** (`./fixture-preferences.ts`). Every test below restores the zone in
  // a `finally`, and a `finally` is application-level: a Ctrl-C or a cancelled CI job between the
  // flip and the restore skips it. This is what protects the NEXT run — including this suite's own,
  // whose first assertion reads the default out of the column.
  await resetPreferences(ownerA.client, ownerA.userId);
  // Workouts first: deleting them cascades to entries and sets, which is what releases the
  // `on delete restrict` on the exercises this suite created. The reverse order fails.
  await ownerA.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", ownerA.userId);
  await ownerA.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", ownerA.userId);
});

describe("a Sunday belongs to the week that started, against real rows", () => {
  it("1. splits a Sunday and the Monday after it into two weeks, both named by literals", async () => {
    // **The claim `weekly-tonnage.test.ts:273` already makes, made non-circularly.** Its expectation
    // comes from `trainingWeeksFor`; these four dates are typed out, verified by computation:
    // 2023-06-19 is a Monday, so 2023-06-18 is the Sunday that closes the week before it, and an
    // instant on Wednesday 2023-06-21 sits inside the later of the two.
    //
    // A `mondayOf` that returned the FOLLOWING Monday — the off-by-one the PRD names by name — moves
    // both windows forward by seven days here and moves nothing in the suite that derives its dates
    // from the subject.
    const exerciseId = await makeExercise(ownerA, "sunday");
    await logWorkout(ownerA, exerciseId, "2023-06-18", [{ reps: 5, weight: 100 }]); // Sunday: 500 kg
    await logWorkout(ownerA, exerciseId, "2023-06-19", [{ reps: 3, weight: 60 }]); // Monday: 180 kg

    try {
      const { current, previous } = await readWeeksAt(ownerA, "2023-06-21T12:00:00Z");

      expect({ start: current.start, end: current.end }).toEqual({ start: "2023-06-19", end: "2023-06-25" });
      expect({ start: previous.start, end: previous.end }).toEqual({ start: "2023-06-12", end: "2023-06-18" });
      // **And the kilograms followed the boundary**, which the window assertion alone does not say:
      // a service that computed the right range and folded every row into `current` would pass it.
      expect(current.kilograms).toBeCloseTo(180, 6);
      expect(previous.kilograms).toBeCloseTo(500, 6);
      expect(current.hasSets).toBe(true);
      expect(previous.hasSets).toBe(true);
    } finally {
      await setTimeZone(ownerA, DEFAULTS.timezone);
    }
  });
});

describe("the same row lands in a different week when the stored zone changes", () => {
  it("2. moves one Sunday set from previous to current, with nothing but the column changed", async () => {
    // **The sharpest available statement of Risk #1.** Nothing about the data changes — same set,
    // same instant, same account — and the week it counts in moves, because the profile row moved.
    //
    // Verified by computation. At 2023-08-14T02:00:00Z:
    //   Europe/Warsaw (+2)    → 04:00 on Monday 2023-08-14 → current 08-14..08-20, previous 08-07..08-13
    //   America/New_York (−4) → 22:00 on Sunday 2023-08-13 → current 08-07..08-13, previous 07-31..08-06
    // So the set on 2023-08-13 is LAST week's under one zone and THIS week's under the other, and
    // `2023-08-07..2023-08-13` is the range on both sides of the move — which is the point: the days
    // did not change, the label on them did.
    //
    // Its window is seven weeks clear of assertion 1's, because this suite aggregates by date range
    // and two tests sharing a window share an answer.
    const exerciseId = await makeExercise(ownerA, "twozones");
    await logWorkout(ownerA, exerciseId, "2023-08-13", [{ reps: 4, weight: 75 }]); // Sunday: 300 kg

    try {
      await setTimeZone(ownerA, "Europe/Warsaw");
      const warsaw = await readWeeksAt(ownerA, "2023-08-14T02:00:00Z");

      expect({ start: warsaw.previous.start, end: warsaw.previous.end }).toEqual({
        start: "2023-08-07",
        end: "2023-08-13",
      });
      expect(warsaw.previous.kilograms).toBeCloseTo(300, 6);
      expect(warsaw.current.kilograms).toBeCloseTo(0, 6);
      expect(warsaw.current.hasSets).toBe(false);

      await setTimeZone(ownerA, "America/New_York");
      const newYork = await readWeeksAt(ownerA, "2023-08-14T02:00:00Z");

      expect({ start: newYork.current.start, end: newYork.current.end }).toEqual({
        start: "2023-08-07",
        end: "2023-08-13",
      });
      expect(newYork.current.kilograms).toBeCloseTo(300, 6);
      expect(newYork.previous.kilograms).toBeCloseTo(0, 6);
      expect(newYork.previous.hasSets).toBe(false);

      // The two answers are genuinely different answers, stated once so a future reader deleting
      // either half can see what the pair was for.
      expect(warsaw.current.start).not.toBe(newYork.current.start);
    } finally {
      await setTimeZone(ownerA, DEFAULTS.timezone);
    }
  });
});

describe("the shared fixture is left as it was found", () => {
  it("3. the account is back on the zone every other suite expects", async () => {
    // Not decoration. This suite flips `profiles.timezone` on an account four other suites read, and
    // the zone decides which week is "current" for both tonnage suites. A run that died between a
    // flip and its restore would otherwise turn an unrelated suite red on the NEXT run — the failure
    // `AGENTS.md` § Testing warns about, and the one `preferences-derive.test.ts` assertion 4 exists
    // to catch across the whole directory. This says it here, where it was caused.
    expect(await storedTimeZone(ownerA)).toBe(FIXTURE_PREFERENCES.timezone);
  });
});
