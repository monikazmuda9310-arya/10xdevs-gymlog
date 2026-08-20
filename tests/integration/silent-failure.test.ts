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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { DELETE as deleteAccountRoute } from "@/pages/api/account/index";
import { GET as entryImpactRoute } from "@/pages/api/exercise-entries/[id]/impact";
import { POST as addSetRoute } from "@/pages/api/sets/index";
import { GET as workoutImpactRoute } from "@/pages/api/workouts/[id]/impact";

import { resetPreferences } from "./fixture-preferences";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";

const MARK = "t3s-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;

let url: string;
let key: string;
let password: string;

/** Per-run accounts the deletion assertions own and destroy. Swept in `afterAll`. */
const throwaways: { client: SupabaseClient<Database>; userId: string; email: string }[] = [];

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

/** The slice `POST /api/sets` reads: a client, a user id, and a JSON body. */
function jsonContext(owner: Owner, body: unknown, client?: SupabaseClient<Database>): APIContext {
  return {
    locals: { supabase: client ?? owner.client, user: { id: owner.userId } },
    params: {},
    request: new Request("http://localhost/api/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

/** `DELETE /api/account` takes no route parameter and no body — the account is named by auth.uid(). */
function accountContext(userId: string, client: SupabaseClient<Database>): APIContext {
  return {
    locals: { supabase: client, user: { id: userId } },
    params: {},
    request: new Request("http://localhost/api/account", { method: "DELETE" }),
  } as unknown as APIContext;
}

/**
 * A brand-new account for this run alone.
 *
 * **Never a shared fixture**, because the assertions below DELETE their subject. Reusing
 * `rls-owner-a/b` or an `s09i-` address would remove a permanent fixture and surface as an unrelated
 * suite failing on a later run.
 */
async function throwawayAccount(label: string) {
  const email = `${MARK}${label}-${RUN_ID}@gymlog-test.dev`;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(`could not create ${email}: ${error.message}`);
  }
  if (!data.session) {
    throw new Error(
      `${email} was created without a session. Email confirmation has been switched on for ` +
        `gymlog-test, which breaks every suite that bootstraps an account without an inbox.`,
    );
  }

  const account = { client, userId: data.session.user.id, email };
  throwaways.push(account);
  return account;
}

/** What `auth.signOut()` is made to do, mirroring the two shapes the library actually produces. */
type SignOutOutcome = { error: { message: string } } | "throw";

/**
 * A client whose `auth.signOut` fails and whose `rpc` still works.
 *
 * **`rpc` must pass through or the assertion measures the Proxy rather than the endpoint** —
 * `deleteOwnAccount` calls `supabase.rpc("delete_own_account")`, and a Proxy that intercepted
 * everything would leave the account alive while the route reported success, which is the very
 * confusion these assertions exist to rule out.
 */
function withFailingSignOut(client: SupabaseClient<Database>, outcome: SignOutOutcome): SupabaseClient<Database> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "auth") {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return new Proxy(target.auth, {
        get(auth, authProp, authReceiver) {
          if (authProp !== "signOut") {
            return Reflect.get(auth, authProp, authReceiver) as unknown;
          }
          return () =>
            outcome === "throw"
              ? Promise.reject(new TypeError("simulated non-AuthError failure inside signOut"))
              : Promise.resolve(outcome);
        },
      });
    },
  });
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
  url = required("SUPABASE_TEST_URL");
  key = required("SUPABASE_TEST_KEY");
  password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);

  // **This suite DEPENDS on `weight_unit`, so it establishes it rather than trusting whoever last
  // changed it.** `logExercise` inserts its sets with `weight_unit: "kg"` directly, while
  // `POST /api/sets` stamps the unit from the profile — so with the profile left on `lb`, the
  // 130 logged through the endpoint would be 58.97 kg against a stored 100 kg, would beat nothing,
  // and assertion 8's record announcement would vanish for a reason that has nothing to do with the
  // swallow it is controlling for. Teardown protects the happy path; only setup protects the next
  // run (`lessons.md` § "A `finally` that restores shared state does not survive a killed process").
  await resetPreferences(ownerA.client, ownerA.userId);

  // Workouts first: the cascade releases the `on delete restrict` on the exercises. The reverse
  // order fails.
  await ownerA.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", ownerA.userId);
  await ownerA.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", ownerA.userId);
});

afterAll(async () => {
  // **A sweep that tolerates an account already gone.** These accounts are the SUBJECT of the
  // deletion assertions, so on a green run every one of them is already removed and signing in
  // fails — that is success, not an error. What this catches is the other case: an assertion that
  // failed BEFORE reaching the deletion, leaving a live per-run account behind. This project has no
  // `LIKE` sweep over accounts, deliberately, so a leak is invisible until somebody counts
  // addresses in the dashboard months later.
  for (const subject of throwaways) {
    const probe = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await probe.auth.signInWithPassword({ email: subject.email, password });
    if (!data.session) {
      continue;
    }
    const { error } = await probe.rpc("delete_own_account");
    if (error) {
      throw new Error(`could not remove leaked account ${subject.email}: ${error.code} ${error.message}`);
    }
  }
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

// THE TWO DELIBERATE SWALLOWS — and this describe runs in the OPPOSITE direction to everything
// above it.
//
// Class B of the catch inventory (`research.md` § The catch inventory): two sites where a caught
// error correctly does **not** become a non-2xx, because the write has already committed. Both carry
// their reasoning inline and **nothing enforced either** until now — so "do not reverse a deliberate
// swallow" was an instruction in a comment, which is exactly the kind of rule this project has
// learned to make executable.
//
// **The decision rule, stated once**: log it and carry on is defensible exactly when the caller's
// next action cannot be improved by knowing. After a committed write it cannot — an error there
// invites a retry that duplicates the write, or contradicts a deletion that already happened.

describe("a failure AFTER a committed write must not turn the write into an error — POST /api/sets", () => {
  it("7. still answers 201 with the set persisted when the record verdict cannot be computed", async () => {
    // `sets/index.ts:74-90` gives the verdict its OWN try/catch, inside the handler's. The set is
    // already in the database when it runs, so a failed verdict costs the badge and nothing else.
    // Reversing it into a 500 would invite the retry `AddSetForm` deliberately makes easy — and a
    // retry after a successful write logs the same set twice, inflating tonnage and inventing a
    // record nobody performed. A missing badge is recoverable by reloading; a duplicated set is not.
    const a = await logExercise(ownerA, "verdict-fails", [{ reps: 5, weight: 100 }]);

    const response = await addSetRoute(
      jsonContext(ownerA, { exerciseEntryId: a.entryId, reps: 5, weight: 130, rpe: null }, withBrokenRankings(ownerA)),
    );
    const body = (await response.clone().json()) as { set?: { id: string }; record?: unknown };
    console.info(
      `  set logged with the verdict read broken\n           -> HTTP ${response.status} record=${JSON.stringify(body.record)}`,
    );

    expect(response.status).toBe(201);
    expect(body.record).toBeNull();

    // **THE CLAIM: the write landed.** A 201 is a statement about a response, not about stored
    // state, and the failure worth catching here is the reverse of the usual one — a caller told
    // "saved" while nothing was saved. Read back as the owner.
    const { data: stored } = await ownerA.client
      .from("sets")
      .select("id, reps, weight")
      .eq("user_id", ownerA.userId)
      .eq("id", body.set?.id ?? "")
      .maybeSingle();
    expect(stored).not.toBeNull();
    expect(stored?.reps).toBe(5);
    expect(Number(stored?.weight)).toBe(130);
  });

  it("8. and still announces a record when the verdict CAN be computed", async () => {
    // **The positive control.** `record: null` in assertion 7 is satisfied perfectly by an endpoint
    // that has stopped announcing records at all — and such an endpoint would pass assertion 7 while
    // having lost the feature FR-020 exists for. Only a non-null announcement separates "the
    // swallow worked" from "the badge is gone everywhere".
    //
    // Both sets sit at 5 repetitions — inside the 1–12 range at positive load — so the verdict is
    // decided by weight rather than by falling outside the range, which would make this vacuous for
    // a domain reason rather than a failure reason.
    const a = await logExercise(ownerA, "verdict-works", [{ reps: 5, weight: 100 }]);

    const response = await addSetRoute(
      jsonContext(ownerA, { exerciseEntryId: a.entryId, reps: 5, weight: 130, rpe: null }),
    );
    const body = (await response.clone().json()) as { record?: { previousBest?: unknown } | null };
    console.info(
      `  set logged with everything healthy\n           -> HTTP ${response.status} record=${JSON.stringify(body.record)}`,
    );

    expect(response.status).toBe(201);
    expect(body.record).not.toBeNull();
    expect(body.record?.previousBest).toBeDefined();
  });
});

describe("a failure AFTER a committed write must not turn the write into an error — DELETE /api/account", () => {
  it("9. still answers { deleted: true } when signOut RESOLVES an error, and the account is gone", async () => {
    const subject = await throwawayAccount("delete-signout-error");

    // **POSITIVE CONTROL FIRST, because the claim below is an ABSENCE.** "Signing in fails
    // afterwards" is satisfied perfectly by an account that never existed — a typo in the address
    // produces exactly that observation. This is the proof it was there to be removed.
    const before = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const live = await before.auth.signInWithPassword({ email: subject.email, password });
    expect(live.data.session).not.toBeNull();

    const response = await deleteAccountRoute(
      accountContext(
        subject.userId,
        withFailingSignOut(subject.client, { error: { message: "simulated GoTrue 500" } }),
      ),
    );
    const body = (await response.clone().json()) as { deleted?: boolean; code?: string };
    console.info(
      `  account deleted, signOut resolved an error\n           -> HTTP ${response.status} ${JSON.stringify(body)}`,
    );

    // The deletion genuinely happened, so saying so is the truth. `account/index.ts:65-70` logs the
    // orphaned cookie and reports success deliberately: telling the caller the deletion failed —
    // about an account that no longer exists — is "the one lie this endpoint must never tell".
    //
    // **WHAT THIS ASSERTION DOES AND DOES NOT PIN, measured 2026-08-20 rather than assumed.**
    // Turning the guard into `return fail(500, "unexpected")` — the reversal this test exists to
    // forbid — reddens the line below with `expected 500 to be 200`. But **deleting the guard
    // outright breaks nothing**: all ten assertions still pass, because
    // `if (signOut.error) { console.error(...) }` is diagnostic-only and changes no response. So
    // this assertion pins the SWALLOW, not the log. Said plainly rather than left implied, in the
    // words this project uses to refuse an assertion (`lessons.md` § "When a mutation does not break
    // anything, fix the claim — never the test"): nothing writable from this suite would notice the
    // `console.error` being removed, and the edit that would make it load-bearing is a caller
    // learning to act on that log — an alert, a metric, a retry — at which point its absence becomes
    // observable somewhere other than a response body. Keep the log; do not write an assertion that
    // merely appears to cover it.
    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);

    // **THE CLAIM, proven from outside.** Nothing here can read `auth.users`; a fresh client
    // attempting the same credentials is the only evidence available.
    const after = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const gone = await after.auth.signInWithPassword({ email: subject.email, password });
    expect(gone.data.session).toBeNull();
  });

  it("10. and the same when signOut THROWS, which is a different branch of the same handler", async () => {
    // **Two shapes, two branches, and only one is reachable per test.** `signOut()` resolves
    // `{ error }` for an ordinary auth failure and re-throws anything that is not an `AuthError`;
    // `account/index.ts` handles the first at `:65` and the second at `:71`. Removing the `try`
    // lets the throw escape after the deletion has committed — Astro answers a generic HTML 500,
    // `DeleteAccountPanel`'s `response.json()` fails, and the user is told the deletion did not
    // happen. Assertion 9 cannot see that; this one can.
    const subject = await throwawayAccount("delete-signout-throws");

    const before = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const live = await before.auth.signInWithPassword({ email: subject.email, password });
    expect(live.data.session).not.toBeNull();

    const response = await deleteAccountRoute(
      accountContext(subject.userId, withFailingSignOut(subject.client, "throw")),
    );
    const body = (await response.clone().json()) as { deleted?: boolean; code?: string };
    console.info(`  account deleted, signOut threw\n           -> HTTP ${response.status} ${JSON.stringify(body)}`);

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);

    const after = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const gone = await after.auth.signInWithPassword({ email: subject.email, password });
    expect(gone.data.session).toBeNull();
  });
});
