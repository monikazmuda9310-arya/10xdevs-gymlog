---
project: GymLog
platform: cloudflare-workers
planned_at: 2026-08-08
status: complete
approval_gate: "first production deploy — contract §6.4, user decides"
approved_at: 2026-08-09
deployed_url: https://gymlog.10x-astro-starter.workers.dev
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

| Precondition                        | State                                                |
| ----------------------------------- | ---------------------------------------------------- |
| Cloudflare account                  | ✓ `monika.zmuda9310@gmail.com`                       |
| `wrangler` authenticated            | ✓ OAuth token, verified via `wrangler whoami`        |
| `wrangler.jsonc` name is `gymlog`   | ✓ — this string becomes the public hostname          |
| Deploy target is Workers, not Pages | ✓ — `wrangler deploy`, never `wrangler pages deploy` |
| `npm run build` green               | ✓                                                    |
| Supabase project                    | ✗ **blocks Stage 2**                                 |

## Stage 1 — Smoke deploy (no data layer)

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy` reads `wrangler.jsonc`, which declares the adapter entrypoint and the `ASSETS`
binding pointing at `./dist`. The first run prompts to register a `workers.dev` subdomain — this
is the one-time choice that fixes the public hostname as `gymlog.<subdomain>.workers.dev`.

### Expected outcome — including the parts that must fail

| Check                           | Expected                      |
| ------------------------------- | ----------------------------- |
| `/` renders                     | ✓                             |
| `/auth/signin` renders the form | ✓                             |
| Submitting the sign-in form     | **fails** — no data layer yet |
| `/dashboard`                    | redirects to `/auth/signin`   |
| HTTP status on public pages     | 200                           |

A green Stage 1 proves the Worker builds, uploads, boots, and serves assets. It proves **nothing**
about auth. Treating a 200 here as success is precisely the failure mode the infrastructure
research flagged as risk #1.

### Actual outcome — run 2026-08-09, approved under §6.4

Public URL: **https://gymlog.10x-astro-starter.workers.dev** · Version ID
`6d4b7093-1592-4cc9-9420-73af9b50f572` · Worker startup 30 ms · 8 assets, 1931 KiB (395 KiB gzip).

Every row of the table above came back exactly as predicted: `/` 200, `/auth/signin` 200 with both
the email and password inputs present, `/auth/signup` 200, `/dashboard` 302 → `/auth/signin`, and
`POST /api/auth/signin` **500** — the expected failure, because `src/lib/supabase.ts` returns
`null` without credentials. **This is not a working deployment.** It is a validated deploy path.

Three things the plan did not anticipate:

- **The `workers.dev` subdomain was already registered** on this account as `10x-astro-starter`,
  so no one-time prompt appeared and the hostname is `gymlog.10x-astro-starter.workers.dev`, not
  `gymlog.<new-subdomain>.workers.dev`. The `gymlog` half still comes from `wrangler.jsonc`
  `"name"`, so renaming the Worker still abandons this URL.
- **A KV namespace was auto-provisioned.** `wrangler deploy` found an unbound `env.SESSION`
  binding and created `gymlog-session` (`177a1a6f2ef64192a7bb63ff116d10cf`) without being asked.
  It backs Astro's session store. Nothing in the repository referenced it before this deploy.
- **The edge certificate for a fresh hostname is not instant.** For the first ~30 seconds every
  request died at the TLS handshake (`SSL alert number 40`) while general connectivity was fine.
  A failed handshake immediately after a first deploy means wait, not debug.

### Rollback

```bash
npx wrangler rollback            # previous version of the Worker
npx wrangler deployments list    # inspect version history first
```

Rollback is near-instant **for code only**. It does not touch the schema.

The first migration landed on 2026-08-10 (`20260810063450_create_profiles_with_row_ownership`),
so the caveat this section used to defer is now live:

- **`npx wrangler rollback` reverts the Worker, on production only.** The database stays where the
  last `npm run db:push` left it. A rollback past a migration therefore leaves code that predates
  the schema running against it.
- **There are no down migrations.** Supabase's model is forward-only. A schema mistake is undone by
  a **new forward migration** dropping what the old one created, in reverse dependency order —
  for this one that reads `drop trigger on_auth_user_created on auth.users;` →
  `drop function public.handle_new_user, public.set_updated_at;` → `drop table public.profiles;` →
  `drop type public.weight_unit, public.estimation_formula;`. It is applied with
  `npm run db:push` like any other, which rolls **both** databases forward together.
- **Order matters, and it is the deploy's constraint, not the migration's.** Deploy code that
  tolerates the old schema first, or accept a window in which the two disagree. There is no
  ordering that avoids the window entirely; there is only choosing which side of it is safe.
- **`gymlog-test` is not a backup.** It holds no recoverable data — it is a schema mirror whose
  only job is to catch a bad migration before production sees it. A rollback that fixes production
  must be pushed to it too, or the next `npm run db:status` shows divergence.

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

### Stage 2 — run 2026-08-09

Project `cdzybmwxtefhbanfytna`, region Central EU (Frankfurt), free plan. All four steps executed:
`.env` + `.dev.vars` written (both gitignored, confirmed with `git check-ignore`), both runtime
secrets uploaded via `wrangler secret bulk` and confirmed with `wrangler secret list`, both
repository secrets set with `gh secret set`, and the Worker rebuilt and redeployed
(version `9ad3c7de-00ac-4e86-beac-ee2ff109cbf6`).

**The key is the new-format `sb_publishable_…`, not a legacy `anon` JWT.** It works unchanged —
`@supabase/ssr` passes the key through opaquely, and `GET /auth/v1/settings` authenticates with it.
Nothing in this repository needs to know the difference.

Two traps found while verifying, both worth carrying into the browser-test phase:

- **The auth endpoints read `formData()`, not JSON.** A JSON probe against
  `POST /api/auth/signin` returns **500** from the failed `formData()` parse — which looks exactly
  like the missing-credentials failure it is not. Send `application/x-www-form-urlencoded`.
- **Astro's `security.checkOrigin` rejects the POST with 403** unless the request carries an
  `Origin` header matching the deployment. A browser form does this automatically; a scripted
  `fetch` does not. Any programmatic auth call in a test must set `Origin` explicitly.

With both corrected, `POST /api/auth/signin` for a non-existent account returns
`302 → /auth/signin?error=Invalid login credentials`. That error text is the proof the Worker
reached Supabase and Supabase authenticated the request — the pre-secrets behaviour was a
`Supabase is not configured` redirect, and a wrong key would have said so instead.

**Email confirmation was turned off** by the owner in the dashboard (Authentication → Sign In /
Providers → Email → Confirm email), confirmed by `mailer_autoconfirm: true` on
`GET /auth/v1/settings`. The free plan sends two emails an hour, which would make the browser tests
of the quality phase — every one of which has to create its own account — untenable. This is a
development-environment setting and should be revisited before the product carries real users.

### Verification — the only check that counts

Sign in against the deployed URL with a real account. Nothing else distinguishes a working
deployment from a broken one: the build passes, the pipeline is green, and every page returns
200 in both cases. Automate this as an E2E smoke test against the deployed URL when the browser
test lands in the quality phase.

**Done, 2026-08-09.** Six steps against `https://gymlog.10x-astro-starter.workers.dev`, carrying
cookies between them, with a throwaway account (`smoke-1786276093721@gymlog-test.dev`):

| #   | Request                                    | Result                                                        |
| --- | ------------------------------------------ | ------------------------------------------------------------- |
| 1   | `POST /api/auth/signup`                    | 302 → `/auth/confirm-email`, session cookies set              |
| 2   | `GET /dashboard`                           | **200** — signed in                                           |
| 3   | `POST /api/auth/signout`                   | 302 → `/`                                                     |
| 4   | `GET /dashboard`                           | **302 → `/auth/signin`** — session really is gone             |
| 5   | `POST /api/auth/signin` (fresh cookie jar) | 302 → `/`                                                     |
| 6   | `GET /dashboard`                           | **200**, and the page renders the account's own email address |

Step 4 is the one that matters as much as step 6: it rules out a page that returns 200 to
everybody. Step 6 rendering the account's own address rules out a session that authenticates but
resolves to nobody.

The signup step still redirects to `/auth/confirm-email` even though the account is usable
immediately — the page is unconditional in the starter. Harmless, but it will read as a bug to
anyone testing by hand, and belongs to S-01 (`account-access`) to fix.

**The throwaway account still exists in `auth.users`** and cannot be deleted without a
`service_role` key. Clean it up when S-09 lands account deletion, or from the dashboard.

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
