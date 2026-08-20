import { expect, test } from "@playwright/test";

import { RUN_ACCOUNT_EMAIL, RUN_ACCOUNT_PASSWORD, RUN_ID } from "./_shared/account";

/**
 * The one flow a person actually performs: sign up → create a workout → log a set → **see what it
 * is worth**. Risk #4.
 *
 * **What this suite can see that the other four cannot: whether a screen that renders also DOES
 * anything.** Every island in this product is `client:load`. A form that server-renders perfectly
 * and hydrates into nothing passes `npm test` (hermetic, no DOM), `npm run test:render` (asserts on
 * the HTML, which is correct) and `npm run test:integration` (drives handlers directly, never a
 * browser). Four of the five defects this product has shipped were of that shape.
 *
 * **One account per run, one browser, no retries.** `playwright.config.ts` names the address;
 * `globalTeardown` removes it through `delete_own_account()`. An interrupted run leaks one account
 * carrying the `t2e-` mark, not seven — the RPC cannot rescue a run that was killed before it, so
 * the mark is the recovery path, not the cleanup.
 *
 * **NOT asserted here, deliberately: anything about viewport, layout or reachability at a phone
 * width.** "The control is unusable at a phone width" is the other half of risk #4 and it has no
 * assigned layer anywhere in `test-plan.md` §2. It stays a named gap; this spec does not imply
 * otherwise by adding a viewport nobody agreed to test at.
 */

const NOTE = `t2e-flow-${RUN_ID}`;

/** Serial, because the three assertions are three stages of ONE session, not three scenarios. */
test.describe.configure({ mode: "serial" });

test("a person signs up, logs a set, and sees what it is worth", async ({ page }) => {
  // ---------------------------------------------------------------- sign up
  // Confirmation is OFF on `gymlog-test`, so `signUp` returns a session and `signUpDestination()`
  // sends the browser to `/dashboard` rather than `/auth/confirm-email`
  // (`tests/integration/auth-flows.test.ts` assertion 1 is what would notice that flipping).
  await page.goto("/auth/signup");
  await page.getByLabel("Email").fill(RUN_ACCOUNT_EMAIL);
  // `exact`, because `getByLabel` matches substrings by default and "Confirm password" contains
  // "Password". Both fields also carry the IDENTICAL `aria-label="Show password"` on their toggle
  // (`PasswordToggle.tsx:14`), which is why nothing here locates by that name.
  await page.getByLabel("Password", { exact: true }).fill(RUN_ACCOUNT_PASSWORD);
  await page.getByLabel("Confirm password").fill(RUN_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // ---------------------------------------------------------------- start a workout
  // The date field arrives prefilled with today in the account's timezone (`workouts/index.astro:23`,
  // default `Europe/Warsaw`), so it is left alone: typing a date here would test the date picker
  // rather than the flow, and would make the run's outcome depend on the hour it started.
  await page.goto("/workouts");

  // **A `fill()` that lands before the island hydrates is SILENTLY LOST, and this is the shape of
  // every interaction with a controlled input in this product.** The DOM takes the text; React's
  // state does not, because the handler is not attached yet; hydration then restores the empty
  // value. Measured 2026-08-20: **one run in three** lost the exercise picker's search this way.
  // `toPass()` retries the fill until the island's own state reflects it — waiting on state, which
  // is the rule, rather than sleeping, which is not.
  //
  // **This retry verifies through `toHaveValue`, which is the WEAKER form, and that is a deliberate
  // exception rather than an oversight** (`test-plan.md` §6.3 warns against it: the DOM is what lies
  // in this failure, so the value can read back while React's state is still empty). There is no
  // framework-state observable on this form before it is submitted — nothing here filters, counts or
  // re-renders. What closes the gap is the **positive control after navigation**: the note has to be
  // on the workout page, which only a value that reached React, the API and the database can put
  // there. The picker below has a real observable and uses it.
  const noteField = page.getByLabel("Note");
  await expect(async () => {
    await noteField.fill(NOTE);
    await expect(noteField).toHaveValue(NOTE, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Start workout" }).click();

  // **Success is a NAVIGATION, not a message** — `NewWorkoutForm.tsx:52` assigns
  // `window.location.href` and renders nothing to confirm with. Waiting on state, never a timeout.
  await page.waitForURL(/\/workouts\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f]{12}/);
  const workoutUrl = page.url();

  // **The positive control for assertion 3, and it is not optional.** Assertion 3 proves signing out
  // by looking for this note and finding NOTHING — which a note that was never saved satisfies
  // perfectly. Without this line a lost `fill()` would turn the strongest assertion in the spec into
  // one that passes for the wrong reason and reports green (`lessons.md` § "A guard you have not
  // mutated may not guard"). Here it is training that is provably on screen while signed in.
  await expect(page.getByText(NOTE)).toBeVisible();

  // ---------------------------------------------------------------- add an exercise
  // **THE HYDRATION TRIPWIRE, and it is here rather than further down for a measured reason.** The
  // picker's filter is client-side (`ExercisePicker.tsx:25`), so a catalogue that has NARROWED is
  // proof that a handler ran — something no amount of correct server-rendered HTML can fake.
  //
  // Without this line the whole spec still goes red when `WorkoutDetail` stops hydrating, but it
  // goes red one step later, on `getByLabel("Reps")` timing out — measured under mutation 6.4, and
  // that message is indistinguishable from somebody having renamed the label. Two very different
  // defects reporting identically is the ambiguity `lessons.md` § "A mutation that fails for the
  // WRONG REASON has not confirmed the guard" is about. With this line, an unhydrated island fails
  // HERE — measured: `Expected: 0, Received: 3`, the three seeded names containing "Bench Press",
  // i.e. the unfiltered catalogue still on screen — and a renamed field fails at its own locator
  // below. Retried with the fill for the reason given on `/workouts` above; under a genuinely
  // unhydrated island it never passes and the timeout reports this same count.
  const search = page.getByLabel("Search exercises");
  await expect(async () => {
    await search.fill("Lat Pulldown");
    await expect(page.getByRole("button", { name: /Bench Press/ })).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // **`Lat Pulldown`, chosen for a locator reason and not an anatomical one**: among the 38 seeded
  // names it is a substring of no other, unlike `Bench Press` (⊂ `Incline Bench Press`) and
  // `Deadlift` (⊂ `Romanian Deadlift`). The button's accessible name concatenates the name, any
  // badges and the muscle group, so it is matched non-exactly.
  await page.getByRole("button", { name: /Lat Pulldown/ }).click();
  // The click's EFFECT, not the click: `POST /api/exercise-entries` landed and the island
  // re-rendered with the entry. Asserting the button was clickable would prove only that it existed.
  await expect(page.getByRole("heading", { name: "Lat Pulldown" })).toBeVisible();

  // ---------------------------------------------------------------- 1. the flow, to a number
  await page.getByLabel("Reps").fill("5");
  // The unit is IN the label (`AddSetForm.tsx:118-120`) and the account's default is `kg`.
  await page.getByLabel("Weight (kg)").fill("100");
  // Icon-only submit. Its `aria-label` is static, so the name does not change while the request is
  // in flight and is NOT a pending signal — the set row appearing is.
  await page.getByRole("button", { name: "Add set" }).click();

  // **Row-scoped on purpose.** The entry header carries "Best estimated 1RM here: 112.5 kg" as well
  // (`WorkoutDetail.tsx:351-357`), so a page-level `getByText("112.5")` would pass even if the
  // per-set slot rendered nothing. `hasNotText: "Lat Pulldown"` is what separates the set row from
  // the entry `<li>` that wraps it — the entry renders the name as a heading, the set row carries it
  // only inside `aria-label`s, which `hasText` does not read.
  const firstSet = page.getByRole("listitem").filter({ hasText: "5 × 100 kg", hasNotText: "Lat Pulldown" });
  await expect(firstSet).toHaveCount(1);
  // Brzycki at the account's default formula: 100 × 36 / (37 − 5) = 112.5. The assertion is on the
  // NUMBER that appeared as a result of submitting the form, not on the element being present — a
  // slot that renders for every input proves nothing.
  await expect(firstSet).toContainText("≈ 112.5 kg 1RM");

  // ------------------------------------------- 2. the product declines to guess, on screen
  // 15 reps is outside 1–12, where an estimate would be fabricated (Brzycki divides by zero at 37
  // and goes negative beyond). The unit tests already pin `estimateForLoggedSet`; what is pinned
  // HERE is that the refusal occupies the same slot the number does, which is what a user reads.
  // Without it this spec would be happy-path only, and a flow that only ever sees a number cannot
  // tell a working estimator from one that prints something for every input.
  await page.getByLabel("Reps").fill("15");
  await page.getByLabel("Weight (kg)").fill("60");
  await page.getByRole("button", { name: "Add set" }).click();

  const secondSet = page.getByRole("listitem").filter({ hasText: "15 × 60 kg", hasNotText: "Lat Pulldown" });
  await expect(secondSet).toContainText("outside 1–12 reps — no estimate");
  await expect(secondSet).not.toContainText("1RM");

  // ---------------------------------------------------------------- 3. sign out ends it
  // **There is no sign-out control on `/workouts` or `/workouts/[id]`** — only the landing page's
  // Topbar and `dashboard.astro:307-314`, a plain form POST needing no hydration.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/auth/signin");

  await page.goto(workoutUrl);
  // **The data read is the claim and goes FIRST** (`lessons.md` § "The assertion carrying the claim
  // goes FIRST"): a sign-out that redirected while leaving a usable session behind would still
  // satisfy the URL check below, and measuring that ordering is exactly what Phase 3's mutation 3.6
  // recorded. Both of these were proven to be ON this screen while signed in — the note by its
  // positive control above, the set row by assertion 1 — so neither absence can be vacuous.
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByText("5 × 100 kg")).toHaveCount(0);
  // Diagnostic, not load-bearing: it says WHERE the browser ended up when the line above fails.
  await expect(page).toHaveURL(/\/auth\/signin/);

  // **The only delta over Phase 3** — `tests/middleware/session-lifecycle.test.ts` assertion 2
  // already proves this at the cookie level, with a doubled `AstroCookies`. What is new here is that
  // a real browser jar honours the `Set-Cookie` the worker actually emitted. Cite Phase 3 as the
  // evidence for risk #3, not this line.
});
