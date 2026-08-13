---
change_id: unit-formula-timezone-preferences
title: Choose kilograms or pounds, the estimation formula, and the timezone the training week runs in
status: implemented
created: 2026-08-12
updated: 2026-08-13
archived_at: null
---

## Notes

S-06 on the roadmap. Outcome: the user can choose whether weights are entered and shown in
kilograms or pounds, which formula estimates their one-rep max, and which timezone their training
week is measured in — and every derived figure already on screen follows that choice.

PRD refs: FR-016, FR-022, US-03, and the NFR on exact unit round-trip. Prerequisites S-03 and F-03,
both done. Parallel with S-05 on the roadmap; S-05 landed first.

**Probably no migration.** `public.profiles` already carries `timezone`, `weight_unit` and
`estimation_formula` with defaults `Europe/Warsaw` / `kg` / `brzycki`, created by F-03. The three
enums exist. Confirm before planning — but the expected shape of this slice is a screen, an endpoint
and the branches those two make reachable, not schema.

### What S-05 left S-06, from `C:\10xdev\handoff\STATE.md` § "Co S-05 zostawił S-06 i S-07"

- **`weight_unit` is a property of the ROW, not of the account — and S-06 is the slice that will
  break this if it is careless.** `PATCH /api/sets/[id]` deliberately carries no unit and the column
  keeps whatever it already holds; `EditSetForm` labels its weight field with the **set's own**
  stored unit rather than the profile's. Once this slice lets somebody switch to pounds, a set typed
  in kilograms must still read back as the number typed. Re-stamping stored rows with the new
  preference would turn 100 lb into 100 kg and corrupt every figure derived from `weight_kg`.
- **Nothing derived is stored, and that is what makes this slice a re-derivation rather than a
  migration.** There is no record column, no record row and no cache: `set_estimates` and
  `personal_records` are `security_invoker` views computed at read time. Changing the formula
  recomputes history rather than lying about it. Adding an `estimated_1rm` column or a
  `personal_records` table would undo that.

### What S-03 left S-06 — the branch this slice makes reachable

- **`weightInUnit` in `src/lib/services/set-display.ts` has a second branch that is dead until this
  slice.** Its own comment says so: "In S-03 the second branch is unreachable: every set is stored in
  the profile's unit and the profile's unit cannot yet be changed. It is written and tested now
  anyway, because leaving it implicit is how S-06 inherits a screen that quietly estimates in
  kilograms for somebody reading pounds." **S-06 is what makes it live.** Verify it under a real
  mixed-unit account rather than trusting the unit test that was written blind.

### Domain rules this slice is most likely to get wrong (`AGENTS.md` § Domain rules)

- **Epley must be pinned at `r == 1`.** Brzycki yields "estimate equals the weight lifted" naturally;
  Epley returns `1.033 × w` and has to be forced. The toggle is the first thing that exercises this
  for real.
- **The two formulas cross at exactly 10 repetitions** (`36/27` and `1 + 10/30` are both `4/3`). A
  fixture set of ten reads identically under either, so it proves nothing about the toggle — and it
  is the first thing to suspect when somebody reports that switching does nothing.
- **The 1RM formula has exactly TWO implementations and they must agree**: `estimateOneRepMax` in
  `src/lib/services/one-rep-max.ts` and the `case` expression inside `public.set_estimates`. A
  constant can be grepped; a `case` expression cannot. Assertion 4 of
  `tests/integration/personal-records.test.ts` is the only thing that would notice them drifting.
  **A formula toggle is exactly the change that would make them drift.**
- **In SQL, `reps::numeric / 30` needs the cast.** `reps` is `smallint`, so `reps / 30` is integer
  division and evaluates to `0` across the whole 1–12 range — Epley silently degenerates to
  `estimate = weight`. **CORRECTED BY THE PLAN REVIEW (F1): this is already guarded.**
  `tests/integration/personal-records.test.ts` toggles `estimation_formula` and reads the view back
  (`setFormula` at `:212`, assertion 4 at `:391`, assertion 4b at `:429`), so dropping the cast fails
  the gate on every push. The note above originally continued "the defect surfaces only for accounts
  that switch formula — that is, only after this slice ships", which was false and cost this plan a
  whole phase before it was caught. **Do not build a phase around this gap; it is closed.**
- **A training week is Monday–Sunday in the user's own timezone**, not UTC. `performed_on` is a date
  the user states rather than an instant, so changing the timezone must not move a workout to a
  different day. `src/lib/services/calendar.ts` already exists from S-03.
- **`profiles` has no DELETE policy and no delete grant, on purpose** — deleting the row while the
  account survives leaves a live account with no timezone. This slice updates it; it must not gain a
  delete path.

### Owner ruling on FR-022 (2026-08-12) — escalation point §6

The first draft of the plan settled FR-022's reading inside a non-goal. FR-022 reads _"User can set a
preferred unit … and **every weight shown or totalled is expressed in it**"_, which pulls against the
NFR on exact unit round-trip. `CLAUDE.md` § Course contract makes a scope-changing product decision an
escalation point, so it was put to the owner rather than decided in the plan.

**Ruling: the product keeps the line it already draws.** A derived **headline** figure is expressed in
the reader's unit; the **evidence line** quoting the set is shown as typed, in the unit it was typed
in. This is what the code already does — `heaviestFigure` (`src/lib/services/record-display.ts:126-127`)
converts through `weightInUnit` and `src/pages/records.astro:108-109` prints that converted headline,
while the set row on `/workouts/[id]` prints the typed value with its own unit.

Rejected alternatives, both considered: converting every displayed weight (literal FR-022 — but the
edit form must operate on the row's own unit, so screen and form would show two different numbers for
one set, which is the corruption the S-05 PATCH payload refuses to allow); and showing both
(`220.5 lb (100 kg)` — a third number in a row that already wraps at 360 px).

**Do not "fix" `heaviestFigure` to stop converting.** The plan's non-goal now says so by name.

### Plan review, 2026-08-12 — 10 findings, all applied

`reviews/plan-review.md`. Run with two sub-agents at the owner's explicit request, because the plan's
author was also its reviewer. Four criticals, and the first one reshaped the slice:

- **F1** — the plan's headline risk was false. It claimed the `s.reps::numeric / 30` cast was
  untested until this slice made the formula switchable. `tests/integration/personal-records.test.ts`
  has toggled the column since S-04 (`setFormula` at `:212`, assertions 4 and 4b), and dropping the
  cast fails both. **"A user cannot do X yet" is not "X is untested."** Phase 2 was rewritten around
  the three things genuinely uncovered: the record **holder** moving under a formula switch, the unit
  round-trip through stored rows, and the timezone invariant.
- **F2** — the mutation that replaced `set_estimates` on `gymlog-test` out of band was deleted. Its
  restore could not work (the migration says `create view`, not `create or replace`, and
  `personal_records` depends on the view) and its verification could not verify (`db:status` reads
  migration history, which `create or replace view` never touches).
- **F3** — Phase 1's cross-account assertion could not fail: the route takes no id, so account B has
  no way to name account A's row. Replaced with a fabricated `locals.user.id`, which can fail and
  also supplies the otherwise-unreachable zero-row `404`.
- **F4** — the plan contradicted itself on island props; passing the 418-zone list as a prop would
  serialise it into `astro-island props` and ship it to the browser, and the criterion checking for
  that leak grepped `dist/client/`, where server-rendered HTML does not live.
- **F5** — the FR-022 escalation above.
- **F6–F10** — FR-016's own acceptance criterion (consistency across screens) was unverified; Phase 2
  lacked the fixture-restore contract Phase 1 had, on an account three other suites share; two
  assertions were tautologies; four Progress/criteria defects; and `Topbar.astro` renders on the
  landing page only, so the settings link goes on the dashboard.

### Working mode

No subagents unless the owner asks — including for skills that spawn them by default
(`/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-impl-review`). Sessions 5–9 ran them inline.
Write to the owner in Polish; documents, comments and commit messages stay in English.

A slice whose outcome is a screen carries its own deployment phase, and the deploy phase carries an
**automatic** criterion "pushed to `origin/main` and CI green" with the run number in Progress
(`context/foundation/lessons.md`, plus the S-05 requirement that came from session 8's twice-unpushed
work).

### Deviations from the plan, and what they cost (implementation, 2026-08-13)

Five phases, five commits plus two write-back commits. Nothing in the plan's § What We're NOT Doing
was violated: **no migration on either database**, no conversion of stored weights, no confirmation
dialog, no delete path on `profiles`, no out-of-band DDL, no E2E.

1. **Criteria 3.3 and 3.4 render rather than fetch.** The plan asked for "a script that fetches the
   rendered `/settings` HTML". It cannot: `/settings` is in `PROTECTED_ROUTES`, and `astro dev`
   authenticates against **production**, so a fetch would need a real production session. Astro's
   container renders the real page component with fake `locals` — no server, no session, no network —
   and answers the same question about the same HTML. Cost: a **third Vitest project**
   (`vitest.render.config.ts`, `tests/render/`), which the owner then approved wiring into CI. Its
   `configFile: false` is forced: loading `astro.config.mjs` pulls in `@astrojs/cloudflare`, whose
   Vite plugin hands the Vitest runner to workerd and kills it with
   `ReferenceError: exports is not defined`.
2. **Phase 1's mutation (b) had to be sharpened.** Deleting `.eq("id", userId)` from `updateProfile`
   fails the suite for the wrong reason — PostgREST refuses an unfiltered `UPDATE`, so the endpoint
   answers `500`, which says nothing about *which row* the handler resolves. Re-run as "resolve the
   row from `supabase.auth.getUser()`", it failed correctly. Carried into `lessons.md` and into
   `AGENTS.md` § Access control, because it also means the "the filter is only the index path" note
   recorded for `deleteSet` does **not** generalise.
3. **Criterion 3.10 needed a second attempt, and the criterion was at fault.** `Pacific/Kiritimati`
   (+14) is on the *same* calendar date as Warsaw at 08:26 UTC, so the default date did not move and
   the product looked broken. Exactly 9 of 418 zones qualified at that hour. Re-run with
   `Pacific/Niue` it passed. Carried into `lessons.md`.
4. **A finding in a sibling module, deliberately NOT fixed here.** The new unit suite caught that
   `typeof body === "object"` admits an array, so zod answers with its own prose
   (`"Invalid input: expected object, received array"`) in the `code` field — the one channel this
   project keeps free of provider wording. Fixed in `profile-schemas.ts` with `Array.isArray`. **The
   same hole is in `workout-schemas.ts`, and a wider one in `exercise-schemas.ts`**
   (`safeParse(body ?? {})` admits a bare string). Out of scope for S-06 and left untouched; the
   message catalogues mean nothing reaches the screen, so the impact is discipline rather than
   exposure. Raised with the owner; no decision taken.
5. **Labels landed in `src/lib/validation/profile.ts`, which the plan said "imports nothing".** It
   now has one **type-only** import from `@/types`, which erases at compile time, so the island's
   bundle is unaffected. The gain is real: `WEIGHT_UNIT_LABELS` and `ESTIMATION_FORMULA_LABELS` are
   typed as `Record` over each enum, so a value added to the Postgres enum cannot ship to the screen
   without a name.

Additions the plan did not name, each small and each earning its place: assertion 1b of
`preferences-derive.test.ts` (switching back restores the original record *holder*, which is the
"nothing is stored" promise stated as a test); assertion 7 of `profile-mutations-rls.test.ts` and
assertion 4 of `preferences-derive.test.ts` (the shared fixture is left on the defaults — the
tripwire for a run that dies between a flip and its restore, surfacing in the suite that caused it
rather than in an unrelated one); and `ESTIMATION_FORMULA_HINTS`, because "Brzycki or Epley" is not a
choice most people can make from the names.

**Deployed**: Worker version `b8a05a85-73a8-4427-bf1f-d3a96bf46d0a` at 100% of traffic, CI run **#44**
green for `b251103`. Tests: **183 unit, 95 integration, 5 render**.
