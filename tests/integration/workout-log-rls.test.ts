/* eslint-disable no-console -- this suite's second job is to PRINT what the database answered to
   every attempted boundary crossing. context/foundation/lessons.md:37-51 requires a guarantee to be
   demonstrated by something that attacks it and shows the raw response, rather than by asking a
   human to judge SQL. The assertions are the gate; the printed refusals are the evidence. */

// Proves the access boundary on the training record at the level the database enforces it — and at
// all THREE levels, which is what makes this suite different from the two before it.
//
// `profiles` and `exercises` are flat: one row, one owner, and `(select auth.uid()) = user_id` on
// the row in front of the policy is the whole story. The training record is nested
// (workout -> exercise entry -> set), and there the four-policy template has a hole: an account
// inserting a row with ITS OWN user_id and SOMEBODY ELSE'S parent id passes the policy, because a
// policy never looks at the parent. Assertions 4 and 5 are that hole, and the composite foreign
// keys in the migration are what close it.
//
// Same two rules as the suites before it:
//   * every negative assertion is paired with a re-read AS A CALLER ENTITLED TO SEE THE ROW. The
//     failure US-04 warns about is a caller told "nothing happened" while the write landed, and a
//     status code cannot tell those apart.
//   * the suite authenticates ONLY to gymlog-test, with that project's publishable key. Never a
//     service_role key, and no production credential exists in this process at all.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

// The same fixture accounts as the other RLS suites. This one only creates rows it owns, marks
// every one of them with a prefix, and clears that prefix before it starts.
const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

// Unique per run, so a run that dies before cleanup cannot make the next one fail for a reason
// unrelated to the code under test.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// `workouts` has no name column, so the note carries the marker — the same role `name` plays in
// exercises-rls.test.ts. Every row this suite writes is reachable from it.
const MARK = "s03-";
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;
let anonymous: SupabaseClient<Database>;

/** A custom exercise per account, to hang entries off without touching the seeded catalogue. */
let exerciseA: string;
let exerciseB: string;

interface Refusal {
  code?: string;
  message?: string;
}

/**
 * Print what the database actually answered. A refusal that arrives as an empty result rather than
 * an error is the failure mode that reads as success, so the two are printed differently on
 * purpose.
 */
function report(crossing: string, error: Refusal | null): void {
  if (error) {
    console.info(`  refused  ${crossing}\n           -> ${error.code ?? "(no code)"}: ${error.message ?? ""}`);
  } else {
    console.info(
      `  refused  ${crossing}\n           -> no error raised; the row was filtered out (zero rows affected)`,
    );
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The integration check runs against the gymlog-test project and cannot ` +
        `run without it. It must never skip its way to green.`,
    );
  }
  return value;
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.data.session) {
    return { client, userId: signIn.data.session.user.id };
  }

  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) {
    throw new Error(
      `could not sign in or sign up ${email}. Sign-in said "${signIn.error?.message ?? "no session"}"; ` +
        `sign-up said "${signUp.error.message}".`,
    );
  }
  if (!signUp.data.session) {
    throw new Error(`${email} was created but no session came back — is email confirmation on for gymlog-test?`);
  }
  return { client, userId: signUp.data.session.user.id };
}

/** A workout owned by `owner`, marked so cleanup can find it. Throws rather than returning null. */
async function makeWorkout(owner: Owner, label: string): Promise<string> {
  const { data, error } = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: TODAY, note: `${MARK}${label}-${RUN_ID}` })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' workout: ${error.code} ${error.message}`);
  }
  return data.id;
}

async function makeEntry(owner: Owner, workoutId: string, exerciseId: string): Promise<string> {
  const { data, error } = await owner.client
    .from("exercise_entries")
    .insert({ user_id: owner.userId, workout_id: workoutId, exercise_id: exerciseId })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create an exercise entry: ${error.code} ${error.message}`);
  }
  return data.id;
}

async function makeSet(owner: Owner, entryId: string, reps = 5, weight = 100): Promise<string> {
  const { data, error } = await owner.client
    .from("sets")
    .insert({ user_id: owner.userId, exercise_entry_id: entryId, reps, weight, weight_unit: "kg" })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create a set: ${error.code} ${error.message}`);
  }
  return data.id;
}

async function makeExercise(owner: Owner, label: string): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "back" })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  }
  return data.id;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);
  anonymous = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Clear this suite's own rows from any previous run, scoped by the marker and by owner so it can
  // never touch the seeded catalogue or a row somebody added by hand. Cleanup happens at the START
  // of a run rather than in a `finally`, following exercises-rls.test.ts: an interrupted run then
  // cannot poison the next one, and the run-unique ids mean nothing collides in between.
  //
  // Workouts first: deleting them cascades to entries and sets, which is what releases the
  // `on delete restrict` on any exercise this suite created. The reverse order would fail.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", owner.userId);
    await owner.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", owner.userId);
  }

  exerciseA = await makeExercise(ownerA, "ex-a");
  exerciseB = await makeExercise(ownerB, "ex-b");
});

describe("the training record: an owner can use it", () => {
  it("1. an account creates a workout, an entry and a set, and reads all three back", async () => {
    // Without this, every negative assertion below would pass against tables nobody can use.
    const workoutId = await makeWorkout(ownerA, "own");
    const entryId = await makeEntry(ownerA, workoutId, exerciseA);
    const setId = await makeSet(ownerA, entryId, 5, 100);

    const workout = await ownerA.client.from("workouts").select("id, performed_on").eq("id", workoutId);
    const entry = await ownerA.client.from("exercise_entries").select("id, workout_id").eq("id", entryId);
    const set = await ownerA.client.from("sets").select("id, reps, weight, weight_unit, weight_kg").eq("id", setId);

    expect(workout.data).toHaveLength(1);
    expect(entry.data?.[0]?.workout_id).toBe(workoutId);
    expect(set.data).toHaveLength(1);

    // The storage decision, asserted rather than assumed: what is read back is what was written,
    // and the canonical column was derived by the database rather than by the caller.
    expect(Number(set.data?.[0]?.weight)).toBe(100);
    expect(set.data?.[0]?.weight_unit).toBe("kg");
    expect(Number(set.data?.[0]?.weight_kg)).toBe(100);
  });

  it("1b. a pound set stores the number typed and derives canonical kilograms", async () => {
    // The round-trip rule, at the level the schema is responsible for: `weight` comes back as the
    // number that went in — not as a converted-and-converted-back approximation — while `weight_kg`
    // carries the comparable value. 225 lb is the classic case where a lossy round trip shows up.
    const workoutId = await makeWorkout(ownerA, "lb");
    const entryId = await makeEntry(ownerA, workoutId, exerciseA);
    const { data, error } = await ownerA.client
      .from("sets")
      .insert({ user_id: ownerA.userId, exercise_entry_id: entryId, reps: 3, weight: 225, weight_unit: "lb" })
      .select("weight, weight_unit, weight_kg")
      .single();

    expect(error).toBeNull();
    expect(Number(data?.weight)).toBe(225);
    expect(Number(data?.weight_kg)).toBeCloseTo(102.058, 3);
  });
});

describe("the training record: another account cannot reach it", () => {
  it("2. B cannot read A's workout, entry or set by naming the id — and still reads its own", async () => {
    const workoutId = await makeWorkout(ownerA, "private");
    const entryId = await makeEntry(ownerA, workoutId, exerciseA);
    const setId = await makeSet(ownerA, entryId);

    const asBWorkout = await ownerB.client.from("workouts").select("id").eq("id", workoutId);
    const asBEntry = await ownerB.client.from("exercise_entries").select("id").eq("id", entryId);
    const asBSet = await ownerB.client.from("sets").select("id").eq("id", setId);

    report("B reads A's workout by id", asBWorkout.error);
    report("B reads A's exercise entry by id", asBEntry.error);
    report("B reads A's set by id", asBSet.error);

    expect(asBWorkout.data).toHaveLength(0);
    expect(asBEntry.data).toHaveLength(0);
    expect(asBSet.data).toHaveLength(0);

    // Non-vacuous: B can still see its own record, so the three empty results above are filtering
    // rather than a broken client or a table nobody can read.
    const bWorkout = await makeWorkout(ownerB, "b-own");
    const bEntry = await makeEntry(ownerB, bWorkout, exerciseB);
    const bSet = await makeSet(ownerB, bEntry);

    const bSees = await ownerB.client.from("sets").select("id").eq("id", bSet);
    expect(bSees.data).toHaveLength(1);
  });

  it("3. neither account can insert a row carrying the other's user_id, at any level", async () => {
    const workoutA = await makeWorkout(ownerA, "forge-target");
    const entryA = await makeEntry(ownerA, workoutA, exerciseA);

    const forgedWorkout = await ownerB.client
      .from("workouts")
      .insert({ user_id: ownerA.userId, performed_on: TODAY, note: `${MARK}forged-w-${RUN_ID}` });
    const forgedEntry = await ownerB.client
      .from("exercise_entries")
      .insert({ user_id: ownerA.userId, workout_id: workoutA, exercise_id: exerciseA });
    const forgedSet = await ownerB.client
      .from("sets")
      .insert({ user_id: ownerA.userId, exercise_entry_id: entryA, reps: 5, weight: 60, weight_unit: "kg" });

    report("B inserts a workout owned by A", forgedWorkout.error);
    report("B inserts an exercise entry owned by A onto A's workout", forgedEntry.error);
    report("B inserts a set owned by A onto A's entry", forgedSet.error);

    expect(forgedWorkout.error?.code).toBe("42501");
    expect(forgedEntry.error?.code).toBe("42501");
    expect(forgedSet.error?.code).toBe("42501");

    // The half that matters: re-read as the account the rows were forged onto.
    const asA = await ownerA.client.from("workouts").select("id").eq("note", `${MARK}forged-w-${RUN_ID}`);
    expect(asA.data).toHaveLength(0);

    const entriesOfA = await ownerA.client.from("exercise_entries").select("id").eq("workout_id", workoutA);
    expect(entriesOfA.data).toHaveLength(1);

    const setsOfA = await ownerA.client.from("sets").select("id").eq("exercise_entry_id", entryA);
    expect(setsOfA.data).toHaveLength(0);
  });

  it("4. THE GRAFT: B cannot attach its own entry to A's workout", async () => {
    // THE assertion of this suite. Every policy here is `(select auth.uid()) = user_id` on the row
    // being touched, and B is using its OWN user_id — so the insert policy admits this row. Nothing
    // in the policy text says "a child cannot be attached to somebody else's parent".
    //
    // What refuses it is the composite foreign key: (workout_id, user_id) -> workouts (id, user_id)
    // looks for a workout owned by B and does not find one. That protection is invisible in the
    // policies, which is exactly what makes it fragile. If a later migration "simplifies" the
    // composite key into a plain `references workouts (id)`, this is the ONLY thing in the
    // repository that would say so. Do not delete it as redundant.
    const workoutA = await makeWorkout(ownerA, "graft-target");
    const before = await ownerA.client.from("exercise_entries").select("id").eq("workout_id", workoutA);
    expect(before.data).toHaveLength(0);

    const graft = await ownerB.client
      .from("exercise_entries")
      .insert({ user_id: ownerB.userId, workout_id: workoutA, exercise_id: exerciseB });

    report("B attaches its own exercise entry to A's workout", graft.error);
    expect(graft.error?.code).toBe("23503");

    // Re-read as A: the workout is untouched.
    const after = await ownerA.client.from("exercise_entries").select("id").eq("workout_id", workoutA);
    expect(after.data).toHaveLength(0);
  });

  it("5. the same graft one level down: B cannot attach its own set to A's entry", async () => {
    const workoutA = await makeWorkout(ownerA, "graft-set-target");
    const entryA = await makeEntry(ownerA, workoutA, exerciseA);

    const graft = await ownerB.client
      .from("sets")
      .insert({ user_id: ownerB.userId, exercise_entry_id: entryA, reps: 8, weight: 40, weight_unit: "kg" });

    report("B attaches its own set to A's exercise entry", graft.error);
    expect(graft.error?.code).toBe("23503");

    const after = await ownerA.client.from("sets").select("id").eq("exercise_entry_id", entryA);
    expect(after.data).toHaveLength(0);
  });
});

describe("the training record: the rules the schema carries", () => {
  it("6. an exercise with logged history cannot be deleted; one without still can", async () => {
    // `on delete restrict` on exercise_id. The PRD guarantees a saved workout is never silently
    // lost, and a cascade here would destroy training history sideways, through a catalogue screen.
    const workoutId = await makeWorkout(ownerA, "restrict");
    await makeEntry(ownerA, workoutId, exerciseA);

    const blocked = await ownerA.client.from("exercises").delete().eq("id", exerciseA);
    report("A deletes its own exercise while sets hang off it", blocked.error);
    expect(blocked.error?.code).toBe("23503");

    const survives = await ownerA.client.from("exercises").select("id").eq("id", exerciseA);
    expect(survives.data).toHaveLength(1);

    // Non-vacuous: the restriction is about history, not about deletion being broken.
    const unused = await makeExercise(ownerA, "unused");
    const removed = await ownerA.client.from("exercises").delete().eq("id", unused);
    expect(removed.error).toBeNull();
    const gone = await ownerA.client.from("exercises").select("id").eq("id", unused);
    expect(gone.data).toHaveLength(0);
  });

  it("7. one entry per exercise per workout; the same exercise in another workout is fine", async () => {
    const workoutId = await makeWorkout(ownerA, "dup");
    await makeEntry(ownerA, workoutId, exerciseA);

    const duplicate = await ownerA.client
      .from("exercise_entries")
      .insert({ user_id: ownerA.userId, workout_id: workoutId, exercise_id: exerciseA });

    report("A adds the same exercise to one workout twice", duplicate.error);
    expect(duplicate.error?.code).toBe("23505");

    // The constraint is per workout, not per account: the same lift on another day is a new entry.
    const otherWorkout = await makeWorkout(ownerA, "dup-other-day");
    const allowed = await ownerA.client
      .from("exercise_entries")
      .insert({ user_id: ownerA.userId, workout_id: otherWorkout, exercise_id: exerciseA })
      .select("id")
      .single();
    expect(allowed.error).toBeNull();
  });

  it("8. deleting a workout takes its entries and sets with it", async () => {
    const workoutId = await makeWorkout(ownerA, "cascade");
    const entryId = await makeEntry(ownerA, workoutId, exerciseA);
    const setId = await makeSet(ownerA, entryId);

    const removed = await ownerA.client.from("workouts").delete().eq("id", workoutId);
    expect(removed.error).toBeNull();

    // Proven by re-reading for the children, not by trusting the declaration.
    const entries = await ownerA.client.from("exercise_entries").select("id").eq("id", entryId);
    const sets = await ownerA.client.from("sets").select("id").eq("id", setId);
    expect(entries.data).toHaveLength(0);
    expect(sets.data).toHaveLength(0);
  });
});

describe("the training record: the anonymous caller", () => {
  it("9. has no read path to any of the three tables", async () => {
    const workouts = await anonymous.from("workouts").select("*");
    const entries = await anonymous.from("exercise_entries").select("*");
    const sets = await anonymous.from("sets").select("*");

    report("an unauthenticated client reads workouts", workouts.error);
    report("an unauthenticated client reads exercise_entries", entries.error);
    report("an unauthenticated client reads sets", sets.error);

    // With `revoke all ... from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(workouts.data).toBeNull();
    expect(entries.data).toBeNull();
    expect(sets.data).toBeNull();
    expect(workouts.error?.code).toBe("42501");
    expect(entries.error?.code).toBe("42501");
    expect(sets.error?.code).toBe("42501");
  });
});
