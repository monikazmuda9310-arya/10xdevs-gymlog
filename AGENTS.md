# AGENTS.md — GymLog

Guidance for AI agents working in this repository. Source of truth; `CLAUDE.md` points here.

GymLog is a training log: the user records workouts (date, exercises, sets of reps × weight) and
the app derives estimated one-rep max, weekly tonnage, and personal records. Product contract:
`context/foundation/prd.md`.

## Domain rules that are easy to get wrong

These are not style preferences. Getting any of them wrong produces a number the user will
believe and that will be false. **Every one of them has a unit test; do not change behaviour here
without changing the test and saying so.**

- **1RM estimates are valid for 1–12 repetitions only.** Outside that range, show no estimate —
  never a fabricated one — and exclude the set from record detection. Brzycki (`w × 36 / (37 − r)`)
  divides by zero at 37 reps and goes negative beyond.
- **At exactly 1 repetition the estimate equals the weight lifted.** Brzycki yields this
  naturally; Epley (`w × (1 + r/30)`) does not — it returns `1.033 × w` — so Epley must be pinned
  at `r == 1`.
- **Records are derived, never stored as trophies.** A record is always the best *surviving* set,
  recomputed when the underlying sets change. A record may therefore go *down* after an edit or
  delete, and the user is warned by how much before confirming. Never write a record row that can
  outlive the set that justifies it.
- **A personal record is decided on estimated 1RM**, not raw weight. The heaviest absolute weight
  is tracked separately as a second, distinct record.
- **A training week is Monday–Sunday in the user's own timezone** (stored on their profile), not
  UTC. A Sunday-evening session belongs to that week.
- **Zero-weight sets contribute reps but no tonnage. Negative-weight (assisted) sets are excluded
  from 1RM and from record detection**, and contribute zero — never a negative amount — to tonnage.
- **Unit round-trip is exact.** A weight entered in lb and read back in lb must be the number the
  user typed. Rounding or conversion must never create or erase a record.
- **Every exercise has exactly one primary muscle group**, so per-group tonnage sums exactly to
  the week's total. Never invent weighted multi-group splits.

## Access control is a hard guardrail

No account may reach another account's workouts, exercise entries, or sets — including by naming
an identifier directly. This is enforced in the database, not only in the UI.

- **Enable RLS on every new table in the same migration that creates it**, with granular
  per-operation, per-role policies. A table without RLS is a defect, not a follow-up.
- Tests for this must assert against **persisted state**, not just the response status code.

## Commands

Scripts, local Supabase setup, and deploy steps: @README.md

Two things README does not cover:

- `npx astro sync` — regenerate types. Run it after changing `astro.config.mjs` or any content
  schema, otherwise type errors will be stale and misleading.
- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and
  `prettier --write` on `*.{json,css,md}`. A commit that fails lint will not land.

## Architecture

Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase auth + shadcn/ui, deployed to Cloudflare.

**Rendering**: `output: "server"` — every page is server-rendered by default. API routes must
export `const prerender = false`.

**Auth wiring** (already built by the starter — read it before adding to it):

- `src/lib/supabase.ts` — Supabase SSR client via `@supabase/ssr`, cookie-based sessions. Reads
  `SUPABASE_URL` / `SUPABASE_KEY` through `astro:env/server` (declared in `astro.config.mjs`
  under `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user onto
  `context.locals.user`, redirects unauthenticated requests away from `PROTECTED_ROUTES`. **Add
  new protected routes there**, not with per-page checks.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Pages: `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/pages/dashboard.astro`

## Conventions

- **Path alias** `@/*` → `./src/*`.
- **Astro components for static content and layout; React only where interactivity is needed.**
- **Tailwind classes**: use `cn()` from `@/lib/utils`. Never concatenate class strings by hand.
- **shadcn/ui** lives in `src/components/ui/` ("new-york" variant). Add with
  `npx shadcn@latest add [name]`.
- **API routes** export uppercase `GET` / `POST`; validate every input with zod.
- **Migrations**: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- **React**: no Next.js directives (`"use client"` and friends). Hooks go in
  `src/components/hooks/`.
- **Business logic** goes in `src/lib/services/`, shared entity and DTO types in `src/types.ts`.
  Keep the 1RM / tonnage / record calculations in plain, dependency-free functions so they stay
  directly unit-testable.

## Testing

- **Unit tests are the primary defence for the domain rules above.** Cover the boundaries
  explicitly: 1-rep sets, the 12-rep edge, zero and negative loads, kg↔lb round-trip, week
  boundaries across timezones.
- **E2E locators**: `getByRole` / `getByLabel` / `getByText` first. `getByTestId` only when
  accessibility attributes are genuinely ambiguous. Never CSS selectors, XPath, or DOM structure.
- **Never `page.waitForTimeout()`.** Wait on state: `toBeVisible()`, `waitForURL()`,
  `waitForResponse()`.
- **Every test is independent**: its own setup, action, assertion, and cleanup. Use unique ids
  (timestamp suffix) so parallel runs and re-runs cannot collide.
- DOM snapshots are the default for E2E; vision is a supplement for visual-only risks. For pixel
  regression prefer deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel).

## Environment

Node version, secrets, local Supabase, and deployment: @README.md. **Never commit a real key** —
`.env` and `.dev.vars` are gitignored and must stay that way.

Line endings are LF, pinned by `.gitattributes`. Do not disable this: the machine has
`core.autocrlf=true`, and without the pin every file checks out as CRLF and prettier fails all
1022 lines of the repository.

## Known state

- **Astro is held at 6.x.** Astro 7 resolves the four outstanding `npm audit` advisories but its
  build fails against the Cloudflare adapter (`Could not find the prerender entry point`),
  reproduced on 7.1.6 and 7.2.0. Do not "helpfully" bump it; see
  `context/changes/bootstrap-verification/verification.md` for the full record.
- `.github/workflows/ci.yml` still targets the `master` branch; this repository's default branch
  is `main`.
