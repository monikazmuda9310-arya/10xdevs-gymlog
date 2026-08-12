<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Edit and Delete the Log

- **Plan**: `context/changes/edit-and-delete-log/plan.md`
- **Scope**: all five phases (45 of 45 Progress rows checked)
- **Date**: 2026-08-12
- **Verdict**: APPROVED — all three findings fixed on 2026-08-12
- **Findings**: 0 critical, 2 warnings, 1 observation
- **Method**: reviewed inline, without sub-agents, per the owner's standing instruction recorded in
  `C:\10xdev\handoff\STATE.md` § Tryb pracy.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence re-checked during this review

Not taken from the Progress rows — re-run against the working tree:

- **Scope guardrails hold.** `git diff --name-only cc2ac9a^..HEAD -- supabase/` is empty (no
  migration, as the plan required), and the three S-03 `POST` endpoint files appear nowhere in the
  slice's diff (criterion 2.3).
- **Criterion 1.7, the three copies of the ordering, agree.** `records.ts:118`, `records.ts:232` and
  the view's `distinct on` (`…derive_personal_records….sql:157`) all read
  `estimate_kg desc, created_at asc, set_id asc`; `records.ts:265` and line 163 of the migration
  both read `weight_kg desc, created_at asc, set_id asc`.
- **Criteria 2.4 and 2.5 hold.** `weight_unit` appears in `workouts.ts` only in the insert payload
  and in select lists — never in an update. `weight_kg` appears only in select lists and comments.
- **The F2 guard is a genuine pair.** `workout-mutations-rls.test.ts` assertion 13 forces the
  ranking reads to throw through a `Proxy` while leaving the ownership read working, and asserts a
  non-2xx carrying `impact_unavailable` with no `impact` key; assertion 14 asserts that an ordinary
  `{ impact: [] }` is still reachable. Without 14, assertion 13 would pass against an endpoint that
  had simply stopped answering.
- **The full gate passes**: lint, typecheck, 165 unit, 83 integration, build.

## Findings

### F1 — Two doc comments are attached to the wrong function

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/record-display.ts:67`, `src/lib/services/records.ts:276`
- **Detail**: Phase 1 inserted `fallToFigure` and `impactOf` **between** an existing S-04 doc block
  and the function that block documented. The result in both files is a function carrying two
  stacked doc comments, the first of which describes something else entirely, and a second function
  left undocumented at the bottom of the file. A reader arriving at `fallToFigure` is told "The
  heaviest absolute load ever handled, or `null` when every set was at zero or assisted" — which is
  `heaviestFigure`'s contract (now at line 115, with no comment of its own). The same shape holds
  for `impactOf`, which is preceded by `anySetSurvives`' description; `anySetSurvives` sits
  undocumented at `records.ts:320`. This matters more here than it would elsewhere: this codebase's
  convention is that the comment carries the reasoning, so a comment on the wrong function is not
  clutter, it is a false statement in the place a reader trusts most.
- **Fix**: Move each orphaned block down onto the function it describes — the "heaviest absolute
  load" block onto `heaviestFigure`, the "Whether ANY set … survives" block onto `anySetSurvives`.
- **Decision**: FIXED — both blocks moved onto the functions they describe

### F2 — The measured `<dialog>` fallback dropped `role="alertdialog"`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: `src/components/ui/confirm-dialog.tsx:59`
- **Detail**: The measurement that rejected the shadcn `alert-dialog` (+40 KB against a ~15 KB
  threshold) was correct, and `showModal()` genuinely replaces four of the five things that
  component provided: focus containment, Escape, an inert background and focus restoration — all
  confirmed by hand in criterion 3.11. The fifth was not replaced. A native `<dialog>` carries an
  implicit `role="dialog"`; Radix's `AlertDialog` sets `role="alertdialog"`, which is what tells
  assistive technology that this dialog interrupts and demands a response rather than merely being
  open. These are the first irreversible actions in the product, which is exactly the case the role
  exists for. **Criterion 3.11 could not have caught this**: the dialog is operated correctly by
  keyboard, it is only announced with a weaker meaning, and that difference is inaudible to a
  sighted tester.
- **Fix**: Add `role="alertdialog"` to the `<dialog>` element in `confirm-dialog.tsx`.
- **Decision**: FIXED — role="alertdialog" added, with a comment naming what showModal() does not supply

### F3 — `impactOf` serialises its per-exercise reads

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: `src/lib/services/records.ts:307`
- **Detail**: Inside the loop the three successor queries run together under `Promise.all`, but the
  loop **over exercises** is sequential `await`. For a set edit or a set deletion that is one
  iteration and the plan's "typically zero, one or two" is exact. For a workout deletion it is one
  iteration per exercise whose record lives in that workout — after a good session that is
  realistically six or eight, so the preflight becomes six to eight sequential round trips while
  the user waits on a spinner in an open dialog. **This is latency, not the 10 ms CPU trap**: these
  are awaits on network I/O and the Workers cap is CPU time, so it will not produce an Error 1102.
  The plan's performance section claimed the cost is bounded, which is true; it did not notice that
  the bound is paid serially.
- **Fix**: Collect the per-exercise work into an array and `Promise.all` the outer loop too, keeping
  the inner `Promise.all` as it is.
- **Decision**: FIXED — the outer loop is now Promise.all as well

## What was checked and found clean

- **The id-comparison seam holds end to end.** `record-impact.ts` imports only types at runtime and
  compares ids exclusively; no TypeScript-computed number is ever compared against a Postgres-computed
  one anywhere in the slice.
- **No number Postgres computed reaches the screen.** Every figure in the dialog comes through
  `fallToFigure` → `set-display.ts`, re-derived from the surviving set's typed `weight`/`weight_unit`.
- **The browser boundary is intact.** The built client bundle contains no `zod` and no `@supabase/`,
  verified against `dist/client/_astro/` with a control match proving the same grep can find
  something that is genuinely present.
- **`radix-ui` left no trace.** `package.json` and `package-lock.json` are unchanged by the slice,
  and three CI runs (#38, #39, #40) have since passed `npm ci` against that lockfile.
- **The zero-rows rule is enforced uniformly.** All five mutations `.select()` what they touched;
  all six routes answer `404` with the resource's own code for both "absent" and "another
  account's", asserted by suite assertions 1–8.
