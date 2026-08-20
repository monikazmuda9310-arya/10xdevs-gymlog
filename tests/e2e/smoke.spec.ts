import { expect, test } from "@playwright/test";

/**
 * The harness itself, asserted once.
 *
 * This spec proves nothing about the product — `tests/render/` already renders pages far more
 * cheaply. What it proves is that the BUILT worker is up, serving, and reachable at `baseURL`, so
 * that when `critical-flow.spec.ts` fails there is one line in the report saying whether the harness
 * or the flow is at fault.
 *
 * It is deliberately a signed-OUT page. `/auth/signin` is in neither `PROTECTED_ROUTES` nor a
 * position to need credentials, so it answers even when `SUPABASE_URL` / `SUPABASE_KEY` never
 * reached the worker — which means a green smoke and a red flow is exactly the signature of the
 * launcher having been bypassed (`scripts/e2e-serve.mjs` header: absent, never wrong).
 */
test("the built worker serves the sign-in page", async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
