/* eslint-disable no-console -- this suite's second job is to PRINT what the database answered to
   every attempted crossing (context/foundation/lessons.md): a guarantee is demonstrated by something
   that attacks it and shows the raw response, not by asking a human to read policy text. */

// THE TWELVE UPDATE AND DELETE POLICIES WRITTEN IN S-03 HAVE NEVER BEEN EXERCISED BY APPLICATION
// CODE. S-03's implementation review confirmed `.update(`, `.delete(` and `.upsert(` appeared nowhere
// in `src/`; the migration granted them anyway and said in a comment that the absent screens were
// scope for S-05, not permission. This suite is the first thing that runs them, so it is also the
// first thing that could discover one of them is wrong.
//
// Two failure modes it exists to catch, both silent:
//
//   1. A CALLER TOLD "NOTHING HAPPENED" WHILE THE WRITE LANDED. Every negative assertion is
//      therefore paired with a RE-READ AS THE ROW'S OWNER. A status code is not evidence about
//      stored state (AGENTS.md § Testing).
//
//   2. A CALLER TOLD "IT WORKED" WHILE NOTHING HAPPENED. Under RLS an update or a delete naming
//      another account's row does not raise — it matches ZERO ROWS and reports success. An endpoint
//      answering 204 to that tells one account it has just deleted another's data. Assertions 1-6
//      require 404, and the mutation protocol in the plan flips it to 204 to prove they bite.
//
// Driven by calling the exported handlers directly, as workout-endpoints.test.ts does and for the
// same reason: `astro dev` reads its credentials from `.dev.vars`, which points at PRODUCTION.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { DELETE as deleteEntryRoute } from "@/pages/api/exercise-entries/[id]/index";
import { GET as setImpactRoute } from "@/pages/api/sets/[id]/impact";
import { DELETE as deleteSetRoute, PATCH as patchSetRoute } from "@/pages/api/sets/[id]/index";
import { DELETE as deleteWorkoutRoute, PATCH as patchWorkoutRoute } from "@/pages/api/workouts/[id]/index";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MARK = "s05m-";
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; the integration check must never skip its way to green.`);
  }
  return value;
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

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

/** The slice of APIContext the handlers actually read. Cast rather than mocked wholesale. */
function context(owner: Owner, id: string, body?: unknown, client?: SupabaseClient<Database>) {
  return {
    locals: { supabase: client ?? owner.client, user: { id: owner.userId } },
    params: { id },
    request: new Request(`http://localhost/api/x/${id}`, {
      method: body === undefined ? "DELETE" : "PATCH",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  } as unknown as APIContext;
}

async function report(crossing: string, response: Response): Promise<void> {
  const text = await response.clone().text();
  console.info(`  refused  ${crossing}\n           -> HTTP ${response.status} ${text || "(no body)"}`);
}

interface Logged {
  exerciseId: string;
  workoutId: string;
  entryId: string;
  setIds: string[];
}

async function logExercise(owner: Owner, label: string, sets: readonly { reps: number; weight: number }[]) {
  const exercise = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "back", is_bodyweight: false })
    .select("id")
    .single();
  if (exercise.error) {
    throw new Error(`exercise '${label}': ${exercise.error.code} ${exercise.error.message}`);
  }

  const workout = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: TODAY, note: `${MARK}${label}-${RUN_ID}` })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`workout '${label}': ${workout.error.code} ${workout.error.message}`);
  }

  const entry = await owner.client
    .from("exercise_entries")
    .insert({ user_id: owner.userId, workout_id: workout.data.id, exercise_id: exercise.data.id })
    .select("id")
    .single();
  if (entry.error) {
    throw new Error(`entry '${label}': ${entry.error.code} ${entry.error.message}`);
  }

  const setIds: string[] = [];
  for (const set of sets) {
    const row = await owner.client
      .from("sets")
      .insert({
        user_id: owner.userId,
        exercise_entry_id: entry.data.id,
        reps: set.reps,
        weight: set.weight,
        weight_unit: "kg",
      })
      .select("id")
      .single();
    if (row.error) {
      throw new Error(`set '${label}': ${row.error.code} ${row.error.message}`);
    }
    setIds.push(row.data.id);
  }

  const logged: Logged = { exerciseId: exercise.data.id, workoutId: workout.data.id, entryId: entry.data.id, setIds };
  return logged;
}

/** Read back AS THE OWNER. The failure worth catching is a caller told "no" while the write landed. */
async function readSet(owner: Owner, setId: string) {
  const { data } = await owner.client
    .from("sets")
    .select("id, reps, weight")
    .eq("user_id", owner.userId)
    .eq("id", setId)
    .maybeSingle();
  return data;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);

  // Workouts first: the cascade releases the `on delete restrict` on the exercises. The reverse
  // order fails.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", owner.userId);
    await owner.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", owner.userId);
  }
});

describe("another account cannot correct or remove what it does not own", () => {
  it("1. B cannot edit A's set, and A's set is unchanged afterwards", async () => {
    const a = await logExercise(ownerA, "patch-set", [{ reps: 5, weight: 100 }]);

    const response = await patchSetRoute(context(ownerB, a.setIds[0], { reps: 1, weight: 500, rpe: null }));
    await report("B edits A's set", response);

    expect(response.status).toBe(404);

    // Persisted state, not the status code.
    const stored = await readSet(ownerA, a.setIds[0]);
    expect(stored?.reps).toBe(5);
    expect(Number(stored?.weight)).toBe(100);
  });

  it("2. B cannot delete A's set, and A's set is still there afterwards", async () => {
    const a = await logExercise(ownerA, "delete-set", [{ reps: 5, weight: 100 }]);

    const response = await deleteSetRoute(context(ownerB, a.setIds[0]));
    await report("B deletes A's set", response);

    expect(response.status).toBe(404);
    expect(await readSet(ownerA, a.setIds[0])).not.toBeNull();
  });

  it("3. B cannot change the date on A's workout", async () => {
    const a = await logExercise(ownerA, "patch-workout", [{ reps: 5, weight: 100 }]);

    const response = await patchWorkoutRoute(
      context(ownerB, a.workoutId, { performedOn: "2020-01-01", note: "taken over" }),
    );
    await report("B edits A's workout", response);

    expect(response.status).toBe(404);

    const { data } = await ownerA.client
      .from("workouts")
      .select("performed_on, note")
      .eq("user_id", ownerA.userId)
      .eq("id", a.workoutId)
      .single();
    expect(data?.performed_on).toBe(TODAY);
    expect(data?.note).not.toBe("taken over");
  });

  it("4. B cannot delete A's workout, and nothing beneath it disappears", async () => {
    const a = await logExercise(ownerA, "delete-workout", [
      { reps: 5, weight: 100 },
      { reps: 3, weight: 120 },
    ]);

    const response = await deleteWorkoutRoute(context(ownerB, a.workoutId));
    await report("B deletes A's workout", response);

    expect(response.status).toBe(404);

    // The whole tree, not just the top row: a cascade fired by a refused delete would be invisible
    // in the workout table alone.
    const workout = await ownerA.client.from("workouts").select("id").eq("id", a.workoutId).maybeSingle();
    const sets = await ownerA.client.from("sets").select("id").eq("user_id", ownerA.userId).in("id", a.setIds);
    expect(workout.data).not.toBeNull();
    expect(sets.data).toHaveLength(2);
  });

  it("5. B cannot remove an exercise from A's workout", async () => {
    const a = await logExercise(ownerA, "delete-entry", [{ reps: 5, weight: 100 }]);

    const response = await deleteEntryRoute(context(ownerB, a.entryId));
    await report("B removes an exercise from A's workout", response);

    expect(response.status).toBe(404);

    const entry = await ownerA.client.from("exercise_entries").select("id").eq("id", a.entryId).maybeSingle();
    expect(entry.data).not.toBeNull();
    expect(await readSet(ownerA, a.setIds[0])).not.toBeNull();
  });

  it("6. B cannot read what deleting A's set would cost", async () => {
    // The impact endpoint reads the same ownership boundary. If it leaked, it would report which of
    // ANOTHER account's records a set holds — the records themselves, one step removed.
    const a = await logExercise(ownerA, "impact-cross", [{ reps: 5, weight: 100 }]);

    const response = await setImpactRoute(context(ownerB, a.setIds[0]));
    await report("B reads the impact of deleting A's set", response);

    expect(response.status).toBe(404);
  });
});

describe("absent and somebody else's are the same answer", () => {
  it("7. a well-formed id with no row behind it answers exactly as another account's does", async () => {
    const absent = crypto.randomUUID();

    const set = await deleteSetRoute(context(ownerB, absent));
    const workout = await deleteWorkoutRoute(context(ownerB, absent));
    const entry = await deleteEntryRoute(context(ownerB, absent));

    // 404 for all three, and the same 404 assertions 2, 4 and 5 got for a row that DOES exist —
    // so neither endpoint is an existence oracle.
    expect([set.status, workout.status, entry.status]).toEqual([404, 404, 404]);
  });

  it("8. a malformed id never reaches a query", async () => {
    // Postgres answers 22P02 for a uuid column handed something that is not one, which would
    // surface as a 500 — a different fact about the system than "no such row".
    const response = await deleteSetRoute(context(ownerB, "not-a-uuid"));

    expect(response.status).toBe(404);
  });
});

describe("the owner can, and the records follow", () => {
  it("9. deleting a workout takes its entries and sets with it", async () => {
    const a = await logExercise(ownerA, "cascade", [
      { reps: 5, weight: 100 },
      { reps: 3, weight: 120 },
    ]);

    const response = await deleteWorkoutRoute(context(ownerA, a.workoutId));
    expect(response.status).toBe(204);

    const entries = await ownerA.client.from("exercise_entries").select("id").eq("id", a.entryId);
    const sets = await ownerA.client.from("sets").select("id").eq("user_id", ownerA.userId).in("id", a.setIds);
    expect(entries.data).toEqual([]);
    expect(sets.data).toEqual([]);
  });

  it("10. deleting the set behind a record lets the record fall to the runner-up", async () => {
    // The derivation, end to end and through the real endpoint. Nothing was recomputed and nothing
    // was invalidated: the next read of the view simply returns a different row.
    const a = await logExercise(ownerA, "fall", [
      { reps: 5, weight: 100 },
      { reps: 5, weight: 130 },
    ]);

    const before = await ownerA.client
      .from("personal_records")
      .select("best_estimate_set_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", a.exerciseId)
      .single();
    expect(before.data?.best_estimate_set_id).toBe(a.setIds[1]);

    const response = await deleteSetRoute(context(ownerA, a.setIds[1]));
    expect(response.status).toBe(204);

    const after = await ownerA.client
      .from("personal_records")
      .select("best_estimate_set_id")
      .eq("user_id", ownerA.userId)
      .eq("exercise_id", a.exerciseId)
      .single();
    console.info(`  the record fell from ${a.setIds[1]} to ${after.data?.best_estimate_set_id} with no write`);
    expect(after.data?.best_estimate_set_id).toBe(a.setIds[0]);
  });

  it("11. editing a barbell set down to zero is refused in the same words as logging it there", async () => {
    // FR-014's third caller. `isWeightAllowed` has one definition; this is the edit path meeting it.
    const a = await logExercise(ownerA, "bodyweight-rule", [{ reps: 5, weight: 100 }]);

    const response = await patchSetRoute(context(ownerA, a.setIds[0], { reps: 5, weight: 0, rpe: null }));
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("weight_needs_bodyweight");
    // And the set is untouched — a refused edit must not half-apply.
    const stored = await readSet(ownerA, a.setIds[0]);
    expect(Number(stored?.weight)).toBe(100);
  });

  it("12. an edit keeps the unit the set was stored in", async () => {
    // The unit belongs to the row, not to the account. Re-stamping it from the profile would turn
    // 100 lb into 100 kg the first time somebody fixed a typo after changing that preference.
    const a = await logExercise(ownerA, "unit", [{ reps: 5, weight: 100 }]);
    await ownerA.client.from("sets").update({ weight_unit: "lb" }).eq("id", a.setIds[0]).eq("user_id", ownerA.userId);

    const response = await patchSetRoute(context(ownerA, a.setIds[0], { reps: 6, weight: 110, rpe: null }));
    expect(response.status).toBe(200);

    const { data } = await ownerA.client
      .from("sets")
      .select("weight, weight_unit, weight_kg")
      .eq("user_id", ownerA.userId)
      .eq("id", a.setIds[0])
      .single();

    expect(data?.weight_unit).toBe("lb");
    expect(Number(data?.weight)).toBe(110);
    // The generated column followed the stored unit, not the profile's.
    expect(Number(data?.weight_kg)).toBeCloseTo(110 * 0.45359237, 6);
  });
});

describe("a failed impact read is never reported as an empty one", () => {
  it("13. answers impact_unavailable rather than { impact: [] }", async () => {
    // THE F2 GUARD. An empty impact list is a positive claim — "no record is at stake" — so degrading
    // a failed ranking read into one would hand the user reassurance at the exact moment the product
    // cannot know. The ownership read is left working and only the ranking reads fail, which is the
    // shape a database hiccup actually takes.
    const a = await logExercise(ownerA, "impact-fails", [{ reps: 5, weight: 100 }]);

    const brokenRankings = new Proxy(ownerA.client, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (table: string) => {
            if (table === "personal_records" || table === "set_estimates") {
              throw new Error("simulated ranking failure");
            }
            return target.from(table as "sets");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const response = await setImpactRoute(context(ownerA, a.setIds[0], undefined, brokenRankings));
    const body = (await response.json()) as { code?: string; impact?: unknown[] };

    console.info(`  ranking read failed -> HTTP ${response.status} ${JSON.stringify(body)}`);

    expect(response.status).not.toBe(200);
    expect(body.code).toBe("impact_unavailable");
    expect(body.impact).toBeUndefined();
  });

  it("14. and still answers an ordinary empty impact when nothing is genuinely at stake", async () => {
    // The other half: `{ impact: [] }` must remain reachable and meaningful, or assertion 13 would
    // pass against an endpoint that had simply stopped answering.
    const a = await logExercise(ownerA, "impact-empty", [
      { reps: 5, weight: 130 },
      { reps: 5, weight: 100 },
    ]);

    // The second set holds neither record — the first out-estimates and out-weighs it.
    const response = await setImpactRoute(context(ownerA, a.setIds[1]));
    const body = (await response.json()) as { impact: unknown[] };

    expect(response.status).toBe(200);
    expect(body.impact).toEqual([]);
  });
});
