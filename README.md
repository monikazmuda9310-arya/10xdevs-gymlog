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

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

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

GitHub Actions runs lint, typecheck, unit tests, the integration check and build on every push and PR to `main`. The workflow carries a `concurrency` group so two runs cannot race the integration check's shared fixture rows.

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
