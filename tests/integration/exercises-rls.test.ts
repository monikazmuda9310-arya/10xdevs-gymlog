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

/** One row from the real seed, to assert the shared half against. */
let seededId: string;
let seededName: string;

/** The catalogue the owner settled on: 38 rows, distributed like this. */
const SEED_TOTAL = 38;
const SEED_BY_GROUP: Record<string, number> = { legs: 9, back: 7, chest: 7, shoulders: 5, arms: 6, core: 4 };

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
  // touch the seed or a row somebody added by hand.
  for (const owner of [ownerA, ownerB]) {
    await owner.client.from("exercises").delete().like("name", "s02-%").eq("user_id", owner.userId);
  }

  // Pick a seeded row for the shared-half assertions. Deadlift specifically: it is the one whose
  // muscle group looks wrong until you read why, so a test naming it keeps the decision visible.
  const seeded = await ownerA.client
    .from("exercises")
    .select("id, name")
    .is("user_id", null)
    .eq("name", "Deadlift")
    .single();
  if (seeded.error) {
    throw new Error(
      `the seeded catalogue is missing or unreadable — expected to find 'Deadlift' with user_id ` +
        `is null. Has the seed migration been pushed? (${seeded.error.message})`,
    );
  }
  seededId = seeded.data.id;
  seededName = seeded.data.name;
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

  // Assertions 3, 6 and 7 below need a seeded row to exist, so they arrived with Phase 2 rather
  // than Phase 1. They were briefly written in Phase 1 guarded by `if (!seededId) return;` and
  // removed, because that made three tests report green while asserting nothing — the failure this
  // project already recorded as a lesson after F-03. An empty test is worse than a missing one,
  // because it looks like coverage.

  it("3. a seeded row is readable by both accounts", async () => {
    // The property the whole shared-catalogue design exists for.
    const asA = await ownerA.client.from("exercises").select("id").eq("id", seededId);
    const asB = await ownerB.client.from("exercises").select("id").eq("id", seededId);

    expect(asA.error).toBeNull();
    expect(asB.error).toBeNull();
    expect(asA.data).toHaveLength(1);
    expect(asB.data).toHaveLength(1);
  });

  it("6. no account can update a seeded row", async () => {
    const attempt = await ownerA.client
      .from("exercises")
      .update({ name: `hijacked-${RUN_ID}` })
      .eq("id", seededId)
      .select();

    // The update policy's `using` filters the row out rather than raising, so PostgREST reports
    // success over zero rows. The re-read as a different account is what proves nothing moved.
    expect(attempt.error).toBeNull();
    expect(attempt.data ?? []).toHaveLength(0);

    const after = await ownerB.client.from("exercises").select("name").eq("id", seededId).single();
    expect(after.data?.name).toBe(seededName);
  });

  it("7. no account can delete a seeded row", async () => {
    const attempt = await ownerA.client.from("exercises").delete().eq("id", seededId).select();

    expect(attempt.error).toBeNull();
    expect(attempt.data ?? []).toHaveLength(0);

    const stillThere = await ownerB.client.from("exercises").select("id").eq("id", seededId);
    expect(stillThere.data).toHaveLength(1);
  });

  it("10. the seed is complete and distributed as the owner decided", async () => {
    const { data, error } = await ownerA.client.from("exercises").select("muscle_group").is("user_id", null);

    expect(error).toBeNull();
    expect(data).toHaveLength(SEED_TOTAL);

    // Per-group counts, not just the total: a bare total passes happily when two exercises are
    // swapped between groups in a copy-paste, which is the mistake this shape of data invites.
    const counted: Record<string, number> = {};
    for (const row of data ?? []) {
      counted[row.muscle_group] = (counted[row.muscle_group] ?? 0) + 1;
    }
    expect(counted).toEqual(SEED_BY_GROUP);
  });

  it("11. the five deliberate assignments are what the owner chose", async () => {
    // These five look like mistakes and are not. Pinning them here means a well-meaning
    // "correction" fails a test instead of silently changing what the tonnage chart reports.
    const { data, error } = await ownerA.client
      .from("exercises")
      .select("name, muscle_group, is_bodyweight")
      .is("user_id", null)
      .in("name", ["Deadlift", "Romanian Deadlift", "Hip Thrust", "Dip", "Face Pull", "Plank"]);

    expect(error).toBeNull();
    // A Map rather than an object: half these names carry a space, so the lookups would be a
    // mixture of dot and bracket notation and the linter is right to dislike that.
    const byName = new Map((data ?? []).map((row) => [row.name, row]));

    // The conventional pull is programmed on pull day; the Romanian variant on leg day.
    expect(byName.get("Deadlift")?.muscle_group).toBe("back");
    expect(byName.get("Romanian Deadlift")?.muscle_group).toBe("legs");
    // No `glutes` group exists — declined deliberately.
    expect(byName.get("Hip Thrust")?.muscle_group).toBe("legs");
    expect(byName.get("Dip")?.muscle_group).toBe("chest");
    // Done on pull day, but it targets the rear delts.
    expect(byName.get("Face Pull")?.muscle_group).toBe("shoulders");
    // Nobody assists a plank; the flag is what permits a zero load.
    expect(byName.get("Plank")?.is_bodyweight).toBe(true);
  });
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
