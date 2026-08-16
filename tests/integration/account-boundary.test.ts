// The US-04 dossier for `cross-account-isolation`: everything this slice claims, in one file a
// reviewer can read end to end.
//
// **WHAT THIS SUITE OWNS.** `exercise_entries.exercise_id references public.exercises (id)` is a
// SINGLE-COLUMN foreign key and is not ownership-scoped. Foreign-key checks bypass RLS, and the
// insert policy only ever looks at the row in front of it — so until 2026-08-15 the database
// permitted an entry of account A's naming a PRIVATE exercise of account B's. The migration
// `20260815090000_scope_exercise_entries_to_visible_exercises.sql` refuses that row with a
// `security invoker` trigger whose visibility check IS the `exercises` select policy. Assertions 1
// and 2 are what would notice the trigger being dropped, restricted to `insert` alone, or flipped to
// `security definer` — the last of which disables it while looking unchanged.
//
// **AND US-04'S THIRD CRITERION, WHICH NOTHING IN THIS REPOSITORY ASSERTED BEFORE.** "Signing out
// and returning requires authenticating again" is assertion 6. `workout-endpoints.test.ts`'s
// "refuses an unauthenticated caller at every level" is a different claim and does not cover it: it
// hands a handler `user: null`, which is a caller that never had a session. Assertion 6 signs a real
// one out and retries the identical read with the same client. Read its comment for what that does
// and does not prove — a JWT is stateless and the distinction matters.
//
// **Assertion 7 checks what the caller is TOLD when the trigger refuses**, which is a property of
// `src/pages/api/exercise-entries/index.ts` rather than of the database: the same `404
// exercise_not_found` an exercise that does not exist already gets, so the refusal is no existence
// oracle. It answers that today with no branch of its own, because the trigger raises `23503` and
// its message does not name `exercise_entries_workout_owner_fkey`. Both halves of that sentence are
// load-bearing and neither is obvious from reading the endpoint.
//
// **WHAT THIS SUITE DOES NOT RESTATE.** Cross-account reads, updates and deletes at all three levels
// of the training record are already proven and are not duplicated here. Cited by title text rather
// than by position, because a positional citation rots the moment somebody inserts a test:
//   * `tests/integration/workout-log-rls.test.ts` — "one account cannot read another's workout by
//     naming its id", the insert carrying another account's `user_id`, and the two graft attempts;
//   * `tests/integration/workout-mutations-rls.test.ts` — every cross-account update and delete,
//     each paired with a read-back as the row's owner;
//   * `tests/integration/workout-page-access.test.ts`, `exercises-rls.test.ts`, `profiles-rls.test.ts`,
//     `profile-mutations-rls.test.ts`, and the per-view probes in `personal-records.test.ts`,
//     `weekly-tonnage.test.ts` and `tonnage-breakdown.test.ts`.
//
// **THE SEAM WITH `account-deletion` IS PROSE HERE, NOT AN ASSERTION, AND THAT IS DELIBERATE.**
// `exercises.user_id` cascades from `auth.users`, so deleting account B cascades into B's private
// exercises — and `exercise_entries.exercise_id`'s `on delete restrict` then BLOCKS that cascade.
// One account could therefore permanently prevent another from deleting their own account, which the
// PRD keeps in scope as a baseline data-protection duty. Refusing the hazard row at the source
// removes the only way an account could do that to a stranger. **No assertion in this repository can
// check it**, and writing one that appeared to would be worse than the gap (`lessons.md` § "A guard
// you have not mutated may not guard"): deleting an account needs `auth.admin.deleteUser` and a
// `service_role` key, which `AGENTS.md` forbids and `vitest.integration.config.ts` actively strips
// from the process; and the weaker form is unreachable too, because under RLS the hazard row is by
// construction visible to neither account. **No mutation available today breaks the guarantee.** The
// future edit that would make it testable is `account-deletion` landing a deletion path — at which
// point the assertion belongs in that slice's suite, not here. Assertion 5 below is the nearest
// assertable neighbour and claims nothing more than its own title.
//
// **Rules this file follows** (`AGENTS.md` § Testing): `gymlog-test` only, with that project's
// publishable key; never a `service_role` key; throw in `beforeAll` when a variable is missing,
// because a check must never skip its way to green.
//
// MARK is `s09i-` — not a prefix of, and not prefixed by, any of the twelve marks this repository
// uses (`s01-signup-`, `s02-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`,
// `s06-`, `s07-`, `s08-`, `s09d-`). Deliberately not `s09-`, which is a strict prefix of this one and
// of the sibling slice's `s09d-`. **The list is the thing that rots** — it was written naming ten and
// silently omitted `s02-` (`exercises-rls.test.ts:94`), so anyone picking a new mark from it was
// checking against an incomplete set. Re-derive it with `grep -rn "const MARK" tests/integration/`
// rather than trusting this line.
//
// **This suite owns its three accounts and never touches `rls-owner-a/b`.** Every other suite
// shares that fixture pair, and the sibling slice `account-deletion` is developing in a parallel
// worktree against the same `gymlog-test`. The third account exists because assertion 6 deliberately
// ends its account's session, which no other assertion may inherit.
//
// **They are a FIXED POOL, not throwaway accounts per run, and the reason is durability rather than
// tidiness.** Run-unique addresses looked safer — nothing another run could collide with — but at the
// time nothing in this repository could delete an `auth.users` row (that needed `auth.admin.deleteUser`
// and a `service_role` key, which `vitest.integration.config.ts` strips), so every run leaked three
// accounts permanently; and an interrupted run's ROWS were worse still, because no later run knew
// those account ids and RLS hides them from every other account. Fixed addresses plus the
// `beforeAll` reset below make the garbage self-healing, which is the reason every sibling RLS suite
// resets at the START of a run (`workout-log-rls.test.ts`, `exercises-rls.test.ts`). Run-uniqueness
// is kept where it is actually load-bearing — in the row MARKS, via `RUN_ID`.
//
// **That premise stopped being true on 2026-08-15 and this pool stays anyway.** `delete_own_account()`
// (`20260815140000_delete_own_account.sql`) lets a caller delete its OWN account with no
// `service_role` key, so a per-run account is now disposable and new suites should prefer one. What
// it does not do is rescue an INTERRUPTED run: the cleanup call is the thing that did not happen, and
// the orphaned account is the only thing that could have made it. The self-healing `beforeAll` reset
// below is what covers that, which is why this suite keeps its fixed pool rather than being converted.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { POST as addEntryRoute } from "@/pages/api/exercise-entries/index";

const MARK = "s09i-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Raised by the trigger, and by the plain foreign keys it now fires ahead of. */
const FOREIGN_KEY_VIOLATION = "23503";
/** What Postgres answers a role holding no grant on the table — assertion 6's signed-out client. */
const INSUFFICIENT_PRIVILEGE = "42501";
/** What the `not null` constraint on `exercise_id` answers — assertion 8. */
const NOT_NULL_VIOLATION = "23502";

interface Account {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
}

/** This suite's three fixed accounts, created on the first run that needs them and reused after. */
const ADDRESSES = {
  a: `${MARK}a@gymlog-test.dev`,
  b: `${MARK}b@gymlog-test.dev`,
  signout: `${MARK}signout@gymlog-test.dev`,
} as const;

let accountA: Account;
let accountB: Account;
/** Assertion 6's account, and only its. It is the one whose session gets ended. */
let accountC: Account;

/**
 * Kept so `afterAll` can re-authenticate before deleting.
 *
 * Assertion 6 signs `accountC` out, and a signed-out client cannot delete its own rows — so
 * teardown would leak whatever that account created, silently, and only for the runs where it got
 * that far. Re-authenticating in teardown rather than at the end of the assertion keeps that true
 * when the assertion FAILS partway, which is exactly when a leak is least welcome.
 */
let accountPassword: string;

/**
 * Every account this run actually reached, in order.
 *
 * `beforeAll` and `afterAll` iterate THIS rather than `[accountA, accountB, accountC]`: when
 * `beforeAll` dies partway — the second sign-in rate-limited, say — the later bindings are still
 * unassigned, and a hook reaching through one would replace a legible setup failure with a
 * TypeError.
 */
const accounts: Account[] = [];

/** A's private exercise: the row B must never be able to point an entry at. */
let aPrivateExerciseId: string;
/** A seeded catalogue row (`user_id is null`), which both accounts must still be able to use. */
let seededExerciseId: string;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

/**
 * One of this suite's three accounts: signed in if it exists, created if it does not.
 *
 * Sign-in first, in the shape `workout-log-rls.test.ts` established, so the first run creates the
 * account and every later run reuses it. `signUp` returns a session because email confirmation is
 * OFF on `gymlog-test`, which `auth-flows.test.ts` assertion 1 is the tripwire for — and a created
 * account with no session means somebody switched it on, which breaks every suite that bootstraps
 * without an inbox.
 */
async function authenticate(url: string, key: string, password: string, email: string): Promise<Account> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.data.session) {
    const account = { client, userId: signIn.data.session.user.id, email };
    accounts.push(account);
    return account;
  }

  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) {
    throw new Error(
      `could not sign in or sign up ${email}. Sign-in said "${signIn.error?.message ?? "no session"}"; ` +
        `sign-up said "${signUp.error.message}".`,
    );
  }
  if (!signUp.data.session) {
    throw new Error(
      `${email} was created without a session. Email confirmation has been switched on for ` +
        `gymlog-test, which breaks every suite that bootstraps an account without an inbox.`,
    );
  }
  const account = { client, userId: signUp.data.session.user.id, email };
  accounts.push(account);
  return account;
}

/** A private exercise owned by `account`. Never seeded: `exercises-rls.test.ts` counts those. */
async function makePrivateExercise(account: Account, label: string): Promise<string> {
  const { data, error } = await account.client
    .from("exercises")
    .insert({ user_id: account.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "legs", is_bodyweight: false })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  }
  return data.id;
}

/** A workout of `account`'s, marked so teardown can find it. */
async function makeWorkout(account: Account, label: string): Promise<string> {
  const { data, error } = await account.client
    .from("workouts")
    .insert({ user_id: account.userId, performed_on: "2026-08-15", note: `${MARK}${label}-${RUN_ID}` })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' workout: ${error.code} ${error.message}`);
  }
  return data.id;
}

/** Every entry of `account`'s under one workout, read back as its owner. */
async function readEntries(account: Account, workoutId: string) {
  const { data, error } = await account.client
    .from("exercise_entries")
    .select("id, exercise_id")
    .eq("user_id", account.userId)
    .eq("workout_id", workoutId);
  if (error) {
    throw new Error(`could not re-read the entries of ${workoutId}: ${error.code} ${error.message}`);
  }
  return data;
}

/**
 * The slice of `APIContext` the entry endpoint actually reads, in the shape
 * `tests/integration/workout-endpoints.test.ts` established.
 *
 * Never over HTTP: `astro dev` reads its Supabase credentials from `.dev.vars`, which point at
 * PRODUCTION, and no process-env override displaces them.
 */
function apiContext(body: unknown, account: Account): APIContext {
  return {
    locals: { supabase: account.client, user: { id: account.userId } },
    request: new Request("http://localhost/api/exercise-entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

/**
 * Say so when a cleanup call fails, rather than leaking in silence.
 *
 * Every statement in `sweep` is fire-and-forget by nature — there is nothing to assert about a
 * delete that matched nothing. But a FAILED delete is different: the rows survive, and with them
 * the `on delete restrict` that makes the next statement fail too. Unread, that is a suite which
 * starts failing later for a reason that happened here.
 */
function report(what: string, error: { code?: string; message: string } | null): void {
  if (error) {
    // eslint-disable-next-line no-console -- a silent cleanup failure is the thing being prevented
    console.warn(`[account-boundary] ${what} failed: ${error.code ?? "?"} ${error.message}`);
  }
}

/**
 * Remove every row this suite has ever written, across all three accounts.
 *
 * Run at the START of a run as well as at the end. **Teardown protects the happy path; only setup
 * protects the next run** (`lessons.md` § "A `finally` that restores shared state does not survive
 * a killed process") — and with fixed accounts an interrupted run's rows are reachable again,
 * which is the whole reason those accounts stopped being throwaway.
 *
 * Two passes, and the order is not tidiness: `exercise_id` carries `on delete restrict`, so an
 * exercise cannot go while an entry still points at it, and deleting a workout is what cascades the
 * entries away. Across accounts as well as within one, because the pass is cheap and the ordering
 * argument does not depend on which account owns what.
 */
async function sweep(): Promise<void> {
  for (const account of accounts) {
    const { error } = await account.client
      .from("workouts")
      .delete()
      .like("note", `${MARK}%`)
      .eq("user_id", account.userId);
    report(`clearing ${account.email}'s workouts`, error);
  }
  for (const account of accounts) {
    const { error } = await account.client
      .from("exercises")
      .delete()
      .like("name", `${MARK}%`)
      .eq("user_id", account.userId);
    report(`clearing ${account.email}'s exercises`, error);
  }
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  accountPassword = required("GYMLOG_TEST_PASSWORD");

  accountA = await authenticate(url, key, accountPassword, ADDRESSES.a);
  accountB = await authenticate(url, key, accountPassword, ADDRESSES.b);
  accountC = await authenticate(url, key, accountPassword, ADDRESSES.signout);

  await sweep();

  aPrivateExerciseId = await makePrivateExercise(accountA, "a-private");

  // Pinned by name rather than "any seeded row": with `.limit(1)` and no `order by`, which of the
  // 38 comes back is unspecified, so a failure would name a different exercise on different runs.
  const seeded = await accountB.client
    .from("exercises")
    .select("id")
    .is("user_id", null)
    .eq("name", "Deadlift")
    .single();
  if (seeded.error) {
    throw new Error(`could not read the seeded 'Deadlift': ${seeded.error.code} ${seeded.error.message}`);
  }
  seededExerciseId = seeded.data.id;
});

afterAll(async () => {
  // Assertion 6 ends one of these sessions on purpose, and a signed-out client deletes nothing —
  // so re-authenticate every account first. Unconditional rather than conditional: signing in a
  // client that already has a session simply replaces it, and the alternative is teardown that
  // depends on which assertions ran.
  for (const account of accounts) {
    const { error } = await account.client.auth.signInWithPassword({
      email: account.email,
      password: accountPassword,
    });
    report(`re-authenticating ${account.email}`, error);
  }

  await sweep();
});

describe("account boundary: an entry cannot name an exercise the account cannot see", () => {
  it("1. account B cannot insert an entry naming account A's private exercise", async () => {
    // **The defect this slice exists to close.** B's own user_id, B's own workout, A's private
    // exercise: the insert policy passes — it never looks at the exercise — and the foreign key
    // passes, because FK checks bypass RLS and the row does exist. Only the trigger refuses it.
    const workoutId = await makeWorkout(accountB, "insert");

    const attempt = await accountB.client
      .from("exercise_entries")
      .insert({ user_id: accountB.userId, workout_id: workoutId, exercise_id: aPrivateExerciseId })
      .select("id");

    expect(attempt.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    // Non-vacuity: this is OUR trigger refusing, not some other 23503 from the same statement. The
    // message names the exercise, which no plain foreign-key violation does.
    expect(attempt.error?.message).toContain(aPrivateExerciseId);
    expect(attempt.data).toBeNull();

    // **Asserted against persisted state, not against the response.** `AGENTS.md` § Access control:
    // the failure worth catching is a caller told "nothing happened" while the write landed.
    expect(await readEntries(accountB, workoutId)).toEqual([]);
  });

  it("2. account B cannot update its own entry onto account A's private exercise", async () => {
    // The same hazard through a second door. `exercise_entries` carries an UPDATE policy, so B may
    // rewrite a row it owns — and re-pointing `exercise_id` would reach exactly the row assertion 1
    // refuses at insert. This is what `or update of exercise_id` on the trigger is for; dropping it
    // leaves assertion 1 green and this one red.
    const workoutId = await makeWorkout(accountB, "update");
    const created = await accountB.client
      .from("exercise_entries")
      .insert({ user_id: accountB.userId, workout_id: workoutId, exercise_id: seededExerciseId })
      .select("id")
      .single();
    expect(created.error).toBeNull();

    const attempt = await accountB.client
      .from("exercise_entries")
      .update({ exercise_id: aPrivateExerciseId })
      .eq("user_id", accountB.userId)
      .eq("id", created.data?.id ?? "")
      .select("id");

    expect(attempt.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(attempt.error?.message).toContain(aPrivateExerciseId);

    // The entry still names what it named before. A zero-row UPDATE under RLS reports success, so
    // "it was refused" and "it was silently applied to nothing" have to be told apart by re-reading.
    const after = await readEntries(accountB, workoutId);
    expect(after).toHaveLength(1);
    expect(after[0].exercise_id).toBe(seededExerciseId);
  });
});

describe("account boundary: the trigger admits everything it should", () => {
  it("3. a seeded exercise is still usable by both accounts", async () => {
    // **The whole reason a composite foreign key could not be used.** The 38 seeded rows have
    // `user_id is null`, and FK matching is equality, so `NULL = NULL` would never match. If the
    // trigger's existence query were tightened into a restated owner check, this is what breaks —
    // and it breaks the catalogue for every account, not just for a test.
    for (const account of [accountA, accountB]) {
      const workoutId = await makeWorkout(account, "seeded");
      const { data, error } = await account.client
        .from("exercise_entries")
        .insert({ user_id: account.userId, workout_id: workoutId, exercise_id: seededExerciseId })
        .select("id, exercise_id")
        .single();

      expect(error).toBeNull();
      expect(data?.exercise_id).toBe(seededExerciseId);
    }
  });

  it("4. an account's own private exercise is still usable by that account", async () => {
    const workoutId = await makeWorkout(accountA, "own-private");

    const { data, error } = await accountA.client
      .from("exercise_entries")
      .insert({ user_id: accountA.userId, workout_id: workoutId, exercise_id: aPrivateExerciseId })
      .select("id, exercise_id")
      .single();

    expect(error).toBeNull();
    expect(data?.exercise_id).toBe(aPrivateExerciseId);
  });

  it("5. an account can still delete its own unused private exercise", async () => {
    // The assertable neighbour of the seam described in this file's header, and it claims exactly
    // what its title says and nothing about account deletion. `on delete restrict` binds only while
    // something references the row; an exercise with no entries is still the owner's to remove, and
    // the trigger — which fires on `exercise_entries`, not here — does not change that.
    const exerciseId = await makePrivateExercise(accountA, "unused");

    const removed = await accountA.client
      .from("exercises")
      .delete()
      .eq("user_id", accountA.userId)
      .eq("id", exerciseId)
      .select("id");

    // `.select()` rather than the status alone: a delete matching zero rows also reports success.
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);

    const reread = await accountA.client.from("exercises").select("id").eq("id", exerciseId);
    expect(reread.data).toEqual([]);
  });
});

describe("account boundary: signing out ends access to the training record", () => {
  it("6. after signOut the same client can no longer read the workout it had just read", async () => {
    // **US-04's third criterion, and the only one nothing in this repository asserted.**
    //
    // What this proves and what it does not, stated precisely because the difference is invisible
    // from the assertion: an access token is a stateless JWT and stays cryptographically valid
    // until it expires — `signOut` cannot recall one. What it ends is the SESSION the client holds
    // and the refresh token behind it, after which this client authenticates as nobody and the
    // grants decide. That is the same mechanism a browser sign-out uses, because `@supabase/ssr`
    // keeps the session in cookies and `/api/auth/signout` clears it. So the claim here is at the
    // session level; the title says "client", not "screen".
    //
    // Distinct from `workout-endpoints.test.ts`'s "refuses an unauthenticated caller at every
    // level", which hands a handler `user: null` — a caller that never had a session at all.
    const workoutId = await makeWorkout(accountC, "signout");

    const before = await accountC.client
      .from("workouts")
      .select("id, note")
      .eq("user_id", accountC.userId)
      .eq("id", workoutId);
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(1);

    const { error: signOutError } = await accountC.client.auth.signOut();
    expect(signOutError).toBeNull();
    expect((await accountC.client.auth.getUser()).data.user).toBeNull();

    // The identical read, on the same client. `anon` holds no grant on `workouts` and no policy
    // names it — `revoke all ... from anon, authenticated` before the grant, in the migration that
    // created the table — so this is refused before RLS is even reached.
    const after = await accountC.client
      .from("workouts")
      .select("id, note")
      .eq("user_id", accountC.userId)
      .eq("id", workoutId);
    expect(after.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    // Refused AND empty-handed: "the read failed" and "the read returned the row anyway" are two
    // different outcomes, and only one of them is a leak.
    expect(after.data ?? []).toEqual([]);
  });
});

describe("account boundary: what the endpoint tells a caller the trigger refused", () => {
  it("7. POST /api/exercise-entries answers 404 exercise_not_found, not 500 and not workout_not_found", async () => {
    // **The endpoint needs no branch for this, and that is the assertion — not an assumption.**
    // `src/pages/api/exercise-entries/index.ts` already maps a 23503 onto a 404, choosing between
    // `workout_not_found` and `exercise_not_found` by whether the message names
    // `exercise_entries_workout_owner_fkey`. The trigger raises `foreign_key_violation` and names
    // the exercise instead, so it lands on `exercise_not_found` — the same answer an exercise that
    // genuinely does not exist gets, which is what keeps the refusal from being an existence
    // oracle. Change the raised code and this fails as `500 unexpected`; make the message mention
    // that constraint and it fails as `workout_not_found`.
    const workoutId = await makeWorkout(accountB, "endpoint");

    const response = await addEntryRoute(apiContext({ workoutId, exerciseId: aPrivateExerciseId }, accountB));

    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("exercise_not_found");

    // Persisted state, not the response: the refusal has to have written nothing.
    expect(await readEntries(accountB, workoutId)).toEqual([]);
  });
});

describe("account boundary: the trigger answers only the question it was asked", () => {
  it("8. a null exercise_id is refused by the not-null constraint, not by the visibility trigger", async () => {
    // **The guard added by `20260815120000`, and the assertion that would notice it being removed.**
    // `not null` is enforced in ExecConstraints, which runs AFTER `before row` triggers — so without
    // the short-circuit the trigger sees `new.exercise_id is null`, finds no such exercise, and
    // raises `23503` with an empty id in the message. `/api/exercise-entries` would then answer
    // `404 exercise_not_found` for a write that is malformed rather than pointed at a hidden row:
    // a different fact about the system, told to whoever reads the log.
    //
    // Unreachable through the endpoint — `parseAddExerciseEntry` requires a uuid — which is exactly
    // why it needs an assertion at this level, where PostgREST is spoken to directly.
    const workoutId = await makeWorkout(accountB, "null-exercise");

    const attempt = await accountB.client
      .from("exercise_entries")
      // The generated types type `exercise_id` as a required string, correctly: no application code
      // may write null here. The cast is the point of the test — it reaches the database the way a
      // hand-written PostgREST call would.
      .insert({ user_id: accountB.userId, workout_id: workoutId, exercise_id: null as unknown as string })
      .select("id");

    expect(attempt.error?.code).toBe(NOT_NULL_VIOLATION);
    expect(await readEntries(accountB, workoutId)).toEqual([]);
  });
});
