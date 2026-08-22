---
change_id: duplicate-record-impact-sentence
title: The delete dialog says an exercise leaves your records twice
status: archived
created: 2026-08-22
updated: 2026-08-22
archived_at: 2026-08-22T16:08:50Z
---

## Notes

the delete dialog states "will no longer appear in your records" twice when one set holds both
records and is the last for its exercise; impactSentence is untested because it lives inside the
React island

**Found by the owner clicking through the deployed app on 2026-08-22**, during the five-minute
check that STATE.md § "Na czym stoi każde ✓" names as the only way to close the evidence gap on
badge requirements #2 and #3. It is the first defect this session that no runner could have caught.

Reported verbatim:

```
Delete this set?
This removes the set from this workout. It cannot be undone.

Back Squat will no longer appear in your records at all — this removes the last set you have logged for it.
Back Squat will no longer appear in your records at all — this removes the last set you have logged for it.
```

### Mechanism, already traced

`fallingRecords` (`src/lib/services/record-impact.ts:164-184`) emits **one entry per record kind**.
A set holding both the estimate record and the heaviest record yields two `AffectedRecord`s, and when
it is the last set for that exercise both resolve to `successor: { kind: "no_sets_left" }`.

`impactSentence` (`src/components/workouts/RecordImpactDialog.tsx:175-198`) then renders one sentence
per entry. Its `figure` and `no_qualifying_set` branches use `RECORD_LABEL[record.kind]`, so they say
different things for the two kinds. **Its `no_sets_left` branch does not** — and it cannot
meaningfully, because "Back Squat will no longer appear in your records at all" is a fact about the
**exercise**, not about a record kind.

So the list is keyed by record kind while one of its three outcomes is exercise-scoped.

### Why nothing caught it

- **`impactSentence` has no test at all.** `RecordImpactDialog.tsx` appears in no test file: the
  render suite renders Astro pages rather than React islands, and the integration suites stop at the
  service.
- The nearest assertion, `tests/integration/record-impact.test.ts:443-444`, is
  `expect(falling).toHaveLength(2)` followed by
  `expect(falling.every((r) => r.successor.kind === "no_sets_left")).toBe(true)`. **It saw both
  entries and was right to.** At the service layer two entries are correct — both records really do
  fall. The data is right; the sentence is wrong. Nothing tests the boundary between them.

### Direction (not yet a plan)

Fix in **presentation**, not in the service: `impactOf` reporting both kinds is a true statement
about the data, and changing `fallingRecords` would break assertions that are correct in order to fix
a sentence. Collapse `no_sets_left` to one line per exercise at render time.

Second half, and the reason this is a change folder rather than a one-line edit: **`impactSentence`
must become unit-testable**, which means moving it out of the island into `src/lib/services/`.
`lessons.md` § "A criterion that demands a unit test must name the module that will hold it" is
exactly this situation — a rule living in a component is a rule the unit suite cannot reach.
