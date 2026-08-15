// The evidence for `account-deletion`: an account can delete ITSELF, everything keyed to it goes,
// and nothing else moves.
//
// **WHAT THIS SUITE OWNS.** `public.delete_own_account()` is the first RPC in this repository and the
// only function here that deliberately escapes RLS — `security definer`, because `authenticated`
// holds no privilege on `auth.users` and must never be given one. Everything that confines it is
// asserted below: it takes no parameters (6), `anon` cannot reach it (7), it deletes the caller's own
// exercises but not the shared catalogue (3), and it leaves other accounts alone (4).
//
// **THIS SUITE DELETES ACCOUNTS, WHICH MAKES IT THE MOST DANGEROUS FILE IN THE REPOSITORY.** Two
// address families must never be passed to the function, and nothing here would notice if they were —
// the damage would surface as a DIFFERENT suite failing on a LATER run:
//   * `rls-owner-a@` / `rls-owner-b@gymlog-test.dev` — the shared fixture pair twelve suites depend on;
//   * `s09i-a@`, `s09i-b@`, `s09i-signout@gymlog-test.dev` — the sibling slice's pool, made permanent
//     by its implementation review precisely because nothing could delete an `auth.users` row.
// Every account this file touches is created by this file, in this run, with the `s09d-` mark.
//
// **THE FIXTURES ARE THROWAWAY PER RUN, AND THE COST OF THAT IS REAL.** This is the first suite here
// able to clean up after itself, because the subject of the test is the cleanup mechanism. The price
// is that **when the function is broken, teardown is broken too — so a red run leaks accounts exactly
// when it fails**, which is the opposite of the usual failure mode. Accepted deliberately: the
// alternative (a fixed pool, as the sibling suite uses) would mean a suite about deleting accounts
// that may not delete its own, re-creating them in every test. The leak is bounded by how often this
// suite is red, and every leaked address carries the `s09d-` mark so it is identifiable later.
//
// MARK is `s09d-` — not a prefix of, and not prefixed by, any of the eleven marks in use
// (`s01-signup-`, `s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`, `s06-`, `s07-`,
// `s08-`, `s09i-`). Deliberately not `s09-`, which is a strict prefix of `s09i-` and of this one.
//
// **Rules this file follows** (`AGENTS.md` § Testing): `gymlog-test` only, with that project's
// publishable key; never a `service_role` key — `vitest.integration.config.ts` strips it, which is why
// the function had to exist at all; throw in `beforeAll` when a variable is missing, because a check
// must never skip its way to green.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { DELETE as deleteAccountRoute } from "@/pages/api/account/index";

const MARK = "s09d-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** What Postgres answers a role holding no `execute` grant on the function. */
const INSUFFICIENT_PRIVILEGE = "42501";
/** What PostgREST answers when no function matches the name and argument list. */
const NO_FUNCTION_MATCHES = "PGRST202";
/** The seeded catalogue, which no deletion may ever touch. */
const SEEDED_EXERCISE_COUNT = 38;

interface Account {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
}

let url: string;
let key: string;
let password: string;

/** Kept alive for the whole file: the account every "nothing else moved" claim is read back as. */
let survivor: Account;
let seededExerciseId: string;

/**
 * Every account this run created, so teardown can remove whatever the tests did not.
 *
 * Deleting an account twice is not an error worth failing on — the function raises `no_data_found`
 * and teardown moves on — so this list is deliberately append-only and never pruned by the tests.
 */
const created: Account[] = [];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

/** A brand-new account for this run alone. Never an existing address. */
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
  const account = { client, userId: data.session.user.id, email };
  created.push(account);
  return account;
}

/** A workout with one entry logging `exerciseId` and one set under it. */
async function logSomething(account: Account, exerciseId: string, label: string): Promise<void> {
  const workout = await account.client
    .from("workouts")
    .insert({ user_id: account.userId, performed_on: "2026-08-15", note: `${MARK}${label}-${RUN_ID}` })
    .select("id")
    .single();
  if (workout.error) throw new Error(`workout for ${label}: ${workout.error.code} ${workout.error.message}`);

  const entry = await account.client
    .from("exercise_entries")
    .insert({ user_id: account.userId, workout_id: workout.data.id, exercise_id: exerciseId })
    .select("id")
    .single();
  if (entry.error) throw new Error(`entry for ${label}: ${entry.error.code} ${entry.error.message}`);

  const set = await account.client
    .from("sets")
    .insert({
      user_id: account.userId,
      exercise_entry_id: entry.data.id,
      reps: 5,
      weight: 100,
      weight_unit: "kg",
    })
    .select("id")
    .single();
  if (set.error) throw new Error(`set for ${label}: ${set.error.code} ${set.error.message}`);
}

/** A private exercise owned by `account`. */
async function makePrivateExercise(account: Account, label: string): Promise<string> {
  const { data, error } = await account.client
    .from("exercises")
    .insert({
      user_id: account.userId,
      name: `${MARK}${label}-${RUN_ID}`,
      muscle_group: "legs",
      is_bodyweight: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  return data.id;
}

/**
 * The slice of `APIContext` the delete route actually reads.
 *
 * There is no request body and no route parameter — the account is named by `auth.uid()` inside the
 * database function — so this is `locals` and nothing else.
 */
function apiContext(account: Account): APIContext {
  return { locals: { supabase: account.client, user: { id: account.userId } } } as unknown as APIContext;
}

/** The same, for a caller the middleware would have bounced: a live client with no user. */
function anonymousContext(client: SupabaseClient<Database>): APIContext {
  return { locals: { supabase: client, user: null } } as unknown as APIContext;
}

beforeAll(async () => {
  url = required("SUPABASE_TEST_URL");
  key = required("SUPABASE_TEST_KEY");
  password = required("GYMLOG_TEST_PASSWORD");

  survivor = await throwawayAccount("survivor");

  // Read the seeded row as an AUTHENTICATED caller: `anon` holds no grant on public.exercises.
  const seeded = await survivor.client
    .from("exercises")
    .select("id")
    .is("user_id", null)
    .eq("name", "Deadlift")
    .single();
  if (seeded.error) {
    throw new Error(`could not read the seeded 'Deadlift': ${seeded.error.code} ${seeded.error.message}`);
  }
  seededExerciseId = seeded.data.id;

  // The survivor's own training, which every "nothing else moved" assertion reads back.
  await logSomething(survivor, seededExerciseId, "survivor");
});

afterAll(async () => {
  // Delete through the subject itself — the whole reason this suite can use throwaway accounts.
  // An account a test already removed raises `no_data_found` here; that is expected, not a failure.
  for (const account of created) {
    await account.client.rpc("delete_own_account");
  }
});

describe("account deletion: an account can remove itself", () => {
  it("1. an account holding a custom exercise with logged sets deletes cleanly", async () => {
    // **The regression guard for the deletion order.** The function deletes workouts (cascading to
    // entries and sets), then the account's own exercises, then auth.users. Deleting the exercises
    // first would meet `exercise_entries.exercise_id`'s `on delete restrict` head-on.
    //
    // Note what this assertion does NOT claim: that a bare `delete from auth.users` would fail here.
    // It was measured on 2026-08-15 and it succeeds — see the migration header. This asserts that the
    // ORDER the function actually uses works, which is the claim the product depends on.
    const victim = await throwawayAccount("custom");
    const ownExercise = await makePrivateExercise(victim, "custom");
    await logSomething(victim, ownExercise, "custom");

    const { error } = await victim.client.rpc("delete_own_account");
    expect(error).toBeNull();
  });

  it("2. an account holding only seeded exercises deletes cleanly", async () => {
    const victim = await throwawayAccount("seeded");
    await logSomething(victim, seededExerciseId, "seeded");

    const { error } = await victim.client.rpc("delete_own_account");
    expect(error).toBeNull();
  });

  it("3. the seeded catalogue is untouched by a deletion", async () => {
    // **The `is not distinct from` tripwire.** The function bypasses RLS, so the 38 shared rows are
    // protected inside it by nothing but `where user_id = caller` — `null = <uuid>` is NULL, so they
    // never match. A "null-safe" rewrite to `is not distinct from` would take the whole catalogue
    // with the first deletion, and no policy anywhere would stop it.
    const victim = await throwawayAccount("catalogue");
    await makePrivateExercise(victim, "catalogue");

    const { error } = await victim.client.rpc("delete_own_account");
    expect(error).toBeNull();

    const seeded = await survivor.client.from("exercises").select("id").is("user_id", null);
    expect(seeded.error).toBeNull();
    expect(seeded.data).toHaveLength(SEEDED_EXERCISE_COUNT);
  });

  it("4. another account's training is untouched by a deletion", async () => {
    // Asserted against re-read rows as the owner, per `AGENTS.md` § Access control: the failure worth
    // catching is a deletion that reached further than the account that asked for it.
    const before = await survivor.client
      .from("workouts")
      .select("id, exercise_entries(id, sets(id))")
      .eq("user_id", survivor.userId);
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(1);

    const victim = await throwawayAccount("bystander");
    await logSomething(victim, seededExerciseId, "bystander");
    const { error } = await victim.client.rpc("delete_own_account");
    expect(error).toBeNull();

    const after = await survivor.client
      .from("workouts")
      .select("id, exercise_entries(id, sets(id))")
      .eq("user_id", survivor.userId);
    expect(after.data).toHaveLength(1);
    expect(after.data?.[0].exercise_entries).toHaveLength(1);
    expect(after.data?.[0].exercise_entries[0].sets).toHaveLength(1);
  });

  it("5. the auth.users row is really gone, not merely unreadable", async () => {
    // **Proven without an admin key.** Nothing in this repository can read `auth.users`, so "the row
    // is gone" has to be established from outside: with confirmation off on gymlog-test, `signUp` on
    // a LIVE address fails, so a successful signup returning a DIFFERENT user id is external proof
    // that the original row went rather than merely becoming invisible.
    const victim = await throwawayAccount("resignup");
    const originalId = victim.userId;

    const { error } = await victim.client.rpc("delete_own_account");
    expect(error).toBeNull();

    const fresh = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const again = await fresh.auth.signUp({ email: victim.email, password });
    expect(again.error).toBeNull();
    expect(again.data.session).not.toBeNull();
    expect(again.data.session?.user.id).not.toBe(originalId);

    // The re-created account is a new account and teardown must remove it too.
    if (again.data.session) {
      created.push({ client: fresh, userId: again.data.session.user.id, email: victim.email });
    }
  });
});

describe("account deletion: the function cannot be aimed or borrowed", () => {
  it("6. a call carrying any argument is refused — there is no aim-able overload", async () => {
    // **The tripwire for somebody adding `delete_own_account(p_user_id uuid)` later.** The generated
    // types already say `Args: never`, so this would not compile through the typed client — which is
    // exactly why the runtime half needs its own assertion, reached through a deliberate cast.
    // The cast is on the CLIENT, not on the method: detaching `.rpc` from its object trips
    // `@typescript-eslint/unbound-method`, and the rule is right — a bound call is what we want here.
    const loose = survivor.client as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;
    };

    const { error } = await loose.rpc("delete_own_account", { user_id: survivor.userId });
    expect(error?.code).toBe(NO_FUNCTION_MATCHES);

    // And the caller still exists: a refused call must not have deleted anybody.
    const reread = await survivor.client.from("workouts").select("id").eq("user_id", survivor.userId);
    expect(reread.data).toHaveLength(1);
  });

  it("7. an unauthenticated caller is refused BY THE GRANT, and nothing is deleted", async () => {
    // **The `revoke ... from public` tripwire.** Supabase's implicit grant on TABLES goes to
    // anon/authenticated; the default EXECUTE grant on a FUNCTION goes to PUBLIC. Revoking from anon
    // and authenticated alone would leave this callable with no session at all.
    //
    // **THE MESSAGE IS ASSERTED, NOT JUST THE CODE, AND THAT IS THE WHOLE POINT OF THIS ASSERTION.**
    // Three defences stand between `anon` and a deletion — the missing EXECUTE grant, the null-uid
    // raise, and `where user_id = caller` — and the first two BOTH answer `42501`. Measured under the
    // Phase 1 mutation protocol: granting `execute` to `public` left this test green, because the
    // function then ran and its own null-uid guard raised `insufficient_privilege`, the same code.
    // Matching on the message is what tells the two apart, so this assertion now fails when the
    // grant is widened rather than silently accepting the second layer's answer.
    const anonymous = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { error } = await anonymous.rpc("delete_own_account");
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    // Postgres's own wording for a missing EXECUTE grant. The function's own guard says
    // "requires an authenticated caller" instead, which is what this must not match.
    expect(error?.message).toContain("permission denied for function");

    const reread = await survivor.client.from("workouts").select("id").eq("user_id", survivor.userId);
    expect(reread.data).toHaveLength(1);
  });
});

describe("account deletion: the endpoint", () => {
  it("8. DELETE /api/account removes the caller's account and answers 200", async () => {
    // Called as the exported handler with a real session, in the pattern of
    // `workout-endpoints.test.ts` — never through `astro dev`, whose `.dev.vars` point at PRODUCTION.
    const victim = await throwawayAccount("endpoint");
    await logSomething(victim, seededExerciseId, "endpoint");

    const response = await deleteAccountRoute(apiContext(victim));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deleted: boolean }).deleted).toBe(true);

    // The account is gone, proven from outside: signing the address up again succeeds with a new id.
    const fresh = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const again = await fresh.auth.signUp({ email: victim.email, password });
    expect(again.error).toBeNull();
    expect(again.data.session?.user.id).not.toBe(victim.userId);
    if (again.data.session) {
      created.push({ client: fresh, userId: again.data.session.user.id, email: victim.email });
    }

    // And nobody else's training moved.
    const reread = await survivor.client.from("workouts").select("id").eq("user_id", survivor.userId);
    expect(reread.data).toHaveLength(1);
  });

  it("9. an unauthenticated caller gets 401 and nothing is deleted", async () => {
    // `locals.user` null is a caller the middleware would have bounced — but an endpoint is reachable
    // directly and must not lean on a page guard.
    const response = await deleteAccountRoute(anonymousContext(survivor.client));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe("unauthenticated");

    const reread = await survivor.client.from("workouts").select("id").eq("user_id", survivor.userId);
    expect(reread.data).toHaveLength(1);
  });

  it("10. a missing Supabase client is refused rather than thrown", async () => {
    // The silent-failure class `AGENTS.md` § Cloudflare traps warns about: absent secrets make
    // `locals.supabase` null, and an endpoint that assumed otherwise would 500 on every request.
    const response = await deleteAccountRoute({
      locals: { supabase: null, user: { id: survivor.userId } },
    } as unknown as APIContext);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { code: string }).code).toBe("not_configured");
  });
});

// **THE BLOCKED PATH — THE ONE THING THIS SLICE OWNS — HAS NO END-TO-END TEST, AND THIS PARAGRAPH IS
// WRITTEN IN THE SAME WORDS THIS REPOSITORY USES TO REFUSE A DECORATIVE ONE.**
//
// The guarantee: when `exercise_entries.exercise_id`'s `on delete restrict` refuses the cascade into
// `public.exercises`, the caller is told so — `409 account_delete_blocked`, never a 500 and never a
// silent success — and every row survives, because the whole deletion is one transaction.
//
// **It cannot be reached from here, and the reason changed twice while this was being built.**
//   * The SAME-ACCOUNT route was the plan's expectation and does not exist: measured on 2026-08-15,
//     an account owning a custom exercise with a logged entry deletes cleanly (Progress 1.2), because
//     the RESTRICT check is itself an AFTER trigger queued behind the cascade that removes the
//     referencing rows. Assertion 1 above is what remains of that expectation, and it now guards the
//     deletion ORDER rather than a failure.
//   * The CROSS-ACCOUNT route — another account's entry pointing at this account's private exercise —
//     is refused at insert by `20260815090000`'s trigger for every `authenticated` caller, which is
//     the sibling slice's whole purpose. Building it needs `postgres` or `service_role`, and
//     `vitest.integration.config.ts` strips every credential but three.
//
// **No mutation available today breaks the guarantee**, because no caller reachable from this suite
// can put the database into the state it describes. What guards the half that can be checked is
// `src/lib/services/accounts.test.ts`: `23503` maps to `account_delete_blocked` and not to
// `unexpected`, hermetically, with the mapping mutated to confirm it fails. What that cannot prove is
// that Postgres raises `23503` on this path at all.
//
// The future edits that would make this testable, in the order they are likely: `RESTRICT` becoming
// `NO ACTION` on `exercise_entries.exercise_id`; the sibling trigger being dropped or narrowed; or a
// deliberately seeded hazard row. **Seeding one through a migration was considered and refused** —
// `npm run db:push` reaches production, so it would write a permanent, real block onto a real
// account's deletion in order to make a test possible.
//
// **TWO GUARDS IN `delete_own_account` HAVE NO TEST, AND THIS PARAGRAPH IS WRITTEN IN THE SAME WORDS
// THIS REPOSITORY USES TO REFUSE A DECORATIVE ONE** (`lessons.md` § "When a mutation does not break
// anything, fix the claim — never the test", and § "An assertion you keep because it cannot fail YET").
//
// The function stacks three defences against deleting the wrong rows. Only the outermost is testable
// from here, and assertion 7 above now guards it by message rather than by code.
//
//   1. **The EXECUTE grant** — guarded. Assertion 7. Measured: widening it to `public` turns that
//      assertion red on the message.
//   2. **The null-uid raise** — NOT guarded, and cannot be. Reaching it needs `auth.uid()` to be null
//      INSIDE the function, which requires a caller with no JWT — who is refused by layer 1 first.
//      An `authenticated` caller always has a uid. Measured: removing this raise breaks nothing.
//   3. **`where user_id = caller` on the exercises delete** — NOT guarded, and cannot be. Rewriting
//      it to `is not distinct from` is inert while a uid exists, because `<uuid> is not distinct from
//      NULL` is FALSE: the seeded rows are only matched when the caller is null, which layer 2
//      prevents and layer 1 prevents before that. Measured: the rewrite breaks nothing on its own.
//
// **There is a fourth layer, and it is the reason no combination of the first three is worth
// running as an experiment.** The zero-row raise at the end of the function makes the whole call
// ATOMIC: PostgREST executes an RPC in a transaction, so a caller that reaches the exercises delete
// with a null uid deletes the catalogue and is then rolled back by `no_data_found`, because
// `delete from auth.users where id = null` matches nothing. Destroying the seeded rows for real needs
// **all four** removed at once — the grant, the null raise, the owner-scoped predicate, and the
// zero-row raise.
//
// **So no mutation available today breaks layers 2 or 3, individually OR in the three-way
// combination.** That is defence in depth working exactly as intended, and it is also the reason this
// note exists instead of a test: the experiment that would prove layer 3 bites is one that destroys
// the 38 seeded rows every other suite depends on, and it is not worth running to confirm what the
// four layers already make unreachable. What would make them testable is any edit that legitimately
// admits a null-uid caller, or that removes the zero-row raise. There is none today; adding one
// should be read as making this note load-bearing rather than as a small convenience.
//
// Measured under the Phase 1 protocol: (c) alone breaks nothing, (d) alone breaks nothing — and the
// reason (d) is inert is worth knowing on its own, because it is not the obvious one:
// `<uuid> is not distinct from NULL` is FALSE, so the rewrite matches no seeded row while a real uid
// exists. It is dangerous only in the company of a null uid.
