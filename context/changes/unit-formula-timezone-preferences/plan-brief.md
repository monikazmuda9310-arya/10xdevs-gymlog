# Unit, Formula and Timezone Preferences — Plan Brief

> Full plan: `context/changes/unit-formula-timezone-preferences/plan.md`
> Plan review: `context/changes/unit-formula-timezone-preferences/reviews/plan-review.md` — 10 findings, all applied

## What & Why

The account already owns three preferences in the database — weight unit, estimation formula, training-week
timezone — and has never been able to change any of them. This slice gives them a screen, and makes every
derived number on the product follow the choice **by re-derivation, never by rewriting anything stored**.

## Starting Point

`public.profiles` already carries all three columns with defaults, an `update` grant and an update policy
(F-03). `public.set_estimates` already joins `profiles` and reads the formula **per row**, so nothing
anywhere reads a hardcoded formula. `set-display.ts` and `record-display.ts` already take unit and formula
as parameters, and a blast-radius sweep found no caller that would keep an old preference. What is missing
is any way to write the columns: no settings screen, no endpoint. `/dashboard` prints the raw timezone as
F-03's RLS demonstration.

## Desired End State

A user opens `/settings`, picks kilograms or pounds, Brzycki or Epley, and a timezone from the complete
IANA list, and presses Save once. Estimates and records re-derive in the chosen unit and formula
consistently across every screen; new sets are stored in the chosen unit while every set already logged
still reads back as the exact number typed; a new workout defaults to today in the chosen zone and no
logged workout moves. Switching back restores the previous figures to the digit, because nothing derived
was ever stored.

## Key Decisions Made

| Decision                | Choice                                                                  | Why                                                                                                            | Source      |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| Where preferences live  | New `/settings` page                                                    | One page per concern; leaves `/dashboard` free for S-07's tonnage                                              | Plan        |
| Timezone input          | Full IANA list, server-rendered `<select>`, never an island prop        | **Measured** in workerd: 418 zones, 6825 B of names, zero JavaScript — but only if it stays out of props       | Plan review |
| Mixed units on screen   | Derived headline in the reader's unit; the evidence line as typed       | **Owner ruling on FR-022, 2026-08-12.** It is what the code already does; `heaviestFigure` must not be "fixed" | Owner       |
| Unknown timezone        | Refused server-side, from the same source as the `<select>`             | Closes `calendar.ts`'s silent UTC fallback, which this slice makes reachable from a form                       | Plan        |
| Save model              | One form, one Save, one `PATCH`                                         | Three auto-saves give three failure paths and a half-applied set of preferences                                | Plan        |
| Warning before a change | A sentence on the screen, no dialog                                     | Reversible to the digit; cheapening the S-05 dialog weakens the one that matters                               | Plan        |
| What Phase 2 proves     | Record **holder** movement, the unit round-trip, the timezone invariant | Formula **value** parity is already covered by `personal-records.test.ts` 4 and 4b since S-04                  | Plan review |
| Out-of-band DDL         | None, anywhere                                                          | A replaced view cannot be verified by `db:status` and a failed restore leaves CI silently wrong                | Plan review |
| `/dashboard`            | Keep the unfiltered read, render it as a sentence + link                | The read is F-03's RLS demonstration; the link goes here because `Topbar` renders on the landing page only     | Plan review |

## Scope

**In scope:** a `/settings` screen; `PATCH /api/profile` with validation; timezone list and validation from
one source; the two Postgres enums pinned as iterable tuples; integration proof of the three uncovered
behaviours; `/dashboard` de-duplicated; deploy.

**Out of scope:** any migration or out-of-band DDL; converting stored weights; a confirmation dialog;
browser timezone detection; a delete path on `profiles` (S-09); per-workout unit overrides; new derived
numbers (tonnage is S-07); E2E.

## Architecture / Approach

`settings.astro` reads the profile and the timezone list on the server and renders the `<select>` there;
a small `client:load` island wraps it, holds only the current values, and issues one `PATCH /api/profile`.
The endpoint validates against `profile-schemas.ts`, whose timezone check calls the same `timezones.ts`
the page rendered from. `updateProfile` scopes by `id` and selects what it touched. Nothing downstream
changes: the view and the display modules already read the preferences.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                                  |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. The preference write path       | Rules, schemas, service, `PATCH /api/profile`, boundary suite | A well-formed but unreal timezone slipping into a silent UTC week         |
| 2. Prove what nothing covers today | Record-holder movement, unit round-trip, timezone invariant   | Flipping preferences on the shared fixture account and not restoring them |
| 3. The screen                      | `/settings`, dashboard link, `/dashboard` de-duplicated       | The 418-entry list crossing into JavaScript as an island prop             |
| 4. Deploy                          | Worker shipped and proved on the public address               | Finished locally, never pushed — the failure session 8 paid for twice     |
| 5. Documents                       | `AGENTS.md`, `README.md`, `lessons.md`, handoff               | Writing a claim no test backs                                             |

**Prerequisites:** S-03 and F-03, both done. No new credential, no new Worker secret, no migration.
**Estimated effort:** ~1–2 sessions across 5 phases; the write path is small and the proof is the work.

## Open Risks & Assumptions

- **The one genuinely new assertion is the record-holder flip.** Fixture `100 × 5` and `82 × 12`:
  Brzycki ranks the twelve-rep set first (118.08 vs 112.5), Epley the five-rep set (116.67 vs 114.8).
  Arithmetic independently verified during review. If that assertion is wrong, Phase 2 proves little.
- **The two formulas are identical at exactly ten repetitions**, so any fixture written there proves
  nothing about a toggle. Phase 2 demonstrates this once, deliberately, as a mutation.
- Index usage still cannot be verified in this environment — `gymlog-test` is too small for a query plan
  to mean anything. Unchanged from S-04 and S-05; S-07 inherits it.

**Corrected during review**: this brief previously named the `s.reps::numeric / 30` cast as the slice's
sharpest hazard, on the claim it was untested until now. It is not — `personal-records.test.ts`
assertions 4 and 4b have exercised the formula toggle against the view since S-04, and dropping the cast
fails both.

## Success Criteria (Summary)

- The user can change all three preferences from a screen, and every figure follows — on every screen,
  which is what FR-016 names as its acceptance criterion.
- Switching the formula changes **which set holds a record** for a fixture chosen to make that happen.
- Nothing stored is converted: a set logged in kilograms still reads back as the number typed, no logged
  workout changes date when the timezone changes, and switching back restores the previous figures exactly.
