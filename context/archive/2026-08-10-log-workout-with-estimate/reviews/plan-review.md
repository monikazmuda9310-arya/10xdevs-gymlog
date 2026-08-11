<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Log a Workout and See What It Was Worth

- **Plan**: `context/changes/log-workout-with-estimate/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 0 critical, 3 warnings, 4 observations — all seven fixed

> Reviewer's note: the plan was written in the same session by the same agent, so the three riskiest
> technical claims were delegated to an independent sub-agent with documentation access rather than
> judged from memory. Two of them came back confirmed, which is recorded below alongside the
> findings — a review that only lists problems hides which assumptions were actually checked.

## Verdicts

| Dimension             | Verdict            |
| --------------------- | ------------------ |
| End-State Alignment   | WARNING → resolved |
| Lean Execution        | WARNING → resolved |
| Architectural Fitness | PASS               |
| Blind Spots           | WARNING → resolved |
| Plan Completeness     | WARNING → resolved |

## Grounding

8/8 paths ✓, 5/5 symbols ✓, brief↔plan ✓, Progress↔Phase 32 criteria ↔ 32 checkboxes 1:1 ✓
(3 integration suite files today; the plan's "four files" criterion is correct after Phase 1.)

## Claims verified and confirmed

- **PostgREST embeds across a composite foreign key.** Its documentation states the join condition is
  generated from the foreign-key columns "respecting composite keys". The embed name stays the plain
  table name with no hint syntax — conditional on exactly one FK path existing between the pair,
  which became finding F4.
- **The `SubmitButton` warning is accurate.** `src/components/auth/SubmitButton.tsx:12` derives its
  only state from `useFormStatus()`, and its single current caller `SignInForm.tsx:50` performs a
  genuine native POST. Under `fetch` + `preventDefault` the pending state would never flip.
- **`PROTECTED_ROUTES` is a single array entry** matched with `startsWith` (`src/middleware.ts:5,30`),
  so `/workouts` does cover `/workouts/[id]`, and no other code path reads the array.
- **A fourth integration suite needs no registration** — `vitest.integration.config.ts` globs the
  directory, and `fileParallelism: false` already serialises suites that share the fixture accounts.

## Findings

### F1 — `todayIn` is unit-tested in Node, but runs in workerd

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 → `calendar.ts`; criterion 2.2
- **Detail**: `vitest.config.ts` runs `environment: "node"`, and Node ships full ICU, so the tests
  pass regardless of what the deployment runtime does. No file in this repository has used `Intl`
  before, and no primary Cloudflare document states that Workers carries complete IANA timezone
  data. The only check that would catch a reduced-ICU build sat in Phase 5 — after the form, the
  endpoints and both screens were built on it.
- **Fix**: Add a temporary probe endpoint (`src/pages/api/dev/tz-probe.ts`) returning `todayIn` for
  Kiritimati (+14), UTC and Niue (−11) at a fixed instant, exercised with `curl` against
  `npm run dev`, which runs the real workerd. Three distinct dates prove real timezone data.
  Phase 5 deletes the file, and both its deletion and its 404 on the deployed host are success
  criteria there.
  - Strength: Answers the question in Phase 2, in the runtime that matters, for one file.
  - Tradeoff: A temporary route that must be removed — made a checked criterion, not a memory.
  - Confidence: HIGH — `astro dev` runs real workerd per `AGENTS.md` § Cloudflare traps.
  - Blind spot: Dev and production builds are assumed to share an ICU compilation.
- **Decision**: FIXED

### F2 — The plan never says which column feeds the estimate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 → `WorkoutDetail`
- **Detail**: The schema stores `weight` (as entered), `weight_unit` and `weight_kg`. Nothing said
  which one `estimateForSet` receives. In S-03 the difference is invisible because a set's unit
  always equals the profile's — but the success criterion "a 1-repetition set shows an estimate equal
  to the weight typed" has no defined answer without the rule, and guessing `weight_kg` would show a
  pounds user an estimate in kilograms the moment S-06 ships.
- **Fix**: State the rule in Phase 4's contract — estimate from the value on screen: `set.weight`
  when `set.weight_unit === profile.weight_unit`, otherwise `weight_kg` converted into the profile's
  unit — and unit-test both branches even though the second is unreachable from the S-03 screen.
  - Strength: Closes the gap now and makes S-06 a pure preference change.
  - Tradeoff: One branch S-03 cannot exercise from the UI.
  - Confidence: HIGH — follows directly from the storage decision.
  - Blind spot: None — the rule is unit-testable.
- **Decision**: FIXED

### F3 — The attack script re-implements the integration suite

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 → `scripts/attack-workout-boundary.mjs`
- **Detail**: The eight boundary crossings the script printed are the same crossings
  `workout-log-rls.test.ts` already performs and asserts. Two implementations of one intent drift at
  the first schema change, and the one outside the CI gate drifts first — which is precisely the one
  serving as the owner's evidence.
- **Fix A ⭐ Recommended**: Delete the script; have the suite print the SQLSTATE and message of each
  refusal through a small `report()` helper, and point the manual criterion at
  `npm run test:integration -- --reporter=verbose`.
  - Strength: One implementation, inside the gate, so it cannot rot unnoticed. Still satisfies
    `lessons.md:37-51`, whose requirement is a demonstrated attack showing raw responses.
  - Tradeoff: The owner reads test output rather than a bespoke report.
  - Confidence: HIGH — the suite performs every crossing already.
  - Blind spot: Requires `--reporter=verbose` to see the output.
- **Fix B**: Keep the script as the single implementation and have the suite import its crossings.
  - Strength: One source of truth plus a standalone tool.
  - Tradeoff: A test depending on `scripts/`, a pattern used nowhere else here.
  - Confidence: MEDIUM — works, but cuts against convention.
  - Blind spot: `scripts/` is outside the test tsconfig.
- **Decision**: FIXED via Fix A

### F4 — A "clarifying" second foreign key would break every nested read

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 → the migration
- **Detail**: PostgREST embedding works because exactly one FK path exists between each pair of
  tables. Adding a plain `workout_id references workouts (id)` beside the composite key creates a
  second constraint and every nested read fails with `PGRST201`, demanding `!constraint_name` hints
  at each call site. The plan depended on this and never said so.
- **Fix**: Documented in § Critical Implementation Details, required as a migration comment, added to
  § Open Risks, and written into `AGENTS.md` by Phase 6.
- **Decision**: FIXED

### F5 — The generated column's immutability trap was unnamed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 → `sets.weight_kg`
- **Detail**: The expression is accepted because the `'kg'` literal is folded into a typed constant
  and enum equality is immutable. Rewriting it as `weight_unit::text = 'kg'` would be rejected at
  `create table` time, since `enum_out` is `STABLE`. Neither the trap nor a fallback was recorded.
- **Fix**: Named in § Critical Implementation Details with the `before insert or update` trigger as
  the fallback, plus the note that `db:push` reaches `gymlog-test` first so production is protected.
- **Decision**: FIXED

### F6 — No index supports S-04's central query

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 → indexes
- **Detail**: S-04 asks "every set this account logged for this exercise", which reaches `sets` only
  through `exercise_entries`. The planned indexes covered `(user_id, workout_id)` but not
  `(user_id, exercise_id)`, leaving that query nothing to travel on. One line now, a migration later.
- **Fix**: Added `exercise_entries (user_id, exercise_id)` to the migration contract, with the
  asymmetry stated as the reason.
- **Decision**: FIXED

### F7 — The note constraint rejects the empty string

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 1 and 3
- **Detail**: `check (char_length(note) between 1 and 500)` fails on `""`, which is exactly what an
  untouched note field submits — surfacing as a database constraint violation the user cannot act on.
- **Fix**: The migration contract states the requirement; Phase 3's schema trims the note and
  normalises empty or whitespace-only input to `null`, with a unit test for both.
- **Decision**: FIXED

## Triage summary

Fixed: F1 (probe), F2 (estimate input rule), F3 (Fix A — script removed), F4, F5, F6, F7 — 7 of 7.
Skipped: none. Accepted: none. Dismissed: none.

**Verdict after fixes: SOUND.** Phase counts changed — Phase 1 lost an artifact and a criterion,
Phase 2 gained the probe and a criterion, Phase 4 gained a criterion, Phase 5 gained the probe's
removal and two criteria. Progress renumbered to stay 1:1 — verified mechanically at 40 criteria
bullets ↔ 40 numbered checkboxes.
