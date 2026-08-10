// Proves the dual-visibility boundary on `public.exercises` at the level the database enforces it.
//
// This table is the first that is NOT "one row, one owner": rows with `user_id is null` are the
// seeded catalogue every account reads, and rows with an owner are private to that account. The
// select policy carries that split; the three write policies do not, and the reason is subtle
// enough that assertion 4 exists solely to pin it down — see there.
//
// Same two rules as profiles-rls.test.ts:
//   * every negative assertion is paired with a re-read AS A CALLER ENTITLED TO SEE THE ROW. The
//     failure US-04 warns about is a caller told "nothing happened" while the write landed, and a
//     status code cannot tell those apart.
//   * the suite authenticates ONLY to gymlog-test, with that project's publishable key. Never a
//     service_role key, and no production credential exists in this process at all.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

// The same fixture accounts as the RLS suite: they are stable, and this suite only adds rows it
// owns and removes them itself, so it cannot disturb the profile assertions.
const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

// Unique per run, so a run that dies before cleanup cannot make the next one fail for a reason
// unrelated to the code under test.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;
let anonymous: SupabaseClient<Database>;

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

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);
  anonymous = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Clear this suite's own rows from any previous run. Scoped by the name prefix so it can never
  // touch the real seed (Phase 2) or a row somebody added by hand.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("exercises").delete().like("name", "s02-%").eq("user_id", owner.userId);
  }
});

describe("exercises: the private half", () => {
  it("1. an account can create and read its own exercise", async () => {
    const name = `s02-own-${RUN_ID}`;
    const insert = await ownerA.client
      .from("exercises")
      .insert({ user_id: ownerA.userId, name, muscle_group: "back", is_bodyweight: false })
      .select()
      .single();

    expect(insert.error).toBeNull();
    expect(insert.data?.name).toBe(name);
    expect(insert.data?.user_id).toBe(ownerA.userId);
  });

  it("2. the other account cannot see it, and still sees its own catalogue", async () => {
    const name = `s02-private-${RUN_ID}`;
    const created = await ownerA.client
      .from("exercises")
      .insert({ user_id: ownerA.userId, name, muscle_group: "chest" })
      .select()
      .single();
    expect(created.error).toBeNull();

    // B naming A's row directly gets nothing.
    const asB = await ownerB.client
      .from("exercises")
      .select("id")
      .eq("id", created.data?.id ?? "");
    expect(asB.error).toBeNull();
    expect(asB.data).toHaveLength(0);

    // Non-vacuous: B can still see its own rows, so the empty result above is filtering rather
    // than a broken client or a table nobody can read.
    const bOwn = `s02-b-own-${RUN_ID}`;
    const bCreated = await ownerB.client
      .from("exercises")
      .insert({ user_id: ownerB.userId, name: bOwn, muscle_group: "legs" })
      .select()
      .single();
    expect(bCreated.error).toBeNull();
    const bSees = await ownerB.client
      .from("exercises")
      .select("id")
      .eq("id", bCreated.data?.id ?? "");
    expect(bSees.data).toHaveLength(1);
  });

  it("5. an account cannot insert a row owned by somebody else", async () => {
    const name = `s02-forged-${RUN_ID}`;
    const attempt = await ownerA.client
      .from("exercises")
      .insert({ user_id: ownerB.userId, name, muscle_group: "arms" });

    expect(attempt.error?.code).toBe("42501");

    // The half that matters: re-read as the account it was forged onto.
    const asB = await ownerB.client.from("exercises").select("id").eq("name", name);
    expect(asB.error).toBeNull();
    expect(asB.data).toHaveLength(0);
  });

  it("8. an account can update and delete its own row", async () => {
    // Without this, every negative assertion above would pass against a table nobody can use.
    const name = `s02-mine-${RUN_ID}`;
    const created = await ownerA.client
      .from("exercises")
      .insert({ user_id: ownerA.userId, name, muscle_group: "core" })
      .select()
      .single();
    expect(created.error).toBeNull();
    const id = created.data?.id ?? "";

    const renamed = `${name}-renamed`;
    const update = await ownerA.client.from("exercises").update({ name: renamed }).eq("id", id);
    expect(update.error).toBeNull();

    const reread = await ownerA.client.from("exercises").select("name").eq("id", id);
    expect(reread.data?.[0]?.name).toBe(renamed);

    const remove = await ownerA.client.from("exercises").delete().eq("id", id);
    expect(remove.error).toBeNull();

    const gone = await ownerA.client.from("exercises").select("id").eq("id", id);
    expect(gone.data).toHaveLength(0);
  });
});

describe("exercises: the shared half", () => {
  it("4. no account can create a seeded row — the protection nothing states out loud", async () => {
    // THE assertion of this suite. `with check ((select auth.uid()) = user_id)` on a row whose
    // user_id is null evaluates to NULL, not TRUE, and a policy admits a row only on TRUE — so the
    // ordinary owner check already makes the shared catalogue unwritable, without naming it.
    //
    // That is correct and completely invisible in the policy text. A later migration introducing
    // coalesce() or `is not distinct from` would hand every account write access to the catalogue
    // every other account reads, and this is the only thing that would say so. Do not delete it
    // as redundant.
    const before = await ownerA.client.from("exercises").select("id").is("user_id", null);
    expect(before.error).toBeNull();
    const countBefore = before.data?.length ?? 0;

    const attempt = await ownerA.client
      .from("exercises")
      .insert({ user_id: null, name: `s02-forged-seed-${RUN_ID}`, muscle_group: "legs" });

    expect(attempt.error?.code).toBe("42501");

    const after = await ownerA.client.from("exercises").select("id").is("user_id", null);
    expect(after.data?.length ?? 0).toBe(countBefore);
  });

  // Assertions 3, 6 and 7 — that a seeded row is readable by both accounts and writable by
  // neither — arrive in PHASE 2, with the seed they need.
  //
  // They were written here first and removed, deliberately, because the plan asked them to run
  // against "a row inserted for the test with user_id = null" and **no client in this suite can
  // create such a row** — which is precisely what assertion 4 above proves. Guarding them with
  // `if (!seededId) return;` made three tests report green while asserting nothing, which is the
  // failure this project already recorded as a lesson after F-03: a guard you have not mutated may
  // not guard. An empty test is worse than a missing one, because it looks like coverage.
});

describe("exercises: the anonymous caller", () => {
  it("9. has no read path at all", async () => {
    const { data, error } = await anonymous.from("exercises").select("*");

    // With `revoke all ... from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});
