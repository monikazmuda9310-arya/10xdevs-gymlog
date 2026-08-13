// Drives `PATCH /api/profile` against gymlog-test by calling the exported handler with a real
// Supabase client and a real session — the pattern `workout-endpoints.test.ts` established, and for
// the reason stated there: `astro dev` reads its credentials from `.dev.vars`, which points at
// production, so an HTTP round trip would write into the database the owner trains against.
//
// **`profiles-rls.test.ts` already proves the TABLE's policies. This proves the ENDPOINT**, and it
// is written to be capable of failing.
//
// What is deliberately NOT asserted: "account B cannot PATCH account A's row". The route takes no
// id, so B has no way to name A's row — the assertion would hold by the absence of a parameter
// rather than by any guarantee, and would survive deleting `.eq("id", userId)` from the service
// because RLS confines the update anyway. The fabricated-id assertion below replaces it: it fails
// the moment the handler resolves its row from anything other than `locals.user.id`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { PATCH as updateProfileRoute } from "@/pages/api/profile/index";

const DEFAULTS = {
  timezone: "Europe/Warsaw",
  weight_unit: "kg",
  estimation_formula: "brzycki",
} as const;

// Hardcoded and prefixed, not secret: S-09 needs to find them to clean them up. The same pair
// `profiles-rls.test.ts`, `workout-endpoints.test.ts` and `personal-records.test.ts` use — which is
// why every assertion here restores in a `finally`.
const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const EMAIL_B = "rls-owner-b@gymlog-test.dev";

/**
 * The payload every negative assertion sends, chosen so that all three fields differ from the
 * defaults. A write that landed where it should not is then visible in any one of the three columns
 * rather than only in the one the test happened to look at.
 */
const DISTINCT = { timezone: "Pacific/Kiritimati", weightUnit: "lb", estimationFormula: "epley" } as const;

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;
let ownerB: Owner;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

/** The slice of APIContext the handler actually reads. Cast rather than mocked wholesale. */
function context(body: unknown, session: { supabase: SupabaseClient<Database> | null; user: { id: string } | null }) {
  return {
    locals: session,
    request: new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** The three preference columns as stored, plus the stamp that moves on ANY update. */
async function stored(owner: Owner) {
  const { data, error } = await owner.client
    .from("profiles")
    .select("timezone, weight_unit, estimation_formula, updated_at")
    .eq("id", owner.userId)
    .single();
  if (error) {
    throw new Error(`could not re-read ${owner.userId}: ${error.message}`);
  }
  return data;
}

async function restore(owner: Owner): Promise<void> {
  const { error } = await owner.client.from("profiles").update(DEFAULTS).eq("id", owner.userId);
  if (error) {
    throw new Error(`fixture restore failed for ${owner.userId}: ${error.message}`);
  }
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.data.session) {
    throw new Error(`could not sign in ${email}: ${signIn.error?.message ?? "no session"}`);
  }
  return { client, userId: signIn.data.session.user.id };
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);
  ownerB = await authenticate(url, key, EMAIL_B, password);

  // Fixture reset (AGENTS.md § Testing). A run that dies between a flip and its restore would
  // otherwise leave both accounts holding a test preference permanently — and `weight_unit` in
  // particular is asserted to be "kg" by `workout-endpoints.test.ts:115`, a suite that has nothing
  // to do with this one. The reset is also what makes the read-backs below meaningful: the value
  // before every write is known, so a stored value equal to what this run wrote cannot be a stale
  // leftover from a previous one.
  await restore(ownerA);
  await restore(ownerB);
});

describe("PATCH /api/profile", () => {
  it("1. writes all three preferences, and they are really stored", async () => {
    try {
      const response = await updateProfileRoute(
        context(DISTINCT, { supabase: ownerA.client, user: { id: ownerA.userId } }),
      );
      expect(response.status).toBe(200);

      const { profile } = (await json(response)) as {
        profile: { timezone: string; weight_unit: string; estimation_formula: string };
      };
      expect(profile.timezone).toBe(DISTINCT.timezone);
      expect(profile.weight_unit).toBe(DISTINCT.weightUnit);
      expect(profile.estimation_formula).toBe(DISTINCT.estimationFormula);

      // Persisted state, not the response the caller saw.
      const row = await stored(ownerA);
      expect(row.timezone).toBe(DISTINCT.timezone);
      expect(row.weight_unit).toBe(DISTINCT.weightUnit);
      expect(row.estimation_formula).toBe(DISTINCT.estimationFormula);
    } finally {
      await restore(ownerA);
    }
  });

  it("2. writes only the row named by locals.user.id, and answers 404 when that names nothing", async () => {
    // The assertion this suite exists for. A fabricated id, sent with account A's real client and
    // real session: RLS confines the update to A's own row, so a handler that resolved its target
    // from the SESSION rather than from `locals.user.id` would happily write A's preferences and
    // report success. It also supplies the zero-row 404, which is otherwise unreachable — a trigger
    // creates a profile for every account and there is no delete path.
    const beforeA = await stored(ownerA);
    const beforeB = await stored(ownerB);

    const response = await updateProfileRoute(
      context(DISTINCT, { supabase: ownerA.client, user: { id: crypto.randomUUID() } }),
    );

    // Zero rows is a SUCCESS under RLS; the 404 is built by the handler (AGENTS.md § Access control).
    expect(response.status).toBe(404);
    expect((await json(response)).code).toBe("profile_not_found");

    // The half that matters: re-read as each row's owner. `updated_at` is included because the
    // trigger moves it on ANY update, so this fails even for a write that stored identical values.
    expect(await stored(ownerA)).toEqual(beforeA);
    expect(await stored(ownerB)).toEqual(beforeB);
  });

  it("3. refuses a well-formed timezone that is not a real zone, and stores nothing", async () => {
    const before = await stored(ownerA);

    const response = await updateProfileRoute(
      context({ ...DISTINCT, timezone: "Europe/Warsawa" }, { supabase: ownerA.client, user: { id: ownerA.userId } }),
    );

    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("timezone_unknown");

    // Without the re-read this would pass against an endpoint that refused the response and wrote
    // the row anyway. `Europe/Warsawa` stored would make `todayIn` answer in UTC forever after,
    // with nothing on screen saying so.
    expect(await stored(ownerA)).toEqual(before);
  });

  it("4. refuses a unit and a formula outside the enums, and stores nothing", async () => {
    const before = await stored(ownerA);

    for (const [label, body, code] of [
      ["unit", { ...DISTINCT, weightUnit: "stone" }, "weight_unit_invalid"],
      ["formula", { ...DISTINCT, estimationFormula: "lombardi" }, "estimation_formula_invalid"],
    ] as const) {
      const response = await updateProfileRoute(
        context(body, { supabase: ownerA.client, user: { id: ownerA.userId } }),
      );
      expect(response.status, `a bogus ${label} should be refused`).toBe(400);
      expect((await json(response)).code).toBe(code);
    }

    expect(await stored(ownerA)).toEqual(before);
  });

  it("5. refuses an unauthenticated caller, and writes nothing", async () => {
    const before = await stored(ownerA);

    const response = await updateProfileRoute(context(DISTINCT, { supabase: ownerA.client, user: null }));
    expect(response.status).toBe(401);
    expect((await json(response)).code).toBe("unauthenticated");

    expect(await stored(ownerA)).toEqual(before);
  });

  it("6. refuses when Supabase is not configured, rather than throwing", async () => {
    // The silent-failure class AGENTS.md § Cloudflare traps warns about: missing Worker secrets make
    // `locals.supabase` null, and an endpoint that assumed otherwise would 500 on every request.
    const response = await updateProfileRoute(context(DISTINCT, { supabase: null, user: { id: ownerA.userId } }));

    expect(response.status).toBe(500);
    expect((await json(response)).code).toBe("not_configured");
  });

  it("7. the account is left on the defaults every other suite expects", async () => {
    // Not decoration: `workout-endpoints.test.ts:115` asserts a new set is stamped "kg", and
    // `personal-records.test.ts` toggles the formula from a known starting point. If this suite
    // ever leaves a preference flipped, this is what says so — here, rather than in a suite that
    // has nothing to do with preferences.
    for (const owner of [ownerA, ownerB]) {
      const row = await stored(owner);
      expect(row.timezone).toBe(DEFAULTS.timezone);
      expect(row.weight_unit).toBe(DEFAULTS.weight_unit);
      expect(row.estimation_formula).toBe(DEFAULTS.estimation_formula);
    }
  });
});
