<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Weekly Tonnage (S-07)

- **Plan**: `context/changes/weekly-tonnage/plan.md`
- **Scope**: all five phases (`f8bdb5e..85043dc`, 19 files)
- **Date**: 2026-08-14
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 8 warnings, 12 observations

Two sub-agents at the owner's explicit request, since the plan's author was also its implementer.
The split paid for the third time running: **every substantive finding was invisible from inside**,
and the two agents converged independently on the same two (the miscited assertion number and the
`security_invoker` comment).

## Verdicts

| Dimension           | Before  | After fixes |
| ------------------- | ------- | ----------- |
| Plan Adherence      | WARNING | PASS        |
| Scope Discipline    | PASS    | PASS        |
| Safety & Quality    | PASS    | PASS        |
| Architecture        | PASS    | PASS        |
| Pattern Consistency | WARNING | PASS        |
| Success Criteria    | WARNING | PASS        |

**Independently verified and correct, recorded because a review listing only problems misrepresents
what was checked**: all nine "What We're NOT Doing" items still hold; the migration is purely
additive (`create` / `comment` / `revoke` / `grant` / `notify`, no `alter`, no `drop`, no index); all
four § Critical Implementation Details claims are true in the code; and **every measurable Progress
claim reproduced exactly** — 211/18/103 tests, the migration on both databases, CI #51 for `d4548bb`,
the Worker version, the 18-file bundle listing, both probes. The six fixture windows are disjoint by
at least 15 days, no other suite writes any 2025 date, and the `TZ` pin was verified empirically to
make both of its declared properties observable.

## The shape of the findings

All eight warnings are one species: **a claim that was checkable and was not checked.** Three were
comments asserting coverage that did not exist; two were guards inert for reasons outside their own
assertions; one was a test pinning a defect in place. `lessons.md` already carries a rule for each,
which is what makes them weigh more rather than less.

## Findings

### F1 — The empty-week sentence named the wrong week

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Plan Adherence
- **Location**: `src/pages/dashboard.astro`; `tests/render/dashboard-tonnage.test.ts`
- **Detail**: The card rendered the constant `"No sets logged this week"` for whichever week was
  empty. The commonest real state — this week logged, last week empty — therefore read
  **"Last week / 0 kg / No sets logged this week"**. The plan asked for a sentence "for that week",
  and this is exactly the per-week-versus-per-page distinction it spent a paragraph on, implemented
  halfway. **The render test pinned the wrong string**, so a passing assertion held it in place.
- **Fix**: the sentence takes the card's own label; the test constant follows.
- **Decision**: FIXED — `077301b`

### F2 — The render suite never asserted the empty week rendered a figure

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Success Criteria
- **Detail**: Phase 3's first render bullet was "the zero week renders `0` **and** its explanation".
  The suite asserted the explanation and the *other* week's figure. Code that hid the number for an
  empty week — the blank US-03 forbids — passed. Progress 3.2 did not claim the missing half either,
  so nothing flagged it.
- **Fix**: extract both figure spans and require one to read exactly `0`. **Mutated**: hiding the
  empty week's figure now fails.
- **Decision**: FIXED — `077301b`

### F3 — The `.gte` / `.lte` window was guarded by nothing

- **Severity**: ⚠️ WARNING · **Impact**: 🔬 HIGH · **Dimension**: Success Criteria
- **Location**: `src/lib/services/tonnage.ts`
- **Detail**: `fold` re-filters by week in TypeScript, so **deleting both bounds from the query
  changed no answer** — every assertion passed while the Worker received one row per training day in
  the account's entire history. That is unbounded work under the 10 ms CPU cap: the precise thing the
  module's own header claims to prevent, and the slice's central architectural thesis. The
  `span !== 14` guard does not catch it — it checks `trainingWeeksFor`'s output, not the row set.
- **Fix**: a row outside the requested window is a broken promise and throws.
- **Decision**: FIXED — `077301b`

### F4 — The locale guard was inert on CI

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Success Criteria
- **Detail**: The assertion only failed where the machine's own default locale groups differently —
  `pl-PL` here, so it did. CI runners have no `LANG` and Node resolves the default to `en-US`, so on
  the one machine that matters, deleting `"en-US"` would have passed. **This is the lesson this very
  slice added to `lessons.md` — "a guard can be inert because of the ENVIRONMENT it runs in" —
  repeated one file away**, in a module whose header says the render suite cannot catch it and does
  not notice the unit suite could not either.
- **Fix**: spy on the `Intl.NumberFormat` constructor and assert the argument — what the code asked
  for, not what this machine answered. **Mutated**: dropping the locale now fails by assertion.
- **Decision**: FIXED — `077301b`

### F5 — The migration cited an assertion that does not guard it

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency
- **Detail**: Said assertion **6** holds `security_invoker`. Assertion 6 is the empty-week test and
  **passes with the flag removed**; the guard is assertion 7, specifically its third probe. Both
  agents found this independently. `lessons.md`: a comment asserting "test X fails if Y changes" is
  itself a checkable claim.
- **Fix**: corrected to 7, naming the probe, with the miscitation recorded in place.
- **Decision**: FIXED — `077301b`

### F6 — A comment claimed a leak test that cannot see a leak

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: "if the view leaked, A's tonnage would appear here" — it would not. The read scopes by
  B's `user_id`, so PostgREST filters before B sees anything. Only naming A's identifier directly
  observes the leak, which the next probe does.
- **Fix**: reworded as the non-vacuity control it actually is.
- **Decision**: FIXED — `077301b`

### F7 — An access-control test depended on an arithmetic test's fixtures

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency
- **Detail**: Assertion 7 reused assertion 1's window, so `-t "7."` failed on its own and any
  arithmetic failure took the access test with it — against AGENTS.md § Testing ("every test its own
  setup, action, assertion").
- **Fix**: its own anchor and its own fixture.
- **Decision**: FIXED — `077301b`

### F8 — The 365-instant sweep never checked the anchor was a Monday

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: It asserted both spans are 6 days and that the weeks meet — all of which reduce to
  "`addDays` works". **A `mondayOf` returning Sunday passes all 365 iterations**, and the 14 in its
  own title was never asserted, although `tonnage.ts` cites this test as justification for its span
  guard.
- **Fix**: assert the anchor's weekday and the 14-day window, with the same expression `tonnage.ts`
  uses.
- **Decision**: FIXED — `077301b`

## Observations, all applied

- A non-finite total would have rendered as the string `"NaN"` — a number the user would believe.
- The render stub answered the daily chain for **any** table name, so a third read added later would
  have sailed past with `error: undefined`; it throws on an unstubbed table now.
- `expect(current.kilograms).not.toBeLessThan(0)` could not fail after `toBe(0)` on the line above.
- `tonnage-display.ts` re-exported `roundForDisplay` with no importer.
- `plan.md` enumerated `set_count` in one of two paragraphs — the review edit reached the second
  only, so the plan contradicted itself as written. The implementation followed the controlling one.
- `STATE.md`'s delivery table still read "6 z 12" with S-06 and S-07 as `proposed`, left from S-06.

## Recorded, not fixed

- **`records.astro` still defaults the unit on an absent profile** (`profile?.weight_unit ?? "kg"`),
  which is the defect the S-06 review fixed in `settings.astro` and this slice fixed in
  `dashboard.astro`. The new code is right and the asymmetry is now unexplained — worth a slice of
  its own rather than a drive-by.
- **`dashboard-tonnage.test.ts` computes its weeks from the real clock** while the page uses its own
  `new Date()`. Crossing the Warsaw week boundary between the two would fail one assertion — once a
  week, at Sunday midnight. The page has no injectable clock; the risk is named rather than removed.
- **No `src/lib/services/tonnage.test.ts`.** Three defensive guards in that module remain unreachable
  from a test (the span throw, the null-column throw, and now the window throw). Each carries an
  honest comment saying it is defensive, which is what `lessons.md` requires — but a small unit file
  with a recording stub would reach all three.
- **The migration header does not open with the `-- Purpose: / -- Affected:` block** the other six
  use. Cosmetic; the same content is present as prose.

## Post-review state

CI **#53** green for `077301b`. Tests: **212 unit** (+1), **18 render**, **103 integration**.

**The deployed Worker is `20e74767`, built from `d4548bb` — it does NOT contain these fixes.** F1 is
user-visible and is live on production until a redeploy.
