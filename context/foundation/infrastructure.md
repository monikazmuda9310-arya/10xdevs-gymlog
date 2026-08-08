---
project: GymLog
researched_at: 2026-08-08
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR, output "server") + React 19
  runtime: Cloudflare workerd (via @astrojs/cloudflare v13.5.0, wrangler v4.x)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only shortlisted platform that costs nothing indefinitely at this
project's scale *and* requires zero migration work: the scaffolded repo already ships a Workers
configuration (`wrangler.jsonc` with `main` + an `assets` binding), the `@astrojs/cloudflare`
adapter is installed, and `astro dev` already runs on the real workerd runtime. It passes all
five agent-friendly criteria outright — `wrangler` covers deploy, rollback, secrets and log
tailing from the terminal with no dashboard step, Cloudflare publishes `llms.txt` and official
MCP servers, and the Free plan's 100,000 requests/day ceiling is roughly three orders of
magnitude above one Polish lifter logging four sessions a week. The interview answers point the
same way: no persistent connections needed (so nothing is lost to the serverless model), cost
minimised over DX, single region, external Supabase already chosen as the data layer, and no
prior platform familiarity to break a tie toward something else.

The counterweight was taken seriously. The binding budget here is three weeks of after-hours
work, not dollars — a platform that burns two evenings on setup is more expensive than one that
costs $5/month. That test also favours Workers: the alternatives all require swapping the Astro
adapter and re-verifying a build that is already fragile on this stack. The adapter swap is a
bounded one-file change, but "bounded" is not "free" on a repo whose Astro 7 build already
fails for adapter-related reasons.

> **Interview note.** The five constraint questions were answered by the coordinating session
> rather than gathered from the developer directly. The answers are recorded above and drove
> the weighting exactly as if they had been collected in conversation.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | **4 Pass / 1 Partial** |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Render** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Railway** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Fly.io** | Pass | Partial | Pass | Pass | Partial | **3 Pass / 2 Partial** |

Raw Pass counts cluster tightly; the separation comes from the soft weights (cost, single
region, external data layer) and from the adapter already installed. Notes per platform:

**Cloudflare Workers — 5 Pass.** `wrangler deploy`, `wrangler rollback [version-id]`,
`wrangler tail`, `wrangler secret put`, `wrangler versions upload|deploy` and
`wrangler deployments list` are all GA in wrangler 4.x, so the entire operational loop is
terminal-only. Fully managed edge serverless — no OS, no container, no Dockerfile. Cloudflare
publishes `llms.txt`, keeps docs in a public repo, and runs official remote MCP servers
(docs, bindings, observability; core servers GA, some domain servers still beta). Free plan:
100,000 requests/day, static-asset requests free and unlimited, no automatic overage billing —
hitting a cap throttles until the 00:00 UTC reset rather than issuing an invoice. The binding
free-plan constraints are **10 ms CPU per invocation** and a **3 MB compressed** Worker, both
of which land in the risk register rather than disqualifying the platform.

**Vercel — 4 Pass / 1 Partial.** `vercel deploy --prod`, `vercel rollback`, `vercel logs
--follow` are all CLI-native and GA, which is what keeps criterion 1 at Pass (on Hobby,
rollback is restricted to the immediately-previous production deployment). `llms.txt` and
`llms-full.txt` are published. Vercel MCP is still **public beta** — the only Partial. Hobby is
effectively free at this traffic and, importantly, its single permitted region can be Frankfurt
(`fra1`) or Stockholm (`arn1`), so a Poland-based user is not pinned to a US region. Overage
hard-pauses rather than auto-billing. Two caveats that stop it from winning: it needs an
adapter swap to `@astrojs/vercel`, pinned to the `^10` line while this project remains on
Astro 6 (v11 is Astro-7-only); and Hobby's terms explicitly forbid commercial use, which is
fine for a course project but makes the free tier conditional in a way Cloudflare's is not.

**Netlify — 4 Pass / 1 Partial.** Strong on everything except the one criterion weighted most
heavily: **rollback is dashboard-only**. There is no `netlify rollback` — reverting means
clicking "Publish deploy" on a prior build in the UI, which is precisely the failure example
in the criteria file ("an agent cannot click"). Everything else is excellent: `netlify deploy
--prod` and the new unified `netlify logs` command, an official `llms.txt`, and the official
`@netlify/mcp` server at GA — the strongest MCP story of any candidate. Free tier moved to
credits (300/month, hard cap, no overage billing); at this traffic that is a few credits a
month. Astro 7 got day-one support, which the Cloudflare adapter did not. Requires an adapter
swap to `@astrojs/netlify`.

**Render — 4 Pass / 1 Partial.** Rollback exists via REST API (`POST /deploys/{id}/rollback`)
but not as a CLI subcommand, and the `render` CLI itself is still public beta — hence Partial
on criterion 1. Official MCP server is GA, `llms.txt` is published and current, and there is a
first-party Astro deploy guide. What sinks it is the free tier's shape rather than its score:
free web services **spin down after 15 minutes of inactivity with a 30–60 second cold start**,
and free bandwidth was cut from 100 GB to 5 GB in April 2026. Deployment producing a working
public URL is a graded requirement of this project; a reviewer opening a cold URL and waiting
50 seconds is a bad outcome that costs $7/month to avoid. PR previews are Pro-only.

**Railway — 4 Pass / 1 Partial.** Excellent DX, Railpack auto-detects a Node/Astro build with
no Dockerfile, official MCP server, PR environments, `llms-full.txt` and public docs repo.
Rollback is dashboard-only (Partial). Fails the cost constraint: the Free plan grants $1/month
of usage credit, while an always-on Node service costs roughly $3–4/month in compute alone, so
containers stop with no grace period once the credit is gone. Realistic floor is the $5/month
Hobby plan. European regions are Pro-only ($20/month).

**Fly.io — 3 Pass / 2 Partial.** Real VMs, so it would handle persistent connections — which
this app does not need, so the capability buys nothing while the operational burden (a
hand-maintained Dockerfile, `@astrojs/node`) is charged in full; that is the Partial on
"managed over raw infra". No first-class `fly rollback` (you re-deploy a prior image digest),
and the MCP server ships inside flyctl but is explicitly **experimental**. Decisive failure:
**no free tier exists for accounts created after October 2024**. A card is mandatory after a
2-VM-hour trial, and a single `shared-cpu-1x` 256 MB machine is ~$2/month minimum, with stopped
rootfs still billed. Warsaw is not a Fly region; Frankfurt is the nearest. This is disqualified
by the "must run indefinitely on a free tier" constraint.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on three axes at once. **Zero migration**: the adapter, the `wrangler.jsonc`, the
`nodejs_compat` flag and the observability block are already in the repo; the first deploy is
`npm run build && npx wrangler deploy`, not a refactor. **Zero cost, unconditionally**: 100k
requests/day free with no commercial-use clause, no card required, no overage billing, and
static assets served free and unlimited — for one user in Poland the Free plan is not a
stepping stone, it is the permanent home. **Full terminal control**: every operation this
project needs — deploy, roll back to a named version, put a secret, tail live logs, list
deployments — is a `wrangler` subcommand at GA, so an agent never needs a browser. Edge
placement is irrelevant given the single-region answer, but it costs nothing either. The price
is real coupling to a fast-moving adapter (see the cross-check below).

#### 2. Vercel

The strongest fallback and the one to reach for if the Cloudflare adapter's Astro-7 problem
outlives its welcome. It is the only alternative with a genuinely CLI-complete operational loop
including rollback, its docs are the most agent-legible of any candidate, and Hobby is free at
this traffic with a Frankfurt region available. The gap is threefold: an adapter swap to
`@astrojs/vercel` (pinned to `^10` on Astro 6), an MCP server still in public beta, and a
free tier whose terms are conditional on non-commercial use — three small frictions where
Cloudflare has none.

#### 3. Netlify

Third on the weighted score but first on agent integration: the official `@netlify/mcp` server
is GA and covers deploys, secrets and access control, which is the best structured-tool surface
in the field. Free tier is genuinely free at this volume, deploy previews are unlimited and
free, EU function regions are available at no cost, and the Astro adapter tracked Astro 7 on
day one — a pointed contrast with the Cloudflare adapter. It ranks third only because rollback
cannot be performed from the CLI, and rollback-without-a-human is the single capability this
project's autonomous-agent workflow most depends on.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The 10 ms CPU ceiling on the Free plan is a hard kill per request, not a throttle.**
   Exceeding it returns Error 1102 for that invocation. The PRD makes weekly tonnage the first
   screen after sign-in: a Monday-to-Sunday, timezone-bucketed aggregation with per-set 1RM
   estimation, unit conversion and per-muscle-group rollup. If that arithmetic runs in the
   Worker instead of in Postgres, CPU cost grows with the size of the training log — so the
   failure does not appear in week one when the log is empty. It appears in month six, on the
   home screen, for the only user.

2. **The adapter is a single point of failure and it has already failed once.**
   `@astrojs/cloudflare` is the reason this project is pinned to Astro 6: Astro 7's build dies
   with `Could not find the prerender entry point`, reproduced on 7.1.6 + adapter 14.2.0 and
   7.1.6 + 14.1.7. Four `npm audit` advisories — including a HIGH on `astro` itself (reflected
   XSS via unescaped slot name, Host-header SSRF in the prerendered error page) — resolve only
   via `astro@7`. Cloudflare is therefore not merely the deploy target; it is the reason a
   known security fix is currently out of reach.

3. **Two breaking majors in roughly a year, and the deleted APIs are the ones agents reach
   for.** Adapter v13 removed Cloudflare Pages support entirely, removed `Astro.locals.runtime`,
   removed `cloudflareModules`, changed the entrypoint contract to
   `@astrojs/cloudflare/entrypoints/server`, and flipped the default `imageService` from
   `compile` to `cloudflare-binding`. Every tutorial, forum answer and model weight older than
   v13 teaches a pattern that no longer exists. An agent will confidently write
   `Astro.locals.runtime.env.SUPABASE_URL` and get `undefined` at runtime with no build error.

4. **Secrets fail open, not closed.** `SUPABASE_URL` and `SUPABASE_KEY` are declared
   `optional: true` in `astro.config.mjs`; `src/lib/supabase.ts` returns `null` when either is
   missing; `src/middleware.ts` then sets `locals.user = null` and every protected route
   redirects to a sign-in page that itself cannot function. Deploy the Worker without running
   `wrangler secret put` and the result is a green deploy, HTTP 200, and an application in
   which nobody can ever log in. CI cannot catch this — the build is designed to pass without
   the secrets, so a green pipeline is not evidence that the Supabase wiring works.

5. **The stateless model prices the next feature, not this one.** Workers has no filesystem, a
   128 MB isolate, and no long-lived process. That is a perfect fit for the PRD as written. But
   every plausible follow-on — a CSV export of training history, a weekly email summary, a PDF
   of a lifting block — stops being a few lines of Node and becomes a separate Cloudflare
   primitive (R2, Cron Triggers, Durable Objects), each with its own binding, its own local-dev
   story and its own free-tier limits.

### Pre-Mortem — How This Could Fail

Six months on, the decision reads as a disaster, and the chain is short. The first deploy went
out without the Worker secrets set — CI was green, because the build is built to pass without
them — so the public URL served a signed-out shell for two days before anyone noticed, and the
graded review landed in that window. The team then treated Cloudflare as solved and stopped
looking at it. Meanwhile the Astro 6 pin held, because nobody revisited the adapter bug, so the
HIGH-severity `astro` advisory sat unpatched for the whole period and the dependency tree
drifted further from anything upgradable. By month four the training log was large enough that
the weekly-tonnage screen — computing 1RM per set and rolling up by muscle group inside the
Worker — began tripping the 10 ms Free-plan CPU limit, intermittently at first, on exactly the
screen the PRD calls the home screen. The fix was not a config change but moving aggregation
into Postgres, which meant migrations, which meant discovering that `wrangler rollback` reverts
the Worker and nothing else. And somewhere in there a two-week gap in training paused the free
Supabase project, and the "working public URL" requirement quietly stopped being true.

### Unknown Unknowns

- **`astro dev` is already workerd — a separate `wrangler dev` step is legacy for this stack.**
  Adapter v13 bundles `@cloudflare/vite-plugin` (v1.51.1 is installed here), so `astro dev` and
  `astro preview` run on the real Workers runtime. `platformProxy` was removed. Any instruction
  to "run `wrangler dev` alongside the Astro dev server" comes from adapter v11-era material and
  will produce two servers with divergent behaviour.

- **The hand-off's `deployment_target: cloudflare-pages` is factually wrong, and the two
  commands are not interchangeable.** Adapter v13 removed Pages support outright. This repo's
  `wrangler.jsonc` declares `main` plus an `assets` binding — a Workers Static Assets
  configuration. `wrangler pages deploy` does not read that shape. The correct command is
  `wrangler deploy`, exactly as the starter's own README says.

- **Supabase's free tier pauses a project after roughly one week of no database activity.** A
  single-user training log plus one holiday is enough. The data survives (the volume is frozen,
  not deleted) and restore is a dashboard click, but the public URL is broken until someone does
  it — and after 90 days paused, the project's API URL is released permanently. Free-tier backup
  retention is zero days.

- **Cloudflare gives you nothing that would catch a missing RLS policy.** The PRD's hardest
  guardrail — no account reaches another account's data — is enforced entirely inside Postgres.
  The Worker holds the anon key and forwards the user's JWT; if a table ships without RLS
  enabled, the Worker will serve another user's rows correctly, quickly, and at the edge. The
  platform is not a layer of defence here, and no amount of Cloudflare configuration substitutes
  for the policy.

- **Free-plan observability is a 3-day window, and `wrangler tail` is live-only.** Workers Logs
  on Free retains 200,000 events/day for 3 days. There is no way to ask "what happened last
  Tuesday" without upgrading or shipping logs off-platform — which matters for a project worked
  on in evening batches with days of silence between them.

- **`nodejs_compat` is a partial polyfill, not Node.** It covers `node:buffer`, `node:crypto`,
  `node:events`, `node:stream`, `node:util` and (for recent compatibility dates) `node:fs`. The
  current stack is fine — `@supabase/ssr` is fetch-based — but a library that reaches for
  `child_process` or real filesystem semantics will fail at runtime, not at build time.

## Operational Story

- **Preview deploys**: two viable routes. (a) **Workers Builds** — Cloudflare's git integration
  (GA since Sep 2025, available on Free): connect the GitHub repo once and every branch gets a
  stable preview URL with a PR comment. (b) Keep the existing GitHub Actions workflow and add
  `cloudflare/wrangler-action` running `wrangler versions upload` on PRs, which prints a version
  preview URL of the form `<version-prefix>-gymlog.<subdomain>.workers.dev`, then
  `wrangler versions deploy` to promote on merge. Preview URLs are **public** — Cloudflare
  Access is not on the Free plan. The PRD forbids any unauthenticated read path, so a public
  preview is tolerable, but a preview pointed at the *production* Supabase project is a live
  data-exposure route: previews should target a separate Supabase project. Fork PRs will not
  receive Cloudflare credentials from GitHub Actions and so will not get a preview.

- **Secrets**: runtime secrets live in **Workers Secrets**, set with
  `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`. They are
  write-only once set — not readable back from CLI or dashboard — and setting one publishes a
  new Worker version. Locally they live in `.dev.vars` (gitignored). Critically, the existing
  GitHub repo secrets `SUPABASE_URL` / `SUPABASE_KEY` are **build-time only**; they do not
  become Worker runtime secrets and setting them does not substitute for `wrangler secret put`.
  CI additionally needs `CLOUDFLARE_API_TOKEN` (scoped to Workers Scripts: Edit) and
  `CLOUDFLARE_ACCOUNT_ID`. Rotation: re-run `wrangler secret put` (publishes a new version),
  then rotate the Supabase anon key on the Supabase side.

- **Rollback**: `npx wrangler deployments list` to find the target, then
  `npx wrangler rollback [<version-id>]` — with no argument it reverts to the previous version.
  Time to revert is seconds; it is a metadata change, not a rebuild. **Data caveat**: rollback
  reverts the Worker only. Supabase migrations are not touched, so an older Worker rolled back
  onto a newer schema will fail in new ways. Use expand-then-contract migrations (add columns,
  never drop in the same release) so that any two adjacent Worker versions can run against the
  same schema.

- **Approval**: an agent may run unattended — `npm run lint`, `npm run build`,
  `wrangler versions upload` (preview only), `wrangler tail`, `wrangler deployments list`,
  `wrangler versions list`. A human must authorise — `wrangler deploy` / `wrangler versions
  deploy` to production, `wrangler secret put` and `wrangler secret delete`, any Supabase
  migration that drops or renames a column or table, any RLS policy change, and any Cloudflare
  plan or account change.

- **Logs**: `npx wrangler tail --format=pretty` streams live Worker logs read-only;
  `observability.enabled` is already `true` in `wrangler.jsonc`, so historical logs are queryable
  in the dashboard for 3 days on Free. Deployment history: `npx wrangler deployments list` and
  `npx wrangler versions list`. CI logs: `gh run list` / `gh run view --log`. For structured
  tool-use rather than CLI string-parsing, attach Cloudflare's observability MCP server
  (`observability.mcp.cloudflare.com`) — confirm its status before relying on it in automation,
  as some domain servers remain beta.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Worker deployed without runtime secrets → green deploy, auth silently dead on the public URL | Devil's advocate | **H** | **H** | Run `wrangler secret put` for both vars before the first production deploy; add a post-deploy smoke check that fetches `/auth/signin` and asserts the "Supabase not configured" banner is absent. Consider flipping `optional: true` to required in `astro.config.mjs` once CI supplies the vars, so misconfiguration fails loudly. |
| Weekly-tonnage aggregation exceeds the Free plan's 10 ms CPU/invocation limit as the log grows | Devil's advocate / Pre-mortem | M | **H** | Compute tonnage, 1RM and per-group rollups in Postgres (SQL aggregate or view), not in the Worker. Keep the Worker's job to fetch-and-render. Watch CPU time in Workers observability during the first slices. |
| Supabase free project auto-pauses after ~1 week of inactivity, breaking the graded public URL | Unknown unknowns | **H** | **H** | Treat the URL as needing a heartbeat: log a session at least weekly, or add an external uptime pinger that hits an authenticated-free health route. Know the restore path (dashboard click) and that data survives. Never let it sit paused near 90 days. |
| Astro 6 pin holds indefinitely; HIGH `astro` advisory stays unpatched because Astro 7 + Cloudflare adapter build fails | Devil's advocate / Research finding | M | M | Track the upstream `Could not find the prerender entry point` issue; re-attempt the upgrade (`astro@^7 @astrojs/cloudflare@^14`) monthly — it is a one-command test. Interim: avoid dynamic slot names and treat the error page as an untrusted-input surface. Vercel or Netlify remain the escape hatch if the adapter bug outlives the MVP. |
| Missing or incorrect RLS lets one account read another's data; the platform provides no backstop | Unknown unknowns | M | **H** | Enable RLS on every table in the same migration that creates it. Add a cross-account E2E test (per `/10x-e2e`) that authenticates as user B and requests user A's workout id directly, asserting failure against the recorded data — the PRD requires exactly this verification. |
| Agent writes removed v13 APIs (`Astro.locals.runtime`, `cloudflareModules`, `wrangler pages deploy`) from stale training data | Devil's advocate / Unknown unknowns | **H** | M | Record the v13 contract in `CLAUDE.md`/`AGENTS.md`: env via `astro:env/server`, deploy via `wrangler deploy`, dev via `astro dev` (already workerd). Reviews should reject `Astro.locals.runtime` and any `pages deploy` on sight. |
| Worker rollback reverts code but not the Supabase schema, leaving an old Worker on a new database | Pre-mortem | M | M | Expand-then-contract migrations only: additive changes ship first, destructive changes ship a release later. Never drop a column in the same deploy that stops using it. |
| Public preview URLs pointed at the production Supabase project expose real data | Research finding | M | M | Use a separate Supabase project (or at minimum a separate anon key and database) for preview deploys. Cloudflare Access is not available on the Free plan, so isolation must come from the data layer. |
| 3 MB compressed Worker size limit on the Free plan breached as dependencies accumulate | Research finding | L | M | Check bundle size after each dependency addition (`wrangler deploy --dry-run` reports it). React 19 + Supabase JS leaves comfortable headroom today; heavy chart or PDF libraries are the realistic trigger. |
| Adapter's v13 default `imageService: "cloudflare-binding"` breaks prerendered image optimization | Research finding | L | L | No `astro:assets` usage exists in the repo today, so the path is inert. If images are introduced, set `imageService: "passthrough"` or `"compile"` explicitly and verify the build (open Astro issues #16035, #15974). |
| Free-plan logs retain only 3 days; incidents in a quiet week are unforensicable | Unknown unknowns | M | L | Rely on `wrangler tail` during active work; for anything needing history, capture output to a file during the session. Accept the gap at MVP rather than paying for retention. |
| Free-plan daily request cap (100k/day) reached via bot traffic on a public `workers.dev` URL | Research finding | L | M | Caps throttle rather than bill, so there is no financial exposure. If it becomes real, put the Worker behind a custom domain and enable a basic WAF/rate-limit rule. |

## Getting Started

Commands below were verified against the versions actually installed in this repo —
`astro@6.4.8`, `@astrojs/cloudflare@13.5.0`, `wrangler@4.120.0`, `@cloudflare/vite-plugin@1.51.1`
— not against general Cloudflare documentation.

1. **Create a Cloudflare account and authenticate.** No account exists yet. Sign up (no card
   required for the Free plan), then:
   ```bash
   npx wrangler login
   ```
   This opens a browser once and stores an OAuth token locally. For CI, create a scoped API
   token instead (Workers Scripts: Edit) and set `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` as GitHub repo secrets.

2. **Rename the Worker before the first deploy.** `wrangler.jsonc` still carries the starter's
   name, `"name": "10x-astro-starter"`. That string becomes the public hostname
   (`<name>.<your-subdomain>.workers.dev`), so change it to `gymlog` now — renaming later
   creates a second Worker and abandons the first URL.

3. **Develop locally with `npm run dev` — do not add a `wrangler dev` step.** At adapter v13,
   `astro dev` and `astro preview` already run on the real workerd runtime via the bundled
   Cloudflare Vite plugin. `platformProxy` was removed. Put local Supabase credentials in
   `.dev.vars` (copy from `.env.example`); they are read through `astro:env/server`, which is
   how `src/lib/supabase.ts` already consumes them.

4. **Deploy.** Build first — `wrangler.jsonc` publishes `./dist` as Static Assets, so the
   directory must exist:
   ```bash
   npm run build
   npx wrangler deploy
   ```
   `wrangler deploy` is correct here, **not** `wrangler pages deploy`: adapter v13 removed
   Cloudflare Pages support, and this configuration (`main` + `assets` binding) is a Workers
   Static Assets project. The command prints the public URL.

5. **Set the runtime secrets, then verify the live app.** This is the step whose omission
   produces a green deploy with dead auth:
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   Each publishes a new version. Then open `https://gymlog.<subdomain>.workers.dev/auth/signin`
   and confirm the sign-in form renders **without** the "Supabase nie jest skonfigurowany"
   banner from `src/lib/config-status.ts`. Tail logs while testing with
   `npx wrangler tail --format=pretty`.

6. **Wire auto-deploy on merge** (matches the `ci_default_flow: auto-deploy-on-merge` hint).
   Either connect the repo in Workers Builds (zero config, gives per-branch preview URLs), or
   add a `cloudflare/wrangler-action` step to the existing `.github/workflows/ci.yml` after the
   build job. Note that workflow currently triggers on `main` while the starter README still
   documents `master` — reconcile the two before relying on the trigger.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (the deploy wiring above is a pointer, not a pipeline design)
- Production-scale architecture (multi-region, HA, DR)
