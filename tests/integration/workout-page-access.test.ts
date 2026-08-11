// The workout page's answer to "is this yours", proven against gymlog-test.
//
// `src/pages/workouts/[id].astro` decides between rendering a workout and answering 404 on exactly
// one value: whether `getWorkout` returned a row or null. This suite calls that function — the real
// one, through a real session — as the owner and as a second account, so the page's branch rests on
// a measured guarantee rather than on a reading of the policy text.
//
// Why not a scripted HTTP round trip against the dev server, which is what plan criterion 4.4
// describes: `astro dev` reads its Supabase credentials from `.dev.vars`, which points at
// production, and no process-env override displaces it (recorded in change.md against Phase 3). An
// HTTP version would therefore have to create two accounts and a workout in the database the owner
// trains against. The browser half is covered by Phase 4's manual verification instead, and this
// half stays inside the gate where it cannot rot.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";
import { getWorkout } from "@/lib/services/workouts";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

const MARK = "s03-page-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;
let workoutId: string;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (!data.session) {
    throw new Error(`could not sign in ${email}: ${error?.message ?? "no session"}`);
  }
  return { client, userId: data.session.user.id };
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);

  // Clear this suite's own prefix first: a run that died before its cleanup must not make the next
  // one fail for a reason unrelated to the code. Workouts go first, and their children cascade.
  await ownerA.client.from("workouts").delete().eq("user_id", ownerA.userId).like("note", `${MARK}%`);

  const { data: exercises, error: catalogueError } = await ownerA.client
    .from("exercises")
    .select("id, name")
    .is("user_id", null)
    .eq("name", "Deadlift");
  if (catalogueError) {
    throw new Error(`seeded catalogue unreadable: ${catalogueError.message}`);
  }
  const exerciseId = exercises[0]?.id;
  expect(exerciseId).toBeTruthy();

  const workout = await ownerA.client
    .from("workouts")
    .insert({ user_id: ownerA.userId, performed_on: TODAY, note: `${MARK}${RUN_ID}` })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`could not create the fixture workout: ${workout.error.message}`);
  }
  workoutId = workout.data.id;

  // A populated workout, so "B sees nothing" is a statement about a row that really has content
  // rather than about an empty shell.
  const entry = await ownerA.client
    .from("exercise_entries")
    .insert({ user_id: ownerA.userId, workout_id: workoutId, exercise_id: exerciseId })
    .select("id")
    .single();
  if (entry.error) {
    throw new Error(`could not create the fixture entry: ${entry.error.message}`);
  }
  const set = await ownerA.client
    .from("sets")
    .insert({ user_id: ownerA.userId, exercise_entry_id: entry.data.id, reps: 5, weight: 100, weight_unit: "kg" })
    .select("id")
    .single();
  if (set.error) {
    throw new Error(`could not create the fixture set: ${set.error.message}`);
  }
});

afterAll(async () => {
  await ownerA.client.from("workouts").delete().eq("user_id", ownerA.userId).like("note", `${MARK}%`);
});

describe("what the workout page reads", () => {
  it("hands the owner the workout, its entries and its sets in one nested read", async () => {
    const workout = await getWorkout(ownerA.client, ownerA.userId, workoutId);

    expect(workout).not.toBeNull();
    expect(workout?.id).toBe(workoutId);
    // The embeds resolve through the composite foreign keys. If a second foreign key to a parent
    // were ever added "for clarity", PostgREST would answer PGRST201 and this read would throw.
    expect(workout?.exercise_entries).toHaveLength(1);
    expect(workout?.exercise_entries[0].sets).toHaveLength(1);
    expect(workout?.exercise_entries[0].exercises.name).toBe("Deadlift");
  });

  it("answers null for the second account, which is what makes the page a 404 and not an oracle", async () => {
    const asOtherAccount = await getWorkout(ownerB.client, ownerB.userId, workoutId);
    expect(asOtherAccount).toBeNull();

    // Paired with a read back as the owner, so the null above cannot pass vacuously — the failure
    // worth catching is a suite where the row was simply not there for anybody.
    const asOwner = await getWorkout(ownerA.client, ownerA.userId, workoutId);
    expect(asOwner).not.toBeNull();
  });

  it("gives the same null for an id that does not exist at all", async () => {
    // Identical answers for "absent" and "somebody else's" is the property that stops the page
    // telling one account which ids are real.
    const missing = await getWorkout(ownerA.client, ownerA.userId, "00000000-0000-4000-8000-000000000000");
    expect(missing).toBeNull();
  });
});
