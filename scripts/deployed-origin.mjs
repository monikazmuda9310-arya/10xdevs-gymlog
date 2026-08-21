// The deployed Worker's origin — ONE definition, read by two things that must not disagree.
//
// `scripts/env-parity.mjs` asserts that production's Supabase `site_url` points here, and
// `scripts/deploy-smoke.mjs` probes here after a deploy. Two literals would let the parity check
// bless a `site_url` aimed somewhere the smoke never visits, and neither would notice.
//
// **`site_url` is the trap no test can see** (AGENTS.md § Environment): it decides where a
// confirmation link sends a user, it lives in Supabase project config rather than in this
// repository, and getting it wrong is silent — the account confirms correctly, the database looks
// right, every suite passes, and the user sees "site unreachable". It shipped wrong once already
// (`lessons.md` § "`site_url` shipped wrong and no test could see it"), as `http://localhost:3000`.
//
// **If the deployed URL ever changes, changing it here is not enough.** The Supabase project config
// must change with it, and the only way to verify the confirmation link end to end is for a human
// to click a real one.
export const DEPLOYED_ORIGIN = "https://gymlog.10x-astro-starter.workers.dev";

// Supabase sends a confirmed user here. It is the sign-in page rather than the origin, so somebody
// arriving from an email lands on something that explains what to do next.
export const EXPECTED_SITE_URL = `${DEPLOYED_ORIGIN}/auth/signin`;
