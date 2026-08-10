// Proves the two account-access flows against a real auth server, including the ways they must
// fail. A schema test cannot answer "does a signup return a session" or "is a wrong password
// rejected" — only the provider can.
//
// Same rules as profiles-rls.test.ts, and for the same reasons:
//   * gymlog-test only, with that project's publishable key. Never a service_role key, and no
//     production credential exists in this process at all (vitest.integration.config.ts strips
//     them), so the suite is INCAPABLE of reaching production rather than merely disinclined to.
//   * throw in beforeAll when a variable is missing. A check must never skip its way to green.
//   * a unique account per run, so repeated and parallel runs cannot collide.
//
// One assertion here looks like a tautology and is not: that a fresh signup on gymlog-test still
// returns a session. It is the tripwire for Phase 4's email-confirmation switch being applied to
// the wrong project — the failure mode whose other outcome (production left unprotected) is
// silent.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

// Unique per run and prefixed `s01-` so S-09 can find every account this slice created.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const FRESH_EMAIL = `s01-signup-${RUN_ID}@gymlog-test.dev`;

// Deliberately NOT rls-owner-a/b: those are shared with the RLS suite, and a signup test must own
// the account it creates or it is asserting about somebody else's fixture.
const NO_SUCH_EMAIL = `s01-absent-${RUN_ID}@gymlog-test.dev`;

let url: string;
let key: string;
let password: string;

/** The client that performed the signup, still carrying that account's session. */
let signedUp: SupabaseClient<Database>;
let signUpUserId: string;
let signUpHadSession: boolean;

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

function freshClient(): SupabaseClient<Database> {
  // A new client per flow: sessions must not leak between assertions, or "signing in returned a
  // session" could be satisfied by a session that was already there.
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

beforeAll(async () => {
  url = required("SUPABASE_TEST_URL");
  key = required("SUPABASE_TEST_KEY");
  password = required("GYMLOG_TEST_PASSWORD");

  signedUp = freshClient();
  const { data, error } = await signedUp.auth.signUp({ email: FRESH_EMAIL, password });

  if (error) {
    throw new Error(`signing up ${FRESH_EMAIL} failed outright: ${error.message}`);
  }

  signUpHadSession = data.session !== null;
  signUpUserId = data.user?.id ?? "";
});

describe("account creation", () => {
  it("1. a fresh signup returns a session — email confirmation is still OFF on gymlog-test", () => {
    // Reads as a tautology today. The moment somebody applies Phase 4's setting to gymlog-test
    // instead of gymlog, this is the assertion that goes red — loudly, before production is left
    // quietly unprotected.
    expect(signUpHadSession).toBe(true);
    expect(signUpUserId).not.toBe("");
  });

  it("2. the signup created exactly one profiles row, owned by the new account", async () => {
    // The F-03 trigger, exercised through the flow this slice owns rather than in isolation.
    const { data, error } = await signedUp.from("profiles").select("id").eq("id", signUpUserId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data ?? [])[0].id).toBe(signUpUserId);
  });
});

describe("sign-in", () => {
  it("3. the right password returns a session whose user id is the account's own", async () => {
    const client = freshClient();

    const { data, error } = await client.auth.signInWithPassword({ email: FRESH_EMAIL, password });

    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    // Not merely "a session": the session belongs to the account that just signed up.
    expect(data.session?.user.id).toBe(signUpUserId);
  });

  it("4. a wrong password returns an error and no session", async () => {
    const client = freshClient();

    const { data, error } = await client.auth.signInWithPassword({
      email: FRESH_EMAIL,
      password: `${password}-definitely-wrong-${RUN_ID}`,
    });

    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
    expect(data.user).toBeNull();
  });

  it("5. an address with no account is indistinguishable from a wrong password", async () => {
    // US-04: one account learns nothing about another. If these two diverge at the level the
    // caller sees, the endpoint's neutral message is papering over a real oracle underneath.
    const wrongPassword = await freshClient().auth.signInWithPassword({
      email: FRESH_EMAIL,
      password: `${password}-definitely-wrong-${RUN_ID}`,
    });
    const noSuchAccount = await freshClient().auth.signInWithPassword({
      email: NO_SUCH_EMAIL,
      password,
    });

    expect(noSuchAccount.data.session).toBeNull();
    expect(noSuchAccount.error).not.toBeNull();

    expect(noSuchAccount.error?.status).toBe(wrongPassword.error?.status);
    expect(noSuchAccount.error?.code).toBe(wrongPassword.error?.code);
    expect(noSuchAccount.error?.message).toBe(wrongPassword.error?.message);
  });
});
