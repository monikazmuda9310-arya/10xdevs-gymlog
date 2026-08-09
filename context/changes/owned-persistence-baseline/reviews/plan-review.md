<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Account-Owned Persistence Baseline

- **Plan**: `context/changes/owned-persistence-baseline/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE
- **Findings**: 1 critical, 5 warnings, 4 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

16/16 existing paths ✓ · 5/5 asserted-absent paths confirmed absent (`supabase/migrations/`, `src/db/`,
`src/types.ts`, `tests/`, `scripts/`) ✓ · 10/10 symbols ✓ · brief↔plan ✓ · Progress↔Phase contract ✓
(one `## Progress`, 6/6 phase headings matched, 34 criteria ↔ 34 checkboxes 1:1, zero stray checkboxes) ·
blast radius: `createClient` from `@/lib/supabase` has 4 importers — `src/middleware.ts` plus
`src/pages/api/auth/{signin,signup,signout}.ts`; the three API routes touch only `supabase.auth.*`, so
parameterising the client with `<Database>` cannot break them (the plan does not mention them; no action
needed).

Codebase and network verification was run inline rather than via a sub-agent — every claim was directly
checkable on this machine. Measured 2026-08-09:

| Plan claim                                                            | Result                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--db-url` needs no Docker, no login, no link                         | **Confirmed** — `db push --dry-run --db-url …@127.0.0.1:1` printed `DRY RUN` → `Connecting to remote database…` → `LegacyDbConnectError … ECONNREFUSED`. No Docker/login/link check preceded it. |
| The CLI ignores `SUPABASE_DB_URL` from the environment                | **Confirmed** — env set, flag omitted → `LegacyProjectNotLinkedError: Cannot find project ref`, exit 1                        |
| `db.<ref>.supabase.co` is IPv6-only                                   | **Confirmed** — `nslookup` returns AAAA `2a05:d014:8ef:5900:…` only; explicit `-type=A` returns no address                    |
| That address is unreachable from here                                 | **Confirmed and strengthened** — raw TCP connect → `ENETUNREACH` (the plan's evidence was a weaker `curl: could not resolve host`) |
| The session pooler answers on IPv4                                    | **Confirmed** — `aws-0-eu-central-1` (18.198.30.239, …) and `aws-1-eu-central-1` (3.65.151.229, …) both TCP-connect on 5432; both resolve, so "copy, do not construct" is correct |
| `migration list` / `gen types` accept `--db-url`                      | **Confirmed** via `--help` on CLI 2.113.0; `migration list --db-url` reaches the connect step with **no** local `supabase/migrations/` directory present, so Phase 1's gate is runnable before any SQL exists |
| `node_modules/supabase` bin is `dist/supabase.js`                     | **Confirmed** — and read: it is an ESM shim that `execFileSync`s `@supabase/cli-windows-x64/bin/supabase.exe` with `stdio: "inherit"` and propagates `e.status`. Spawning it with `process.execPath` works (I did exactly that), and because the shim *inherits* stdio, the wrapper's `stdout: "pipe"` for the `types` verb does reach the real binary's stdout. |
| Criterion 1.1's `Local \| Remote \| Time (UTC)` table header is real  | **Confirmed** — `Time (UTC)` present in the CLI binary                                                                        |
| Criteria 2.1 / 2.3 wording matches CLI output                         | **Confirmed** — `Applying migration`, `up to date`, `pending migration`, `Finished supabase db push` all present in the binary |
| CI already gates lint + typecheck + unit tests + build                | **Confirmed** — `.github/workflows/ci.yml` runs `npm ci`, `npx astro sync`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| `@types/node` is now declared (previous review's F7)                  | **Confirmed** — `devDependencies["@types/node"] = "^26.2.0"`                                                                  |
| `scripts/**.mjs` is safe under `astro check`                          | **Confirmed** — `astro/tsconfigs/base.json` sets `allowJs: true` and leaves `checkJs` unset, so a `.mjs` without `// @ts-check` is parsed but not error-checked |
| `loadEnv` is importable from `vitest/config`                          | **Refuted** — `vitest/config` exports only `configDefaults`, `coverageConfigDefaults`, `defaultBrowserPort`, `defaultExclude`, `defaultInclude`, `defineConfig`, `defineProject`, `mergeConfig`. `loadEnv` exists only on `vite`, which is **not** a declared dependency (see F5) |
| `process.loadEnvFile()` gives real env precedence over the file       | **Confirmed** — `FOO=fromenv` + `.env` containing `FOO=fromfile` → `process.env.FOO === "fromenv"`. Exactly the precedence the plan wants, with zero dependencies |
| `git grep` / `git ls-files` / `git status` on an **untracked** file   | **Measured** — `git grep` → no output, exit 1; `git ls-files --eol` → **no output, exit 0**; `git status --porcelain` → `?? path`. This is what breaks Phase 3 (F2) |
| `prettier --check` on the four Phase-6 documents                      | **Fails today** on `AGENTS.md` (2 lines, `*surviving*`/`*down*` vs Prettier's `_surviving_`/`_down_`) — see F9 |

### The SQL, read line by line

The migration in Phase 2 is **correct as written**, on every point that matters:

- `alter table public.profiles enable row level security` is present, in the creating migration, before the
  policies. ✓
- Every policy is scoped `to authenticated`, never `to public`. ✓
- Every predicate uses `(select auth.uid())`, not bare `auth.uid()`. ✓
- `with check` is present on **both** INSERT and UPDATE, and the UPDATE policy carries `using` **and**
  `with check` — so a row cannot be rewritten to another owner's `id`. ✓ (This is the single most commonly
  omitted clause in this shape and the plan gets it right.)
- `revoke all on public.profiles from anon, authenticated` precedes `grant select, insert, update … to
  authenticated`, which is the correct order and neutralises Supabase's default `GRANT ALL ON TABLES` to
  `anon`/`authenticated`. ✓
- **Deletes are genuinely denied**: no DELETE grant *and* no DELETE policy — either alone suffices,
  and PostgREST raises `42501`. ✓
- **`anon` reaches nothing**: no grant and no policy. Double-locked. ✓
- **No cross-account path exists.** SELECT is filtered by `uid = id`; UPDATE is filtered on both sides;
  INSERT is constrained to `id = uid`; DELETE is ungranted. No view, no `security definer` non-trigger
  function, and no RPC surface is created. `service_role` (which does carry `BYPASSRLS` on Supabase) keeps
  its default `ALL` grant — acceptable precisely because the plan bans that key from `.env`, CI and the
  Worker.
- `force row level security` is correctly *not* used (it would subject the `postgres` owner to the policies
  and break the dashboard table editor); the reasoning is written down.
- Sequencing details are right: `after insert` (not `before`) on `auth.users`, so the FK to `auth.users(id)`
  is satisfiable; `set_updated_at` as a `before update` trigger, so the UPDATE policy's `with check` is
  evaluated after it fires; `search_path = ''` with `now()` resolving through the implicit `pg_catalog`.

Two non-defects worth recording so nobody "fixes" them later: `set_updated_at` is deliberately **not**
`security definer` (it only touches `NEW`), and neither function needs an `execute` revoke because a
`returns trigger` function cannot be called by PostgREST or by hand.

## Findings

### F1 — The integration suite mutates fixture rows it also asserts defaults on, and nothing serialises runs

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 § The isolation check (assertions 1, 4, 7) · § Script and pipeline · Progress 4.1
- **Detail**: Assertion 1 asserts that fixture A's stored row reads exactly `Europe/Warsaw` / `kg` /
  `brzycki`. Assertion 7 **updates A's timezone and then restores it**. Two consequences the plan does not
  address.
  (a) **Poisoned fixture.** If assertion 7 fails, times out, or the runner is killed between the update and
  the restore, A's row is left holding `America/New_York` (or whatever the test wrote) *permanently*. Every
  subsequent run — local and CI — then fails assertion 1, for a reason that has nothing to do with the code
  under test, and the only repair is manual SQL against the owner's live database. This is the same class of
  defect the previous review flagged as F1 on the last change: a mechanism that ships a permanently red
  pipeline.
  (b) **Concurrency.** `.github/workflows/ci.yml` triggers on both `push` and `pull_request` and declares no
  `concurrency:` group, and the suite is also runnable locally at any time. Two overlapping runs share the
  same two rows: run X's assertion 7 (A's timezone mutated) races run Y's assertion 1 (A's timezone must be
  the default). `fileParallelism: false` serialises files *within* a run and does nothing across runs.
  This directly contradicts `AGENTS.md` § Testing — "Every test is independent: its own setup, action,
  assertion, and cleanup. Use unique ids (timestamp suffix) so parallel runs and re-runs cannot collide" —
  which the plan otherwise honours carefully.
- **Fix A ⭐ Recommended**: Make the suite self-healing and collision-proof: (i) `beforeAll` resets both
  fixture rows to the defaults with an owner-scoped `update` (the UPDATE policy already permits exactly
  this) *after* sign-in, so assertion 1 tests a known state instead of an inherited one; (ii) assertion 7
  writes a **unique** value (`Etc/GMT+${run-scoped suffix}` or `America/New_York` plus a timestamped
  round-trip through `weight_unit`), restores in a `finally`, and asserts the read-back equals what *this
  run* wrote; (iii) add a `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: false }` block
  to `ci.yml` so two pipeline runs cannot interleave.
  - Strength: Removes both failure modes at the source, costs ~10 lines, and keeps the two-fixture-account
    design (which is what keeps junk users at exactly two — Progress 4.7).
  - Tradeoff: `beforeAll` now writes before it reads, so a broken UPDATE policy surfaces in setup rather
    than in assertion 7. That is arguably better, but the failure message is less specific.
  - Confidence: HIGH — the reset uses only the grants and policies this migration installs.
  - Blind spot: A local run concurrent with a CI run is still possible; the concurrency group only covers
    GitHub. Accepted — the reset in (i) makes that case self-repairing rather than fatal.
- **Fix B**: Give every run its own pair of accounts (`rls-owner-a-<timestamp>@gymlog-test.dev`), which is
  the literal reading of the `AGENTS.md` rule.
  - Strength: Zero shared state; textbook test independence.
  - Tradeoff: Contradicts the plan's own Progress 4.7 ("exactly two fixture accounts after several runs")
    and accumulates unremovable `auth.users` rows forever, because no `service_role` key exists to delete
    them. The plan's reasoning for reuse is sound and should not be thrown away.
  - Confidence: HIGH mechanically, LOW as a fit for this project.
  - Blind spot: Auth rate limits (30 sign-ups per 5 min per IP) would eventually bite in CI.
- **Decision**: PENDING

### F2 — Phase 3's three git-based criteria cannot produce their stated output on an untracked file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 § Automated Verification · Progress 3.1, 3.2, 3.3
- **Detail**: `src/db/database.types.ts` is a **new** file at the moment these criteria run. Measured on
  this repository against a throwaway untracked file:
  - 3.1 "running it a second time leaves `git status --porcelain src/db/database.types.ts` **empty**" —
    an untracked file prints `?? src/db/database.types.ts`. Never empty. The criterion cannot pass.
  - 3.2 "`git grep -n "profiles" -- src/db/database.types.ts` returns matches" — `git grep` searches
    **tracked** files only: no output, exit 1. The criterion cannot pass.
  - 3.3 "`git ls-files --eol -- src/db/database.types.ts` prints `w/lf`" — `git ls-files` lists tracked
    files only: **no output, exit 0**. This one is the worst of the three: it *silently passes* while
    proving nothing about line endings, on the exact discipline `AGENTS.md` says will otherwise make
    "prettier fail all 1022 lines of the repository".
    Phase 2's criterion 2.4 gets this right — "`git add` it, **then** `git ls-files --eol`". Phase 3 forgot
    the same step three times.
- **Fix**: Prefix Phase 3's verification with `git add src/db/database.types.ts` (as 2.4 already does), and
  restate 3.1 as: after `git add`, a second `npm run db:types` leaves `git status --porcelain
  src/db/database.types.ts` showing at most the staged `A ` entry and no `M`/`??` change — or simply
  `git diff --stat -- src/db/database.types.ts` empty once staged.
- **Decision**: PENDING

### F3 — The Phase 4 red proof disarms RLS on the live database, and the suite can prove the same thing without it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 § Manual Verification (red proof) · § The isolation check assertion 2 · Progress 4.8
- **Detail**: Two linked problems.
  (a) **Assertion 2 is not self-proving.** "As A, an unfiltered `select *` returns exactly one row" is only
  meaningful because the table "holds at least three rows" — and that fact is asserted **nowhere in the
  suite**. It rests on the Phase 2 backfill plus the survival of `smoke-1786276093721@gymlog-test.dev`,
  an account `deploy-plan.md` explicitly schedules for deletion ("Clean it up when S-09 lands account
  deletion, or from the dashboard"). The day someone deletes it and the fixtures are the only accounts,
  assertion 2 still passes with RLS *off* if the suite ever runs with a single account — and its
  non-vacuity has quietly evaporated with no test turning red.
  (b) Because of (a), the plan reaches for a destructive proof: `alter table public.profiles disable row
  level security` on the owner's **only** database — the one serving the public Worker and holding real
  auth accounts — for ~60 seconds. It is opt-in and honestly labelled, but the failure mode is asymmetric:
  an interrupted revert leaves reads **and writes** open on production, and this change exists precisely to
  make "a table without RLS is a defect" structural. Normalising "turn the guardrail off in production to
  prove the test" is a habit that becomes serious at S-02, when the same shape carries training data.
- **Fix A ⭐ Recommended**: Make assertion 2 self-proving and delete the destructive proof. Assert, in one
  test: A's unfiltered `select *` returns exactly 1 row; B's unfiltered `select *` returns exactly 1 row;
  the two ids differ. Those three facts together prove the table holds ≥ 2 rows *and* that each client sees
  only one — so if RLS were disabled, the first assertion would return ≥ 2 and fail. That is logically the
  same proof the manual step buys, obtained by construction, with no external dependency on the smoke
  account and no window in which production is unprotected. Replace Progress 4.8 with "assertion 2 is
  non-vacuous by construction: A and B each see exactly one row and the ids differ".
  - Strength: Removes the production risk entirely, removes the dependency on a row scheduled for deletion,
    and makes the guarantee survive S-09 deleting the smoke account.
  - Tradeoff: Loses the emotional certainty of watching the suite go red. Mitigable for free: temporarily
    change the expected count from 1 to 2 in the test file and watch it fail — a source-only red proof.
  - Confidence: HIGH — the logic is airtight and needs no schema access.
  - Blind spot: Does not exercise the `enable row level security` flag itself; the grant revocation would
    still deny `anon` even with RLS off. Assertion 8 covers the anon path independently.
- **Fix B**: Keep a schema-level red proof but never touch the RLS flag — `create policy "tmp_red_proof" on
  public.profiles for select to authenticated using (true);` then `drop policy`.
  - Strength: A genuine mutation test of the policy layer; an interrupted revert leaves reads open but
    **writes and deletes still protected**, and RLS still on — strictly a smaller blast radius than
    `disable row level security`.
  - Tradeoff: Still opens every profile row to every signed-in account for the duration, still on the
    production database, and still needs a human to remember the second statement.
  - Confidence: HIGH that it works; MEDIUM that it is worth the exposure given Fix A exists.
  - Blind spot: None significant.
- **Decision**: PENDING

### F4 — The trigger fallback is named as the mitigation for the plan's biggest bet, but has no implementation site

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: § Critical Implementation Details · § Open risks · Decision 5 · Phase 2 Manual 2.9
- **Detail**: The plan is right that `security definer` + `set search_path = ''` + fully-qualified names +
  `on conflict do nothing` is the correct construction, that a failure surfaces as
  `Database error saving new user`, and that the fallback needs **no schema change** (the INSERT policy
  `with check ((select auth.uid()) = id)` plus the `insert` grant already permit an authenticated client to
  create its own row). What is missing is *where the fallback code goes*. No phase, no file, no function
  signature. If Phase 2's manual step 2.9 fails, the implementer is mid-change with a broken signup on the
  deployed URL and an instruction that reads "have the application upsert the profile on the first
  authenticated request" — which touches `src/middleware.ts` (already on the critical path of every
  request, under a 10 ms CPU cap), the Phase 4 fixture bootstrap, and Phase 5's dashboard, none of which are
  written for it. Phase 5 as specified renders a plain fallback for a missing row, so under the contingency
  the dashboard would show "unknown" forever and every phase gate would still pass.
- **Fix A ⭐ Recommended**: Add a named, pre-specified contingency block to Phase 2: on failure, the profile
  is created by `ensureProfile(supabase, userId)` in `src/lib/services/profiles.ts` (a single
  `upsert({ id }, { onConflict: "id", ignoreDuplicates: true })`), called from `src/pages/api/auth/signin.ts`
  and `signup.ts` — **not** from the middleware — plus one explicit line in the Phase 4 fixture bootstrap.
  Say plainly that taking this path also means Phase 2's `create trigger` statement is removed from the
  migration before it is pushed.
  - Strength: Keeps the hot path clean (the write happens once per sign-in, not once per request, which is
    what the 10 ms cap argument in Decision 5 was actually protecting), and turns a mid-implementation
    improvisation into a decision already taken.
  - Tradeoff: ~15 lines of contingency spec that will most likely never be used.
  - Confidence: HIGH — the auth endpoints already construct a client and already hold the session.
  - Blind spot: An account created directly in the dashboard would get no profile until it signs in; the
    backfill statement covers the accounts that exist today.
- **Fix B**: State explicitly that hitting the fallback **ends the phase** — the change stops, the trigger
  question goes back to `/10x-plan`, and no improvised code lands.
  - Strength: Zero speculative spec; keeps the plan lean and honest about the size of the unknown.
  - Tradeoff: A blocked change and a re-planning cycle over what is probably a 15-line service.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: PENDING

### F5 — `loadEnv` comes from `vite`, which this project does not declare as a dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 § Integration runner (`vitest.integration.config.ts`)
- **Detail**: The prescribed snippet calls `loadEnv("test", process.cwd(), "")`. Verified: `vitest/config`
  exports only `configDefaults`, `coverageConfigDefaults`, `defaultBrowserPort`, `defaultExclude`,
  `defaultInclude`, `defineConfig`, `defineProject`, `mergeConfig` — **not** `loadEnv`. So the import must be
  `from "vite"`, and `vite` appears in `package.json` **only** inside `overrides`; it is neither a
  dependency nor a devDependency. It resolves today purely by npm hoisting it out of `astro`. This is
  exactly the class of latent defect the previous review caught as F7 (`@types/node`) and the project fixed.
  Better still, the dependency is avoidable: `process.loadEnvFile()` is available on Node 22.14.0, is
  already the mechanism the Phase 1 wrapper uses, and — measured here — **does not override variables
  already present in the environment**, which is precisely the `{...fileEnv, ...process.env}` precedence
  the plan wants.
- **Fix**: Drop `loadEnv`. Open `vitest.integration.config.ts` with
  `try { process.loadEnvFile(); } catch { /* CI has no .env */ }` and pass `env: { ...process.env }`. One
  mechanism instead of two, zero new dependencies, identical precedence. (If `loadEnv` is kept for any
  reason, add `vite` to `devDependencies`.)
- **Decision**: PENDING

### F6 — The wrapper's contract asks for something `stdio: "inherit"` makes impossible

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 § CLI wrapper (bullets 2 and 3)
- **Detail**: The contract says the wrapper "**Never prints the URL**, and masks it out of any
  child-process error text", and two bullets later specifies `status` → `migration list --db-url <url>`
  **(stdio inherited)** and `push` → `db push --db-url <url>` **(stdio inherited)**. With inherited stdio
  the child writes straight to the terminal; the wrapper never sees the bytes and cannot mask anything. The
  implementer must either drop the masking or drop the inheritance (losing live push progress). Measured
  mitigation: the CLI's connection error text names host, user and database but **not** the password
  (`failed to connect to \`host=… user=postgres database=postgres\``), so nothing needs masking in practice
  — the requirement is both impossible and unnecessary.
- **Fix**: Restate the bullet as "the wrapper never prints `SUPABASE_DB_URL` itself; the CLI's own error
  text names host/user/database but not the password (verified), so inherited stdio is safe" — and keep
  the masking requirement only on the `types` verb, whose stdout the wrapper does capture.
- **Decision**: PENDING

### F7 — Phase 1's cross-shell gate exercises the one verb whose behaviour is identical in both shells

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 § Manual Verification · Progress 1.5
- **Detail**: "`npm run db:status` produces the same result from **both** PowerShell and Git Bash — this is
  the whole reason the wrapper exists." `db:status` is the verb that just inherits stdio; the verb that
  actually differs is `db:types`, which captures stdout, writes a file with explicit `\n`, and then chains
  `&& prettier --write` through the npm script runner — the exact combination the plan cites as
  non-portable (`>` redirect, `$VAR` vs `%VAR%`). The cross-shell check is aimed at the wrong verb.
- **Fix**: Move / extend the cross-shell criterion to Phase 3: run `npm run db:types` from both PowerShell
  and Git Bash and confirm the file is byte-identical (`git diff` empty on the second run) and still `w/lf`.
- **Decision**: PENDING

### F8 — Two integration assertions describe a result shape `supabase-js` does not return

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 § The isolation check, assertions 6 and 8
- **Detail**: Assertion 8 expects the unauthenticated client to get "zero rows **and** a permission error
  (`42501`)". With `revoke all … from anon`, PostgREST returns an error and `data` is `null` — not `[]` —
  so an implementer writing `expect(data).toHaveLength(0)` gets a `TypeError`, not a clean assertion.
  Assertion 6 has the same ambiguity in the other direction: with no DELETE grant the delete raises
  `42501`, it does not silently affect zero rows, and the plan does not say which to expect.
- **Fix**: Pin both: assertion 8 → `expect(data).toBeNull()` and `expect(error?.code).toBe("42501")`;
  assertion 6 → `expect(error?.code).toBe("42501")` **and** the re-read as owner still returns the row.
- **Decision**: PENDING

### F9 — Criterion 6.4 fails today for a reason this change did not cause

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 § Automated Verification · Progress 6.4 · 6.2
- **Detail**: `npx prettier --check README.md AGENTS.md context/foundation/roadmap.md
  context/deployment/deploy-plan.md` **currently fails** on `AGENTS.md` — two pre-existing lines use
  `*surviving*` / `*down*` where Prettier wants `_surviving_` / `_down_`. lint-staged will rewrite them on
  the first commit that touches the file, so the criterion will pass, but it arrives as unrelated diff
  noise inside the change unless it is expected. Second, smaller point: criterion 6.2
  (`git grep -n "no schema" -- context/foundation/roadmap.md` returns nothing) exits **1** on success,
  exactly like 6.1 — 6.1 carries the "do not `&&`-chain" note and 6.2 does not.
- **Fix**: Add one line to Phase 6 noting the two-line `AGENTS.md` reformat is expected and pre-existing,
  and copy 6.1's exit-1 parenthetical onto 6.2.
- **Decision**: PENDING

### F10 — Phase 5 teaches "don't filter by owner", which is right here and wrong for every table that copies it

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 5 § Dashboard reads the profile · Phase 6 § Agent instructions
- **Detail**: "No query filter by user id is needed and none should be added: the point is that **RLS**
  returns exactly one row." Correct as a *demonstration*, and correct for a single-row primary-key table.
  But this change's declared purpose is to be the shape every later table copies, and on `workouts` /
  `sets` an unfiltered `select` relying on the policy predicate for filtering is a full scan — the exact
  thing `AGENTS.md` § Cloudflare traps warns about under the 10 ms CPU cap, and the reason the plan itself
  insists on `(select auth.uid())` as an InitPlan.
- **Fix**: Keep the unfiltered query in Phase 5 (it is the honest demonstration) but add one sentence to the
  `AGENTS.md` § Access control template in Phase 6: the policy is the guarantee, an explicit
  `.eq("user_id", user.id)` in the query is the index path — later tables carry both.
- **Decision**: PENDING

## Coordinator questions — explicit answers

**1. The SQL — correct and complete; I found no path in or out.** Every item on the checklist is present and
right: `enable row level security` inside the creating migration; all three policies `to authenticated`;
`(select auth.uid())` everywhere; `with check` on INSERT **and** on UPDATE alongside `using`, so a row
cannot be rewritten to another owner's `id`; `revoke all … from anon, authenticated` before the grant, which
neutralises Supabase's default `GRANT ALL ON TABLES`. Deletes are denied twice over (no grant, no policy) and
`anon` is denied twice over (no grant, no policy) — PostgREST returns `42501` in both cases. There is no view,
no RPC, and no callable `security definer` function (both functions `return trigger`, which Postgres refuses
to invoke outside a trigger context), so no side door exists. The declining of `force row level security` is
correct and reasoned. Two residual, accepted exposures, both already governed by the plan: `service_role`
keeps its default `ALL` grant and does carry `BYPASSRLS` on Supabase — safe only because that key is banned
from `.env`, CI and the Worker, which the plan states three separate times; and the `postgres` owner is not
subject to the policies, which is what keeps the dashboard editor working. The only thing I would add is
cosmetic: `created_at` is writable by its owner (`updated_at` is not, because the `before update` trigger
overwrites it). Harmless, worth one line in the template so S-02 does not copy it without noticing.

**2. The `auth.users` trigger — sufficient as constructed; the gap is the fallback's implementation site, not
the SQL.** `security definer` is not optional here: at trigger time the executing role is
`supabase_auth_admin`, which has no grant on `public.profiles`, so without it the insert fails outright.
`set search_path = ''` is the correct hardening for a `SECURITY DEFINER` function and forces the
fully-qualified names, which the body has; `now()` still resolves through the implicit `pg_catalog`. Postgres
does not re-check `EXECUTE` when firing a trigger, so no `grant … to supabase_auth_admin` is needed — that
requirement belongs to Auth *hooks*, not triggers. `after insert` (not `before`) is required for the FK to
`auth.users(id)` and the plan has it. `on conflict (id) do nothing` makes a retried signup idempotent. And
yes, a failure surfaces exactly as `Database error saving new user`: GoTrue wraps any error inside the
user-insert transaction into that message. The fallback **is** genuinely schema-change-free — the INSERT
policy plus the `insert` grant already let an authenticated client create its own row, and the backfill
covers the accounts that exist. Is there a safer construction? One is often proposed —
`exception when others then return new;` — and I would **reject** it: it converts a loud signup failure into
a silent population of accounts with no timezone, and a wrong training-week boundary is the failure mode
`AGENTS.md` opens with. Keep it loud. The real deficiency is F4: the mitigation is named but has no file,
no function and no phase, so hitting it means improvising against a broken production signup.

**3. CI writing to the owner's only database — keep one project. Recommendation, not a survey.** The
"two projects" note in `context/foundation/infrastructure.md:252` and its risk-register row (`:300`) is
scoped to a *different vector*: **public preview URLs** pointed at production, where the exposure is
unauthenticated reads by strangers. This project has no preview deploys — deployment is a manual
`wrangler deploy` of one Worker — so that risk is inert, and it is not an argument about CI test isolation.
On the merits for F-03: a second free-plan project would have to be migrated in lockstep, and **schema drift
between a test project and production is a far more likely source of false green than shared data is** —
CI would prove RLS on a table that is not the table serving users. The plan's Decision 12 leans on precisely
this: an unpushed migration turns CI red *because* CI points at the real schema. That drift detector
disappears the moment you split. Add the practical costs — a second database password, a second
`SUPABASE_DB_URL`, doubled `db push`, and consumption of the free plan's only spare project slot, which is
the slot a preview environment would want later — against a blast radius of two fixture rows in one table,
confined by the very policy under test, and the answer is clear. **Single project, with two conditions**: (a)
the concurrency guard in F1(iii), because the real risk here is not data corruption but two runs colliding;
(b) revisit at S-02, when CI starts writing *workout* rows rather than two preference rows — that is where
the calculus genuinely changes, and S-09 is the natural owner. Record the revisit trigger in the plan; do
not build the second project now.

**4. `weight_unit` and `estimation_formula` in F-03 rather than S-06 — sound, keep them.** Decisive on the
roadmap's own dependency graph: **S-03 depends on F-03, F-01 and S-02 — not on S-06.** S-03 ("log a workout
and see the estimated one-rep max") cannot render an estimate without a formula or a unit, so these columns
must exist before S-06 by construction; putting them here rather than in S-03 costs one line each in a
migration that is being written anyway. Because all three are `not null default`, S-06 does zero data
migration and keeps its whole feature (FR-016, FR-022, US-03) — F-03 creates storage, S-06 creates choice.
No collision. Two caveats worth writing into the plan: the *defaults* (`Europe/Warsaw` / `kg` / `brzycki`)
are a product decision the plan already flags as pending-owner (Decision 4) and should stay flagged; and the
`enum` choice fixes the value sets, so S-06's UI must render exactly `kg|lb` and `epley|brzycki` and nothing
else. The narrow-precedent note (enums only for closed sets fixed by the PRD; muscle groups become a lookup
table) is the right guardrail and should survive into `AGENTS.md`. Strictly speaking `timezone` alone would
suffice to make the UPDATE policy demonstrable, so that particular justification is the weakest of the
three — the S-03 dependency is the one that carries the decision.

**5. Feasibility — every claim re-verified, all hold; one new defect found in the wrapper's neighbourhood.**
`--db-url` needs no Docker, no login, no link (reproduced: the dry run goes straight to
`Connecting to remote database…`). The CLI genuinely ignores `SUPABASE_DB_URL` from the environment
(`LegacyProjectNotLinkedError`, exit 1). `db.<ref>.supabase.co` really is AAAA-only, and I strengthened the
plan's evidence: a raw TCP connect to that address returns **`ENETUNREACH`**, which is a stronger proof than
the plan's `curl: could not resolve host`. Both `aws-0-` and `aws-1-eu-central-1.pooler.supabase.com` resolve
to IPv4 and TCP-connect on 5432, so "copy it from the dashboard, do not construct it" is correct advice, and
session mode (5432, not 6543) is the right choice for DDL. `migration list --db-url` reaches the connect step
with no local `supabase/migrations/` directory, so Phase 1's gate is runnable before any SQL exists — and
`Time (UTC)` really is in the binary, so criterion 1.1's expected table header is real. On the wrapper:
`node_modules/supabase/dist/supabase.js` is exactly what the plan says, and reading it makes the design
*better* founded than the plan claims — it is an ESM shim that `execFileSync`s the platform binary with
`stdio: "inherit"` and re-exits with the child's status, so (a) `spawnSync(process.execPath, [thatFile, …])`
works (I ran it), (b) exit codes propagate through two hops correctly, and (c) the `types` verb's stdout
capture reaches the real binary *because* the shim inherits rather than pipes. Two things the plan gets
wrong in that area: the masking requirement is unimplementable under inherited stdio (F6), and the sibling
`vitest.integration.config.ts` reaches for `loadEnv` from an undeclared `vite` (F5). One robustness nit worth
taking for free: resolve the shim with `createRequire(import.meta.url).resolve("supabase/package.json")`
rather than hardcoding `node_modules/supabase/dist/supabase.js`, so a hoisted or workspace install still
works.

**6. Success criteria that cannot produce their stated output — three, all in Phase 3 (F2).** 3.1
(`git status --porcelain` "empty" on an untracked file → always `??`), 3.2 (`git grep` searches tracked files
only → no output, exit 1) and 3.3 (`git ls-files --eol` on an untracked file → **no output, exit 0**, i.e. a
gate that reports success while checking nothing). Phase 2's 2.4 handles the identical situation correctly
with an explicit `git add`, which is the fix. On the Windows question the plan is clean: there is **no bare
`grep`** anywhere in the criteria — every text search uses `git grep`, which works in PowerShell and Git Bash
alike, so the previous review's F4 lesson has been absorbed. On non-zero exit as a success condition: 6.1
carries the correct "exits 1 on success; do not `&&`-chain" note; 6.2 has the same property and lacks the
note (F9). Everything else in the 34 criteria is runnable and produces what it claims, including 1.1, 2.1,
2.3 and 4.5, which I checked against the CLI binary and against `ci.yml` directly. Two soft spots that are
not defects: 4.1's "**8 passing**" hard-codes a count that shifts if the implementer splits assertion 6's
two halves into two `it()` blocks, and 4.3's "still exits 0 **with no network access**" is a claim rather
than a command.

**7. The Phase 4 red proof — not acceptable as written, and, better, not necessary (F3).** Disabling RLS on
the single database that serves the public Worker and holds real auth accounts has an asymmetric failure
mode: an interrupted revert leaves reads *and writes* open, on the table whose whole purpose is to be the
template for "a table without RLS is a defect, not a follow-up". The equally convincing alternative is
already latent in the plan and costs nothing: assert that **A sees exactly one row, B sees exactly one row,
and the two ids differ**. That trio proves the table holds ≥ 2 rows and that each client sees only its own —
so with RLS disabled the first assertion returns ≥ 2 and the suite goes red. Same guarantee, obtained by
construction, with no production window. It also fixes a quieter problem: assertion 2's non-vacuity currently
depends on the backfilled `smoke-…@gymlog-test.dev` row, which `deploy-plan.md` schedules for deletion — the
day that row goes, the "at least three rows" premise evaporates and *nothing turns red*. If a mutation-style
proof is still wanted afterwards, the safe form is adding and then dropping a permissive `for select … using
(true)` policy (RLS stays on; writes stay protected), never toggling the `enable row level security` flag.

## Bottom line

**Not ready for `/10x-implement` — but the gap is narrow, and it is not in the part that mattered most.** The
SQL is right. I went looking for the classic omissions in this shape — `to public` instead of `to
authenticated`, a bare `auth.uid()`, an UPDATE policy with `using` but no `with check`, an implicit grant
surviving the revoke, a delete path nobody decided on — and found none of them. The trigger construction is
correct and its stated failure mode is accurate. The feasibility work was measured, and everything I could
independently reproduce, reproduced; in two places (IPv6 unreachability, the CLI shim's stdio behaviour) the
evidence is stronger than the plan claims.

Fix before implementing:

- **F1** — the fixture-mutation design will eventually leave a poisoned row and a permanently red pipeline,
  and it contradicts `AGENTS.md` § Testing. `beforeAll` reset + unique write values + a CI `concurrency`
  group.
- **F2** — three Phase 3 criteria cannot produce their stated output; one of them *silently passes* while
  verifying nothing about line endings. Copy 2.4's `git add` step.
- **F3** — make assertion 2 self-proving (A sees 1, B sees 1, ids differ) and drop the production RLS
  toggle. This removes both a production risk and a hidden dependency on a row scheduled for deletion.
- **F4** — give the trigger fallback a file and a function, or state that hitting it stops the change.
- **F5** and **F6** — two-line edits; take them in the same pass.

F7–F10 are worth taking but nothing depends on them.

With F1–F6 applied, this reaches SOUND. On the two owner-facing calls I was asked to decide: **one Supabase
project, not two** (revisit at S-02), and **keep `weight_unit` / `estimation_formula` in this change** —
S-03 needs them and does not depend on S-06.
