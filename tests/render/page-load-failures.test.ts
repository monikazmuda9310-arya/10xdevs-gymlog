// WHAT FOUR PAGES SHOW WHEN THE READ BEHIND THEM FAILS.
//
// `records.astro`, `workouts/index.astro`, `workouts/[id].astro` and `exercises.astro` each carry a
// `loadFailed` branch whose entire purpose is that a failed read must not render as "you have
// nothing". **None of them had ever been rendered by a test** — `tests/render/` held three files and
// none touched these pages (measured 2026-08-20). The branches were written correctly and guarded by
// nothing, which is the same shape as the two deliberate swallows one layer down: right today,
// invisible to the gate tomorrow.
//
// **Why the distinction is worth a suite of its own.** An empty list is a positive claim — "you have
// logged nothing" — and it is the answer a user is least able to question. `exercises.astro` says
// this in its own comment: without the branch, a failed catalogue read is indistinguishable from a
// seed that never landed. The failure and the emptiness must be two different sentences, and this is
// the only project that can ask what a protected page's HTML actually contains.
//
// **`renderToResponse` for `workouts/[id].astro`, `renderToString` for the rest.** That page has
// THREE outcomes and one of them is a status code: `Astro.response.status = 404` for a workout that
// is absent or not the caller's, versus a `loadFailed` branch that must NOT be a 404 — the database
// being unreachable is not evidence that a workout does not exist. The HTML alone cannot tell them
// apart.
//
// **The stub throws on an unstubbed table**, copied from `dashboard-tonnage.test.ts:143-150`. A fifth
// read added to any of these pages reddens this file before an assertion exists for it — that
// tripwire is what caught S-08's breakdown read, and it is why the chains below are written out per
// table instead of sharing one permissive shape.

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { describe, expect, it } from "vitest";

import Exercises from "@/pages/exercises.astro";
import Records from "@/pages/records.astro";
import WorkoutDetailPage from "@/pages/workouts/[id].astro";
import Workouts from "@/pages/workouts/index.astro";

const USER_ID = "00000000-0000-4000-8000-000000000000";
const WORKOUT_ID = "11111111-1111-4111-8111-111111111111";

const PROFILE = { id: USER_ID, timezone: "Europe/Warsaw", weight_unit: "kg", estimation_formula: "brzycki" };

/** What a page's read is made to do. `"throw"` is PostgREST's shape: an `error`, not a rejection. */
type Answer = "throw" | unknown[] | Record<string, unknown> | null;

const FAILED = { data: null, error: { message: "unreachable", code: "XX000" } };

const resolve = (answer: Answer) =>
  answer === "throw" ? Promise.resolve(FAILED) : Promise.resolve({ data: answer, error: null });

/** `profiles`: `.select("*").eq("id", …).maybeSingle()`. */
const profileChain = (answer: Answer) => ({ select: () => ({ eq: () => ({ maybeSingle: () => resolve(answer) }) }) });

/** `personal_records` and the workout LIST: `.select().eq().order().order()`. */
const twoOrderChain = (answer: Answer) => ({
  select: () => ({ eq: () => ({ order: () => ({ order: () => resolve(answer) }) }) }),
});

/** One workout: `.select().eq().eq().order().order().maybeSingle()` — two `eq`s, then a single row. */
const singleWorkoutChain = (answer: Answer) => ({
  select: () => ({
    eq: () => ({ eq: () => ({ order: () => ({ order: () => ({ maybeSingle: () => resolve(answer) }) }) }) }),
  }),
});

/** `exercises`: `.select("*").or(…)` and then `.order("name")` on the built query. */
const catalogueChain = (answer: Answer) => ({ select: () => ({ or: () => ({ order: () => resolve(answer) }) }) });

/**
 * A Supabase double answering exactly the tables named, and **throwing on anything else**.
 *
 * The throw is the tripwire, not defensiveness: a page that gains a fifth read would otherwise get a
 * chain whose `.eq()` returns a non-thenable, `await` would hand that straight back, `error` would be
 * `undefined`, and the page would sail on — leaving this suite green against a read that never
 * happened.
 */
function stub(tables: Record<string, unknown>) {
  return {
    from: (table: string) => {
      if (table in tables) {
        return tables[table];
      }
      throw new Error(`unstubbed table: ${table}`);
    },
  };
}

async function container() {
  const created = await AstroContainer.create();
  created.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  created.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
  return created;
}

function locals(tables: Record<string, unknown>): App.Locals {
  return {
    supabase: stub(tables),
    user: { id: USER_ID, email: "lifter@example.test" },
  } as unknown as App.Locals;
}

async function render(page: unknown, tables: Record<string, unknown>): Promise<string> {
  // A `.astro` module has no type outside Astro's own pipeline, so it arrives as `any`; the cast
  // localises that here instead of at four call sites. `astro check` covers the pages themselves.
  return (await container()).renderToString(page as never, { locals: locals(tables) });
}

/** One record row, complete enough for both figures. 5 × 100 kg → 112.5 under Brzycki. */
const RECORD_ROW = {
  user_id: USER_ID,
  exercise_id: "22222222-2222-4222-8222-222222222222",
  exercise_name: "Barbell squat",
  muscle_group: "legs",
  is_bodyweight: false,
  last_record_on: "2026-08-13",
  best_estimate_set_id: "33333333-3333-4333-8333-333333333333",
  best_estimate_workout_id: WORKOUT_ID,
  best_estimate_reps: 5,
  best_estimate_weight: 100,
  best_estimate_weight_unit: "kg",
  best_estimate_weight_kg: 100,
  best_estimate_kg: 112.5,
  best_estimate_performed_on: "2026-08-13",
  heaviest_set_id: "33333333-3333-4333-8333-333333333333",
  heaviest_workout_id: WORKOUT_ID,
  heaviest_reps: 5,
  heaviest_weight: 100,
  heaviest_weight_unit: "kg",
  heaviest_weight_kg: 100,
  heaviest_performed_on: "2026-08-13",
};

/** The class each printed record figure carries — present iff a number is on screen. */
const RECORD_FIGURE_CLASS = "text-lg font-semibold text-purple-200";

const RECORDS_FAILED = "Your records could not be loaded";
const RECORDS_EMPTY = "No records yet";
const WORKOUTS_FAILED = "Your workouts could not be loaded";
const WORKOUTS_EMPTY = "No workouts logged yet";
const WORKOUT_FAILED = "This workout could not be loaded";
const WORKOUT_MISSING = "That workout could not be found";
const CATALOGUE_FAILED = "The catalogue could not be loaded";

describe("records.astro states a failed read instead of showing an empty history", () => {
  it("1. a failed records read prints the failure sentence and NO figure", async () => {
    const html = await render(Records, {
      profiles: profileChain(PROFILE),
      personal_records: twoOrderChain("throw"),
    });

    expect(html).toContain(RECORDS_FAILED);
    // **The claim.** Without the `loadFailed` branch this page renders "No records yet" — which an
    // account that has never logged a set also renders, and the user has no way to tell.
    expect(html).not.toContain(RECORD_FIGURE_CLASS);
    expect(html).not.toContain(RECORDS_EMPTY);
  });

  it("2. and still prints the figure when the read works — the positive control", async () => {
    // **Without this, assertion 1 is vacuous.** "No figure on screen" is satisfied perfectly by a
    // page that renders no figures at all, and a page whose record list silently stopped rendering
    // would pass assertion 1 while having lost the feature entirely.
    const html = await render(Records, {
      profiles: profileChain(PROFILE),
      personal_records: twoOrderChain([RECORD_ROW]),
    });

    expect(html).toContain(RECORD_FIGURE_CLASS);
    expect(html).toContain("Barbell squat");
    // 5 × 100 kg under Brzycki: 100 × 36 / (37 − 5) = 112.5. Re-derived in TypeScript from the set's
    // own weight, never read from `best_estimate_kg` — so this number also pins that rule.
    expect(html).toContain("112.5");
    expect(html).not.toContain(RECORDS_FAILED);
  });

  it("3. an account with no records is a THIRD state, not the failure sentence", async () => {
    // Three outcomes, three sentences. Collapsing "we could not read" into "you have none" is
    // precisely the silent failure `records.astro:29-31` exists to prevent, and a page that showed
    // the failure sentence for an empty history would be wrong in the opposite direction.
    const html = await render(Records, {
      profiles: profileChain(PROFILE),
      personal_records: twoOrderChain([]),
    });

    expect(html).toContain(RECORDS_EMPTY);
    expect(html).not.toContain(RECORDS_FAILED);
    expect(html).not.toContain(RECORD_FIGURE_CLASS);
  });

  it("4. a NULL profile prints figures under a defaulted unit — today's behaviour, pinned not endorsed", async () => {
    // **THIS ASSERTION PINS BEHAVIOUR THAT MAY BE WRONG, AND SAYS SO IN THE WORDS THIS PROJECT USES
    // TO REFUSE ONE** (`lessons.md` § "An assertion you keep because it cannot fail YET must say so
    // in the same words you'd use to refuse one").
    //
    // `records.astro:26-27` reads `profile?.weight_unit ?? "kg"`, so a missing profile row yields a
    // DEFAULTED unit and the page prints headline figures beneath it. `dashboard.astro` and
    // `settings.astro` treat the identical input — `maybeSingle()` returning `null` with no error —
    // as a FAILED READ. Three pages, one input, two opposite answers, and nothing anywhere says
    // which is intended.
    //
    // **No mutation available today makes this bite.** `profiles` rows are created by a trigger on
    // `auth.users` and there is no delete path, so the null cannot occur in production. It is not
    // fixed here for exactly that reason: a change with no way to prove it is a change nobody can
    // review.
    //
    // **The future edit that makes it load-bearing is any change to the `profiles` SELECT policy** —
    // narrow it, and a live account starts reading its own profile as absent, at which point this
    // page silently re-denominates every figure into kilograms while `/dashboard` refuses to show a
    // number at all. Whoever makes that edit should decide which of the two behaviours is right and
    // change this assertion deliberately, rather than discovering the asymmetry from a diff.
    const html = await render(Records, {
      profiles: profileChain(null),
      personal_records: twoOrderChain([RECORD_ROW]),
    });

    expect(html).toContain(RECORD_FIGURE_CLASS);
    expect(html).not.toContain(RECORDS_FAILED);
  });
});

describe("workouts/index.astro keeps the form when the list fails", () => {
  it("5. a failed list read prints the failure sentence and KEEPS the new-workout form", async () => {
    const html = await render(Workouts, {
      profiles: profileChain(PROFILE),
      workouts: twoOrderChain("throw"),
    });

    expect(html).toContain(WORKOUTS_FAILED);
    expect(html).not.toContain(WORKOUTS_EMPTY);
    // **The non-obvious half.** The page puts the form ABOVE the failure branch on purpose
    // (`workouts/index.astro:47-52`): starting a workout does not depend on the read that failed,
    // and it is the one thing the user came here to do. Moving the form inside the `else` reads as
    // tidier and removes the only available action at the moment the page is already degraded.
    expect(html).toContain("astro-island");
    expect(html).toContain("NewWorkoutForm");
  });

  it("6. and still lists a workout when the read works — the positive control", async () => {
    const html = await render(Workouts, {
      profiles: profileChain(PROFILE),
      workouts: twoOrderChain([
        {
          id: WORKOUT_ID,
          performed_on: "2026-08-19",
          note: "leg day",
          created_at: "2026-08-19T10:00:00Z",
          exercise_entries: [{ count: 3 }],
        },
      ]),
    });

    expect(html).toContain("2026-08-19");
    expect(html).toContain("leg day");
    expect(html).not.toContain(WORKOUTS_FAILED);
  });

  it("7. an account with no workouts is a THIRD state", async () => {
    const html = await render(Workouts, { profiles: profileChain(PROFILE), workouts: twoOrderChain([]) });

    expect(html).toContain(WORKOUTS_EMPTY);
    expect(html).not.toContain(WORKOUTS_FAILED);
  });
});

describe("workouts/[id].astro tells three outcomes apart, and one of them is a status code", () => {
  /** `renderToResponse`, because two of the three outcomes differ by status rather than by HTML. */
  async function renderDetail(id: string, tables: Record<string, unknown>) {
    const response = await (
      await container()
    ).renderToResponse(WorkoutDetailPage as never, { locals: locals(tables), params: { id } });
    return { status: response.status, html: await response.text() };
  }

  it("8. a workout that is absent or not yours answers 404 and says so", async () => {
    // `getWorkout` returns null for both cases on purpose, so this page cannot be used to learn
    // which ids are real.
    const { status, html } = await renderDetail(WORKOUT_ID, { workouts: singleWorkoutChain(null) });

    expect(status).toBe(404);
    expect(html).toContain(WORKOUT_MISSING);
    expect(html).not.toContain(WORKOUT_FAILED);
  });

  it("9. a FAILED read is not a 404 — the database being unreachable is not evidence of absence", async () => {
    // **The regression this exists for.** Collapsing `loadFailed` into the not-found branch would
    // tell a user their workout does not exist when the database was merely unreachable — an
    // existence claim manufactured from a failed read. `[id].astro:33-35` guards it with
    // `!loadFailed && !workout`, and nothing until now would have noticed that guard going away.
    const { status, html } = await renderDetail(WORKOUT_ID, { workouts: singleWorkoutChain("throw") });

    expect(html).toContain(WORKOUT_FAILED);
    expect(html).not.toContain(WORKOUT_MISSING);
    expect(status).not.toBe(404);
  });

  it("10. a malformed id answers 404 WITHOUT running a query", async () => {
    // **Proven by the stub's tripwire rather than asserted directly.** The stub throws on any table
    // it is asked for, so passing NO tables makes "a query ran" an exception rather than a silent
    // pass. Postgres answers `22P02` for a uuid column handed something that is not one, surfacing
    // as a 500 for what is really "no such row" — and a 500 is a different fact about the system
    // than a 404 (`AGENTS.md` § Access control).
    const { status, html } = await renderDetail("not-a-uuid", {});

    expect(status).toBe(404);
    expect(html).toContain(WORKOUT_MISSING);
  });

  it("11. and renders the workout when everything works — the positive control", async () => {
    const { status, html } = await renderDetail(WORKOUT_ID, {
      workouts: singleWorkoutChain({
        id: WORKOUT_ID,
        performed_on: "2026-08-19",
        note: "leg day",
        exercise_entries: [],
      }),
      exercises: catalogueChain([]),
      profiles: profileChain(PROFILE),
    });

    expect(status).toBe(200);
    expect(html).toContain("WorkoutDetail");
    expect(html).not.toContain(WORKOUT_FAILED);
    expect(html).not.toContain(WORKOUT_MISSING);
  });
});

describe("exercises.astro states a failed catalogue read instead of showing an empty one", () => {
  it("12. a failed read prints the failure sentence and does NOT render the catalogue island", async () => {
    const html = await render(Exercises, { exercises: catalogueChain("throw") });

    expect(html).toContain(CATALOGUE_FAILED);
    // The page's own comment: without this branch a failed read is indistinguishable from a seed
    // that never landed — and the catalogue is seeded by migration, so "empty" would read as a
    // broken deployment rather than as a broken request.
    expect(html).not.toContain("ExerciseCatalogue");
  });

  it("13. and still renders the island with the catalogue when the read works — the positive control", async () => {
    // Without this, "the island is absent" is satisfied by a page that never renders it.
    const html = await render(Exercises, {
      exercises: catalogueChain([
        {
          id: "44444444-4444-4444-8444-444444444444",
          user_id: null,
          name: "Barbell squat",
          muscle_group: "legs",
          is_bodyweight: false,
          created_at: "2026-08-01T00:00:00Z",
        },
      ]),
    });

    expect(html).toContain("ExerciseCatalogue");
    expect(html).toContain("Barbell squat");
    expect(html).not.toContain(CATALOGUE_FAILED);
  });
});
