# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run typecheck` - Run `astro check` (type-checks `.astro` and `.ts` alike)
- `npm test` - Run the unit tests once (Vitest, non-interactive, hermetic — no network)
- `npm run test:watch` - Run the unit tests in watch mode
- `npm run test:integration` - Run the RLS check against the `gymlog-test` project (needs network)
- `npm run test:render` - Render pages through Astro's container and assert on the resulting HTML (hermetic)
- `npm run db:status` - Print both projects' migration histories — the drift check
- `npm run db:push` - Apply pending migrations to both projects, `gymlog-test` first
- `npm run db:types` - Regenerate `src/db/database.types.ts` from the production schema

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication **and for data**. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### Database setup — two hosted projects, no local stack

There is **no local database stack and none is wanted**: this project has no container runtime
available, so `npx supabase start` is not an option and nothing here needs it. Development,
migrations and the integration check all run against hosted Supabase projects.

There are two, and the split is deliberate:

| Project       | Role                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `gymlog`      | production — the schema of record, and what the deployed Worker serves |
| `gymlog-test` | what CI and `npm run test:integration` write to; holds no real data    |

CI never authenticates to production's database, so the blast radius of a runaway check is a
project with nothing in it.

1. Copy the template and fill it in from the Supabase dashboard:

```bash
cp .env.example .env
cp .env.example .dev.vars   # only SUPABASE_URL and SUPABASE_KEY are read here
```

`.env` carries eight keys — see `.env.example`, which documents what each is for. Two of them are
session-mode pooler connection strings (`SUPABASE_DB_URL`, `SUPABASE_TEST_DB_URL`): **copy them
from the dashboard's Connect dialog, do not construct them**, use port 5432 (transaction mode
cannot run DDL), and percent-encode the password.

2. Apply the schema to both projects:

```bash
npm run db:push     # gymlog-test first, then gymlog — there is no single-target push
npm run db:status   # prints both migration histories side by side
```

`db:push` applies to both in one invocation on purpose: advancing one schema and forgetting the
other is the only way the two drift. If the test push fails, production is never touched.

3. After any migration, regenerate the committed types:

```bash
npm run db:types
```

`src/db/database.types.ts` is generated from the **production** schema and committed, because CI
has no database credentials and must not gain any. Never hand-edit it.

### Email confirmation — set per project, and the two differ

This is **not** one setting to copy across both projects. Each has a different job:

| Project       | Confirm email | Why                                                                                                                       |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `gymlog`      | **on**        | Nobody may create an account on an address they do not own.                                                               |
| `gymlog-test` | **off**       | The integration check must be able to create accounts without an inbox — `signUp` has to return a session for it to work. |

Turning it on for `gymlog-test` breaks `npm run test:integration` on its first assertion, which
exists precisely to catch that. Turning it off for `gymlog` leaves real accounts unprotected and
**nothing automated will notice**.

The application does not need to be told which is which: `/api/auth/signup` branches on whether
`signUp` returned a session, so it follows each project's actual setting without a redeploy.

The toggle lives in the dashboard under **Authentication → Sign In / Providers → Email → Confirm
email**. Check both without leaving the terminal:

```bash
node -e "process.loadEnvFile();const t=process.env.SUPABASE_ACCESS_TOKEN;const r=v=>new URL(process.env[v]).hostname.split('.')[0];(async()=>{for(const[l,v]of[['gymlog','SUPABASE_URL'],['gymlog-test','SUPABASE_TEST_URL']]){const c=await(await fetch('https://api.supabase.com/v1/projects/'+r(v)+'/config/auth',{headers:{Authorization:'Bearer '+t}})).json();console.log(l,'Confirm email:',c.mailer_autoconfirm===false?'ON':'off')}})()"
```

**Also check `site_url` whenever the deployed URL changes.** It decides where a confirmation link
sends the user, it lives in project config rather than in this repository, and getting it wrong is
invisible to every test: the account is confirmed correctly and the user still sees "site
unreachable". It must be the deployed sign-in page, with `uri_allow_list` covering the deployed host
and `http://localhost:4321/**` for local work.

### Routes

| Route                   | Description                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/auth/signin`          | Email/password sign-in form. On success → `/dashboard`                                                                   |
| `/auth/signup`          | Email/password sign-up form. On success → `/dashboard`, or `/auth/confirm-email` when a confirmation email is on its way |
| `/auth/confirm-email`   | "Check your inbox" page — reached only when an email is genuinely coming                                                 |
| `/dashboard`            | Protected. Total tonnage for this training week next to last week's, plus links into the rest of the product            |
| `/exercises`            | Protected. The catalogue: 38 seeded exercises plus the account's own, with search and a muscle-group filter              |
| `/workouts`             | Protected. The account's own workouts, most recent first, and the form that starts one dated today in their timezone     |
| `/workouts/[id]`        | Protected. One workout: add exercises, log sets, see each set's estimated 1RM. **404 for a workout that is not yours**   |
| `/records`              | Protected. Current records per exercise — best estimated 1RM and heaviest weight, each with the set and date behind it   |
| `/settings`             | Protected. Weight unit, estimation formula, and the timezone the training week runs in. One form, one Save              |
| `/api/auth/signout`     | POST. Always → `/auth/signin`, so returning requires authenticating again                                                |
| `/api/exercises`        | POST, **JSON** (not a form post — the caller is a hydrated island). Creates a custom exercise for the signed-in account  |
| `/api/workouts`         | POST, JSON. Creates a workout from `{ performedOn, note? }`                                                              |
| `/api/exercise-entries` | POST, JSON. Adds an exercise to a workout; choosing one already there returns the existing entry rather than an error    |
| `/api/sets`             | POST, JSON. Logs a set. **The weight unit is not in the body** — it is read from the account's profile on the server     |
| `/api/profile`          | PATCH, JSON. Replaces all three preferences at once. Writes only the row named by `locals.user.id`; no route parameter  |

Correcting what was logged, added by S-05. Each resource carries its mutations and a preflight that
answers what the change would cost:

| Route                               | Description                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/api/sets/[id]`                    | PATCH (reps, weight, RPE) and DELETE. **404, never 204/200, when the row is absent or not yours** — the same answer for both |
| `/api/sets/[id]/impact`             | GET. Which records this set holds and what each falls to without it                                                          |
| `/api/workouts/[id]`                | PATCH (date, note) and DELETE. Deleting cascades to every entry and set beneath it                                           |
| `/api/workouts/[id]/impact`         | GET. The only operation that can take several records at once, so it answers for every exercise in the workout               |
| `/api/exercise-entries/[id]`        | DELETE. Removes one exercise from a workout with its sets. No PATCH — repointing an entry is removing it and picking another |
| `/api/exercise-entries/[id]/impact` | GET. The same answer scoped to that one exercise                                                                             |

`/api/sets` answers `{ set, record }`: `record` is `null` unless the set just saved beat the previous best for that exercise, in which case it carries the set it beat. A failed record verdict never turns a successful save into an error — the badge is lost, the set is not.

**The weight unit is not in the update payload either** — it is a property of the stored row, not of
the account editing it. `PATCH /api/sets/[id]` changes repetitions, weight and RPE and leaves
`weight_unit` exactly as it was, so a set typed in pounds still reads back as the number typed after
the profile preference changes. `weight_kg` is generated and is never written.

### Changing a preference changes what is DERIVED, never what is stored

`PATCH /api/profile` (S-06) writes three columns and nothing else. What follows from each is worth
stating precisely, because "every weight is shown in your unit" and "a weight reads back as the
number you typed" pull against each other and the product settles the conflict rather than ducking it:

- **Weight unit affects NEW sets only.** The unit is stamped from the profile at insert, so every set
  already logged keeps the unit it was typed in — including when you later correct its weight.
- **A derived HEADLINE figure is expressed in the reader's unit; the EVIDENCE line quoting the set is
  shown as typed** (owner ruling on FR-022, 2026-08-12). So `/records` may read
  `220.5 lb — from 5 × 100 kg on 2026-08-13`. Both numbers are true and neither is rounded into the
  other. Do not "fix" `heaviestFigure` to stop converting.
- **Estimation formula re-derives history rather than rewriting it.** `set_estimates` reads the
  column per row, so switching recomputes every estimate and record on the next read — and can change
  **which set holds** a record, not merely the number, because the two formulas rank differently
  either side of ten repetitions. Switching back restores the previous figures exactly.
- **Timezone moves no logged workout.** `performed_on` is a calendar date you stated, not an instant.
  It decides which week a session belongs to and what date a new workout defaults to, nothing else.

### Weekly tonnage

`/dashboard` shows total tonnage for the current training week and the previous one (FR-017).

- **A training week runs Monday to Sunday in your own timezone**, so a Sunday-evening session counts
  in that week. The week is decided in `src/lib/services/calendar.ts` and nowhere else — the database
  never learns what a week is, and no SQL here reads `profiles.timezone`.
- **Tonnage is repetitions × weight, summed.** A zero-load set contributes nothing and an assisted
  set contributes nothing rather than a negative amount — one term, `greatest(weight_kg, 0)`.
- **Nothing is stored.** `public.daily_tonnage` sums at read time. Moving a workout to another date
  recomputes both affected weeks on the next read, with no write and nothing to invalidate.
- **A week with no sets reads as `0` with a sentence saying so.** A week of planks reads as `0`
  without that sentence — it had sets, just no external load. A failed read shows no figure at all,
  because an emitted zero is a positive claim.

Each `…/impact` answers `{ impact: [...] }`. **When the ranking read fails it answers a non-2xx
`impact_unavailable`, never an empty list** — "nothing is at stake" is a positive claim, and the
screen would render it as reassurance. The action stays available; the dialog says the consequence is
unknown.

Route protection is handled in `src/middleware.ts`, in **both** directions: `PROTECTED_ROUTES` keeps
signed-out visitors out of the application, and `AUTH_ROUTES` sends a signed-in visitor away from
the sign-in and sign-up forms to `/dashboard`. Add new paths to the matching array there rather than
writing per-page checks.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs lint, typecheck, unit tests, the render check, the integration check and build on every push and PR to `main`. The workflow carries a `concurrency` group so two runs cannot race the integration check's shared fixture rows.

`npm run test:render` needs no secrets and no network — it renders pages through Astro's container and asserts on the HTML. It is in the gate because it holds the only check that would notice the 418-entry timezone list being passed as an island prop, and a check outside the gate rots.

Five repository secrets:

| Secret                                   | Project       | Used by                       |
| ---------------------------------------- | ------------- | ----------------------------- |
| `SUPABASE_URL`, `SUPABASE_KEY`           | `gymlog`      | the typecheck and build steps |
| `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` | `gymlog-test` | `npm run test:integration`    |
| `GYMLOG_TEST_PASSWORD`                   | `gymlog-test` | its two fixture accounts      |

**CI holds no production database credential and never will.** Migrations are applied by hand from a developer machine, deliberately: putting a database-owner connection string in repository secrets would let any merge rewrite the schema.

Those repository secrets are **build-time only**. They do not become Worker runtime secrets — for that, use `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` against the deployed Worker. Skipping that step produces a deployment that builds, returns 200, and cannot log anybody in.

## License

MIT
