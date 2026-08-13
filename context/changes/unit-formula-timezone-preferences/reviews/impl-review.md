<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Unit, Formula and Timezone Preferences (S-06)

- **Plan**: `context/changes/unit-formula-timezone-preferences/plan.md`
- **Scope**: all five phases (`b41426c..1efec07`, 24 files)
- **Date**: 2026-08-13
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 7 observations

Run with **two sub-agents at the owner's explicit request** — one on plan drift, one on safety,
patterns and test quality — for the same reason S-06's plan review was: the implementer was also the
reviewer. The split paid again. The sharpest finding (F1) was reported **independently by both**,
which is what made it worth acting on immediately; and F2's real extent was found only after a
strengthened assertion was written, not by reading.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Verified independently of the findings below: all ten items of § What We're NOT Doing still hold in
the code (no migration — `git diff … -- supabase/` empty; no stored weight converted; no confirmation
dialog; no delete path on `profiles`; no out-of-band DDL; no per-workout unit override; no new
derived numbers; no E2E; `heaviestFigure` untouched; no browser timezone detection). Both assertions
the plan **forbids** are genuinely unwritten, with their reasoning comments present. The three
"do not delete as redundant" suites are absent from the diff.

## Findings

### F1 — `/settings` offered a timezone the endpoint then refused

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/settings.astro:47-49, 86-90` (as reviewed)
- **Detail**: When the stored zone was not in `Intl.supportedValuesOf("timeZone")`, the page rendered
  it back as a selectable `<option>`. The endpoint validates against that same list, so submitting it
  answered `400 timezone_unknown` for a value the page itself supplied — and because the payload is a
  full replacement, it blocked the unit and formula changes with it. The comment claimed the branch
  prevented exactly that state; it produced it. This is the two-sources failure § Critical
  Implementation Details forbids by name, arriving through the one door nothing was watching.
  Reproduced before fixing: the rendered option set went to 418 against a runtime list of 417 (so
  criterion 3.4 would have failed in that state), and `parseUpdateProfile` answered
  `timezone_unknown` for the offered value.
- **Fix**: name the zone but make it unselectable — a `disabled` placeholder carrying `value=""`,
  which the schema answers with `timezone_required` ("Choose the timezone your training week runs
  in"), plus a sentence saying dates fall back to UTC and to pick a replacement.
  - Strength: no value is ever offered that the server refuses, the account is told what is stored
    rather than shown a substitute as its own choice, and the message is actionable.
  - Tradeoff: one more branch on the page and five more render assertions.
  - Confidence: HIGH — the state had no test at all, which is why it shipped; three of the new
    assertions fail against the old markup, verified by mutation.
  - Blind spot: only reachable through an ICU upgrade dropping a name or a hand-edited column.
- **Decision**: FIXED — `2491db4`

### F2 — zod's own prose reached the `code` field, in three distinct ways

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/validation/exercise-schemas.ts:32`, `workout-schemas.ts:137`, and the `note`
  / `rpe` field declarations
- **Detail**: The `code` channel is kept free of provider wording because prose arriving from outside
  and rendered as a system message is what turns a screen into a phishing surface. Measured, not
  reasoned: `POST /api/exercises` with a body of `"x"` answered
  `{"code":"Invalid input: expected object, received string"}`. `workout-schemas` normalised with
  `typeof`/`null` but admitted arrays (`typeof [] === "object"`). And a third, deeper instance
  surfaced only after the assertion was strengthened: a field declared with **no `error` argument**
  fails its TYPE check before `.min()`/`.max()` can supply a message, so `{ note: 5 }` and
  `{ rpe: "high" }` each leaked a sentence of their own, across three parsers.
  **The old assertions could not catch any of it** — `exercise.test.ts` checked only that parsing
  failed, which it did, loudly and in the wrong words.
- **Fix**: normalise non-plain-objects in both siblings; give every field an `error`; assert in both
  suites that the code is one this project wrote, plus a cross-parser probe over all five workout
  parsers.
  - Strength: the class is closed by type rather than by anyone remembering `[]`; a new field without
    a message now fails a test instead of reaching a user.
  - Tradeoff: touches two modules S-06 had deliberately left alone.
  - Confidence: HIGH — verified by mutation; dropping the `rpe` message fails two cases and names the
    leaked sentence in the failure output.
  - Blind spot: not exploitable today — the prose is zod's, not the caller's, and the client resolves
    unknown codes to the generic message. This is discipline, not exposure.
- **Decision**: FIXED — `2fb2ef3`

### F3 — a missing profile row rendered as loaded defaults

- **Severity**: ⚠️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/settings.astro:30`
- **Detail**: `loadFailed` was set only inside `catch`, but `getProfile` uses `maybeSingle()`, so an
  absent row arrives as `null` **without throwing**. It fell through and rendered
  `Europe/Warsaw / kg / brzycki` as though the account had chosen them — the exact confusion the
  comment above says `loadFailed` prevents, reached by the one path that skipped it.
- **Fix**: treat `null` as a failed load, with a render assertion covering it.
- **Decision**: FIXED — `2fb2ef3`

### F4 — an assertion kept because it cannot fail yet, presented as coverage

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/integration/preferences-derive.test.ts:317`
- **Detail**: Assertion 3 (a 25-hour timezone swing moves no `performed_on`) cannot fail today —
  `profiles.timezone` has no path to a `date` the user stated. Twenty lines later the same file
  **declines** to write an assertion in the identical position, with a careful explanation. Both
  calls are defensible; deciding differently in silence is what leaves the next reader guessing.
- **Fix**: keep the assertion, and give it the paragraph the file gives the one it refuses — naming
  S-07's weekly-boundary view as the edit that would make it bite.
- **Decision**: ACCEPTED-AS-RULE + FIXED — rule in `lessons.md`, comment applied — `be8c1c9`

### F5 — `finally` does not survive a killed process

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/integration/preferences-derive.test.ts`, `profile-mutations-rls.test.ts`
- **Detail**: Fixture discipline is correct within a run — reset in `beforeAll`, restore in
  `finally`, closing tripwire assertions — but a **process kill** between the flip and the restore
  skips it, as does a network failure inside the restore itself. The tripwire never runs either, so
  the damage lands on the next run in `workout-endpoints.test.ts`, which asserts `"kg"` and does not
  reset preferences itself. Teardown protects the happy path; only setup protects the next run.
- **Fix**: recorded as a rule. **The code follow-up — a preferences reset in the dependent suites'
  `beforeAll` — is NOT done and remains open.**
- **Decision**: ACCEPTED-AS-RULE — `be8c1c9`

### F6 — dead `formRef` in the settings island

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/settings/PreferencesForm.tsx:45,103`
- **Detail**: `useRef<HTMLFormElement>(null)` is attached and never read; submit uses
  `event.currentTarget`. ESLint does not flag it because the ref is used as a JSX value.
- **Fix**: delete both lines and the `useRef` import.
- **Decision**: SKIPPED

### F7 — `updateProfile` returns the whole row

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/profiles.ts:79`
- **Detail**: `.select("*")` puts `id`, `created_at`, `updated_at` in the response; the island
  consumes exactly three fields and says so. Not a leak — it is the caller's own row.
- **Fix**: narrow the select to the three preference columns.
- **Decision**: SKIPPED

### F8 — `dashboard.astro` is the last caller of the superseded inline profile read

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/dashboard.astro:9`
- **Detail**: `settings.astro` and `records.astro` both use `getProfile`; the dashboard still uses
  the inline query `profiles.ts`'s header describes as the thing the service replaced. Not a defect —
  AGENTS.md names `profiles` as the one table where an unfiltered read is honest, and the read is
  F-03's RLS demonstration with a real error branch — but S-06 edited the lines around it.
- **Fix**: leave it; the unfiltered read is deliberate and documented.
- **Decision**: SKIPPED

### F9 — tripwire assertions depend on `it` declaration order

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `vitest.integration.config.ts`
- **Detail**: The closing "fixture is back on the defaults" assertions rely on being the last `it` in
  their files. Vitest preserves declaration order, so this holds — but `sequence.shuffle` would
  silently defeat both.
- **Fix**: a line in the integration config saying shuffle must stay off.
- **Decision**: SKIPPED

## What was verified and found correct

Recorded because a review that lists only problems misrepresents what was checked:

- **The zero-row 404** is built by the application, not reported by Postgres, and `profile_not_found`
  answers "absent" and "somebody else's" identically. No provider text can reach a response body.
- **`updateProfile` writes exactly three columns** from a destructured, closed type — no spread, so
  no excess property from a parsed body can reach the write — scoped by `.eq("id", userId)` with the
  policy carrying both `using` and `with check` behind it.
- **The island's import surface is clean**, traced rather than assumed: `react` → `lucide-react` →
  `@/lib/utils` → `@/types` → `@/lib/validation/profile`, every one of those either runtime-trivial
  or type-only. No zod, no Supabase client, no timezone list.
- **`isSupportedTimeZone` is pollution-proof** (a `Set`, pinned by a test asserting `constructor` and
  `toString` answer false), as is `profileMessageForCode` via `Object.hasOwn`.
- **Module-scope computation of the zone list is right for the 10 ms cap**, which is per invocation;
  memoising it behind a function would move the cost onto a request.
- **The fabricated-id assertion is the strongest thing in the diff** and its sharpening history is
  visible in the test and in `lessons.md`.

## Post-review state

- Fixes deployed: Worker version `57406721-3c50-4fec-a607-d809e00452b7` at 100% of traffic.
- CI **#46** green for `be8c1c9`, every step including `npm run test:render`.
- Tests: **189 unit, 95 integration, 11 render** (up from 183 / 95 / 5).
- Open follow-up: **F5's code half** — a preferences reset in `workout-endpoints.test.ts` and
  `personal-records.test.ts` `beforeAll`.
