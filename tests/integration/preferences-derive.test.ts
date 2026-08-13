// The three consequences of changing a preference that NOTHING else in this repository covers.
//
// What is deliberately NOT restated here: that the SQL estimate and the TypeScript estimate agree
// under both formulas. `personal-records.test.ts` assertions 4 and 4b have done that since S-04, and
// they toggle `estimation_formula` to do it — which is why the first draft of S-06's plan was wrong
// to call the formula switch untested and to build a phase around the gap. **"A user cannot do X
// yet" is not the same as "X is untested."** What those assertions cannot see is the subject of
// assertion 1 below: not what a set ESTIMATES TO under each formula, but WHICH SET HOLDS THE RECORD.
//
// Driven by calling the exported handlers directly, as `workout-endpoints.test.ts` does and for the
// reason stated there: `astro dev` reads its credentials from `.dev.vars`, which points at
// PRODUCTION, so an HTTP round trip would write into the database the owner trains against.
//
// FIXTURE DISCIPLINE IS LOAD-BEARING IN THIS SUITE SPECIFICALLY. It flips `weight_unit` and
// `estimation_formula` on `rls-owner-a`, the account `workout-endpoints.test.ts` (which asserts
// `weight_unit === "kg"` at :115), `personal-records.test.ts` and `record-impact.test.ts` all share.
// Both columns are reset in `beforeAll` and restored in a `finally`; assertion 4 is the tripwire for
// a run that dies in between, so the failure surfaces here rather than in a suite that has nothing
// to do with preferences.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import type { Database } from "@/db/database.types";
import { POST as addSetRoute } from "@/pages/api/sets/index";
import { PATCH as updateSetRoute } from "@/pages/api/sets/[id]/index";
import { PATCH as updateProfileRoute } from "@/pages/api/profile/index";

const EMAIL_A = "rls-owner-a@gymlog-test.dev";
const MARK = "s06-";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULTS = { timezone: "Europe/Warsaw", weightUnit: "kg", estimationFormula: "brzycki" } as const;

/** Pounds to kilograms, the constant the generated `sets.weight_kg` column applies. */
const KG_PER_LB = 0.45359237;

interface Owner {
  client: SupabaseClient<Database>;
  userId: string;
}

let ownerA: Owner;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The integration check must never skip its way to green.`);
  }
  return value;
}

async function authenticate(url: string, key: string, email: string, password: string): Promise<Owner> {
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.data.session) {
    throw new Error(`could not sign in ${email}: ${signIn.error?.message ?? "no session"}`);
  }
  return { client, userId: signIn.data.session.user.id };
}

/** The slice of APIContext the handlers actually read. Cast rather than mocked wholesale. */
function context(owner: Owner, body: unknown, method: string, id?: string) {
  return {
    locals: { supabase: owner.client, user: { id: owner.userId } },
    params: id === undefined ? {} : { id },
    request: new Request(`http://localhost/api/x${id === undefined ? "" : `/${id}`}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}

/**
 * Change a preference **through the endpoint this slice added**, rather than by writing the column.
 *
 * That is the point of driving it this way: assertion 2's whole subject is what happens to stored
 * rows when the preference changes the way a user changes it, and a direct `update` would skip the
 * validation and the ownership scoping that the real path applies.
 */
async function setPreferences(owner: Owner, preferences: Record<string, string>): Promise<void> {
  const response = await updateProfileRoute(context(owner, preferences, "PATCH"));
  if (response.status !== 200) {
    const body = (await response.json()) as { code?: string };
    throw new Error(`could not set preferences (${response.status}): ${body.code ?? "no code"}`);
  }
}

async function makeExercise(owner: Owner, label: string): Promise<string> {
  const { data, error } = await owner.client
    .from("exercises")
    .insert({ user_id: owner.userId, name: `${MARK}${label}-${RUN_ID}`, muscle_group: "back", is_bodyweight: false })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' exercise: ${error.code} ${error.message}`);
  }
  return data.id;
}

async function makeWorkout(owner: Owner, label: string, performedOn: string = TODAY): Promise<string> {
  const { data, error } = await owner.client
    .from("workouts")
    .insert({ user_id: owner.userId, performed_on: performedOn, note: `${MARK}${label}-${RUN_ID}` })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create the '${label}' workout: ${error.code} ${error.message}`);
  }
  return data.id;
}

/**
 * A fresh exercise with one workout and one entry under it — nothing else has ever been logged
 * against it.
 *
 * Per test rather than per suite, for the reason `personal-records.test.ts` states: a record
 * aggregates over an exercise's whole history, so two tests sharing an exercise share an answer.
 */
async function freshEntry(owner: Owner, label: string, performedOn: string = TODAY) {
  const exerciseId = await makeExercise(owner, label);
  const workoutId = await makeWorkout(owner, label, performedOn);
  const { data, error } = await owner.client
    .from("exercise_entries")
    .insert({ user_id: owner.userId, workout_id: workoutId, exercise_id: exerciseId })
    .select("id")
    .single();
  if (error) {
    throw new Error(`could not create an exercise entry: ${error.code} ${error.message}`);
  }
  return { exerciseId, workoutId, entryId: data.id };
}

interface LoggedSet {
  id: string;
  weight: number;
  weight_unit: string;
  weight_kg: number;
}

/** Log a set the way the application does — which is what stamps the unit from the profile. */
async function logViaEndpoint(owner: Owner, entryId: string, reps: number, weight: number): Promise<LoggedSet> {
  const response = await addSetRoute(context(owner, { exerciseEntryId: entryId, reps, weight }, "POST"));
  const body = (await response.json()) as { set: LoggedSet; code?: string };
  if (response.status !== 201) {
    throw new Error(`logging ${reps}x${weight} failed (${response.status}): ${body.code ?? "no code"}`);
  }
  return body.set;
}

async function bestEstimateSetId(owner: Owner, exerciseId: string): Promise<string | null> {
  const { data, error } = await owner.client
    .from("personal_records")
    .select("best_estimate_set_id, best_estimate_kg")
    .eq("user_id", owner.userId)
    .eq("exercise_id", exerciseId)
    .single();
  if (error) {
    throw new Error(`could not read the record for ${exerciseId}: ${error.code} ${error.message}`);
  }
  return data.best_estimate_set_id;
}

async function storedPreferences(owner: Owner) {
  const { data, error } = await owner.client
    .from("profiles")
    .select("timezone, weight_unit, estimation_formula")
    .eq("id", owner.userId)
    .single();
  if (error) {
    throw new Error(`could not re-read the profile: ${error.message}`);
  }
  return data;
}

beforeAll(async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_KEY");
  const password = required("GYMLOG_TEST_PASSWORD");

  ownerA = await authenticate(url, key, EMAIL_A, password);

  // Workouts first: deleting them cascades to entries and sets, which is what releases the
  // `on delete restrict` on the exercises this suite created. The reverse order fails.
  await ownerA.client.from("workouts").delete().like("note", `${MARK}%`).eq("user_id", ownerA.userId);
  await ownerA.client.from("exercises").delete().like("name", `${MARK}%`).eq("user_id", ownerA.userId);

  await setPreferences(ownerA, { ...DEFAULTS });
});

describe("changing the formula re-derives WHICH SET holds a record", () => {
  it("1. the same two sets name different record holders under Brzycki and Epley", async () => {
    // The assertion this whole phase exists for, and the one thing `personal-records.test.ts`
    // cannot see: it proves the two formulas produce different NUMBERS, not that they produce a
    // different WINNER. A user who never crosses the boundary sees a formula toggle that only
    // moves decimals; the product's claim is stronger than that.
    //
    // The fixture is chosen so the ranking inverts, and the arithmetic is written out because
    // "trust me" is how a fixture silently stops proving anything:
    //
    //   brzycki  w × 36 / (37 − r):  100×36/32 = 112.5    82×36/25 = 118.08  → the 12-rep set leads
    //   epley    w × (1 + r/30):     100×35/30 = 116.67   82×1.4   = 114.80  → the  5-rep set leads
    //
    // FIVE and TWELVE, never TEN. **The two formulas are numerically identical at exactly ten
    // repetitions** — 36/27 and 1 + 10/30 are both 4/3 — so a fixture written there reads the same
    // under either and would prove nothing at all. Mutation (a) of this phase's protocol moves the
    // fixture to ten once, deliberately, to demonstrate that the crossing is real.
    const { exerciseId, entryId } = await freshEntry(ownerA, "holder");
    const fiveRep = await logViaEndpoint(ownerA, entryId, 5, 100);
    const twelveRep = await logViaEndpoint(ownerA, entryId, 12, 82);

    try {
      await setPreferences(ownerA, { ...DEFAULTS, estimationFormula: "brzycki" });
      const underBrzycki = await bestEstimateSetId(ownerA, exerciseId);

      await setPreferences(ownerA, { ...DEFAULTS, estimationFormula: "epley" });
      const underEpley = await bestEstimateSetId(ownerA, exerciseId);

      // Decided by IDENTIFIER, never by comparing numbers across the SQL/TypeScript boundary —
      // the same seam `records-verdict.ts` and `record-impact.ts` keep.
      expect(underBrzycki).toBe(twelveRep.id);
      expect(underEpley).toBe(fiveRep.id);
      expect(underBrzycki).not.toBe(underEpley);
    } finally {
      await setPreferences(ownerA, { ...DEFAULTS });
    }
  });

  it("1b. and switching back restores the original holder exactly, because nothing was stored", async () => {
    // The promise the whole slice rests on: a formula change is a RE-DERIVATION. There is no record
    // column, no record row and no cache, so switching back cannot leave a trace. If anybody ever
    // adds an `estimated_1rm` column or a `personal_records` table, this is what fails.
    const { exerciseId, entryId } = await freshEntry(ownerA, "reversible");
    const fiveRep = await logViaEndpoint(ownerA, entryId, 5, 100);
    await logViaEndpoint(ownerA, entryId, 12, 82);

    try {
      const before = await bestEstimateSetId(ownerA, exerciseId);
      await setPreferences(ownerA, { ...DEFAULTS, estimationFormula: "epley" });
      expect(await bestEstimateSetId(ownerA, exerciseId)).toBe(fiveRep.id);

      await setPreferences(ownerA, { ...DEFAULTS, estimationFormula: "brzycki" });
      expect(await bestEstimateSetId(ownerA, exerciseId)).toBe(before);
    } finally {
      await setPreferences(ownerA, { ...DEFAULTS });
    }
  });
});

describe("changing the unit affects NEW sets only", () => {
  it("2. a new set follows the new unit while every set already logged keeps its own", async () => {
    // The round-trip promise, through stored rows rather than hand-built objects — and the first
    // thing to exercise `weightInUnit`'s second branch (`set-display.ts:52`) against real data. Its
    // own comment says the branch was unreachable in S-03 "because the profile's unit cannot yet be
    // changed". This slice is what makes it live.
    const { entryId } = await freshEntry(ownerA, "unit");

    try {
      await setPreferences(ownerA, { ...DEFAULTS, weightUnit: "kg" });
      const inKilograms = await logViaEndpoint(ownerA, entryId, 5, 100);
      expect(inKilograms.weight_unit).toBe("kg");

      await setPreferences(ownerA, { ...DEFAULTS, weightUnit: "lb" });
      const inPounds = await logViaEndpoint(ownerA, entryId, 5, 100);

      // The unit came from the profile on the SERVER, never from the request body — both calls sent
      // the identical payload and the two rows differ.
      expect(inPounds.weight_unit).toBe("lb");
      expect(inPounds.weight).toBe(100);
      expect(inPounds.weight_kg).toBeCloseTo(100 * KG_PER_LB, 6);

      // **Editing the older set must not re-stamp it.** The unit is a property of the ROW, not of
      // the account editing it (S-05's PATCH payload carries no unit, deliberately). Re-stamping
      // here would turn 100 kg into 100 lb and corrupt every figure derived from `weight_kg`. This
      // is what mutation (b) of this phase's protocol breaks.
      const edited = await updateSetRoute(
        context(ownerA, { reps: 6, weight: 102.5, rpe: null }, "PATCH", inKilograms.id),
      );
      expect(edited.status).toBe(200);
      const { set: afterEdit } = (await edited.json()) as { set: LoggedSet };
      expect(afterEdit.weight_unit).toBe("kg");
      expect(afterEdit.weight).toBe(102.5);
      expect(afterEdit.weight_kg).toBeCloseTo(102.5, 6);

      // Persisted state, not the responses the caller saw: two rows, two units, each reading back
      // as the number typed in the unit it was typed in.
      const stored = await ownerA.client
        .from("sets")
        .select("id, weight, weight_unit, weight_kg")
        .eq("user_id", ownerA.userId)
        .in("id", [inKilograms.id, inPounds.id]);
      const kilogramRow = stored.data?.find((row) => row.id === inKilograms.id);
      const poundRow = stored.data?.find((row) => row.id === inPounds.id);

      expect(kilogramRow?.weight_unit).toBe("kg");
      expect(Number(kilogramRow?.weight)).toBe(102.5);
      expect(poundRow?.weight_unit).toBe("lb");
      expect(Number(poundRow?.weight)).toBe(100);
      // And the two are genuinely different loads, so nothing here would pass on a no-op conversion.
      expect(Number(poundRow?.weight_kg)).toBeLessThan(Number(kilogramRow?.weight_kg));
    } finally {
      await setPreferences(ownerA, { ...DEFAULTS });
    }
  });

  // **Not asserted, deliberately**: that changing the unit leaves record HOLDERS unchanged.
  // `set_estimates` never references `p.weight_unit`, and both rankings run on `weight_kg` — a
  // column generated from the SET's own unit. There is no path by which the account preference
  // could reach a ranking, so the assertion could not fail, and an assertion that cannot fail is
  // decoration that reads as coverage (context/foundation/lessons.md).
});

describe("changing the timezone moves no workout", () => {
  it("3. every performed_on is byte-identical across a 25-hour swing", async () => {
    // `src/types.ts:37` states the invariant: `performed_on` is a calendar DATE the user stated
    // rather than an instant, "so changing the profile timezone later cannot move a workout to a
    // different day". Until this slice nobody could change the column, so the rule was safe by
    // inaccessibility rather than by design. Now it is reachable from a form.
    //
    // Pacific/Kiritimati (+14) and Pacific/Niue (−11) are the pair `calendar.ts` was measured with
    // in real workerd — 25 hours apart, so any instant-shaped storage would move a date somewhere.
    await freshEntry(ownerA, "tz-today", TODAY);
    await freshEntry(ownerA, "tz-newyear", "2026-01-01");
    await freshEntry(ownerA, "tz-leap", "2024-02-29");

    const readDates = async () => {
      const { data, error } = await ownerA.client
        .from("workouts")
        .select("id, performed_on")
        .eq("user_id", ownerA.userId)
        .order("id");
      if (error) {
        throw new Error(`could not read workouts: ${error.message}`);
      }
      return data;
    };
    const readRecordDates = async () => {
      const { data, error } = await ownerA.client
        .from("personal_records")
        .select("exercise_id, best_estimate_performed_on, heaviest_performed_on, last_record_on")
        .eq("user_id", ownerA.userId)
        .order("exercise_id");
      if (error) {
        throw new Error(`could not read records: ${error.message}`);
      }
      return data;
    };

    try {
      await setPreferences(ownerA, { ...DEFAULTS, timezone: "Pacific/Kiritimati" });
      const atPlusFourteen = await readDates();
      const recordsAtPlusFourteen = await readRecordDates();
      expect(atPlusFourteen.length).toBeGreaterThan(0);

      await setPreferences(ownerA, { ...DEFAULTS, timezone: "Pacific/Niue" });
      // Byte-identical, not "close": these are date strings, and a date that moved by one day is
      // exactly the defect. The record rows are checked too, because they carry dates of their own.
      expect(await readDates()).toEqual(atPlusFourteen);
      expect(await readRecordDates()).toEqual(recordsAtPlusFourteen);

      await setPreferences(ownerA, { ...DEFAULTS, timezone: "Europe/Warsaw" });
      expect(await readDates()).toEqual(atPlusFourteen);
    } finally {
      await setPreferences(ownerA, { ...DEFAULTS });
    }
  });
});

describe("the shared fixture is left as it was found", () => {
  it("4. the account is back on the defaults every other suite expects", async () => {
    // Not decoration. This suite flips two columns on an account three other suites read:
    // `workout-endpoints.test.ts:115` asserts a new set is stamped "kg", and
    // `personal-records.test.ts` toggles the formula from a known starting point. A run that dies
    // between a flip and its restore would otherwise turn an unrelated suite red — the failure
    // AGENTS.md § Testing warns about. This says so here instead.
    const stored = await storedPreferences(ownerA);
    expect(stored.timezone).toBe(DEFAULTS.timezone);
    expect(stored.weight_unit).toBe(DEFAULTS.weightUnit);
    expect(stored.estimation_formula).toBe(DEFAULTS.estimationFormula);
  });
});
