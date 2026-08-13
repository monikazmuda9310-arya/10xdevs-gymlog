<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Unit, Formula and Timezone Preferences

- **Plan**: `context/changes/unit-formula-timezone-preferences/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-12
- **Verdict**: REVISE → **SOUND after fixes** (all 10 findings applied 2026-08-12)
- **Findings**: 4 critical, 5 warnings, 1 observation
- **Method**: the mechanical and consistency scans were run inline; **two sub-agents were run with the
  owner's explicit permission** — one verifying the plan's factual claims against the code without
  reading the plan, one reading the plan adversarially. Four of the four claims the adversarial agent
  raised that could be checked independently were verified against the code before being accepted.
  The plan's author also wrote this review, which is exactly why the sub-agents were used.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | FAIL    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | FAIL    |

## Grounding

8/8 modify paths ✓, 8/8 new paths correctly absent ✓, brief↔plan ✓ with one divergence (the brief
names the test-database schema touch; plan.md's Migration Notes deny any schema change — see F8).

**The approach is sound and is not in question**: no migration, re-derivation through the existing
views, proof before screen, a deployment phase of its own. The no-migration conclusion was verified
independently (`20260810063450_…sql:41-56`: `update` granted, update policy with both halves, no
delete path, three columns with defaults). What fails is the plan's justification for its largest
phase, and several checks that cannot fail.

## Findings

### F1 — The slice's headline hazard is already guarded, in CI, on every push

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Lean Execution
- **Location**: § "Three traps this slice walks straight into" #2; Phase 2 § "The cast that only this slice can expose"; brief § Open Risks bullet 1
- **Detail**: The plan asserts the `s.reps::numeric / 30` defect "is invisible until an account
  switches formula, which is exactly what this slice makes possible for the first time". That is
  false, and both sub-agents found it independently. `tests/integration/personal-records.test.ts`
  already writes the column: `setFormula()` at `:212`, assertion 4 at `:391` loops
  `for (const formula of ["brzycki", "epley"])` and compares every boundary row (reps 1, 2, 3, 5, 12, 13) against `estimateOneRepMax`, and assertion 4b at `:429-462` pins
  `expectClose(epley, 100 * (1 + 5 / 30))` — deliberately at five repetitions, with a comment
  explaining that ten would prove nothing. Drop the cast and Epley returns 100 instead of 116.67:
  4b fails, and 4 fails at four repetition counts. **The plan conflated "a user can switch the
  formula" with "the code path is untested."** Everything downstream inherits the confusion — three
  of Phase 2's seven assertions restate coverage that has existed since S-04.
- **Fix**: Rewrite Phase 2 around what is genuinely uncovered. Keep the record-holder assertion
  (`100 × 5` vs `82 × 12`, arithmetic independently verified: Brzycki 112.5 vs 118.08, Epley 116.67
  vs 114.8 — the holder flips) and the new-set-unit assertion. Delete the formula-vs-TypeScript
  parity assertions, the one-repetition pin and the ten-repetition crossing as duplicates, citing
  `personal-records.test.ts` assertions 4 and 4b instead. Rewrite the risk narrative to say the cast
  is guarded and by what.
- **Decision**: FIXED — Phase 2 rewritten around the three uncovered behaviours; the false risk narrative replaced with a table of what is already guarded

### F2 — Phase 2's out-of-band DDL has a recovery that does not work and a verification that cannot verify

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 Success Criteria, mutation (b); Progress 2.4
- **Detail**: Three defects in one bullet, all verified. (a) "restored by re-running the migration's
  original view definition" — the migration says `create view public.set_estimates`
  (`20260811143000_…sql:41`), **not** `create or replace`, so re-running it errors; and
  `public.personal_records` (`:122`) is built over it, so dropping first needs `cascade`, which takes
  that view, its comment and its grants with it. The implementer would have to hand-author DDL the
  plan does not supply. (b) "confirmed with `npm run db:status`" — `scripts/supabase-db.mjs:131-141`
  runs `supabase migration list`, which reads `supabase_migrations.schema_migrations`. An out-of-band
  `create or replace view` never touches that table, so `db:status` prints two identical healthy
  histories whether the restore worked or not. **The stated confirmation is structurally incapable of
  detecting the failure it exists to catch.** (c) The blast radius is CI: a failed restore leaves
  `gymlog-test` with a silently wrong Epley, and the next push to `main` goes red on
  `personal-records.test.ts` for a reason nothing in git history explains.
- **Fix**: Delete mutation (b) entirely. Given F1 it buys nothing — the cast is already guarded by a
  suite that runs on every push. If it were kept, the restore would have to be verified by re-running
  `personal-records.test.ts`, the thing that actually fails without the cast, never by `db:status`.
- **Decision**: FIXED — mutation (b) and criterion 2.4 deleted; Migration Notes now record why

### F3 — Phase 1's headline boundary assertion cannot fail

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 § "The endpoint boundary suite"; criterion 1.2, Progress 1.2; also criterion 1.6
- **Detail**: The contract says "Account B `PATCH`es while a run-unique value sits in A's row, and A
  re-reads to show it intact". But the route has no `[id]` param — the plan says so itself in §5 —
  and `updateProfile` scopes by `context.locals.user.id`. **There is no input by which B can name A's
  row.** B PATCHes, B's own row changes, A's row is intact by the absence of a parameter rather than
  by any guarantee. Worse, the assertion survives the obvious mutation: remove `.eq("id", userId)`
  and RLS still confines the update to B's own row, so A's row is _still_ intact. This is
  `lessons.md` § "A guard you have not mutated may not guard" — decoration that reads as coverage.
  The comparison drawn to `workout-mutations-rls` does not hold, because there the caller supplies
  the id. Related: criterion 1.6's zero-row `404` branch is unreachable through the real stack (a
  trigger creates every profile, `profiles-rls.test.ts:165-177` proves deletion is impossible), and
  the plan does not say how a test would reach it.
- **Fix**: Replace the cross-account assertion with one that can fail — assert instead that the
  endpoint writes **only** the caller's row by giving B a fabricated `locals.user.id` through the
  handler-calling harness (`workout-endpoints.test.ts:39-49` is the pattern), which also supplies the
  mechanism criterion 1.6 needs. If that is judged not worth it, say plainly in the plan that the
  route's ownership is structural and carries no test, per `lessons.md` § "When a mutation does not
  break anything".
- **Decision**: FIXED — replaced with a fabricated locals.user.id assertion, which also supplies the zero-row 404 mechanism

### F4 — The plan contradicts itself on island props, and criterion 3.3 greps the wrong artifact

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: § Critical Implementation Details vs Phase 3 §2; criterion 3.3, Progress 3.3
- **Detail**: Critical Implementation Details says "the island receives **only the current value** and
  the change handler". Phase 3 §2 says "an island receiving the current values **and the timezone
  list as props**". These are opposite instructions, and the second one defeats the decision the
  first one exists to protect: Astro serialises island props into `<astro-island props="…">` in the
  rendered HTML, so 418 zone names would cross into JavaScript as a JSON payload parsed at hydration
  — the ~7 KB the plan set out to avoid, on top of the option markup. Criterion 3.3 then greps
  `dist/client/`, which holds build-time bundles and not server-rendered HTML, so it would pass
  cleanly while the leak it names is present.
- **Fix**: State that the island receives only the current value and that the `<select>` is rendered
  by Astro with the island wrapping it — then re-aim criterion 3.3 at the rendered `/settings` HTML,
  asserting the `astro-island props` payload does not contain a zone name. That check would also
  catch the contradiction if an implementer resolved it the other way.
- **Decision**: FIXED — island receives only the current values; criterion re-aimed at the rendered /settings HTML and the astro-island props payload

### F5 — FR-022 says the opposite of the plan's non-goal, and that is an escalation, not a plan decision

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: § What We're NOT Doing, bullet 3; brief § Key Decisions, "Mixed units on screen"
- **Detail**: `context/foundation/prd.md:286` reads: _"User can set a preferred unit, kilograms or
  pounds, and **every weight shown or totalled is expressed in it**."_ The plan lists FR-022 as
  satisfied while declaring "No display conversion of the typed value. A set logged as `100 kg` keeps
  reading `100 kg` after a switch to pounds." Both readings are defensible — the round-trip NFR
  pushes one way and FR-022's wording the other — but the plan settles it silently in a non-goal.
  `CLAUDE.md` § Course contract makes scope-changing product decisions an escalation point (§6).
  Separately, the non-goal misdescribes the code it constrains: `heaviestFigure`
  (`record-display.ts:126-127`) already converts through `weightInUnit` and `records.astro:108-109`
  prints that converted headline, so the product already does display conversion in one place. An
  implementer taking the non-goal literally would "fix" that and break `/records`.
- **Fix A ⭐ Recommended**: Escalate to the owner as a product question before Phase 1, and restate
  the non-goal to describe the real design — headline figures in the reader's unit, the evidence line
  as typed — naming `heaviestFigure` so nobody "corrects" it.
  - Strength: FR-022 is a must-have and the owner is the only one who can rule on its reading; the
    restatement removes a live trap for the implementer either way.
  - Tradeoff: one round trip before implementation starts.
  - Confidence: HIGH — the PRD text and the `heaviestFigure` behaviour were both read directly.
  - Blind spot: whether the owner considers the current split already satisfying FR-022.
- **Fix B**: Keep the decision as the plan makes it, but restate the non-goal accurately and record
  in `change.md` that FR-022's literal wording was read narrowly and why.
  - Strength: no interruption.
  - Tradeoff: a must-have requirement is reinterpreted without the owner, which is what §6 forbids.
  - Confidence: MEDIUM.
  - Blind spot: none significant.
- **Decision**: FIXED (Fix A) — escalated to the owner and ruled on 2026-08-12; non-goal restated to name heaviestFigure. See change.md

### F6 — FR-016 names consistency across screens as its acceptance criterion, and that is the one thing unverified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 3 manual block
- **Detail**: `prd.md:251-256` ends: _"Consistency across screens is the acceptance criterion."_ The
  plan verifies the formula switch on `/records` only (3.7, 4.7). Nothing checks that
  `/workouts/[id]`'s per-set estimate (`WorkoutDetail.tsx:380`), the per-entry "Best estimated 1RM
  here" (`:322`), the record badge (`:412`) and the impact dialog (`RecordImpactDialog.tsx:181`) move
  with it. It is also the cheapest thing to check: every one of those call sites takes the formula as
  a parameter, so a criterion asserting no call site passes a literal would cover it.
- **Fix**: Add an automated criterion grepping the estimate call sites for a hardcoded formula or
  unit argument, plus one manual item comparing a single set's estimate on `/workouts/[id]` against
  the same set's figure on `/records` after a switch.
- **Decision**: FIXED — added a grep criterion over the five estimate call sites plus a cross-screen manual check

### F7 — Phase 2 flips preferences on the shared fixture account with no restore contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 § Contract; compare Phase 1 § "The endpoint boundary suite"
- **Detail**: Phase 1's suite contract carries fixture discipline in writing. **Phase 2's does not** —
  and Phase 2 is the phase that flips `weight_unit` and `estimation_formula` on `rls-owner-a`, the
  account `workout-endpoints.test.ts`, `personal-records.test.ts` and `record-impact.test.ts` all
  share. `workout-endpoints.test.ts:115` asserts `expect(logged.weight_unit).toBe("kg")`.
  `vitest.integration.config.ts` sets `fileParallelism: false`, but file order is the sequencer's
  business and only `profiles-rls.test.ts:92-97` resets those columns. A run that dies between the
  flip and its restore leaves the account on `lb` and turns an unrelated suite red — the exact
  failure AGENTS.md § Testing "Fixture discipline" warns about.
- **Fix**: Give Phase 2's contract the same `beforeAll` reset / run-unique value / `finally` restore
  wording Phase 1 has, and name the columns it must restore.
- **Decision**: FIXED — Phase 2 now carries the reset/run-unique/finally contract by name, with the shared account and the columns spelled out

### F8 — Two Phase 2 assertions are tautologies, and one mutation is aimed at a throwaway query

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 § Contract bullets 5 and 7; criterion 2.5, Progress 2.5
- **Detail**: "Changing the unit does NOT change which set holds a record" cannot fail:
  `set_estimates` never references `p.weight_unit` (`20260811143000_…sql:41-90`) and both rankings
  run on `weight_kg`, a generated column derived from the set's own unit. There is no path by which
  the profile's unit reaches a ranking. Mutation (c) compounds it — "break it by ranking on `weight`
  instead of `weight_kg` **in a scratch query**" mutates something written for the occasion, not the
  code under test. The same objection, weaker, applies to "switching back restores the original
  figures exactly": nothing is stored, so it reads one view twice with the same inputs.
- **Fix**: Cut both assertions and mutation (c). If the unit-independence of the ranking is worth
  stating, state it as a comment in the suite naming `weight_kg` as the reason, not as an assertion.
- **Decision**: FIXED — both assertions and mutation (c) cut; the reason recorded as a suite comment instead

### F9 — Four defects in the criteria and the Progress section

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 § Manual Verification and Progress 2.6; criterion 3.5 / Progress 3.5; Progress 3.6–3.8 vs 4.6–4.8; Progress 3.9 and 5.4
- **Detail**: (a) Phase 2 says "Manual Verification: **None**", the Implementation Note two paragraphs
  later asks for a pause, and Progress carries `2.6 Owner has seen the derivation suite's output` —
  three positions, and `/10x-implement` reads Progress, so it will stop for a gate the criteria deny.
  (b) Criterion 3.5 describes an integration assertion that cannot be written: redirects come from
  `src/middleware.ts`, which imports `astro:middleware` and is unresolvable in both vitest configs,
  and `workout-page-access.test.ts` explicitly documents why it does no HTTP round trip. It is also
  already covered by 4.4. (c) Progress 3.6/3.7/3.8 are the same three actions as 4.6/4.7/4.8; either
  cut them or say that 3.x is local and 4.x is the public address. (d) 3.9 ("the timezone control
  offers only real zones") and 5.4 (three greps) are manual items that a script does better —
  `lessons.md` § "Verify with a script that attacks" forbids exactly this. Scripting 3.9 as a diff of
  the rendered `<option>` values against `Intl.supportedValuesOf` would also catch F4.
- **Fix**: Correct Phase 2's Manual block to list the pause; delete 3.5; label 3.6–3.8 as local and
  4.6–4.8 as deployed; move 3.9 and 5.4 into the automated lists with the scripts named.
- **Decision**: FIXED — Phase 2 Manual block corrected, 3.5 deleted, 3.x labelled local and 4.x public, 3.9 and 5.4 moved to the automated lists as scripts

### F10 — Three small factual errors

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3; Phase 1 criteria 3 and 4; § Current State Analysis and § Key Discoveries
- **Detail**: (a) "A link in the topbar … so preferences are reachable without going through a
  training screen" — `Topbar.astro` is imported only by `Welcome.astro`, which is used only by
  `src/pages/index.astro`. It renders on the public landing page and nowhere else; the dashboard link
  is the real navigation path. (b) Criterion 1.3's bare `git diff --name-only` diffs the working tree
  against the index, so after the phase commit it is empty whatever landed under `supabase/`; it
  needs a range. Criterion 1.4's `git grep -n "delete"` is similarly soft — the word appears in prose
  comments repo-wide. (c) Citation drift: the `coalesce` is at
  `20260811143000_…sql:74` not `:73`, and the `update` grant is at `20260810063450_…sql:42` not `:41`
  (`:41` is the `revoke`).
- **Fix**: Correct all three; put the settings link where it will actually render.
- **Decision**: FIXED — settings link moved to the dashboard, git checks given a range and a real target, both citations corrected

## Sound, and worth recording

- The no-migration conclusion is correct and independently verified.
- No caller anywhere in `src/` would silently keep an old preference — every path is server-rendered
  per request or takes the value as a prop from that same read. There is no cache and no stored
  derived figure. The blast-radius sweep found nothing the plan missed.
- `todayIn(profile?.timezone)` is already wired at `workouts/index.astro:23`, so the timezone
  end-state needs only the write path.
- The `100 × 5` / `82 × 12` fixture arithmetic is right and the record holder does flip between
  formulas. Deciding it by `best_estimate_set_id` rather than by comparing numbers is the correct
  seam. **This is the one genuinely new and valuable assertion in Phase 2.**
- Phases 4 and 5 are structurally correct and follow `lessons.md`'s deployment-phase rule.

## Additional gap found inline (not from the sub-agents)

The domain rule at `src/types.ts:37` — _"changing the profile timezone later cannot move a workout to
a different day"_ — is untested, and this slice makes it reachable for the first time. Neither
sub-agent raised it. Worth an assertion that after a timezone change across a large offset, every
`performed_on` on the account's workouts and record rows is byte-identical.
