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
// MARK is `s09i-` — not a prefix of, and not prefixed by, any existing mark (`s01-signup-`, `s03-`,
// `s03-endpoints-`, `s03-page-`, `s07-`, `s08-`). Deliberately not `s09-`, which is a strict prefix
// of this one and of anything the sibling slice picks.
//
// **This suite owns its accounts and never touches `rls-owner-a/b`.** Two throwaway accounts per
// run: every other suite shares that fixture pair, and the sibling slice `account-deletion` is
// developing in a parallel worktree against the same `gymlog-test`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const MARK = "s09i-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Raised by the trigger, and by the plain foreign keys it now fires ahead of. */
const FOREIGN_KEY_VIOLATION = "23503";

interface Account {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
}

let accountA: Account;
let accountB: Account;

/**
 * Every account this run actually created, in creation order.
 *
 * `afterAll` iterates THIS rather than `[accountA, accountB]`: when `beforeAll` dies partway — the
 * second signup rate-limited, say — the second binding is still unassigned, and teardown reaching
 * through it would replace a legible setup failure with a TypeError from a hook.
 */
const created: Account[] = [];

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
 * A brand-new account, created for this run alone.
 *
 * `signUp` returns a session because email confirmation is OFF on `gymlog-test`, which
 * `auth-flows.test.ts` assertion 1 is the tripwire for.
 */
async function throwawayAccount(url: string, key: string, password: string, role: string): Promise<Account> {
  const email = `${MARK}${role}-${RUN_ID}@gymlog-test.dev`;
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
  created.push(account);
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

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  accountA = await throwawayAccount(url, key, password, "a");
  accountB = await throwawayAccount(url, key, password, "b");

  // No fixture reset: both accounts were created seconds ago and own nothing else. That is the
  // point of throwaway accounts — `lessons.md` § "A `finally` that restores shared state does not
  // survive a killed process" applies to SHARED fixtures, and this suite has none.
  aPrivateExerciseId = await makePrivateExercise(accountA, "a-private");

  const seeded = await accountB.client.from("exercises").select("id").is("user_id", null).limit(1).single();
  if (seeded.error) {
    throw new Error(`could not read a seeded exercise: ${seeded.error.code} ${seeded.error.message}`);
  }
  seededExerciseId = seeded.data.id;
});

afterAll(async () => {
  // Workouts before exercises, for both accounts: `exercise_id` carries `on delete restrict`, and
  // deleting a workout cascades to its entries and sets, which is what releases it.
  for (const account of created) {
    await account.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", account.userId);
  }
  for (const account of created) {
    await account.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", account.userId);
  }
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
