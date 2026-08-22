# Duplicate Record-Impact Sentence — Implementation Plan

## Overview

The delete-set dialog prints "Back Squat will no longer appear in your records at all" **twice** when
one set holds both records and is the last set logged for its exercise. Fix the sentence, not the
data: give each sentence an explicit **scope**, collapse on it, and move the function out of the
React island so the unit suite can reach it at all.

## Current State Analysis

`fallingRecords` (`src/lib/services/record-impact.ts:164-184`) emits **one entry per record kind**.
A set holding both the estimate record and the heaviest record yields two `AffectedRecord`s, and when
it is the last set for that exercise both resolve to `successor: { kind: "no_sets_left" }`.

`impactSentence` (`src/components/workouts/RecordImpactDialog.tsx:175-198`) renders one sentence per
entry. Its `figure` and `no_qualifying_set` branches interpolate `RECORD_LABEL[record.kind]`, so the
two kinds read differently. **Its `no_sets_left` branch does not — and cannot meaningfully**, because
"Back Squat will no longer appear in your records at all" is a fact about the **exercise**, not about
a record kind.

So the list is keyed by record kind while one of its three outcomes is exercise-scoped.

**The file already states the invariant it breaks.** `RecordImpactDialog.tsx:24-26`: _"One line per
affected record … Different futures never share a sentence."_ Two entries with the **same** future
share a sentence here, verbatim. The counting rule ("one line per affected record") and the scope of
that one sentence disagree.

**Nothing tests it.** `RecordImpactDialog.tsx` appears in no test file: the render suite renders Astro
pages rather than React islands, and the integration suites stop at the service. The nearest
assertion is `tests/integration/record-impact.test.ts:443-444` —
`expect(falling).toHaveLength(2)` then
`expect(falling.every((r) => r.successor.kind === "no_sets_left")).toBe(true)`. **It saw both entries
and was right to**: at the service layer two entries are correct, because both records really do
fall. The data is right; the sentence is wrong; nothing covers the boundary between them.

**How it was found**: the owner clicking through the deployed app on 2026-08-22 — the five-minute
check `STATE.md` § "Na czym stoi każde ✓" names as the only way to close the evidence gap on badge
requirements #2 and #3. **No runner in this repository could have caught it.**

## Desired End State

- The dialog prints the exercise-scoped sentence **once**, however many record kinds resolve to it.
- `impactSentence` lives in `src/lib/services/record-display.ts` and is covered by
  `record-display.test.ts`, including the duplicate case.
- The collapse happens because the sentence **declares its own scope**, not because two strings
  happen to match.
- `fallingRecords`, `impactOf` and the `…/impact` payloads are **unchanged** — they were never wrong.
- The fix is on the public URL and has been seen there.

### Key Discoveries

- `src/lib/services/record-display.ts:67-83` already owns `FallTo` and a comment explaining that the
  three outcomes "are **different futures for the user** and must not share a sentence" — the
  sentence function belongs beside the reasoning that governs it.
- `record-display.ts` is browser-safe and already imported by the island, so moving the function adds
  no bundle weight and removes some.
- **The `edit` action is not affected and must stay that way.** `RecordImpactDialog.tsx:183-188`
  collapses both no-successor cases into one sentence that **does** interpolate `label`, so two kinds
  give two different sentences there. Verified by reading, not assumed.
- `record-display.test.ts` already imports `fallToFigure` and builds `falling(...)` fixtures — the new
  tests have a shape to follow rather than invent.

## What We're NOT Doing

- **Not changing `fallingRecords` or `impactOf`.** Two entries is a true statement about the data;
  changing it would break assertions that are correct in order to fix a sentence.
- **Not changing the `…/impact` route payloads** — no API contract moves.
- **Not deduplicating by comparing rendered strings.** It works today only because the other two
  branches happen to interpolate `label`; the day somebody drops one, two genuinely different records
  would silently collapse into one row.
- **Not adding an e2e spec.** The browser is the only layer that sees the real dialog, but the harness
  has crashed three times this week independently of the product (`test-plan.md` § 6.3), and the spec
  would need to construct "an exercise whose single set holds both records". Named as a gap below
  rather than left implied.
- **Not touching the `edit` sentences.**

## Implementation Approach

One idea carries the fix: **a sentence knows what it is about.** `impactSentence` returns
`{ scope, text }` where `scope` is `"record"` (this sentence is about one of the two records) or
`"exercise"` (this sentence is about the lift leaving `/records` entirely). The dialog renders one row
per distinct `(scope, exerciseId)` — which for `scope: "record"` is unchanged behaviour, and for
`scope: "exercise"` collapses the pair.

That makes the collapse **structural**: it holds because the sentence says what it covers, not because
two strings matched.

## Phase 1: The sentence carries its scope, and the suite can finally see it

### Overview

Move `impactSentence` into the display service, give it a scope, collapse on it, and cover it.

### Changes Required:

#### 1. The sentence function

**File**: `src/lib/services/record-display.ts`

**Intent**: Take `impactSentence` and `RECORD_LABEL` out of the island and put them beside `FallTo`
and `fallToFigure`, whose doc comment already governs them. Give the return value an explicit scope so
a caller can tell an exercise-scoped statement from a record-scoped one without parsing prose.

**Contract**: a new exported type and function. `scope` is the whole point of the change and the one
thing a future reader must not "simplify" away:

```ts
export type ImpactSentence = { scope: "record" | "exercise"; text: string };

export function impactSentence(
  record: FallingRecord,
  action: "delete" | "edit",
  unit: WeightUnit,
  formula: EstimationFormula,
): ImpactSentence;
```

Only the delete-path `no_sets_left` branch is `scope: "exercise"`. Every other branch — both edit
branches, `figure`, `no_qualifying_set` — is `scope: "record"`, because each interpolates
`RECORD_LABEL` and therefore says something true of one record only. The sentence texts themselves do
not change.

#### 2. The dialog renders one row per distinct scope

**File**: `src/components/workouts/RecordImpactDialog.tsx`

**Intent**: Import the function instead of defining it, and render one row per **distinct
`(scope, exerciseId)`** rather than one per affected record. Keep the `key` stable and distinct.

**Contract**: the `state.impact.map(...)` at `:106-113` becomes a map over a derived, collapsed list.
`scope: "record"` rows are one-per-record as before; `scope: "exercise"` rows are one-per-exercise.
The empty-impact and `impact_unavailable` branches are untouched.

#### 3. The header comment that states the invariant

**File**: `src/components/workouts/RecordImpactDialog.tsx`

**Intent**: The header says "One line per affected record … Different futures never share a sentence."
The first clause is now false and was the bug. Restate the counting rule so the next reader sees why
the collapse exists rather than deleting it as redundant.

**Contract**: the § "Three states" block, state 2. Say that one line is emitted per distinct
**future**, that most futures are per-record, and that `no_sets_left` is per-exercise because it
describes the lift leaving `/records` rather than a record losing its value.

#### 4. Tests

**File**: `src/lib/services/record-display.test.ts`

**Intent**: Cover the function that had no coverage at all, and pin the specific defect.

**Contract**: assertions over the six combinations (three `FallTo` kinds × `delete` / `edit`),
each checking `scope` **and** `text`; plus the defect case — two `FallingRecord`s for the same
exercise, kinds `estimate` and `heaviest`, both `no_sets_left`, asserting they collapse to **one**
row. Put the collapse assertion **first**: it carries the claim, and `lessons.md` § "The assertion
carrying the claim goes FIRST" is about exactly this.

### Success Criteria:

#### Automated Verification:

- `npm test` passes and `record-display.test.ts` gains the new cases
- `npm run lint` passes
- `npm run typecheck` passes
- `npx prettier --check` passes on all four touched files
- `npm run test:render` and `npm run test:integration` still pass — neither should notice this change
- **Mutation**: reverting the collapse makes the duplicate assertion go red, and **that** assertion
  rather than an unrelated one; reverting `scope` on the `no_sets_left` delete branch does the same
- `grep` finds no remaining definition of `impactSentence` or `RECORD_LABEL` in `src/components/`

#### Manual Verification:

- The header comment explains why the collapse exists well enough that a reader would not delete it
- No sentence text changed — only how many times each is printed

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: On the public URL, seen

### Overview

`lessons.md` § "A slice that ends in a screen needs a deployment phase": the check that matters is a
request against the public address. This defect existed only on a screen.

### Changes Required:

#### 1. Deploy

**File**: none — `npm run deploy`

**Intent**: Ship it and prove the deployed thing still authenticates. The command carries its own
guards (dirty tree, non-`main` HEAD, Worker secret names) and runs the smoke itself.

**Contract**: `npm run deploy` exits 0 with `deploy-smoke: PASS`. Run it from `main` after the merge,
not from the change branch — the git guard will refuse otherwise, and that refusal is correct.

### Success Criteria:

#### Automated Verification:

- `npm run deploy` exits 0 and the smoke reports `sign_in_failed`
- `npm run db:parity` still exits 0 — this change touches no schema, and the check should say so

#### Manual Verification:

- On the deployed URL, delete the last set of an exercise whose single set holds both records: the
  dialog shows the sentence **once**
- A case that must NOT collapse still reads as two lines: delete a set that holds both records for an
  exercise which has other sets left, so the two records fall to different successors
- The `edit` dialog is unchanged

---

## Testing Strategy

### Unit Tests

- `impactSentence` over three `FallTo` kinds × two actions, asserting `scope` and `text`
- The defect: two kinds, same exercise, both `no_sets_left` → one row
- The control: two kinds, same exercise, different successors → two rows

### What is deliberately not covered

**The real dialog is never rendered by any suite.** The unit tests cover the function; nothing renders
the component. That gap is why this defect reached the deployed app, and it is not closed here — the
render suite cannot mount React islands and the browser harness has crashed three times this week for
reasons unrelated to the product. **Stated so a green suite is not read as covering it.**

## References

- Diagnosis and the owner's verbatim report: `context/changes/duplicate-record-impact-sentence/change.md`
- The invariant this breaks: `src/components/workouts/RecordImpactDialog.tsx:24-26`
- Why two entries are correct at the service layer: `tests/integration/record-impact.test.ts:432-445`
- Deployment-phase rule: `context/foundation/lessons.md` § "A slice that ends in a screen needs a deployment phase"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The sentence carries its scope

#### Automated

- [x] 1.1 `npm test` passes with the new `record-display.test.ts` cases
- [x] 1.2 `npm run lint` passes
- [x] 1.3 `npm run typecheck` passes
- [x] 1.4 `npx prettier --check` passes on all four touched files
- [x] 1.5 `npm run test:render` and `npm run test:integration` still pass
- [x] 1.6 Mutation: reverting the collapse reddens the duplicate assertion, and that one specifically
- [x] 1.7 No definition of `impactSentence` or `RECORD_LABEL` remains under `src/components/`

#### Manual

- [x] 1.8 The header comment explains why the collapse exists
- [x] 1.9 No sentence text changed — only how many times each is printed

### Phase 2: On the public URL, seen

#### Automated

- [ ] 2.1 `npm run deploy` exits 0 with `deploy-smoke: PASS`
- [ ] 2.2 `npm run db:parity` still exits 0

#### Manual

- [ ] 2.3 Deployed: deleting the last set of a both-records exercise shows the sentence once
- [ ] 2.4 Deployed: a set holding both records with other sets left still shows two lines
- [ ] 2.5 The `edit` dialog is unchanged
