// Proves the row-ownership boundary on `public.profiles` at the level the database enforces it.
//
// Two rules govern everything here:
//   * every negative assertion is paired with a re-read AS THE ROW'S OWNER. The failure US-04
//     warns about is a caller that sees a friendly error while the write silently landed, and a
//     status code cannot tell those apart.
//   * the suite authenticates ONLY to gymlog-test, with that project's publishable key. Never a
//     service_role key (a check that bypasses RLS proves nothing), and no production credential
//     exists here at all — the suite must be incapable of reaching production, not merely
//     disinclined to.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const DEFAULTS = {
  timezone: "Europe/Warsaw",
  weight_unit: "kg",
  estimation_formula: "brzycki",
} as const;

// Hardcoded and prefixed, not secret: S-09 needs to find them to clean them up.
const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

// Unique per run, so assertion 7 can tell its own write apart from a stale value left by a
// previous run that died before restoring.
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

/** Signs in, falling back to sign-up, so the suite bootstraps its fixtures once and reuses them. */
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

  // Fixture reset. Without it, a run that dies between assertion 7's write and its restore leaves
  // a fixture row holding a test value permanently, and every later run fails assertion 1 for a
  // reason unrelated to the code under test — repairable only by hand-written SQL.
  //
  // An update, never an upsert: it affects zero rows when no row exists, so it cannot manufacture
  // the row assertion 1 is there to find. The trigger, not the setup, still has to have created it.
  for (const owner of [ownerA, ownerB]) {
    const { error } = await owner.client.from("profiles").update(DEFAULTS).eq("id", owner.userId);
    if (error) {
      throw new Error(`fixture reset failed for ${owner.userId}: ${error.message}`);
    }
  }
});

describe("profiles row ownership", () => {
  it("1. the trigger created a profile row for the account, carrying the defaults", async () => {
    const { data, error } = await ownerA.client.from("profiles").select("*").eq("id", ownerA.userId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = (data ?? [])[0];
    expect(row.id).toBe(ownerA.userId);
    expect(row.timezone).toBe(DEFAULTS.timezone);
    expect(row.weight_unit).toBe(DEFAULTS.weight_unit);
    expect(row.estimation_formula).toBe(DEFAULTS.estimation_formula);
  });

  it("2. RLS filters, and is not merely switched on", async () => {
    // Non-vacuous by construction: A sees exactly one row, B sees exactly one row, and the two
    // differ — which together prove the table holds at least two rows while each client sees only
    // its own. No dependency on a third account existing anywhere.
    const asA = await ownerA.client.from("profiles").select("*");
    const asB = await ownerB.client.from("profiles").select("*");

    expect(asA.error).toBeNull();
    expect(asB.error).toBeNull();
    expect(asA.data).toHaveLength(1);
    expect(asB.data).toHaveLength(1);
    expect((asA.data ?? [])[0].id).not.toBe((asB.data ?? [])[0].id);
  });

  it("3. naming the other account's identifier directly returns nothing", async () => {
    const { data, error } = await ownerA.client.from("profiles").select("*").eq("id", ownerB.userId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("4. a cross-account update does not land in the database", async () => {
    const before = await ownerB.client.from("profiles").select("timezone, updated_at").eq("id", ownerB.userId);
    expect(before.error).toBeNull();
    const original = (before.data ?? [])[0];

    const attempt = await ownerA.client
      .from("profiles")
      .update({ timezone: "America/New_York" })
      .eq("id", ownerB.userId)
      .select();

    expect(attempt.error).toBeNull();
    expect(attempt.data).toHaveLength(0);

    // The half that matters: re-read as the row's owner, because a caller can be told "nothing
    // happened" while the write landed.
    const after = await ownerB.client.from("profiles").select("timezone, updated_at").eq("id", ownerB.userId);
    expect(after.error).toBeNull();
    const stored = (after.data ?? [])[0];
    expect(stored.timezone).toBe(original.timezone);
    expect(stored.updated_at).toBe(original.updated_at);
  });

  it("5. WITH CHECK rejects an insert for a row the caller would not own", async () => {
    // A random id on purpose: inserting B's id could fail on the primary key (23505) and would
    // prove nothing about the policy.
    const { error } = await ownerA.client.from("profiles").insert({ id: crypto.randomUUID() });

    expect(error?.code).toBe("42501");
  });

  it("6. there is no delete path, not for the owner and not across accounts", async () => {
    const own = await ownerA.client.from("profiles").delete().eq("id", ownerA.userId);
    expect(own.error?.code).toBe("42501");

    const stillMine = await ownerA.client.from("profiles").select("id").eq("id", ownerA.userId);
    expect(stillMine.data).toHaveLength(1);

    const other = await ownerA.client.from("profiles").delete().eq("id", ownerB.userId);
    expect(other.error?.code).toBe("42501");

    const stillTheirs = await ownerB.client.from("profiles").select("id").eq("id", ownerB.userId);
    expect(stillTheirs.data).toHaveLength(1);
  });

  it("7. the owner can still write their own row, and the stored value is this run's", async () => {
    // Without this, assertions 3-6 would all pass against a table nobody can use.
    const written = `Test/Run-${RUN_ID}`;
    try {
      const update = await ownerA.client.from("profiles").update({ timezone: written }).eq("id", ownerA.userId);
      expect(update.error).toBeNull();

      const { data, error } = await ownerA.client.from("profiles").select("timezone").eq("id", ownerA.userId);
      expect(error).toBeNull();
      // Equality with this run's value, not merely "different from the default": a stale value
      // from a previously crashed run would satisfy the weaker assertion.
      expect((data ?? [])[0].timezone).toBe(written);
    } finally {
      await ownerA.client.from("profiles").update({ timezone: DEFAULTS.timezone }).eq("id", ownerA.userId);
    }
  });

  it("8. an unauthenticated caller has no read path at all", async () => {
    const { data, error } = await anonymous.from("profiles").select("*");

    // With `revoke all ... from anon`, PostgREST raises rather than returning an empty set, so the
    // absence of rows must be null and not [].
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});
