<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Week-boundary seam

- **Plan**: `context/changes/testing-week-boundary-seam/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

> **Method note, stated because it bounds what this review is worth.** The evidence was gathered
> **inline by the implementing author** rather than by independent sub-agents. Every file-level claim
> below was re-derived from the diff and every automated criterion was re-run, but a self-review is
> structurally weaker at spotting what the author was already blind to. The two Pattern Consistency
> findings were both found by checking the new files against `lessons.md` and against
> `dashboard-tonnage.test.ts`'s stated disciplines — a mechanical check, not an insight — which is
> roughly the ceiling of what this method reaches.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Scope detected

`git diff 4c7ea4b~1..HEAD` — 8 files, +2422/−2. **Two new test files, four documents, and not one
line under `src/` or `supabase/`.** That matches the plan's "No production code changes and no
migration" exactly, and matches its file list with no unplanned paths.

## Success criteria, re-run

| Check               | Result                                                     |
| ------------------- | ---------------------------------------------------------- |
| `lint`              | clean                                                      |
| `typecheck`         | 141 files, 0 errors                                        |
| `test`              | 15 files, 249 tests                                        |
| `test:render`       | 5 files, 52 tests                                          |
| `dashboard-tonnage` | 14 tests — unchanged, as criterion 1.5 asks                |
| `test:integration`  | 17 files, 142 tests                                        |
| `test:middleware`   | 2 files, 11 tests                                          |
| `build`, `test:e2e` | green at the phase-4 gate; only markdown has changed since |

All 27 Progress rows are `[x]` and every one carries a SHA.

## Findings

### F1 — Two pointers cite the change folder as "this change", naming nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/render/week-boundary.test.ts:479`, `context/foundation/test-plan.md:576`
- **Detail**: Both cite `research.md`'s Open Question 2 as _"Open Question 2 of this change's
  `research.md`"_ and _"…in this change folder's `research.md`"_. `lessons.md` § "A pointer INTO
  `context/changes/` dies the day that change is archived — cite the folder by NAME" is an accepted
  rule of this repository, and these are **worse than the path it forbids**: a path is at least
  greppable until the folder moves, whereas "this change folder" has no antecedent at all. The test
  file is the sharper case — it outlives the change folder entirely and carries no change context, so
  a reader six months from now has nothing to search for. The foundation document is the same defect
  one step milder: §6.6's entry is titled "Phase 4 — Week-boundary seam" and the folder happens to be
  `testing-week-boundary-seam`, but the sentence never says so. This is the exact silent rot the
  lesson describes — the pointer looks authoritative until somebody follows it and concludes the
  evidence never existed.
- **Fix**: Replace both with the folder's name — "Open Question 2 in the `testing-week-boundary-seam`
  change folder's `research.md`".
  - Strength: One-word edit in two places; the name survives `/10x-archive`'s move, which the current
    phrasing does not.
  - Tradeoff: None — it is strictly more information in the same sentence.
  - Confidence: HIGH — the rule is written down, accepted, and names this exact substitution.
  - Blind spot: None significant.
- **Decision**: FIXED — folder named in both places

### F2 — `not.toContain("UTC")` is an unbounded whole-page check, in a file that knows better

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/render/week-boundary.test.ts:489,502`
- **Detail**: Both silent-UTC-fallback tests prove "nothing on screen says the date came from UTC"
  with a substring check over the **entire** rendered page. `dashboard-tonnage.test.ts` states the
  countervailing discipline twice — at `:66` ("no row may FORMAT to `12,346`… a whole-page substring
  check") and at `:250`, where `thisWeekCard()` exists specifically to bound such a check to a region
  so it cannot fail for a reason unrelated to its claim. Nothing on `/workouts` contains `UTC` today,
  so the assertion is correct; it is one unrelated copy change away from failing for the wrong reason.
  Separately, it has no positive control — nothing establishes that the string WOULD be found if the
  page did say it. **Its tripwire behaviour is intended and is documented**: the block comment above
  names the edit (the product deciding to say when the date came from UTC) that should turn it red,
  so an author making that change is meant to revisit the pinned-not-endorsed decision. That is why
  this is an observation rather than a warning.
- **Fix**: Bound the check to the form's region the way `thisWeekCard()` does, or leave it and add one
  line to the existing comment saying the whole-page scope is deliberate.
- **Decision**: FIXED — whole-page scope named as deliberate in the block comment

### F3 — Phase 2 renamed Phase 1's constants, which the plan did not describe

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `tests/render/week-boundary.test.ts:139-158`
- **Detail**: `10ae935` renamed `WARSAW_FIXTURE` / `WARSAW_WINDOWS` to `WEEK_OF_08_10` /
  `WEEK_OF_08_03`, folded windows and fixtures into one `Week` interface, and changed
  `renderDashboardAt`'s signature — all on code committed one commit earlier and none of it in the
  plan's Changes Required. The reason is sound and is in the file: the UTC fallback at I1 lands on the
  same week `America/New_York` does, so a constant named after a zone would have to be reused for a
  case that has nothing to do with that zone. The cost is that `4c7ea4b`'s diff no longer shows the
  file as it stands, so anyone reviewing phase 1 in isolation reads superseded names.
- **Fix**: None needed — the rename is recorded in `10ae935`'s body. Named here so a phase-scoped
  reader is not surprised.
- **Decision**: ACCEPTED — rename kept; recorded in 10ae935 and named here

### F4 — The integration suite ships three tests where the contract described two

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `tests/integration/week-boundary-seam.test.ts:264-273`
- **Detail**: Phase 3's Changes Required names assertion 1 and assertion 2. A third — "the shared
  fixture is left as it was found" — was added, mirroring `preferences-derive.test.ts` assertion 4.
  The plan's own contract text points at that suite's tripwire as the cross-suite guard but does not
  ask for a local one. The addition is house pattern and cheap, and it makes this suite report its own
  leak where it was caused rather than in an unrelated suite on the next run.
- **Fix**: None needed — keep it. Named so the count difference against the plan is not read as drift.
- **Decision**: ACCEPTED — third assertion kept as house pattern

### F5 — Criterion 4.4 was assessed by the author of the thing it assesses

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/testing-week-boundary-seam/plan.md:599`
- **Detail**: "§6.8 is sufficient to write a correct week assertion without reading `research.md`" is
  the only manual criterion in the plan whose subject is comprehension rather than an observable
  outcome, and the person who checked it is the person who wrote §6.8. The owner confirmed it, which
  is the strongest signal available today, but the real evaluation is the next author who writes a
  week assertion — and by construction that evidence cannot exist yet. This is the same class as
  `lessons.md` § "Verify with a script that attacks, not by asking the owner to read code": a
  criterion about whether a document teaches something cannot be settled by its author.
- **Fix**: Leave the checkbox; treat the next week-related test written against §6.8 as the real
  verification, and record in §6.6 whether it needed `research.md`.
  - Strength: Costs nothing now and converts an unverifiable criterion into a deferred, observable one.
  - Tradeoff: The answer arrives whenever somebody next touches a week, which may be never.
  - Confidence: MEDIUM — depends entirely on future work landing.
  - Blind spot: Nobody is assigned to record the outcome; without an owner this note is the only trace.
- **Decision**: FIXED — deferred to the next week test, recorded in test-plan.md §6.6

### F6 — The plan's Phase 2 contract still says four assertions; five shipped

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-week-boundary-seam/plan.md:296-305`
- **Detail**: The Phase 2 contract tabulates four `/workouts` states at I2 and criterion 2.3 expects
  mutation 4 to redden "the two stored-zone rows". At I2 `Europe/Warsaw` and UTC read the same date,
  so that criterion was not satisfiable as written; a fifth assertion at I1 was added with the owner's
  ruling. The plan's phase block is read-only under `/10x-implement`, so the contract and the code
  now disagree for anyone reading the plan alone. The correction is recorded in `change.md` § "The
  plan/reality mismatch this phase found" and in `10ae935`'s body, and the mutation confirmed the
  fix works — both stored-zone rows reddened, both fallback rows stayed green.
- **Fix**: None needed — the addendum is where this repository puts it. Named so the discrepancy is
  not rediscovered as drift.
- **Decision**: ACCEPTED — addendum stays in change.md and the commit body
