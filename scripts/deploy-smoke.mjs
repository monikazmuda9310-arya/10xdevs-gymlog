// Does the DEPLOYED Worker still have working Supabase credentials?
//
// Risk #7 (test-plan.md § 2): "the Worker deploys green, serves 200s, and nobody can sign in because
// runtime secrets are absent". `infrastructure.md` records that happening here once already, with CI
// green throughout, and no pipeline can catch it: GitHub repository secrets are build-time only, and
// the Worker needs its own `wrangler secret put`.
//
// **An unauthenticated GET cannot see this, and the mitigation the risk register proposed does not
// work.** That mitigation was "fetch /auth/signin and assert the 'Supabase not configured' banner is
// absent". Measured 2026-08-21: `messageForCode(null)` returns `null`
// (`src/lib/validation/auth.ts`), so with no `?error=` in the URL there is NO banner in either case
// — the assertion passes exactly as well when the secrets are missing. Probing the live URL the same
// day: `/` and `/auth/signin` answered 200 and `/dashboard` answered 302, and all four lines would
// read identically with the credentials removed.
//
// The signal is the `?error=` CODE on the redirect after a POST, and it separates four different
// facts about the deployment. Nothing here needs an account, a password or a secret.
//
// Usage: node scripts/deploy-smoke.mjs [base-url]
// Exit:  0 reachable and credentialed · 1 the deployment is broken · 2 the probe could not be made
//        · 3 inconclusive (rate limited)

import { pathToFileURL } from "node:url";

import { DEPLOYED_ORIGIN } from "./deployed-origin.mjs";

export const HEALTHY = 0;
export const BROKEN = 1;
export const UNPROBEABLE = 2;
export const INCONCLUSIVE = 3;

const VERDICTS = {
  sign_in_failed: {
    exit: HEALTHY,
    headline: "the Worker reached Supabase and got a genuine identity refusal",
    detail: "Runtime secrets are present and the provider accepted them.",
  },
  not_configured: {
    exit: BROKEN,
    headline: "SUPABASE_URL / SUPABASE_KEY are ABSENT from the Worker",
    detail:
      "`src/lib/supabase.ts` returned null, so every protected route redirects and nobody can sign in.\n" +
      "  Fix:  npx wrangler secret put SUPABASE_URL\n" +
      "        npx wrangler secret put SUPABASE_KEY\n" +
      "  Do NOT roll back — the previous version has the same missing secrets, because secrets are\n" +
      "  Worker state rather than deployment state. Rolling back would hide this rather than fix it.",
  },
  unexpected: {
    exit: BROKEN,
    headline: "the credentials are present and the provider refused them",
    detail:
      "A wrong key, a wrong project URL, or a provider error this repository does not map.\n" +
      "  The Worker logged the raw provider code — `npx wrangler tail` will show it.\n" +
      "  Recovery: re-put the secrets, or  npx wrangler rollback  to the last known-good version.",
  },
  rate_limited: {
    exit: INCONCLUSIVE,
    headline: "Supabase is throttling this IP",
    detail:
      "This says nothing about the deployment — Supabase limits `signInWithPassword` per IP, and\n" +
      "  a smoke run repeatedly can cause it itself. Wait and re-run. NOT a failure.",
  },
};

/**
 * A well-formed address that cannot belong to anybody.
 *
 * `example.com` is reserved by RFC 2606, and the random local part makes a collision with a real
 * account impossible anyway. Both halves have to clear two separate gates: this project's own
 * `isValidEmail` (or the endpoint answers `email_invalid` before Supabase is ever called) and
 * Supabase's own address validation (or the provider answers something that maps to `unexpected`,
 * which this script reports as a BROKEN deployment). **That second gate is why the address is
 * measured rather than assumed** — see the plan's § Measurement record, P5.3.
 *
 * The password only has to be non-empty: `signInSchema` sets no minimum, deliberately, so that an
 * account created under an older rule can still sign in (`src/lib/validation/auth-schemas.ts`).
 */
function probeCredentials() {
  const nonce = Math.random().toString(36).slice(2, 12);
  return {
    email: `deploy-smoke-${nonce}@example.com`,
    password: `no-such-password-${nonce}`,
  };
}

export async function smoke(base = DEPLOYED_ORIGIN, { sendOrigin = true } = {}) {
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    console.error(`deploy-smoke: ${JSON.stringify(base)} is not a URL.`);
    return UNPROBEABLE;
  }

  const { email, password } = probeCredentials();
  const body = new URLSearchParams({ email, password });

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  // **Astro's `security.checkOrigin` is on by default for `output: "server"`**, so a form-encoded
  // POST carrying no `Origin` is answered 403 BEFORE any handler runs — which reads exactly like an
  // absent credential and would make this probe blame the deployment for its own omission
  // (measured as P4.4 during the `testing-browser-layer` change; `scripts/e2e-serve.mjs`). A real
  // browser sends the header itself; a `fetch` has to be told.
  if (sendOrigin) {
    headers.Origin = origin;
  }

  let response;
  try {
    response = await fetch(`${origin}/api/auth/signin`, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
    });
  } catch (error) {
    console.error(`deploy-smoke: could not reach ${origin} — ${error.message}`);
    console.error(`  This is a probe failure, not a verdict about the deployment.`);
    return UNPROBEABLE;
  }

  const location = response.headers.get("location");
  if (!location) {
    console.error(`deploy-smoke: ${origin} answered ${response.status} with no redirect.`);
    if (response.status === 403) {
      console.error(
        `  A 403 with no Location is Astro's origin check, not the application. The probe did not\n` +
          `  reach a handler, so this says NOTHING about the Worker's credentials.`,
      );
    }
    return UNPROBEABLE;
  }

  const code = new URL(location, origin).searchParams.get("error");
  if (!code) {
    // No error code means the sign-in SUCCEEDED, which cannot happen for a random address — so
    // something answered that is not this application.
    console.error(`deploy-smoke: ${origin} redirected to ${location} with no error code.`);
    console.error(`  A random address must not authenticate. Whatever answered is not this app.`);
    return UNPROBEABLE;
  }

  const verdict = VERDICTS[code];
  if (!verdict) {
    console.error(`deploy-smoke: unrecognised code ${JSON.stringify(code)} from ${origin}.`);
    console.error(`  Not one of: ${Object.keys(VERDICTS).join(", ")}.`);
    return UNPROBEABLE;
  }

  const label = verdict.exit === HEALTHY ? "PASS" : verdict.exit === INCONCLUSIVE ? "INCONCLUSIVE" : "FAIL";
  console.log(`deploy-smoke: ${label} — ${origin} answered ?error=${code}`);
  console.log(`  ${verdict.headline}`);
  console.log(`  ${verdict.detail}`);

  // **Printed on every pass, so nobody reads more into it than it says.** Both limits are real and
  // neither is closable without a production account.
  if (verdict.exit === HEALTHY) {
    console.log(
      `\n  What this does NOT prove:\n` +
        `    * WHICH Supabase project the Worker points at. SUPABASE_URL aimed at gymlog-test would\n` +
        `      answer identically — only a successful sign-in names the project, via its cookie.\n` +
        `    * that a real account can complete a session and see its training. This proves the auth\n` +
        `      provider is reachable and credentialed, which is what risk #7 is about.`,
    );
  }

  return verdict.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await smoke(process.argv[2] ?? DEPLOYED_ORIGIN));
}
