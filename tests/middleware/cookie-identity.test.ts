// THE FIRST THING IN THIS REPOSITORY THAT BINDS AN IDENTITY TO A REQUEST.
//
// Fifteen integration suites drive the same handlers with a HAND-BUILT `locals` —
// `{ supabase: client, user: { id: owner.userId } }` — so the client and the user id agree by
// construction. Every one of them would stay green against a middleware that put the WRONG user on
// `locals`, because none of them lets the middleware decide. `resolve()`
// (`src/pages/api/_shared/mutation-route.ts:42-58`) takes `user.id` from `context.locals` as given
// and never checks ownership itself, so everything downstream is exactly as correct as a step
// nothing executes.
//
// What this file runs instead: a REAL `gymlog-test` session cookie → `src/lib/supabase.ts` →
// `auth.getUser()` against the real auth server → `locals` → the real endpoints.
//
// **MARK is `t2c-`** — not a prefix of, and not prefixed by, any mark in `tests/integration/`
// (re-derive with `grep -rn "const MARK" tests/integration/` rather than trusting a list), nor of
// `t2e-`, which the browser suite takes.
//
// **NO `LIKE` SWEEP ANYWHERE IN THIS PROJECT.** Every account is per-run and is removed through
// `delete_own_account()` on the client that owns it. A prefix delete is how one suite reaches
// another's fixtures, and nothing here needs one. `rls-owner-a/b@` and every `s09i-` address are
// permanent shared fixtures and must never be passed to anything in this file.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { onRequest } from "@/middleware";
import { GET as setImpactRoute } from "@/pages/api/sets/[id]/impact";
import { DELETE as deleteWorkoutRoute, PATCH as patchWorkoutRoute } from "@/pages/api/workouts/[id]/index";

import { middlewareContext } from "./_shared/context";
import { claimAnotherAccount, mintSessionCookies, reEncodeSession, type MintedSession } from "./_shared/session";

const MARK = "t2c-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface Account {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
  session: MintedSession;
}

let url: string;
let key: string;
let password: string;

let accountA: Account;
let accountB: Account;

/** A's training, which B will name directly and which must read back untouched afterwards. */
let workoutIdA: string;
let setIdA: string;
let exerciseIdA: string;
const NOTE_A = `${MARK}a-note-${RUN_ID}`;

const created: Account[] = [];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. This check must never skip its way to green.`);
  }
  return value;
}

/** A brand-new account for this run alone, plus the real cookies its session produces. */
async function throwawayAccount(label: string): Promise<Account> {
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

  const account: Account = {
    client,
    userId: data.session.user.id,
    email,
    session: await mintSessionCookies(email, password),
  };
  if (account.session.userId !== account.userId) {
    throw new Error(`the minted cookie names ${account.session.userId} but the account is ${account.userId}`);
  }
  created.push(account);
  return account;
}

/** Drive the real middleware for one request and hand back what it derived. */
async function derive(url: string, cookieHeader?: string) {
  const harness = middlewareContext({ url, cookieHeader });
  const response = await onRequest(harness.context, harness.next);
  return { harness, response: response as Response };
}

/** The slice of `APIContext` the S-05 routes read, carrying MIDDLEWARE-DERIVED locals. */
function apiContext(locals: App.Locals, id: string, body?: unknown): APIContext {
  return {
    locals,
    params: { id },
    request: new Request(`http://localhost/api/x/${id}`, {
      method: body === undefined ? "DELETE" : "PATCH",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  } as unknown as APIContext;
}

beforeAll(async () => {
  url = required("SUPABASE_TEST_URL");
  key = required("SUPABASE_TEST_KEY");
  password = required("GYMLOG_TEST_PASSWORD");

  accountA = await throwawayAccount("a");
  accountB = await throwawayAccount("b");

  const seeded = await accountA.client
    .from("exercises")
    .select("id")
    .is("user_id", null)
    .eq("name", "Deadlift")
    .single();
  if (seeded.error) {
    throw new Error(`could not read the seeded 'Deadlift': ${seeded.error.code} ${seeded.error.message}`);
  }
  exerciseIdA = seeded.data.id;

  const workout = await accountA.client
    .from("workouts")
    .insert({ user_id: accountA.userId, performed_on: TODAY, note: NOTE_A })
    .select("id")
    .single();
  if (workout.error) {
    throw new Error(`workout for A: ${workout.error.code} ${workout.error.message}`);
  }
  workoutIdA = workout.data.id;

  const entry = await accountA.client
    .from("exercise_entries")
    .insert({ user_id: accountA.userId, workout_id: workoutIdA, exercise_id: exerciseIdA })
    .select("id")
    .single();
  if (entry.error) {
    throw new Error(`entry for A: ${entry.error.code} ${entry.error.message}`);
  }

  const set = await accountA.client
    .from("sets")
    .insert({ user_id: accountA.userId, exercise_entry_id: entry.data.id, reps: 5, weight: 100, weight_unit: "kg" })
    .select("id")
    .single();
  if (set.error) {
    throw new Error(`set for A: ${set.error.code} ${set.error.message}`);
  }
  setIdA = set.data.id;
});

afterAll(async () => {
  // Per-run accounts, removed through the subject account's own client. No prefix sweep: this
  // project may never issue a query that could reach an address it did not create.
  for (const account of created) {
    const { error } = await account.client.rpc("delete_own_account");
    if (error) {
      throw new Error(`could not remove ${account.email}: ${error.code} ${error.message}`);
    }
  }

  // **Proven from outside, not assumed.** Nothing here can read `auth.users`, and a leaked per-run
  // account is invisible until somebody counts addresses in the dashboard months later — this
  // project has no `LIKE` sweep to clean one up with, deliberately. Signing in with a removed
  // address must fail; if it succeeds, teardown did not happen and the run must go red where the
  // leak was caused rather than nowhere at all.
  for (const account of created) {
    const probe = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await probe.auth.signInWithPassword({ email: account.email, password });
    if (data.session) {
      throw new Error(`${account.email} still signs in after teardown — the account was not removed.`);
    }
  }
});

describe("the middleware turns a cookie into an identity", () => {
  it("1. each account's own cookie derives that account, and a client with it", async () => {
    // The derivation at `middleware.ts:23-30`, driven by the only production call site of
    // `createClient` (`:18`). Two accounts in one assertion on purpose: `locals.user` being truthy
    // proves nothing, and one account cannot distinguish "the right identity" from "an identity".
    const a = await derive("http://localhost/dashboard", accountA.session.cookieHeader);
    const b = await derive("http://localhost/dashboard", accountB.session.cookieHeader);

    expect(a.harness.context.locals.user?.id).toBe(accountA.userId);
    expect(b.harness.context.locals.user?.id).toBe(accountB.userId);
    expect(accountA.userId).not.toBe(accountB.userId);

    expect(a.harness.context.locals.supabase).not.toBeNull();
    expect(b.harness.context.locals.supabase).not.toBeNull();

    // A protected route with a real user is handed on rather than redirected.
    expect(a.harness.redirectedTo).toEqual([]);
    expect(a.harness.reachedNext).toEqual(["/dashboard"]);
    expect(a.response).toBe(a.harness.nextResponse);
  });

  it("2. a cookie whose sub claim was rewritten is not an identity — and the same path with the original claims still is", async () => {
    // **The forgery.** A's session cookie, reassembled (chunked or not), the access token's `sub`
    // claim and the stored user id both rewritten to B, re-encoded, sent. `getUser()` puts the token
    // in front of the auth server, which checks a signature that no longer matches its payload.
    const forged = await reEncodeSession(accountA.session.cookieHeader, accountA.session.storageKey, (session) => {
      claimAnotherAccount(session, accountB.userId);
    });

    const attacked = await derive("http://localhost/dashboard", forged);
    // **First, and in this order deliberately.** `getUser()` "optimised" into `getSession()` reads
    // the stored session verbatim — no signature check anywhere in `__loadSession` — and hands the
    // rewritten id straight to `locals.user`. Asserted against B's id specifically so the mutation
    // fails naming the defect rather than reporting a truncated object where null was wanted.
    expect(attacked.harness.context.locals.user?.id).not.toBe(accountB.userId);
    expect(attacked.harness.context.locals.user).toBeNull();
    expect(attacked.response.status).toBe(302);
    expect(attacked.response.headers.get("Location")).toBe("/auth/signin");
    expect(attacked.harness.redirectedTo).toEqual(["/auth/signin"]);
    // Not rendered and then redirected: the request never reached the page at all.
    expect(attacked.harness.reachedNext).toEqual([]);

    // **THE POSITIVE CONTROL, and without it this test asserts nothing.** The identical
    // reassemble-and-re-encode path with the claims left alone must still authenticate. A tamper
    // that silently missed — a chunk dropped, an encoding mangled — produces exactly the same 302
    // as a tamper that was correctly refused.
    const untouched = await reEncodeSession(accountA.session.cookieHeader, accountA.session.storageKey, () => {
      /* the same journey, no edit */
    });

    const control = await derive("http://localhost/dashboard", untouched);
    expect(control.harness.context.locals.user?.id).toBe(accountA.userId);
    expect(control.harness.redirectedTo).toEqual([]);
  });
});

describe("an identity the middleware derived cannot reach another account's training", () => {
  it("3. B naming A's workout is answered 404 for both mutations, and A's workout survives", async () => {
    // The difference from `workout-mutations-rls.test.ts`: `locals` here was DERIVED BY THE
    // MIDDLEWARE FROM B'S COOKIE, not assembled by the test. Same endpoints, one fewer assumption.
    const b = await derive(`http://localhost/api/workouts/${workoutIdA}`, accountB.session.cookieHeader);
    expect(b.harness.context.locals.user?.id).toBe(accountB.userId);

    const patched = await patchWorkoutRoute(
      apiContext(b.harness.context.locals, workoutIdA, { performedOn: "2020-01-01", note: "taken over" }),
    );
    expect(patched.status).toBe(404);
    expect(((await patched.json()) as { code: string }).code).toBe("workout_not_found");

    const deleted = await deleteWorkoutRoute(apiContext(b.harness.context.locals, workoutIdA));
    expect(deleted.status).toBe(404);
    expect(((await deleted.json()) as { code: string }).code).toBe("workout_not_found");

    // **Persisted state, read back AS A.** Under RLS a zero-row update or delete reports success, so
    // a status code is not evidence about what is stored: the failure worth catching is a caller
    // told "nothing happened" while the write landed.
    const { data, error } = await accountA.client
      .from("workouts")
      .select("id, performed_on, note")
      .eq("user_id", accountA.userId)
      .eq("id", workoutIdA)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.performed_on).toBe(TODAY);
    expect(data?.note).toBe(NOTE_A);
  });

  it("4. the read path answers the same way, and its body carries none of A's identifiers", async () => {
    const b = await derive(`http://localhost/api/sets/${setIdA}/impact`, accountB.session.cookieHeader);

    const response = await setImpactRoute(apiContext(b.harness.context.locals, setIdA));
    expect(response.status).toBe(404);

    // The body, not the status, is what would leak: an impact answer names the set and the exercise
    // whose record is at stake, which is the records themselves one step removed.
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ code: "set_not_found" });
    expect(body).not.toContain(setIdA);
    expect(body).not.toContain(exerciseIdA);

    // A malformed id must answer 404 as well, never 500: Postgres answers `22P02` for a uuid column
    // handed something that is not one, and a 500 is a different fact about the system than "no such
    // row". `UUID_PATTERN` at `mutation-route.ts:53` is what keeps it from reaching a query.
    const malformed = await setImpactRoute(apiContext(b.harness.context.locals, "not-a-uuid"));
    expect(malformed.status).toBe(404);
    expect(((await malformed.json()) as { code: string }).code).toBe("set_not_found");
  });
});
