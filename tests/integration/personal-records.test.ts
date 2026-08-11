/* eslint-disable no-console -- this suite's second job is to PRINT what the database answered to
   every attempted boundary crossing. context/foundation/lessons.md requires a guarantee to be
   demonstrated by something that attacks it and shows the raw response, rather than by asking a
   human to judge SQL. The assertions are the gate; the printed refusals are the evidence. */

// Proves the two things about S-04 that fail SILENTLY if they fail.
//
//   1. THE VIEWS ARE SUBJECT TO THE CALLER'S ROW-LEVEL SECURITY. A view executes with its owner's
//      privileges unless created `with (security_invoker = true)`, and the owner here is `postgres`,
//      which owns the tables and is therefore not subject to their policies. Without the flag both
//      views return every account's training to every account, through a route that reads exactly
//      like the safe ones. Assertion 2 proves this for `set_estimates`, which is where the
//      protection actually lives: `personal_records` draws every row through it, so removing the
//      flag from the OUTER view alone changes nothing observable and no assertion here can catch
//      it. That asymmetry was measured, not assumed — see the migration's header for what it means
//      and why the outer flag stays anyway.
//
//   2. THE SQL ESTIMATE AND THE TYPESCRIPT ESTIMATE ARE THE SAME FORMULA. S-04 gives
//      `one-rep-max.ts` a second implementation, in the `case` expression inside `set_estimates`.
//      Assertion 4 is the only thing in this repository that would notice them drifting apart - the
//      same role `exercises-rls` assertion 4 and `workout-log-rls` assertion 4 play for their own
//      invisible guarantees. DO NOT DELETE IT AS REDUNDANT.
//
// FIXTURE DISCIPLINE IS SHARPER HERE THAN IN THE OTHER SUITES, and the reason is the domain rule: a
// record aggregates over EVERY set the account has ever logged for an exercise. A leftover set from
// another suite - or from this one's previous run - does not merely add noise, it changes the
// answer. So every test creates its OWN run-unique custom exercise and asserts only about that one.
//
// Same two rules as the suites before it: every negative assertion is paired with a re-read AS A
// CALLER ENTITLED TO SEE THE ROW, and the suite authenticates ONLY to gymlog-test with that
// project's publishable key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";
import { estimateOneRepMax, type EstimationFormula } from "@/lib/services/one-rep-max";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MARK = "s04-";
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;
let anonymous: SupabaseClient<Database>;

interface Refusal {
  code?: string;
  message?: string;
}

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

/**
 * A custom exercise nobody else has logged against.
 *
 * Per TEST rather than per suite, on purpose: a record is computed over an exercise's whole history,
 * so two tests sharing an exercise are two tests sharing an answer.
 */
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

/**
 * Written straight to the table rather than through `/api/sets`, deliberately: the bodyweight rule
 * lives in the endpoint, and this phase is about what the DATABASE derives from a stored set. The
 * endpoint path is Phase 2's subject.
 */
async function makeSet(owner: Owner, entryId: string, reps: number, weight: number): Promise<string> {
  const { data, error } = await owner.client
    .from("sets")
    .insert({ user_id: owner.userId, exercise_entry_id: entryId, reps, weight, weight_unit: "kg" })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not log a ${reps}x${weight} set: ${error.code} ${error.message}`);
  }
  return data.id;
}

/** An exercise with one workout under it and the given sets logged in order. */
async function logExercise(
  owner: Owner,
  label: string,
  isBodyweight: boolean,
  sets: readonly { reps: number; weight: number }[],
): Promise<{ exerciseId: string; setIds: string[] }> {
  const exerciseId = await makeExercise(owner, label, isBodyweight);
  const workoutId = await makeWorkout(owner, label);
  const entryId = await makeEntry(owner, workoutId, exerciseId);

  const setIds: string[] = [];
  for (const set of sets) {
    setIds.push(await makeSet(owner, entryId, set.reps, set.weight));
  }
  return { exerciseId, setIds };
}

/**
 * Postgres computes in exact `numeric` and JavaScript in binary float64, so the two agree to far
 * more digits than the product displays but never to the last bit. A relative tolerance is the
 * honest comparison; an exact one would fail for a reason that is not a defect.
 */
function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = Math.max(Math.abs(expected), 1) * 1e-9;
  expect(Math.abs(actual - expected), `${label}: SQL said ${actual}, TypeScript said ${expected}`).toBeLessThanOrEqual(
    tolerance,
  );
}

async function currentFormula(owner: Owner): Promise<EstimationFormula> {
  const { data, error } = await owner.client
    .from("profiles")
    .select("estimation_formula")
    .eq("id", owner.userId)
    .single();
  if (error) {
    throw new Error(`could not read the profile formula: ${error.code} ${error.message}`);
  }
  return data.estimation_formula;
}

async function setFormula(owner: Owner, formula: EstimationFormula): Promise<void> {
  const { error } = await owner.client.from("profiles").update({ estimation_formula: formula }).eq("id", owner.userId);
  if (error) {
    throw new Error(`could not set the profile formula to ${formula}: ${error.code} ${error.message}`);
  }
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

  // Workouts first: deleting them cascades to entries and sets, which is what releases the
  // `on delete restrict` on the exercises this suite created. The reverse order fails.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", owner.userId);
    await owner.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", owner.userId);
  }
});

describe("the record views: an owner can read their own", () => {
  it("1. an account logs sets and reads both views back", async () => {
    // Without this, every negative assertion below would pass against views nobody can use.
    const { exerciseId, setIds } = await logExercise(ownerA, "own", false, [
      { reps: 5, weight: 100 },
      { reps: 1, weight: 130 },
      { reps: 20, weight: 60 },
    ]);

    const estimates = await ownerA.client
      .from("set_estimates")
      .select("set_id, reps, weight_kg, estimate_kg")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", exerciseId);

    expect(estimates.error).toBeNull();
    expect(estimates.data).toHaveLength(3);
    // The 20-rep set is stored and readable, and carries no estimate rather than a fabricated one.
    const outOfRange = estimates.data?.find((row) => row.set_id === setIds[2]);
    expect(outOfRange?.estimate_kg).toBeNull();

    const records = await ownerA.client
      .from("personal_records")
      .select("*")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", exerciseId)
      .single();

    expect(records.error).toBeNull();
    // The single at 130 out-estimates 5x100 (brzycki: 112.5), and is also the heaviest load.
    expect(records.data?.best_estimate_set_id).toBe(setIds[1]);
    expect(Number(records.data?.best_estimate_kg)).toBeCloseTo(130, 6);
    expect(records.data?.heaviest_set_id).toBe(setIds[1]);
    expect(Number(records.data?.heaviest_weight_kg)).toBeCloseTo(130, 6);
    // The set behind each record travels with it, so the screen can show the evidence (US-02).
    expect(records.data?.best_estimate_reps).toBe(1);
    expect(records.data?.best_estimate_performed_on).toBe(TODAY);
  });

  it("1b. the heaviest-weight record ignores the repetition range, and the estimate record does not", async () => {
    // The two exclusion rules differ deliberately (owner, 2026-08-11). A 20-rep set at 150 is the
    // heaviest load this exercise has ever handled and carries no estimate at all.
    const { exerciseId, setIds } = await logExercise(ownerA, "split", false, [
      { reps: 3, weight: 100 },
      { reps: 20, weight: 150 },
    ]);

    const record = await ownerA.client
      .from("personal_records")
      .select("best_estimate_set_id, heaviest_set_id, best_estimate_kg")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", exerciseId)
      .single();

    expect(record.data?.best_estimate_set_id).toBe(setIds[0]);
    expect(record.data?.heaviest_set_id).toBe(setIds[1]);
    expect(record.data?.best_estimate_kg).not.toBeNull();
  });

  it("1c. an equal set does not displace the older one that already holds the record", async () => {
    // The tie-break IS the equality rule: `order by estimate desc, created_at, set_id` keeps the
    // older set in front, so a set that merely matches the previous best is not a record. Phase 2's
    // verdict is built on exactly this ordering.
    const { exerciseId, setIds } = await logExercise(ownerA, "tie", false, [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 100 },
    ]);

    const record = await ownerA.client
      .from("personal_records")
      .select("best_estimate_set_id, heaviest_set_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", exerciseId)
      .single();

    expect(record.data?.best_estimate_set_id).toBe(setIds[0]);
    expect(record.data?.heaviest_set_id).toBe(setIds[0]);
  });
});

describe("the record views: another account cannot reach them", () => {
  it("2. B cannot read A's estimates or records through either view — and still reads its own", async () => {
    const a = await logExercise(ownerA, "private", false, [{ reps: 5, weight: 120 }]);
    const b = await logExercise(ownerB, "b-own", false, [{ reps: 5, weight: 80 }]);

    // Naming A's identifiers directly is the whole point: this is the request US-04 warns about.
    const asBEstimates = await ownerB.client
      .from("set_estimates")
      .select("set_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", a.exerciseId);
    const asBRecords = await ownerB.client
      .from("personal_records")
      .select("exercise_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", a.exerciseId);
    // Unfiltered by owner, so a view that leaked would hand back A's rows here even without the id.
    const asBAll = await ownerB.client.from("personal_records").select("user_id, exercise_id");

    report("B reads A's set_estimates by user_id and exercise_id", asBEstimates.error);
    report("B reads A's personal_records by user_id and exercise_id", asBRecords.error);

    expect(asBEstimates.data).toEqual([]);
    expect(asBRecords.data).toEqual([]);
    expect(asBAll.data?.some((row) => row.user_id === ownerA.userId)).toBe(false);
    // B is not merely broken: it reads its own row through the same views.
    expect(asBAll.data?.some((row) => row.exercise_id === b.exerciseId)).toBe(true);

    // The refusal is about visibility, not existence: A still sees both of its own rows.
    const asA = await ownerA.client
      .from("personal_records")
      .select("exercise_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", a.exerciseId);
    expect(asA.data).toHaveLength(1);
  });

  it("3. an unauthenticated client has no read path to either view", async () => {
    const estimates = await anonymous.from("set_estimates").select("*");
    const records = await anonymous.from("personal_records").select("*");

    report("an unauthenticated client reads set_estimates", estimates.error);
    report("an unauthenticated client reads personal_records", records.error);

    // With `revoke all ... from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(estimates.data).toBeNull();
    expect(records.data).toBeNull();
    expect(estimates.error?.code).toBe("42501");
    expect(records.error?.code).toBe("42501");
  });
});

describe("the record views: the SQL formula and the TypeScript formula are the same formula", () => {
  it("4. every boundary case agrees with estimateOneRepMax, under both formulas", async () => {
    // The boundary table from AGENTS.md § Testing, logged as real sets and read back through the
    // view. `expected: null` means the product must decline to fabricate a number.
    const loaded = await logExercise(ownerA, "parity", false, [
      { reps: 1, weight: 100 }, // the estimate IS the weight — Epley must be pinned here
      { reps: 2, weight: 100 },
      { reps: 3, weight: 102.5 }, // a load with decimals, exercising the numeric path
      { reps: 5, weight: 100 },
      { reps: 12, weight: 100 }, // the last repetition count that carries an estimate
      { reps: 13, weight: 100 }, // the first that does not
    ]);
    // Zero and assisted loads need a bodyweight exercise to be storable at all (FR-014).
    const assisted = await logExercise(ownerA, "parity-bw", true, [
      { reps: 10, weight: 0 }, // bodyweight: recorded, but no load to estimate from
      { reps: 8, weight: -20 }, // assisted: no meaningful strength score at any repetition count
    ]);

    const restoreTo = await currentFormula(ownerA);
    try {
      for (const formula of ["brzycki", "epley"] as const) {
        await setFormula(ownerA, formula);

        const rows = await ownerA.client
          .from("set_estimates")
          .select("set_id, reps, weight_kg, estimate_kg")
          .eq("user_id", ownerA.userId)
          .in("exercise_id", [loaded.exerciseId, assisted.exerciseId]);

        expect(rows.error).toBeNull();
        expect(rows.data).toHaveLength(8);

        for (const row of rows.data ?? []) {
          const reps = row.reps ?? 0;
          const weightKg = Number(row.weight_kg);
          const expected = estimateOneRepMax(weightKg, reps, formula);
          const label = `${formula} ${reps}x${weightKg}`;

          if (expected === null || weightKg <= 0) {
            // A set the arithmetic refuses is a set the view must refuse too — never a 0, which the
            // user would read as "your best on this exercise is nothing".
            expect(row.estimate_kg, `${label} must carry no estimate`).toBeNull();
          } else {
            expect(row.estimate_kg, `${label} must carry an estimate`).not.toBeNull();
            expectClose(Number(row.estimate_kg), expected, label);
          }
        }

        // The single-repetition rule, asserted by name rather than left to the loop: Brzycki yields
        // it naturally and Epley does not, so this is where a missing pin would show.
        const single = rows.data?.find((row) => row.reps === 1);
        expectClose(Number(single?.estimate_kg), 100, `${formula} at one repetition`);
      }
    } finally {
      await setFormula(ownerA, restoreTo);
    }
  });

  it("4b. changing the formula re-derives history rather than contradicting it", async () => {
    // The reason nothing is stored (S-06 depends on this): the same set reads differently under the
    // two formulas, and neither reading is written down anywhere.
    //
    // FIVE repetitions, not ten, and the difference is not arbitrary: THE TWO FORMULAS CROSS AT TEN.
    // Brzycki is 36/27 there and Epley is 1 + 10/30, and both are exactly 4/3, so a set of ten reads
    // identically under either. A test written at ten proves nothing about the toggle — and anybody
    // reporting "switching the formula does nothing" has probably tried it on a set of ten.
    const { setIds } = await logExercise(ownerA, "rederive", false, [{ reps: 5, weight: 100 }]);

    const restoreTo = await currentFormula(ownerA);
    const readEstimate = async () => {
      const { data } = await ownerA.client
        .from("set_estimates")
        .select("estimate_kg")
        .eq("user_id", ownerA.userId)
        .eq("set_id", setIds[0])
        .single();
      return Number(data?.estimate_kg);
    };

    try {
      await setFormula(ownerA, "brzycki");
      const brzycki = await readEstimate();
      await setFormula(ownerA, "epley");
      const epley = await readEstimate();

      expectClose(brzycki, (100 * 36) / 32, "brzycki at five repetitions");
      expectClose(epley, 100 * (1 + 5 / 30), "epley at five repetitions");
      expect(brzycki).not.toBe(epley);
    } finally {
      await setFormula(ownerA, restoreTo);
    }
  });
});

describe("the record views: an exercise with no record still appears", () => {
  it("5. an exercise logged only at zero load carries a row with both records empty", async () => {
    // Plank, push-up and unweighted pull-up are routine rather than edge cases. An exercise the user
    // logged and cannot find on the records screen reads as lost data, so the row has to exist for
    // the screen to explain itself. This is what anchoring the view on logged exercises buys.
    const { exerciseId } = await logExercise(ownerA, "plank", true, [
      { reps: 60, weight: 0 },
      { reps: 45, weight: 0 },
    ]);

    const record = await ownerA.client
      .from("personal_records")
      .select("*")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", exerciseId)
      .single();

    expect(record.error).toBeNull();
    expect(record.data?.exercise_id).toBe(exerciseId);
    expect(record.data?.is_bodyweight).toBe(true);
    expect(record.data?.best_estimate_set_id).toBeNull();
    expect(record.data?.heaviest_set_id).toBeNull();
    // Nothing to sort it by, so it sinks to the bottom of the list under `nulls last`.
    expect(record.data?.last_record_on).toBeNull();
  });
});
