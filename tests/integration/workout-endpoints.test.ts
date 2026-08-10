// Drives the three logging endpoints against gymlog-test, by calling the exported handlers with a
// real Supabase client and a real session.
//
// Why not over HTTP: `astro dev` reads its Supabase credentials from `.dev.vars`, which points at
// production, and no process-env override displaces it — so an HTTP round trip would either write
// test data into the database the owner trains against or not authenticate at all. Calling the
// handlers directly runs the same validation, the same ownership checks, the same error mapping and
// the same writes, against the project that exists to be written to. What it does not cover is
// Astro's routing and origin check; Phase 4's manual verification exercises those through a browser.
//
// The payoff over the one-off script the plan imagined: this stays in the gate, so it cannot rot.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { POST as createWorkoutRoute } from "@/pages/api/workouts/index";
import { POST as addEntryRoute } from "@/pages/api/exercise-entries/index";
import { POST as addSetRoute } from "@/pages/api/sets/index";

const EMAIL = "rls-owner-a@gymlog-test.dev";
const MARK = "s03-endpoints-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let client: SupabaseClient<Database>;
let userId: string;
let barbellId: string;
let bodyweightId: string;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

/** The slice of APIContext these handlers actually read. Cast rather than mocked wholesale. */
function context(body: unknown, session: { supabase: SupabaseClient<Database> | null; user: { id: string } | null }) {
  return {
    locals: session,
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

const signedIn = () => ({ supabase: client, user: { id: userId } });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email: EMAIL, password });
  if (!signIn.data.session) {
    throw new Error(`could not sign in ${EMAIL}: ${signIn.error?.message ?? "no session"}`);
  }
  userId = signIn.data.session.user.id;

  await client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", userId);

  const { data: exercises, error } = await client
    .from("exercises")
    .select("id, name, is_bodyweight")
    .is("user_id", null)
    .in("name", ["Deadlift", "Plank"]);
  if (error) {
    throw new Error(`seeded catalogue unreadable: ${error.message}`);
  }
  barbellId = exercises.find((e) => e.name === "Deadlift")?.id ?? "";
  bodyweightId = exercises.find((e) => e.name === "Plank")?.id ?? "";
  expect(barbellId && bodyweightId).toBeTruthy();
});

describe("the logging endpoints, end to end", () => {
  it("creates a workout, adds an exercise, logs a set, and the rows are really there", async () => {
    const created = await createWorkoutRoute(
      context({ performedOn: "2026-08-11", note: `  ${MARK}${RUN_ID}  ` }, signedIn()),
    );
    expect(created.status).toBe(201);
    const { workout } = (await json(created)) as { workout: { id: string; note: string } };
    // The schema trims, and an untouched note would have become null rather than "".
    expect(workout.note).toBe(`${MARK}${RUN_ID}`);

    const entry = await addEntryRoute(context({ workoutId: workout.id, exerciseId: barbellId }, signedIn()));
    expect(entry.status).toBe(201);
    const { entry: firstEntry } = (await json(entry)) as { entry: { id: string } };

    const again = await addEntryRoute(context({ workoutId: workout.id, exerciseId: barbellId }, signedIn()));
    // Idempotent: the same exercise chosen twice hands back the entry that is already there.
    expect(again.status).toBe(200);
    const { entry: secondEntry, created: wasCreated } = (await json(again)) as {
      entry: { id: string };
      created: boolean;
    };
    expect(secondEntry.id).toBe(firstEntry.id);
    expect(wasCreated).toBe(false);

    const set = await addSetRoute(context({ exerciseEntryId: firstEntry.id, reps: 5, weight: 102.5 }, signedIn()));
    expect(set.status).toBe(201);
    const { set: logged } = (await json(set)) as {
      set: { weight: number; weight_unit: string; weight_kg: number };
    };
    // Read back as the number typed, with the unit taken from the profile rather than the body.
    expect(logged.weight).toBe(102.5);
    expect(logged.weight_unit).toBe("kg");
    expect(logged.weight_kg).toBe(102.5);

    // Persisted state, not the response the caller saw.
    const reread = await client
      .from("workouts")
      .select("id, exercise_entries(id, sets(id, reps, weight))")
      .eq("user_id", userId)
      .eq("id", workout.id)
      .single();
    expect(reread.data?.exercise_entries).toHaveLength(1);
    expect(reread.data?.exercise_entries[0].sets).toHaveLength(1);

    await client.from("workouts").delete().eq("id", workout.id);
  });

  it("refuses a zero load on a barbell lift and allows it on a bodyweight exercise", async () => {
    const created = await createWorkoutRoute(
      context({ performedOn: "2026-08-11", note: `${MARK}bw-${RUN_ID}` }, signedIn()),
    );
    const { workout } = (await json(created)) as { workout: { id: string } };

    const barbell = await addEntryRoute(context({ workoutId: workout.id, exerciseId: barbellId }, signedIn()));
    const { entry: barbellEntry } = (await json(barbell)) as { entry: { id: string } };

    const refused = await addSetRoute(context({ exerciseEntryId: barbellEntry.id, reps: 5, weight: 0 }, signedIn()));
    expect(refused.status).toBe(400);
    // A specific, actionable code — NOT collapsed into `unexpected`, because the user caused it.
    expect((await json(refused)).code).toBe("weight_needs_bodyweight");

    const plank = await addEntryRoute(context({ workoutId: workout.id, exerciseId: bodyweightId }, signedIn()));
    const { entry: plankEntry } = (await json(plank)) as { entry: { id: string } };
    const allowed = await addSetRoute(context({ exerciseEntryId: plankEntry.id, reps: 30, weight: 0 }, signedIn()));
    expect(allowed.status).toBe(201);

    // The refusal wrote nothing: one set under two entries.
    const reread = await client
      .from("sets")
      .select("id")
      .eq("user_id", userId)
      .in("exercise_entry_id", [barbellEntry.id, plankEntry.id]);
    expect(reread.data).toHaveLength(1);

    await client.from("workouts").delete().eq("id", workout.id);
  });

  it("answers not-found for a workout that is not the caller's, without a 500", async () => {
    const foreign = await addEntryRoute(
      context({ workoutId: "00000000-0000-4000-8000-000000000000", exerciseId: barbellId }, signedIn()),
    );
    expect(foreign.status).toBe(404);
    expect((await json(foreign)).code).toBe("workout_not_found");
  });

  it("refuses an unauthenticated caller at every level, and writes nothing", async () => {
    // The manual criterion, automated: a POST with no session must not create a row, verified by
    // re-reading the table as the owner rather than by trusting the status code.
    const before = await client.from("workouts").select("id").eq("user_id", userId).like("note", `${MARK}anon%`);
    expect(before.data).toHaveLength(0);

    const noUser = { supabase: client, user: null };
    for (const [label, route, body] of [
      ["workouts", createWorkoutRoute, { performedOn: "2026-08-11", note: `${MARK}anon-${RUN_ID}` }],
      ["exercise-entries", addEntryRoute, { workoutId: "00000000-0000-4000-8000-000000000000", exerciseId: barbellId }],
      ["sets", addSetRoute, { exerciseEntryId: "00000000-0000-4000-8000-000000000000", reps: 5, weight: 100 }],
    ] as const) {
      const response = await route(context(body, noUser));
      expect(response.status, `${label} should refuse an anonymous caller`).toBe(401);
      expect((await json(response)).code).toBe("unauthenticated");
    }

    const after = await client.from("workouts").select("id").eq("user_id", userId).like("note", `${MARK}anon%`);
    expect(after.data).toHaveLength(0);
  });

  it("refuses when Supabase is not configured, rather than throwing", async () => {
    // The silent-failure class AGENTS.md § Cloudflare traps warns about: missing secrets make
    // `locals.supabase` null, and an endpoint that assumed otherwise would 500 on every request.
    const response = await createWorkoutRoute(
      context({ performedOn: "2026-08-11" }, { supabase: null, user: { id: userId } }),
    );
    expect(response.status).toBe(500);
    expect((await json(response)).code).toBe("not_configured");
  });
});
