<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Exercise Catalogue Implementation Plan

- **Plan**: `context/changes/exercise-catalogue/plan.md`
- **Scope**: all 5 phases (29/29 Progress items complete)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION → all five findings fixed 2026-08-10
- **Findings**: 0 critical, 3 warnings, 2 observations
- **Method note**: reviewed inline rather than via the skill's two sub-agents — the owner's standing
  instruction for this session is not to spawn sub-agents unless asked.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Scope Discipline PASS**: 21 files changed, every one named in the plan. Nothing on the "What We're
NOT Doing" list was crossed — no edit/delete UI, no `glutes` group, no trigram index, no images or
equipment tags, no favourites, no shadcn sweep.

**Success Criteria PASS**: all 29 items verified. Gate green (lint 0, typecheck 0, 70 unit, 25
integration, build 0); RLS state read from both databases; the seed distribution asserted per group.

## Findings

### F1 — `userId` is interpolated into a PostgREST filter expression

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/exercises.ts:42`
- **Detail**: the `.or(...)` call builds its filter by string concatenation, splicing `userId`
  directly into the expression. PostgREST's `or` argument is a small expression language where a
  comma separates terms and a dot separates operator parts, so a value containing either could
  change the filter's meaning rather than being treated as data.
  **Real exposure here is nil**, and saying so plainly matters more than the alarm: `userId` comes
  from `context.locals.user.id`, which the middleware reads from a verified Supabase JWT — no caller
  can influence it — and the RLS policy independently constrains every row to
  `user_id is null or auth.uid() = user_id`, so even a rewritten filter could not widen visibility.
  The concern is the **pattern**, not this call. Every other filter in the codebase passes values as
  arguments — `.eq("muscle_group", muscleGroup)` — which PostgREST encodes; this is the only place
  a value is spliced into filter syntax, and it is the natural line for a later slice to copy when
  the value is _not_ a JWT claim.
- **Fix**: Assert the shape before interpolating — a UUID guard that throws, plus a comment naming
  why the interpolation is safe here and what would make it unsafe elsewhere.
- **Decision**: FIXED — `assertUserId()` throws unless the value is a UUID, with a comment naming what would make the pattern unsafe if copied for a value that is not a JWT claim. Three unit tests cover it, and it is **mutation-tested**: replacing the condition with `if (false)` fails two of them.

### F2 — The form ignores the plan's instruction to reuse `FormField` and `SubmitButton`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: `src/components/exercises/ExerciseForm.tsx`
- **Detail**: The plan's Phase 4 §3 says "Reuse `FormField` and `SubmitButton` from
  `src/components/auth/` rather than writing new inputs — they already carry the error and pending
  states this form needs." The implementation writes its own input, its own error paragraph and its
  own submit button, and **the deviation was never recorded**.
  Half of it is justified and the plan was wrong: `SubmitButton` derives its pending state from
  `useFormStatus()`, which only reports during a **form action** submission. This form posts with
  `fetch` and `preventDefault`, so `useFormStatus` would report `pending: false` forever and the
  button would never show a spinner — reusing it would have produced a silently broken control.
  The other half is not justified: `FormField` would have worked for the name input, and using it
  would keep one definition of the input's error styling. Today the same focus-ring and red-border
  rules exist in two files and can drift.
- **Fix A ⭐ Recommended**: Record the deviation in `change.md` with the `useFormStatus` reason, and
  leave the components as they are.
  - Strength: The reason is real and worth capturing — the next slice that builds a fetch-based form
    will otherwise re-derive it, or worse, reuse `SubmitButton` and ship a dead spinner.
  - Tradeoff: The input styling stays duplicated in two files.
  - Confidence: HIGH — `useFormStatus`'s form-action requirement is documented React behaviour and
    `SubmitButton` has no other pending source.
  - Blind spot: Have not checked whether a third form is imminent, which would raise the cost of the
    duplication.
- **Fix B**: Switch the name input to `FormField` and keep the custom button.
  - Strength: Removes the duplicated input styling; matches the plan's letter for the half that
    works.
  - Tradeoff: `FormField` requires an `icon` and renders `hint` only when there is no error, so the
    character counter needs rework; a real edit for a modest gain.
  - Confidence: MEDIUM — the props fit, but the counter placement would change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — recorded in `change.md` under `deviations`, with the `useFormStatus` reason: it only reports during a form-action submission, so reusing `SubmitButton` in a fetch-based form would have shipped a spinner that never spins. The `FormField` duplication is noted there as the unjustified half of the deviation.

### F3 — `listExercises`'s `search` and `muscleGroup` options are never used by the application

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/exercises.ts:37-51`, `src/pages/exercises.astro:16`
- **Detail**: The only caller is `exercises.astro`, which calls `listExercises(supabase, user.id)`
  with no options — Phase 4 decided filtering and search run client-side. So the `ilike` branch,
  the `muscle_group` filter and `escapeLikePattern` are unreachable in production.
  **The plan contradicted itself**: Phase 3 specified server-side search, Phase 4 specified
  client-side filtering, and nothing reconciled them. The result is worse than plain dead code
  because four unit tests cover `escapeLikePattern`, so the suite reads as though server-side search
  is verified working when nothing exercises it end to end.
  The code itself is correct and the escaping is right; the problem is that its status is
  ambiguous — a reader cannot tell whether it is deliberate groundwork or an oversight.
- **Fix**: Keep it, and say why in a comment: the options exist for the server-side path S-03 will
  need when the catalogue is queried from a workout form rather than rendered whole. Note in
  `change.md` that they are currently uncalled, so the next reader does not treat the tests as proof
  of a live feature.
- **Decision**: FIXED — `ListExercisesOptions` now states in its doc comment that both options are uncalled, why they stay (S-03's exercise picker queries rather than rendering the catalogue whole), and that the escaping tests prove the escaping rather than a live search path. Also recorded in `change.md`.

### F4 — The plan had no deployment phase

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/exercise-catalogue/plan.md` (Implementation Approach)
- **Detail**: S-01 deployed in its Phase 4; S-02's five phases end at documentation. Because
  `db:push` writes to both databases, closing the plan left **the data on production and the code
  only on the developer machine** — 38 exercises in the production database with no route to reach
  them. Caught after the plan closed and fixed by hand (Worker `765846dd`), but no phase, criterion
  or Progress row would have surfaced it.
  Worth recording as a rule rather than a one-off: any slice whose outcome is a user-visible screen
  needs a deployment step, or the plan's own success criteria can pass while the user sees nothing.
- **Fix**: Record it in `STATE.md` (done) and consider a lessons entry so `/10x-plan` accounts for it
  next time.
- **Decision**: FIXED — recorded in `STATE.md` and as the first entry in the new `context/foundation/lessons.md`, which every planning skill re-reads: a slice whose outcome is a screen carries its own deployment phase, with a check against the public URL.

### F5 — The catalogue query has no upper bound

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/exercises.ts:37`, `src/components/exercises/ExerciseCatalogue.tsx`
- **Detail**: `listExercises` returns every visible row and the page renders all of them into the
  island's props, so the HTML grows with the catalogue. At 38 seeded rows plus a handful of custom
  ones this is right — the plan chose client-side filtering for exactly that reason. It stops being
  right somewhere in the hundreds, and nothing marks that boundary.
  Not worth fixing now: pagination would add a request per page against a list a person can scroll,
  and this product has one user. Worth knowing before S-03 makes the catalogue a picker inside a
  workout form, where the same unbounded read runs on a hotter path.
- **Fix**: Leave as is; note the threshold in the service comment so the next reader meets it there.
- **Decision**: FIXED — the threshold is now in `listExercises`' doc comment: correct at tens of rows, stops being correct in the low hundreds, and S-03 will run it on a hotter path.
