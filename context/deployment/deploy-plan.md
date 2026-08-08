---
project: GymLog
platform: cloudflare-workers
planned_at: 2026-08-08
status: awaiting-approval
approval_gate: "first production deploy — contract §6.4, user decides"
---

# Deploy plan — GymLog on Cloudflare Workers

Platform rationale, scoring, and risk register: `context/foundation/infrastructure.md`.
This document is the executable counterpart — what actually gets run, in what order, and how we
know it worked.

## The decision this plan makes explicit

The deploy splits into **two stages**, because the pieces become available at different times.

Stage 1 can run right now: Cloudflare is authenticated, the Worker config is correct, and the
build is green. It produces a public URL where the landing and auth pages render.

Stage 2 needs a Supabase project, which does not exist yet. Until it lands, **sign-in cannot
work** — not as a bug, but as a direct consequence of how the starter is wired
(`src/lib/supabase.ts` returns `null` without credentials; `src/middleware.ts` then treats every
visitor as anonymous).

Running Stage 1 first is deliberate. It validates the Workers configuration, reserves the
hostname, and proves the deploy path end to end while the surface area is small enough that a
failure is easy to read. The cost of getting this wrong later — after application code exists —
is much higher than the cost of a throwaway smoke deploy now.

**What Stage 1 is not**: it is not "the app is deployed". A URL that loads but cannot
authenticate satisfies none of the product's success criteria. Do not report it as done.

## Preconditions

| Precondition | State |
| --- | --- |
| Cloudflare account | ✓ `monika.zmuda9310@gmail.com` |
| `wrangler` authenticated | ✓ OAuth token, verified via `wrangler whoami` |
| `wrangler.jsonc` name is `gymlog` | ✓ — this string becomes the public hostname |
| Deploy target is Workers, not Pages | ✓ — `wrangler deploy`, never `wrangler pages deploy` |
| `npm run build` green | ✓ |
| Supabase project | ✗ **blocks Stage 2** |

## Stage 1 — Smoke deploy (no data layer)

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy` reads `wrangler.jsonc`, which declares the adapter entrypoint and the `ASSETS`
binding pointing at `./dist`. The first run prompts to register a `workers.dev` subdomain — this
is the one-time choice that fixes the public hostname as `gymlog.<subdomain>.workers.dev`.

### Expected outcome — including the parts that must fail

| Check | Expected |
| --- | --- |
| `/` renders | ✓ |
| `/auth/signin` renders the form | ✓ |
| Submitting the sign-in form | **fails** — no data layer yet |
| `/dashboard` | redirects to `/auth/signin` |
| HTTP status on public pages | 200 |

A green Stage 1 proves the Worker builds, uploads, boots, and serves assets. It proves **nothing**
about auth. Treating a 200 here as success is precisely the failure mode the infrastructure
research flagged as risk #1.

### Rollback

```bash
npx wrangler rollback            # previous version of the Worker
npx wrangler deployments list    # inspect version history first
```

Rollback is near-instant and carries no data caveat at this stage, because there is no data.
Once migrations exist this stops being true — a Worker rollback does not roll back a schema
change. Revisit this section when the first migration lands.

## Stage 2 — Wire the data layer (blocked on Supabase)

1. Create the Supabase project. Record its URL and anon key.
2. Push the runtime secrets to the Worker — **this is a separate step from anything in CI**:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

3. Redeploy: `npm run build && npx wrangler deploy`.
4. Add the same two values as **GitHub repository secrets** so CI's build step has them. These
   are build-time only and do **not** reach the Worker at runtime; step 2 is what does that.
   Setting one and not the other is the trap.

### Verification — the only check that counts

Sign in against the deployed URL with a real account. Nothing else distinguishes a working
deployment from a broken one: the build passes, the pipeline is green, and every page returns
200 in both cases. Automate this as an E2E smoke test against the deployed URL when the browser
test lands in the quality phase.

## Approval gate

Contract §6.4 reserves the first production deploy for the user. Stage 1 is not run until
approved. Stage 2 is gated behind Stage 1 and the Supabase project.

## Known constraints carried from the infrastructure research

- **Workers Free caps CPU at 10 ms per invocation** — a hard kill (Error 1102), not a throttle.
  Weekly tonnage and per-muscle-group rollups must be aggregated in Postgres. This is a design
  constraint on the first data slice, not a deployment step.
- **Supabase free tier auto-pauses after ~1 week of inactivity**, and releases the API URL
  permanently after 90 days paused. A graded public URL that nobody visits will break itself.
- **Astro is pinned at 6.x** because Astro 7 fails to build against this adapter, which leaves one
  HIGH advisory in `astro` unpatched. Recorded in
  `context/changes/bootstrap-verification/verification.md`.
