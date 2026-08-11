/* eslint-disable no-console -- like the suites before it, this one's second job is to PRINT what the
   database answered, so the guarantee is demonstrated by something that exercises it rather than by
   asking a human to read SQL (context/foundation/lessons.md). */

// Proves what S-05's warning is built on, and the three things about it that would fail QUIETLY.
//
//   1. THE TWO RECORDS ARE TWO RANKINGS. The estimate record takes sets of 1-12 repetitions with a
//      positive load; the heaviest record takes every set with a positive load at ANY repetition
//      count. `topTwoEstimatesForExercise` — the query S-04 left behind — ranks estimates only, so a
//      warning built on it alone stays silent while a real record falls. Assertion 1 is the
//      difference, stated as a fixture: the same exercise, two records, two different sets.
//
//   2. THE SUCCESSOR THIS PREDICTS IS THE SET THAT ACTUALLY BECOMES THE RECORD. The ordering
//      `estimate desc, created_at asc, set_id asc` now exists in THREE places — the `distinct on`
//      inside `public.personal_records`, `topTwoEstimatesForExercise`, and the successor queries
//      added by S-05. Assertion 3 does not compare code: it asks for the prediction, performs the
//      deletion, and requires the view to agree. Assertion 3b pins the tie-break the same way.
//
//   3. EXCLUDING AT ENTRY OR WORKOUT LEVEL SKIPS EVERY SET BENEATH IT. Top-two is exact for one
//      disappearing set and wrong above that level, because a workout can hold the leader AND the
//      runner-up. Assertion 4 builds exactly that fixture.
//
// FIXTURE DISCIPLINE, same as personal-records.test.ts and for the same reason: a record aggregates
// over EVERY set the account has logged for an exercise, so every test creates its own run-unique
// custom exercise and asserts only about that one.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";
import {
  anySetSurvives,
  bestSurvivingEstimate,
  bestSurvivingHeaviest,
  recordHoldersForExercises,
} from "@/lib/services/records";
import { affectedRecords, fallingRecords, type SurvivingFor } from "@/lib/services/record-impact";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MARK = "s05-";
const TODAY = new Date().toISOString().slice(0, 10);

/** A Sunday and the Monday after it — different training weeks by the Monday-start rule. */
const SUNDAY = "2026-08-09";
const MONDAY = "2026-08-10";

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;

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
  if (signUp.error || !signUp.data.session) {
    throw new Error(`could not sign in or sign up ${email}: ${signIn.error?.message ?? signUp.error?.message ?? "?"}`);
  }
  return { client, userId: signUp.data.session.user.id };
}

async function makeExercise(owner: Owner, label: string, isBodyweight: boolean): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({
      user_id: owner.userId,
      name: `${MARK}${label}-${RUN_ID}`,
      muscle_group: isBodyweight ? "core" : "back",
      is_bodyweight: isBodyweight,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  }
  return data.id;
}

async function makeWorkout(owner: Owner, label: string, performedOn: string = TODAY): Promise<string> {
  const { data, error } = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: performedOn, note: `${MARK}${label}-${RUN_ID}` })
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

interface SetFields {
  reps: number;
  weight: number;
  /** Explicit id, for the tie-break fixture below. */
  id?: string;
  /** Explicit creation instant, for the same reason. */
  createdAt?: string;
}

/**
 * Written straight to the table rather than through an endpoint: this phase is about what the
 * DATABASE ranks. The endpoints are Phase 2's subject.
 */
async function makeSet(owner: Owner, entryId: string, { reps, weight, id, createdAt }: SetFields): Promise<string> {
  const { data, error } = await owner.client
    .from("sets")
    .insert({
      user_id: owner.userId,
      exercise_entry_id: entryId,
      reps,
      weight,
      weight_unit: "kg",
      ...(id ? { id } : {}),
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not log a ${reps}x${weight} set: ${error.code} ${error.message}`);
  }
  return data.id;
}

/** One exercise, one workout, one entry, and the given sets in order. */
async function logExercise(
  owner: Owner,
  label: string,
  isBodyweight: boolean,
  sets: readonly SetFields[],
): Promise<{ exerciseId: string; workoutId: string; entryId: string; setIds: string[] }> {
  const exerciseId = await makeExercise(owner, label, isBodyweight);
  const workoutId = await makeWorkout(owner, label);
  const entryId = await makeEntry(owner, workoutId, exerciseId);

  const setIds: string[] = [];
  for (const set of sets) {
    setIds.push(await makeSet(owner, entryId, set));
  }
  return { exerciseId, workoutId, entryId, setIds };
}

/**
 * Two uuids sharing a random prefix, where `older` sorts AFTER `newer`.
 *
 * The tie-break rule is `estimate desc, created_at asc, set_id asc`, so on two equal sets the older
 * must win. Left to `gen_random_uuid()`, dropping `created_at asc` from the ordering would still
 * pick the right set about half the time — a tripwire that fails to trip on a coin flip is not a
 * tripwire. Choosing the ids makes the mutation deterministic: without `created_at`, `set_id asc`
 * picks `newer`, and assertion 3b fails every run rather than every other run.
 */
function tiedIds(): { older: string; newer: string } {
  const base = crypto.randomUUID().slice(0, 34);
  return { older: `${base}ff`, newer: `${base}00` };
}

/** Everything the pure module needs about one exercise, read the way the endpoints will read it. */
async function survivingFor(
  owner: Owner,
  exerciseId: string,
  removal: Parameters<typeof bestSurvivingEstimate>[3],
): Promise<SurvivingFor> {
  const [estimate, heaviest, anySurvives] = await Promise.all([
    bestSurvivingEstimate(owner.client, owner.userId, exerciseId, removal),
    bestSurvivingHeaviest(owner.client, owner.userId, exerciseId, removal),
    anySetSurvives(owner.client, owner.userId, exerciseId, removal),
  ]);
  return { estimate, heaviest, anySetSurvives: anySurvives };
}

async function readRecord(owner: Owner, exerciseId: string) {
  const { data } = await owner.client
    .from("personal_records")
    .select("best_estimate_set_id, heaviest_set_id, best_estimate_kg")
    .eq("user_id", owner.userId)
    .eq("exercise_id", exerciseId)
    .maybeSingle();
  return data;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);

  // Workouts first: deleting them cascades to entries and sets, which is what releases the
  // `on delete restrict` on the exercises this suite created. The reverse order fails.
  await ownerA.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", ownerA.userId);
  await ownerA.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", ownerA.userId);
});

describe("the two rankings have different exclusion rules", () => {
  it("1. a set outside 1-12 repetitions is a heaviest candidate and not an estimate candidate", async () => {
    const { exerciseId, setIds } = await logExercise(ownerA, "rank", false, [
      { reps: 3, weight: 100 }, // estimable, and NOT the heaviest
      { reps: 20, weight: 150 }, // the heaviest load, carrying no estimate at all
    ]);
    const nothingExcluded = { level: "set", setId: crypto.randomUUID() } as const;

    const estimate = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, nothingExcluded);
    const heaviest = await bestSurvivingHeaviest(ownerA.client, ownerA.userId, exerciseId, nothingExcluded);

    console.info(`  estimate ranking leads with ${estimate?.reps}x${estimate?.weight}`);
    console.info(`  heaviest ranking leads with ${heaviest?.reps}x${heaviest?.weight}`);

    expect(estimate?.set_id).toBe(setIds[0]);
    expect(heaviest?.set_id).toBe(setIds[1]);
    // The whole reason S-05 could not reuse the estimate ranking alone.
    expect(estimate?.set_id).not.toBe(heaviest?.set_id);
  });

  it("2. a zero load qualifies for neither record, while the set itself still survives", async () => {
    // A plank. `.gt("weight_kg", 0)` and not `.gte` is what keeps it out of the heaviest ranking —
    // and `anySetSurvives` answering true anyway is precisely what separates "no record here" from
    // "this exercise disappears", which are two different sentences in the dialog.
    const { exerciseId } = await logExercise(ownerA, "zero", true, [
      { reps: 60, weight: 0 },
      { reps: 45, weight: 0 },
    ]);
    const nothingExcluded = { level: "set", setId: crypto.randomUUID() } as const;

    const surviving = await survivingFor(ownerA, exerciseId, nothingExcluded);

    expect(surviving.estimate).toBeNull();
    expect(surviving.heaviest).toBeNull();
    expect(surviving.anySetSurvives).toBe(true);
  });

  it("2b. an assisted (negative) load qualifies for neither either", async () => {
    const { exerciseId, setIds } = await logExercise(ownerA, "assisted", true, [
      { reps: 8, weight: -20 },
      { reps: 5, weight: 10 },
    ]);
    const excludeTheOnlyPositive = { level: "set", setId: setIds[1] } as const;

    const surviving = await survivingFor(ownerA, exerciseId, excludeTheOnlyPositive);

    expect(surviving.estimate).toBeNull();
    expect(surviving.heaviest).toBeNull();
    // The assisted set is still there; it simply holds nothing.
    expect(surviving.anySetSurvives).toBe(true);
  });
});

describe("the successor predicted is the set that actually becomes the record", () => {
  it("3. the prediction survives being carried out", async () => {
    const { exerciseId, setIds } = await logExercise(ownerA, "promote", false, [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 110 }, // holds both records
    ]);

    const before = await readRecord(ownerA, exerciseId);
    expect(before?.best_estimate_set_id).toBe(setIds[1]);

    const removal = { level: "set", setId: setIds[1] } as const;
    const predicted = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, removal);
    expect(predicted?.set_id).toBe(setIds[0]);

    // The assertion that makes this more than a code comparison: do the deletion, and require the
    // view — the other implementation of the same ordering — to name the set that was promised.
    const { error } = await ownerA.client.from("sets").delete().eq("id", setIds[1]).eq("user_id", ownerA.userId);
    expect(error).toBeNull();

    const after = await readRecord(ownerA, exerciseId);
    console.info(`  predicted ${predicted?.set_id}\n  view says ${after?.best_estimate_set_id}`);
    expect(after?.best_estimate_set_id).toBe(predicted?.set_id);
  });

  it("3b. on two equal sets the OLDER one is the successor, not the one with the lower id", async () => {
    // The tie-break IS the equality rule. Ids are chosen so that `set_id asc` alone would pick the
    // NEWER set — see `tiedIds` — which makes dropping `created_at asc` from the ordering fail here
    // every run instead of every other run.
    const { older, newer } = tiedIds();
    const { exerciseId } = await logExercise(ownerA, "tie", false, [
      { reps: 5, weight: 100, id: older, createdAt: "2026-08-01T09:00:00Z" },
      { reps: 5, weight: 100, id: newer, createdAt: "2026-08-02T09:00:00Z" },
      { reps: 5, weight: 120 }, // the current holder, excluded below
    ]);

    const record = await readRecord(ownerA, exerciseId);
    const removal = { level: "set", setId: record?.best_estimate_set_id ?? "" } as const;

    const successor = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, removal);

    console.info(`  older=${older}\n  newer=${newer}\n  successor=${successor?.set_id}`);
    expect(successor?.set_id).toBe(older);
    expect(older > newer).toBe(true);
  });

  it("3c. the excluded set is never returned as its own successor", async () => {
    // Removing the `.neq(...)` exclusion would make every warning say the record falls to the set
    // that is about to disappear — a number that is both wrong and reassuring.
    const { exerciseId, setIds } = await logExercise(ownerA, "self", false, [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 130 },
    ]);
    const removal = { level: "set", setId: setIds[1] } as const;

    const estimate = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, removal);
    const heaviest = await bestSurvivingHeaviest(ownerA.client, ownerA.userId, exerciseId, removal);

    expect(estimate?.set_id).not.toBe(setIds[1]);
    expect(heaviest?.set_id).not.toBe(setIds[1]);
    expect(estimate?.set_id).toBe(setIds[0]);
  });
});

describe("excluding at entry and workout level skips every set beneath", () => {
  it("4. a workout holding both the leader and the runner-up falls past both", async () => {
    // THE CASE TOP-TWO CANNOT ANSWER. The workout being deleted holds the two best sets, so the
    // record falls to the third — which a two-row query would never have seen.
    const exerciseId = await makeExercise(ownerA, "deep", false);

    const heavyWorkout = await makeWorkout(ownerA, "deep-heavy");
    const heavyEntry = await makeEntry(ownerA, heavyWorkout, exerciseId);
    const leader = await makeSet(ownerA, heavyEntry, { reps: 5, weight: 130 });
    const runnerUp = await makeSet(ownerA, heavyEntry, { reps: 5, weight: 120 });

    const lightWorkout = await makeWorkout(ownerA, "deep-light");
    const lightEntry = await makeEntry(ownerA, lightWorkout, exerciseId);
    const third = await makeSet(ownerA, lightEntry, { reps: 5, weight: 100 });

    const record = await readRecord(ownerA, exerciseId);
    expect(record?.best_estimate_set_id).toBe(leader);

    // Set level: only the leader goes, so the runner-up inherits.
    const bySet = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, {
      level: "set",
      setId: leader,
    });
    expect(bySet?.set_id).toBe(runnerUp);

    // Entry level and workout level: both sets in that workout go, so the third inherits.
    const byEntry = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, {
      level: "entry",
      exerciseEntryId: heavyEntry,
      workoutId: heavyWorkout,
      exerciseId,
    });
    const byWorkout = await bestSurvivingEstimate(ownerA.client, ownerA.userId, exerciseId, {
      level: "workout",
      workoutId: heavyWorkout,
    });

    console.info(`  set-level successor     ${bySet?.set_id === runnerUp ? "runner-up" : "?"}`);
    console.info(`  entry-level successor   ${byEntry?.set_id === third ? "the third set" : "?"}`);
    console.info(`  workout-level successor ${byWorkout?.set_id === third ? "the third set" : "?"}`);

    expect(byEntry?.set_id).toBe(third);
    expect(byWorkout?.set_id).toBe(third);
    expect(lightEntry).toBeTruthy();
  });

  it("5. an exercise whose every set is excluded answers null rather than a row", async () => {
    const { exerciseId, workoutId } = await logExercise(ownerA, "onlyworkout", false, [{ reps: 5, weight: 100 }]);
    const removal = { level: "workout", workoutId } as const;

    const surviving = await survivingFor(ownerA, exerciseId, removal);

    expect(surviving.estimate).toBeNull();
    expect(surviving.heaviest).toBeNull();
    // Nothing left at all — the exercise leaves /records entirely, which is a different sentence
    // from "this exercise has no estimated record".
    expect(surviving.anySetSurvives).toBe(false);
  });
});

describe("the two halves compose into the warning the dialog shows", () => {
  it("6. holders plus successors produce one falling record per record actually lost", async () => {
    // End to end through the real pieces: read the holders the way an endpoint will, decide from
    // ids alone, fetch only what that decision asked for, and pair them up.
    const { exerciseId, setIds, workoutId } = await logExercise(ownerA, "compose", false, [
      { reps: 5, weight: 100 },
      { reps: 1, weight: 140 }, // heaviest AND, at one repetition, the best estimate
    ]);

    const holders = await recordHoldersForExercises(ownerA.client, ownerA.userId, [exerciseId]);
    const removal = { level: "set", setId: setIds[1] } as const;

    const affected = affectedRecords(holders, removal);
    expect(affected.map((record) => record.kind).sort()).toEqual(["estimate", "heaviest"]);

    const surviving = new Map([[exerciseId, await survivingFor(ownerA, exerciseId, removal)]]);
    const falling = fallingRecords(affected, surviving);

    for (const record of falling) {
      expect(record.successor.kind).toBe("candidate");
      expect(record.successor.kind === "candidate" && record.successor.candidate.set_id).toBe(setIds[0]);
    }
    expect(workoutId).toBeTruthy();
  });

  it("7. deleting the whole workout leaves both records with nothing to fall to", async () => {
    const { exerciseId, workoutId } = await logExercise(ownerA, "compose-all", false, [{ reps: 5, weight: 100 }]);

    const holders = await recordHoldersForExercises(ownerA.client, ownerA.userId, [exerciseId]);
    const removal = { level: "workout", workoutId } as const;

    const falling = fallingRecords(
      affectedRecords(holders, removal),
      new Map([[exerciseId, await survivingFor(ownerA, exerciseId, removal)]]),
    );

    expect(falling).toHaveLength(2);
    expect(falling.every((record) => record.successor.kind === "no_sets_left")).toBe(true);
  });

  it("8. a lift left with only zero-load sets keeps its row and loses only its value", async () => {
    const { exerciseId, setIds } = await logExercise(ownerA, "compose-zero", true, [
      { reps: 5, weight: 40 }, // holds both records
      { reps: 60, weight: 0 }, // survives, and holds nothing
    ]);

    const holders = await recordHoldersForExercises(ownerA.client, ownerA.userId, [exerciseId]);
    const removal = { level: "set", setId: setIds[0] } as const;

    const falling = fallingRecords(
      affectedRecords(holders, removal),
      new Map([[exerciseId, await survivingFor(ownerA, exerciseId, removal)]]),
    );

    expect(falling).toHaveLength(2);
    // Distinct from assertion 7 on purpose: the exercise stays on /records, showing no value.
    expect(falling.every((record) => record.successor.kind === "no_qualifying_set")).toBe(true);
  });
});

describe("changing a workout's date recomputes by being read again", () => {
  it("9. moving a session across a Monday changes its week and leaves every record alone", async () => {
    // FR-006 asks for the recomputation on a date change to be an explicit criterion. There is
    // nothing to recompute: no figure is stored anywhere, so moving the date changes which week the
    // sets fall in on the next read, and the record — decided by load, not by date — does not move.
    expect(new Date(`${SUNDAY}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(new Date(`${MONDAY}T00:00:00Z`).getUTCDay()).toBe(1);

    const exerciseId = await makeExercise(ownerA, "dated", false);
    const workoutId = await makeWorkout(ownerA, "dated", SUNDAY);
    const entryId = await makeEntry(ownerA, workoutId, exerciseId);
    const setId = await makeSet(ownerA, entryId, { reps: 5, weight: 100 });

    const before = await readRecord(ownerA, exerciseId);

    const { error } = await ownerA.client
      .from("workouts")
      .update({ performed_on: MONDAY })
      .eq("id", workoutId)
      .eq("user_id", ownerA.userId);
    expect(error).toBeNull();

    const moved = await ownerA.client
      .from("set_estimates")
      .select("performed_on, estimate_kg")
      .eq("user_id", ownerA.userId)
      .eq("set_id", setId)
      .single();

    console.info(`  the set moved from ${SUNDAY} to ${moved.data?.performed_on} with no write of its own`);

    // The set's own date followed the workout, through the view, with nothing stored.
    expect(moved.data?.performed_on).toBe(MONDAY);
    // And the record is untouched: it is decided by load, not by when the session happened.
    const after = await readRecord(ownerA, exerciseId);
    expect(after?.best_estimate_set_id).toBe(before?.best_estimate_set_id);
    expect(after?.best_estimate_kg).toBe(before?.best_estimate_kg);
  });
});
