/* eslint-disable no-console -- this suite's second job is to PRINT what each broken read answered
   (context/foundation/lessons.md § "Verify with a script that attacks"): a guarantee about failure
   is demonstrated by something that breaks the read and shows the raw response, not by asking a
   human to read a catch block. */

// THE INTEGRATION HALF OF THE SILENT-FAILURE AUDIT (rollout phase 3, risk #5).
//
// **What was missing.** "A failed impact read answers `impact_unavailable`, never `{ impact: [] }`"
// is a guarantee this product makes on THREE routes and proved on ONE:
// `workout-mutations-rls.test.ts` assertions 13 and 14 cover `/api/sets/[id]/impact`, while
// `/api/workouts/[id]/impact` and `/api/exercise-entries/[id]/impact` were imported by **no test in
// the repository** (measured 2026-08-20). Those two are the ones that can take several records with
// one click, so an empty list is most misleading exactly where it was least witnessed.
//
// **Why an empty list is the failure worth catching.** `{ impact: [] }` is not the absence of an
// answer — it is a positive claim, "no record is at stake", and the dialog renders it as
// reassurance immediately before the user confirms a delete. Degrading a failed ranking read into
// one hands out that reassurance at the exact moment the product cannot know.
//
// **Only the RANKING reads are broken, never the ownership read**, and that asymmetry is the whole
// design of the fixture. `impactOf` reads `personal_records` and `set_estimates`; `getWorkout` and
// `getEntry` read `workouts` and `exercise_entries`. Break everything and the route answers `404`
// before it ever reaches the ranking — the assertion would go green against a completely different
// branch. What is simulated here is a database hiccup, which is partial by nature.
//
// **MARK is `t3s-`** — neither a prefix of, nor prefixed by, any mark in use. Re-derive the set with
// `grep -rn "const MARK" tests/` rather than trusting a list, per AGENTS.md § Testing.
// `rls-owner-a@` is a PERMANENT SHARED FIXTURE: this suite writes only `t3s-`-marked rows under it
// and removes them in `beforeAll`, and must never call `delete_own_account()` on it.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { GET as entryImpactRoute } from "@/pages/api/exercise-entries/[id]/impact";
import { GET as workoutImpactRoute } from "@/pages/api/workouts/[id]/impact";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";

const MARK = "t3s-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;

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

/** The slice of `APIContext` a GET impact route reads. Cast rather than mocked wholesale. */
function context(owner: Owner, id: string, client?: SupabaseClient<Database>): APIContext {
  return {
    locals: { supabase: client ?? owner.client, user: { id: owner.userId } },
    params: { id },
    request: new Request(`http://localhost/api/x/${id}/impact`, { method: "GET" }),
  } as unknown as APIContext;
}

interface Logged {
  exerciseId: string;
  workoutId: string;
  entryId: string;
  setIds: string[];
}

/**
 * One workout, one brand-new exercise, and its sets — so every record for that exercise lives
 * inside this workout and removing it necessarily takes one.
 *
 * The exercise is created per call with a run-unique name, which is what makes the positive controls
 * below deterministic: `rls-owner-a` carries history from other suites, and an impact answer
 * computed over a SHARED exercise would depend on rows this file did not write.
 */
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

/**
 * A client whose RANKING reads throw and whose everything else works.
 *
 * The shape is `workout-mutations-rls.test.ts:376-388`'s, generalised: intercept `from` and throw
 * for the two views `impactOf` walks. `workouts` and `exercise_entries` are handed straight through,
 * so the route still resolves ownership and still tells "absent" from "somebody else's" — which is
 * what keeps a `503` assertion from passing against a `404`.
 */
function withBrokenRankings(owner: Owner): SupabaseClient<Database> {
  return new Proxy(owner.client, {
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
}

interface ImpactBody {
  code?: string;
  impact?: unknown[];
}

async function report(what: string, response: Response): Promise<ImpactBody> {
  const body = (await response.clone().json()) as ImpactBody;
  console.info(`  ${what}\n           -> HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);

  // Workouts first: the cascade releases the `on delete restrict` on the exercises. The reverse
  // order fails. Reset in `beforeAll` rather than trusting a previous run's teardown — a killed
  // process skips a `finally` (`lessons.md` § "A `finally` that restores shared state does not
  // survive a killed process").
  await ownerA.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", ownerA.userId);
  await ownerA.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", ownerA.userId);
});

describe("a failed impact read is never reported as an empty one — /api/workouts/[id]/impact", () => {
  it("1. answers impact_unavailable rather than { impact: [] } when the ranking read fails", async () => {
    // The workout-level answer is the one that can take SEVERAL records at once, so an empty list
    // here is the most misleading answer this product could give.
    const a = await logExercise(ownerA, "workout-impact-fails", [{ reps: 5, weight: 100 }]);

    const response = await workoutImpactRoute(context(ownerA, a.workoutId, withBrokenRankings(ownerA)));
    const body = await report("workout impact, ranking read broken", response);

    expect(response.status).not.toBe(200);
    expect(body.code).toBe("impact_unavailable");
    // **Not merely "the list is empty".** The key must be ABSENT: a body carrying both a code and an
    // empty array would still let a lenient client read `impact` and render reassurance.
    expect(body.impact).toBeUndefined();
  });

  it("2. and still answers a NON-EMPTY impact when a record genuinely is at stake", async () => {
    // **The positive control, and deliberately stronger than an empty-list one.** A route that had
    // simply stopped working would satisfy assertion 1 perfectly, and would also satisfy a control
    // asserting `{ impact: [] }` — because "always empty" and "correctly empty" are the same
    // observation. Only a non-empty answer proves the route can still compute one.
    const a = await logExercise(ownerA, "workout-impact-real", [{ reps: 5, weight: 100 }]);

    const response = await workoutImpactRoute(context(ownerA, a.workoutId));
    const body = await report("workout impact, everything healthy", response);

    expect(response.status).toBe(200);
    expect(body.code).toBeUndefined();
    // The exercise was created by this call, so this workout holds its only sets: deleting it takes
    // the record with them.
    expect(body.impact?.length).toBeGreaterThan(0);
  });

  it("3. tells a workout that is not there apart from a ranking it could not compute", async () => {
    // **Two different non-2xx answers, and the difference is the point.** "There is no such workout"
    // and "we could not work out what this would cost" are different facts about the system, and a
    // catch widened to swallow the not-found branch would collapse them — leaving assertion 1 green
    // while the route had lost the ability to say anything specific.
    //
    // This is also why "a failed operation answers non-2xx" is not the criterion: BOTH of these are
    // non-2xx (`test-plan.md` §2, Risk #5, corrected 2026-08-20).
    const response = await workoutImpactRoute(context(ownerA, crypto.randomUUID()));
    const body = await report("workout impact, well-formed uuid naming no row", response);

    expect(response.status).toBe(404);
    expect(body.code).toBe("workout_not_found");
    expect(body.code).not.toBe("impact_unavailable");
  });
});

describe("a failed impact read is never reported as an empty one — /api/exercise-entries/[id]/impact", () => {
  it("4. answers impact_unavailable rather than { impact: [] } when the ranking read fails", async () => {
    const a = await logExercise(ownerA, "entry-impact-fails", [{ reps: 5, weight: 100 }]);

    const response = await entryImpactRoute(context(ownerA, a.entryId, withBrokenRankings(ownerA)));
    const body = await report("entry impact, ranking read broken", response);

    expect(response.status).not.toBe(200);
    expect(body.code).toBe("impact_unavailable");
    expect(body.impact).toBeUndefined();
  });

  it("5. and still answers a NON-EMPTY impact when a record genuinely is at stake", async () => {
    const a = await logExercise(ownerA, "entry-impact-real", [{ reps: 5, weight: 100 }]);

    const response = await entryImpactRoute(context(ownerA, a.entryId));
    const body = await report("entry impact, everything healthy", response);

    expect(response.status).toBe(200);
    expect(body.code).toBeUndefined();
    expect(body.impact?.length).toBeGreaterThan(0);
  });

  it("6. tells an entry that is not there apart from a ranking it could not compute", async () => {
    const response = await entryImpactRoute(context(ownerA, crypto.randomUUID()));
    const body = await report("entry impact, well-formed uuid naming no row", response);

    expect(response.status).toBe(404);
    expect(body.code).toBe("entry_not_found");
    expect(body.code).not.toBe("impact_unavailable");
  });
});
