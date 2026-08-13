# Unit, Formula and Timezone Preferences Implementation Plan

> Revised 2026-08-12 after `/10x-plan-review` (10 findings, all applied).
> See `reviews/plan-review.md` — in particular F1, which removed this plan's original risk narrative.

## Overview

Three preferences the account already owns in the database but has never been able to change: the
unit weights are entered and displayed in, the formula that estimates a one-rep max, and the timezone
the training week runs in (FR-016, FR-022, US-03).

Every derived number on screen follows the choice **by re-derivation, never by rewriting anything**.
Nothing stored is converted, nothing historical is migrated, and switching back restores the previous
figures to the digit — which is only true because S-03 and S-04 refused to store a single derived
value.

## Current State Analysis

**The database already does most of this, and that is the central fact of this slice.**

- `public.profiles` carries `timezone`, `weight_unit` and `estimation_formula` with defaults
  `Europe/Warsaw` / `kg` / `brzycki`, created by F-03's migration. `update` is granted to
  `authenticated` (`20260810063450_create_profiles_with_row_ownership.sql:42`) and the update policy
  carries both `using` and `with check`. **There is no migration in this slice.** If one appears,
  something has gone wrong.
- **`public.set_estimates` already joins `profiles` and reads the formula per row** —
  `coalesce(p.estimation_formula, 'brzycki')` at
  `20260811143000_derive_personal_records_from_surviving_sets.sql:74`. Nothing anywhere reads a
  hardcoded formula. Changing the column re-derives every estimate, every record and every impact
  warning on the next read, with no write and nothing to invalidate.
- **The display layer already takes both preferences as parameters.** `set-display.ts`,
  `record-display.ts`, `records.astro` and `workouts/[id].astro` are all handed `unit` and `formula`
  from `getProfile`. A blast-radius sweep during plan review found **no caller anywhere in `src/`
  that would silently keep an old preference** — every path is server-rendered per request or takes
  the value as a prop from that same read. There is no cache and no stored derived figure.
- **`/api/sets` reads `profiles.weight_unit` on the server** (`src/pages/api/sets/index.ts:55,63`)
  and stamps it onto each new set. So a changed preference takes effect for **new** sets
  automatically, while existing rows keep the unit they were typed in — the round-trip promise, not
  an oversight.
- **`todayIn(profile?.timezone)` is already wired** at `src/pages/workouts/index.astro:23`, so the
  timezone end-state needs only the write path.

**What does not exist**: any way for the user to change any of it. There is no settings screen and no
endpoint that writes a profile. `/dashboard` prints the raw `timezone` string as F-03's demonstration
that RLS returns exactly one row.

### Measured in real workerd, not assumed

`Intl.supportedValuesOf("timeZone")` decides whether a complete timezone list is even available at
the deployment target, and `calendar.ts:18` warns in writing that ICU behaviour in workerd cannot be
inferred from a green Node test. So it was measured before this plan was written, through a temporary
endpoint served by `astro dev` (which runs real workerd), deleted once it had answered:

```
hasSupportedValuesOf: true   count: 418   hasWarsaw: true   hasKiritimati: true
joined names: 6825 bytes
```

The full list is therefore available and cheap. Rendered as `<option>` elements it is roughly 17 KB
of HTML before compression and **zero bytes of JavaScript**, provided the `<select>` is rendered by
Astro and the list never becomes an island prop — see § Critical Implementation Details, which is the
whole reason that section exists.

### What is already guarded, and what this slice actually adds

The first draft of this plan claimed the `s.reps::numeric / 30` cast was "invisible until an account
switches formula, which is exactly what this slice makes possible for the first time". **That was
false**, and it is corrected here because the error shaped a whole phase.

`tests/integration/personal-records.test.ts` has toggled the column since S-04: `setFormula()` at
`:212` writes it, assertion 4 at `:391` loops both formulas and compares every boundary row (1, 2, 3,
5, 12, 13 repetitions) against `estimateOneRepMax`, and assertion 4b at `:429-462` pins
`epley = 100 × (1 + 5/30) = 116.67` — deliberately at five repetitions, with a comment saying that
ten would prove nothing. Drop the cast and Epley returns `100`: 4b fails and 4 fails at four
repetition counts. **The cast is guarded, in the gate, on every push.**

What is genuinely uncovered, and what Phase 2 exists for:

| Preference           | Covered today                      | Not covered                                                        |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `estimation_formula` | value parity SQL↔TS, both formulas | whether a switch changes **which set holds** a record              |
| `weight_unit`        | a unit test on hand-built rows     | anything at all through the database or an endpoint                |
| `timezone`           | the column round-trips             | any derived consequence, including the invariant it must not break |

### Two traps this slice still walks into

**1. The two formulas are numerically identical at exactly 10 repetitions.** `36/27` and `1 + 10/30`
are both `4/3`. A fixture set of ten reads the same under either formula, so it can prove nothing
about a toggle — and it is the first thing to suspect when somebody reports that switching does
nothing (AGENTS.md § Domain rules). Phase 2's fixture is chosen to avoid it and demonstrates the trap
once, deliberately.

**2. An unrecognised timezone fails silently and in the wrong direction.** `calendar.ts:29` catches
the `RangeError` an invalid zone raises and falls back to UTC — deliberately, so a bad profile cannot
take a page down. The consequence is that a typo produces a wrong week boundary with nothing on screen
saying so. Today that is unreachable because nobody can write the column; after this slice it is
reachable from a form, so the validation has to close it.

### Key Discoveries

- `supabase/migrations/20260810063450_create_profiles_with_row_ownership.sql:42` — the `update` grant
  (`:41` is the preceding `revoke`). **No delete policy and no delete grant on purpose**: deleting the
  row while the account survives leaves a live account with no timezone. This slice must not add one;
  `tests/integration/profiles-rls.test.ts:165-177` proves deletion is impossible today.
- `supabase/migrations/20260811143000_derive_personal_records_from_surviving_sets.sql:74` — the view
  reads the formula from the joined profile. This is why the toggle needs no new SQL. Note `:41` is
  `create view`, **not** `create or replace`, and `public.personal_records` at `:122` is built over
  it — which is why this plan does not replace either view out of band.
- `tests/integration/personal-records.test.ts:212,391,429` — the formula toggle is already exercised
  end to end against the view. Phase 2 cites this rather than restating it.
- `src/lib/services/set-display.ts:52` — `weightInUnit`'s second branch, dead until now: _"In S-03
  the second branch is unreachable… leaving it implicit is how S-06 inherits a screen that quietly
  estimates in kilograms for somebody reading pounds."_ **This slice makes it live**, and Phase 2 is
  the first thing to exercise it against stored rows.
- `src/lib/services/one-rep-max.ts:48` — Epley is pinned at one repetition; Brzycki yields it
  naturally.
- `src/lib/services/calendar.ts:26` — `todayIn` and its UTC fallback. Note the fallback at
  `workouts/index.astro:13,23` is `"UTC"`, which does **not** match the column default
  `'Europe/Warsaw'` — an inconsistency worth leaving alone but not worth copying.
- `src/types.ts:31` — `MUSCLE_GROUPS` plus `Assert<MutuallyAssignable<…>>`: the established pattern
  for a Postgres enum the UI must iterate. The two enums this slice puts in a `<select>` need the
  same treatment and do not have it.
- `src/pages/api/_shared/mutation-route.ts:52` — `resolve()` validates a `[id]` param. The profile
  route has no id and its own message catalogue, so it does not reuse this helper. Per-domain
  catalogues that repeat generic codes are the established pattern (`workout.ts:65`,
  `exercise.ts:34`), not duplication.
- `tests/integration/profiles-rls.test.ts` — assertions 4 and 6 already cover a cross-account update
  and the absence of a delete path **at the table level**.
- **`src/components/Topbar.astro` renders on the landing page only** — it is imported by
  `Welcome.astro:2`, which is used by `src/pages/index.astro:7` and nowhere else. A link there would
  not make settings reachable from the training screens.
- `src/pages/dashboard.astro:9` — reads `profiles` inline with no `user_id` filter, deliberately; the
  only profile read that bypasses `getProfile`.

## Desired End State

A signed-in user opens `/settings`, picks kilograms or pounds, Brzycki or Epley, and a timezone from
the complete IANA list, presses Save once, and:

- every estimate, record and impact warning is expressed in the chosen unit and formula on the next
  read, **consistently across every screen** — which FR-016 names as its acceptance criterion;
- switching the formula changes the estimates and can change **which set holds a record**, because
  the two formulas rank differently on either side of ten repetitions;
- new sets are stored in the chosen unit while every set already logged still reads back as the exact
  number typed, in the unit it was typed in;
- a new workout defaults to today in the chosen timezone, and **no workout already logged moves to a
  different day**;
- nothing in the database was converted, and switching back restores the previous figures exactly.

Verified by: the integration suite (the endpoint's write boundary; the record holder moving under a
formula switch; the unit round-trip through stored rows; the timezone invariant); the build (the
418-entry list never crossing into JavaScript); and a human on the deployed URL.

## What We're NOT Doing

- **No migration.** The columns, the grant and the policy already exist.
- **No conversion of stored weights.** `weight` and `weight_unit` on existing rows are never
  rewritten. This is the round-trip promise and the reason the update payload for a set carries no
  unit (S-05).
- **No change to how converted figures are displayed — because the product already draws the line and
  the owner confirmed it (2026-08-12).** FR-022 reads "every weight shown or totalled is expressed in
  it"; the NFR on exact round-trip pulls the other way. The settled reading is: **a derived headline
  figure is expressed in the reader's unit, and the evidence line quoting the set is shown as typed.**
  That is what the code already does — `heaviestFigure` (`record-display.ts:126-127`) converts through
  `weightInUnit` and `records.astro:108-109` prints that converted headline, while the set row on
  `/workouts/[id]` (`WorkoutDetail.tsx:376`) prints the typed value with its own unit. **Do not
  "fix" `heaviestFigure` to stop converting** — it is correct.
- **No confirmation dialog for a preference change.** The dialog built in S-05 guards irreversible
  actions; this one is reversible to the digit. A sentence on the screen carries the explanation
  instead — cheapening the dialog is how people learn to click through the one that matters.
- **No browser timezone detection.** The default is already correct for the account that exists, and
  the list opens with the current value selected.
- **No out-of-band DDL anywhere.** The plan review established that replacing a view outside the
  migration history cannot be verified by `db:status` and risks leaving CI silently wrong. Nothing in
  this slice touches schema on either database.
- **No delete path on `profiles`** — that is S-09, and F-03's migration refuses it on purpose.
- **No per-workout or per-exercise unit override.** One preference per account.
- **No new derived numbers.** Weekly tonnage is S-07.
- **No E2E.** Phase 3 of the course contract owns that through `/10x-e2e`.

## Implementation Approach

The write path is small and the proof is the work, so the phases put the proof **before** the screen:
Phase 2's assertions need only a way to change a preference, not a way to click one.

1. **Phase 1** adds the only new write path in the slice — validated, scoped to the caller's own row.
2. **Phase 2** proves, through Postgres, the three things nothing covers today.
3. **Phase 3** builds the screen on a foundation that has already been demonstrated.

### Critical Implementation Details

**The timezone `<select>` is rendered by Astro and its options never become an island prop.** Astro
serialises island props into `<astro-island props="…">` in the rendered HTML, so passing the 418-entry
list as a prop would ship ~7 KB of zone names into JavaScript to be parsed at hydration — the exact
cost the server-rendered decision exists to avoid. The island wraps the `<select>` and knows only the
**currently selected value**. Criterion 3.3 checks this against the rendered HTML, because a check
against `dist/client/` would pass while the leak was present.

**Validation and the list come from one source.** `isSupportedTimeZone` and the options the page
renders both read `Intl.supportedValuesOf("timeZone")`. If they came from two places, the form could
offer a value the server then refused.

---

## Phase 1: The preference write path

### Overview

The one new write path: rules, schemas, service and endpoint, plus the integration suite that proves
the endpoint writes only the caller's own row.

### Changes Required:

#### 1. The timezone source

**File**: `src/lib/services/timezones.ts` _(new)_

**Intent**: One place that knows which timezones exist, so the `<select>` and the validator cannot
disagree. Measured present in workerd (418 zones) before this plan was written.

**Contract**: Exports the sorted list and a membership test. Computed once at module scope — the
answer cannot change within a deployment. Carries a small hardcoded fallback used only if
`Intl.supportedValuesOf` is absent; that path is a **tripwire, not a supported mode**, and the comment
must say so along with the measurement showing it unreachable today.

#### 2. The two enums as values

**File**: `src/types.ts`

**Intent**: The settings form has to iterate the weight units and the estimation formulas. A
hand-written list in a component is how a third value ships to the database and never reaches the
screen — the exact failure `MUSCLE_GROUPS` exists to prevent.

**Contract**: `WEIGHT_UNITS` and `ESTIMATION_FORMULAS` as `as const` tuples, each pinned in both
directions by the existing `Assert<MutuallyAssignable<…>>` helper against the generated enum type.

#### 3. Rules and messages

**File**: `src/lib/validation/profile.ts` _(new)_

**Contract**: `PROFILE_MESSAGES` and `profileMessageForCode`, in the shape `workout.ts` and `auth.ts`
already use: a code catalogue, an unrecognised code resolving to the generic message and never to the
caller's own words. **Imports nothing**, because the settings form is a `client:load` island.

**File**: `src/lib/validation/profile-schemas.ts` _(new)_

**Contract**: `updateProfileSchema` = `{ timezone, weightUnit, estimationFormula }` as a full
replacement, and `parseUpdateProfile` returning the established `ParseResult` shape. The timezone is
validated with `isSupportedTimeZone` — not by a regex and not by length alone, because the failure
this closes is a well-formed string that is not a real zone. **Server-only.**

#### 4. The service

**File**: `src/lib/services/profiles.ts`

**Contract**: `updateProfile` carries `.eq("id", userId)` and `.select()`s the row, returning `null`
when nothing was updated. It writes exactly the three preference columns and nothing else.

#### 5. The endpoint

**File**: `src/pages/api/profile/index.ts` _(new)_

**Contract**: Exports `prerender = false`, resolves `supabase`/`user` from `context.locals`, answers
`500 not_configured` / `401 unauthenticated` before anything else, validates the body, and answers the
updated row or `404` when the update matched nothing. **It deliberately does not reuse
`_shared/mutation-route.ts`**: that helper's main job is validating a `[id]` param, and this route has
no id. A comment must say so, or the next reader will read the short preamble as duplication.

#### 6. The write-boundary suite

**File**: `tests/integration/profile-mutations-rls.test.ts` _(new)_

**Intent**: `profiles-rls.test.ts` already proves the table's policies. This proves the **endpoint** —
and it is written to be capable of failing, which the first draft of this plan was not.

**Contract**: The naive assertion "account B cannot PATCH account A's row" is **deliberately not
written**: the route takes no id, so B has no way to name A's row, and the assertion would hold by the
absence of a parameter rather than by any guarantee — it would even survive deleting
`.eq("id", userId)`, because RLS confines the update anyway. Instead:

- **The endpoint writes only the row named by `locals.user.id`.** Call the handler with a fabricated
  `locals.user.id` (a random uuid, the pattern at `workout-endpoints.test.ts:39-49`), then re-read
  both fixture accounts' rows and require both unchanged. This can fail — a handler that resolved the
  row any other way would write something.
- **The same fabricated id supplies the zero-row `404`**, which is otherwise unreachable: a trigger
  creates a profile for every account and there is no delete path, so `.eq("id", userId)` cannot miss
  for a real caller.
- A well-formed but unknown timezone is refused `400` and **the stored row is re-read to show it
  unchanged**; a bogus unit or formula is refused; a valid change round-trips and is visible on
  re-read.

Fixture discipline per AGENTS.md § Testing — reset in `beforeAll`, run-unique values, restore in a
`finally`.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- `tests/integration/profile-mutations-rls.test.ts` passes, including the fabricated-id assertion
- `git diff --name-only origin/main...HEAD -- supabase/` is empty — this slice has no migration
- No delete path is added: `profiles.ts` and the profile route contain no `.delete(`
- Mutation (a): dropping `isSupportedTimeZone` from the schema lets `Europe/Warsawa` be stored and
  fails the unknown-timezone assertion, then reverted
- Mutation (b): resolving the row from anything other than `locals.user.id` fails the fabricated-id
  assertion, then reverted
- Mutation (c): removing a value from `WEIGHT_UNITS` while leaving the Postgres enum alone fails
  `npm run typecheck` on the assertion in `src/types.ts`, then reverted. **Any mutation that breaks
  nothing is recorded as a finding, not smoothed over** (`lessons.md`)

#### Manual Verification:

None. Every claim in this phase is demonstrable by a test or a script (`lessons.md`).

**Implementation Note**: no user-visible change lands in this phase.

---

## Phase 2: Prove what nothing covers today

### Overview

Three gaps, named in § "What is already guarded". The formula's **value** parity is already proven by
`personal-records.test.ts` assertions 4 and 4b and is **not** restated here.

### Changes Required:

#### 1. The derivation suite

**File**: `tests/integration/preferences-derive.test.ts` _(new)_

**Contract**: Three assertions, each covering something nothing else does.

- **A formula switch can change WHICH set holds a record.** Fixture: `100 kg × 5` and `82 kg × 12`
  for one exercise. Brzycki ranks the twelve-rep set first (118.08 vs 112.5); Epley ranks the
  five-rep set first (116.67 vs 114.8). Assert `personal_records` names a **different
  `best_estimate_set_id`** under each formula — decided by id, never by comparing numbers across the
  SQL/TypeScript boundary. This is the assertion the whole phase exists for.
- **A new set follows the new unit while existing rows keep theirs.** Flip to `lb`, log a set through
  the endpoint, and assert the new row carries `lb` while an existing row still carries `kg` with its
  `weight` untouched — the round-trip promise, and the first time `weightInUnit`'s second branch is
  exercised against stored data rather than hand-built objects.
- **Changing the timezone moves no workout.** `src/types.ts:37` states the invariant — `performed_on`
  is a calendar date the user stated, so "changing the profile timezone later cannot move a workout
  to a different day". Until this slice nobody could change the column, so the rule was safe by
  inaccessibility. Change the zone across a large offset (`Pacific/Kiritimati` ↔ `Pacific/Niue`, the
  pair `calendar.ts` was measured with) and require every `performed_on` on the account's workouts and
  record rows to be byte-identical afterwards.

**Fixture discipline is load-bearing in this suite specifically**, and is stated here rather than
assumed: it flips `weight_unit` and `estimation_formula` on `rls-owner-a`, the account
`workout-endpoints.test.ts` (which asserts `weight_unit === "kg"` at `:115`),
`personal-records.test.ts` and `record-impact.test.ts` all share. Reset both columns in `beforeAll`,
write run-unique values, and restore both in a `finally`. A run that dies between the flip and the
restore turns an unrelated suite red — the failure AGENTS.md § Testing warns about.

**Not asserted, deliberately**: that changing the unit leaves record holders unchanged. `set_estimates`
never references `p.weight_unit` and both rankings run on `weight_kg`, a column generated from the
set's own unit — there is no path by which the account preference could reach a ranking, so the
assertion could not fail. A comment in the suite says this and names `weight_kg` as the reason.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- `tests/integration/preferences-derive.test.ts` passes, including the different-holder assertion
- Mutation (a): moving the record-holder fixture to **ten** repetitions makes the assertion unable to
  distinguish the formulas — run once to demonstrate the crossing is real, then reverted. This
  mutation proves a _test design_, not a guard, and is recorded as such
- Mutation (b): making `updateSet` re-stamp `weight_unit` from the profile fails the "existing rows
  keep theirs" assertion, then reverted

#### Manual Verification:

- The owner has seen this suite's output before any screen work begins — the first evidence that a
  formula switch moves a record rather than only a number

**Implementation Note**: still no user-visible change. Pause after this phase for the owner.

---

## Phase 3: The screen

### Overview

`/settings`, and the two places that have to acknowledge it exists.

### Changes Required:

#### 1. The page

**File**: `src/pages/settings.astro` _(new)_

**Contract**: Reads `getProfile` and `supportedTimeZones()`, renders the form, and handles the same
failure shapes the other protected pages do — a load failure says so rather than rendering defaults as
though they were the account's choices. **The timezone `<option>` elements are emitted by Astro.**

#### 2. The form

**File**: `src/components/settings/PreferencesForm.tsx` _(new)_

**Contract**: A `client:load` island receiving the current values **only** — never the timezone list
(§ Critical Implementation Details). The island wraps the server-rendered `<select>` and reads its
value on submit. On submit it `PATCH`es all three fields and **replaces its own state with the row the
server returned**. Failures resolve through `profileMessageForCode`. Imports the rules module and the
message catalogue, never the zod schemas.

**It carries the sentence that replaces a confirmation dialog**: that estimates and records recompute
from the sets already logged, and that stored weights are never rewritten.

#### 3. Reaching it

**Files**: `src/middleware.ts`, `src/pages/dashboard.astro`

**Contract**: `/settings` added to `PROTECTED_ROUTES` — never a per-page check. The link goes on the
**dashboard**, which is the post-login landing page and is reachable from the topbar. It does **not**
go in `Topbar.astro`: that component is imported only by `Welcome.astro`, which is used only by
`src/pages/index.astro`, so it renders on the public landing page and nowhere else.

#### 4. The dashboard stops duplicating it

**File**: `src/pages/dashboard.astro`

**Contract**: Keep the unfiltered profile read — that is F-03's demonstration that RLS returns exactly
one row, and the comment explaining why it has no `user_id` filter stays — and render it as a sentence
naming the training week and its timezone, with the link to `/settings`.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- No server-only module is reachable from a hydrated island: the built client bundle contains no
  `zod` and no `@supabase/`, checked against `dist/client/_astro/` with a control match proving the
  same grep can find something genuinely present
- **The timezone list did not cross into JavaScript**: a script fetches the rendered `/settings` HTML
  and asserts no zone name appears inside any `<astro-island … props="…">` attribute, while the same
  names are present in the `<option>` markup. Checking `dist/client/` would pass while the leak was
  present, which is why it is not the check
- **The option set is exactly `Intl.supportedValuesOf("timeZone")`**: the same script diffs the
  rendered `<option value>` set against the runtime list and requires them equal — 418 entries are not
  verifiable by eye (`lessons.md`)
- **No estimate call site hardcodes a unit or a formula**: a grep over the five call sites
  (`WorkoutDetail.tsx:322,380,412`, `RecordImpactDialog.tsx:181`, `records.astro`) shows every one
  passes a variable. FR-016 names consistency across screens as its acceptance criterion, and this is
  the automatable half of it
- The settings island's built size is recorded in Progress

#### Manual Verification:

All local, against `astro dev`; the same three actions are repeated against the public address in
Phase 4.

- Switching to pounds and logging a new set stores pounds, while every set logged before still reads
  back as the number typed with its own unit beside it
- Switching the formula changes the values on `/records`, and for the `100 × 5` / `82 × 12` fixture
  changes **which set** is named as the best estimate
- **The same set's estimate agrees on `/workouts/[id]` and on `/records` after the switch** — the
  half of FR-016's acceptance criterion a script cannot see
- Switching the timezone changes the date a new workout defaults to, and no workout already logged
  changes its date on screen
- Switching a preference and switching back leaves `/records` showing exactly the original figures
- The dashboard shows the training-week sentence and its link, and no raw timezone string
- At 360 px the timezone select and the Save control are both usable

**Implementation Note**: pause here for the owner's confirmation before deploying.

---

## Phase 4: Deploy, and prove it on the public address

### Overview

The slice's outcome is a screen, so it carries its own deployment phase (`lessons.md`), including the
automatic push-and-CI criterion that session 8 paid for twice.

### Changes Required:

#### 1. Push before deploying

**Contract**: `git push origin main`, then a CI run against that exact SHA observed to conclude
green — **its run number written into the Progress row**.

#### 2. Deploy

**Contract**: `npm run build` then `npx wrangler deploy`; the version id recorded in Progress. No new
Worker secret — this slice adds no environment variable.

#### 3. Prove it under the public address

**Contract**: A read-only scripted probe (`node -e 'fetch(...)'`, never `curl` — schannel fails TLS on
fresh Cloudflare hosts) showing `/settings` redirects a signed-out visitor and `PATCH /api/profile`
refuses one; then the owner, signed in, changing a preference and watching `/records` follow.

### Success Criteria:

#### Automated Verification:

- `git status` clean and `git log origin/main..HEAD` empty
- CI run for the deployed SHA is green, run number recorded in Progress
- `npx wrangler deployments list` shows the new version at 100% of traffic, id recorded in Progress
- The scripted probe reports `302 → /auth/signin` for `/settings` while signed out, and a non-2xx
  carrying a message code for an unauthenticated `PATCH /api/profile`. **This is the only check of the
  redirect** — the integration suite cannot assert it, because the redirect lives in
  `src/middleware.ts`, which imports `astro:middleware` and is unresolvable in both vitest configs
- The new route is present in the built server manifest before any 404 from the public address is
  diagnosed as a failure — edge propagation takes tens of seconds

#### Manual Verification:

All against the public address, repeating the three actions Phase 3 checked locally.

- Change the unit, log a set, and see it stored in the new unit while older sets read unchanged
- Change the formula and see `/records` re-derive
- Change the timezone and see a new workout default to the right day

**Implementation Note**: this phase writes to production. Do not run it while the owner is away.

---

## Phase 5: Truth up the documents

### Overview

Everything this slice made true or false in the written record, and the handoff S-07 needs.

### Changes Required:

#### 1. The agent guide

**File**: `AGENTS.md`

**Contract**: § Domain rules gains the note that the formula is read **per row by the view**, so a
formula change is a re-derivation and never a migration — and that a switch can change which set holds
a record, not only the number. § Known state gains `/settings`, `PATCH /api/profile`, and the measured
fact that workerd exposes `Intl.supportedValuesOf` with 418 zones. No claim is written that no test
backs.

#### 2. Routes

**File**: `README.md`

**Contract**: Rows for `/settings` and `PATCH /api/profile`, and a line stating that changing the unit
affects **new** sets only, with the headline-converted / evidence-as-typed rule spelled out.

#### 3. Lessons

**File**: `context/foundation/lessons.md`

**Contract**: Append only what this slice actually paid for, and only if the evidence supports it. The
strongest candidate comes from the plan review rather than the implementation: **"a user cannot do X
yet" is not the same as "X is untested" — check the suite before building a phase around the gap.**
That error cost this plan an entire phase before a line of code was written.

#### 4. The handoff

**Files**: `C:\10xdev\handoff\STATE.md`, `context/foundation/roadmap.md`,
`context/changes/unit-formula-timezone-preferences/change.md`

**Contract**: `STATE.md` gains a "what S-06 left S-07" section: the timezone is now user-settable,
which is what S-07's weekly boundary depends on, and **Open Question 2's interface half is still
S-07's**, unchanged by this slice. Roadmap S-06 → `done`. `change.md` records every deviation and the
owner's FR-022 ruling.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck, unit tests, integration check and build all pass
- Every file path and assertion name newly cited in `AGENTS.md` exists: a script resolves each
  reference and prints its target
- A script confirms the three documentation facts: `README.md` contains rows for `/settings` and
  `/api/profile`; `STATE.md` names Open Question 2 as S-07's; `roadmap.md` shows S-06 as `done`
  (`lessons.md` — an item a script can demonstrate does not belong in the manual list)
- `git log origin/main..HEAD` empty after the phase commit

#### Manual Verification:

None.

**Implementation Note**: after this phase, `/10x-impl-review` then `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/validation/profile.test.ts` — the message catalogue resolves a known code, returns `null`
  for an absent one, and never echoes the caller's own words.
- `src/lib/services/timezones.test.ts` — the list is non-empty, contains `Europe/Warsaw`, and
  `isSupportedTimeZone` refuses a well-formed impostor such as `Europe/Warsawa`.
- Existing suites stay green untouched — in particular `one-rep-max.test.ts` and `set-display.test.ts`,
  whose branches this slice makes reachable rather than changes.

### Integration Tests:

- `tests/integration/profile-mutations-rls.test.ts` — the endpoint writes only the row named by
  `locals.user.id`, the zero-row `404`, the unknown timezone refused with the row re-read intact.
- `tests/integration/preferences-derive.test.ts` — the record holder moving under a formula switch,
  the new-set unit with old rows intact, and the timezone invariant.
- `tests/integration/personal-records.test.ts` — **unchanged**, and already covering formula value
  parity for both formulas across the boundary repetitions.

### Manual Testing Steps:

1. Log `100 kg × 5` and `82 kg × 12` of one exercise. On `/records`, note which set holds the best
   estimate.
2. Switch the formula on `/settings` and reload `/records` — the holder should change between those
   two sets, not merely the number.
3. Open `/workouts/[id]` for that workout and confirm the per-set estimate agrees with `/records`.
4. Switch back and confirm the original figures return exactly.
5. Switch to pounds, log a new set, and confirm it reads in pounds while the earlier sets still read
   in kilograms with their typed numbers.
6. Switch the timezone to something far away, start a new workout, and confirm the default date
   follows while the existing workouts keep their dates.
7. Do all of the above with the keyboard only, and once at 360 px.

## Performance Considerations

The timezone list is computed once per module load and rendered as HTML, so it costs no JavaScript and
no per-request work beyond emitting the options. Everything else is a single-row read and a single-row
update on a primary key.

**A limitation inherited from S-04 and S-05 and stated rather than hidden**: index usage cannot be
verified in this environment, because `gymlog-test` is small enough that Postgres correctly prefers a
sequential scan. Unchanged here; S-07 inherits it.

## Migration Notes

**None, on either database.** F-03's migration created the three columns with defaults, the grant and
the update policy; S-04's view already reads the formula per row. Existing rows need nothing done to
them — and doing something to them is precisely what this slice must not do. The first draft of this
plan contained a temporary out-of-band view replacement on `gymlog-test`; it was removed during plan
review (F2) because its recovery procedure did not work and its stated verification could not detect a
failed restore.

## References

- Plan review that reshaped this plan: `context/changes/unit-formula-timezone-preferences/reviews/plan-review.md`
- Change identity and the handoff: `context/changes/unit-formula-timezone-preferences/change.md`
- The derived-view seam this slice depends on: `context/archive/2026-08-11-personal-records/plan.md`
- The unit-is-a-property-of-the-row decision: `context/archive/2026-08-11-edit-and-delete-log/plan.md`
- Prior art for an endpoint boundary suite: `tests/integration/workout-mutations-rls.test.ts`
- Roadmap item: `context/foundation/roadmap.md` § S-06

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The preference write path

#### Automated

- [x] 1.1 Lint, typecheck, unit, integration and build all pass — 183 unit, 90 integration — 0246a21
- [x] 1.2 `profile-mutations-rls.test.ts` passes, including the fabricated-id assertion — 7 assertions — 0246a21
- [x] 1.3 No migration: `git diff --name-only origin/main...HEAD -- supabase/` is empty — 0246a21
- [x] 1.4 No `.delete(` in the profile service or route — 0246a21
- [x] 1.5 Mutation (a): dropping the timezone check fails the unknown-timezone assertion — assertion 3 went `200` where it wanted `400`, and assertion 7 additionally caught `Europe/Warsawa` left on the shared fixture — 0246a21
- [x] 1.6 Mutation (b): resolving the row from anything but `locals.user.id` fails the fabricated-id assertion — resolving it from `supabase.auth.getUser()` instead answered `200` where the suite wanted `404` **and** wrote `Pacific/Kiritimati` onto account A. **Recorded finding**: the first form of this mutation, deleting `.eq("id", userId)` outright, fails for the wrong reason — PostgREST refuses an unfiltered `UPDATE`, so the suite sees a `500`. So on `profiles` the filter is load-bearing, unlike `deleteSet`, where AGENTS.md records that dropping it breaks nothing — 0246a21
- [x] 1.7 Mutation (c): shrinking `WEIGHT_UNITS` fails typecheck on the `src/types.ts` assertion — `ts(2344) Type 'false' does not satisfy the constraint 'true'`; the twin assertion on `ESTIMATION_FORMULAS` was mutated too and fails the same way — 0246a21

### Phase 2: Prove what nothing covers today

#### Automated

- [x] 2.1 Lint, typecheck, unit, integration and build all pass — 183 unit, 95 integration
- [x] 2.2 `preferences-derive.test.ts` passes, including the different-record-holder assertion — 5 assertions: the holder flip, its reversibility, the unit boundary, the timezone invariant, and the fixture-restored tripwire
- [x] 2.3 Mutation (a): the same fixture at ten repetitions cannot distinguish the formulas — both sets moved to ten reps and both formulas named the same `best_estimate_set_id`, so the assertion could no longer tell them apart. Proves a TEST DESIGN, not a guard: the crossing at ten is real
- [x] 2.4 Mutation (b): re-stamping `weight_unit` in `updateSet` fails the existing-rows assertion — reading the unit from the profile inside `updateSet` turned the kilogram set into `lb` on a plain weight correction; the assertion read `'lb'` where it wanted `'kg'`

#### Manual

- [ ] 2.5 Owner has seen the derivation suite's output

### Phase 3: The screen

#### Automated

- [ ] 3.1 Lint, typecheck, unit, integration and build all pass
- [ ] 3.2 Built client bundle contains no `zod` and no `@supabase/`
- [ ] 3.3 No zone name appears in any `astro-island` props payload in the rendered `/settings` HTML
- [ ] 3.4 The rendered `<option>` set equals `Intl.supportedValuesOf("timeZone")`
- [ ] 3.5 No estimate call site hardcodes a unit or a formula
- [ ] 3.6 Settings island's built size recorded here

#### Manual

- [ ] 3.7 Local: switching to pounds stores pounds for new sets; older sets read back as typed
- [ ] 3.8 Local: switching the formula changes which set holds the best estimate for the fixture
- [ ] 3.9 Local: the same set's estimate agrees on `/workouts/[id]` and on `/records`
- [ ] 3.10 Local: switching the timezone changes a new workout's default date and moves no logged workout
- [ ] 3.11 Local: switching a preference and back restores the original figures exactly
- [ ] 3.12 The dashboard shows the training-week sentence and link, and no raw timezone string
- [ ] 3.13 The settings screen is usable at 360 px

### Phase 4: Deploy, and prove it on the public address

#### Automated

- [ ] 4.1 `git status` clean and `git log origin/main..HEAD` empty
- [ ] 4.2 CI run for the deployed SHA green — run number recorded here
- [ ] 4.3 Worker version at 100% of traffic — version id recorded here
- [ ] 4.4 Scripted probe: `/settings` redirects a signed-out visitor and `PATCH /api/profile` refuses one
- [ ] 4.5 The new route is present in the built server manifest

#### Manual

- [ ] 4.6 Public address: change the unit and log a set in it
- [ ] 4.7 Public address: change the formula and see `/records` re-derive
- [ ] 4.8 Public address: change the timezone and see a new workout's default follow

### Phase 5: Truth up the documents

#### Automated

- [ ] 5.1 Lint, typecheck, unit, integration and build all pass
- [ ] 5.2 Every newly cited file path and assertion name resolves
- [ ] 5.3 A script confirms the README rows, STATE.md's Open Question 2 note and the roadmap's S-06 status
- [ ] 5.4 `git log origin/main..HEAD` empty after the phase commit
