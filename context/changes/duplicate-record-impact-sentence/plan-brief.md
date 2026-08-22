# Duplicate Record-Impact Sentence — Plan Brief

> Full plan: `context/changes/duplicate-record-impact-sentence/plan.md`

## What & Why

The delete-set dialog prints **"Back Squat will no longer appear in your records at all"** twice, when
one set holds both records and is the last set logged for its exercise. Found by the owner clicking
through the deployed app — **no runner in this repository could have caught it**, which is the second
half of why this is worth a change folder rather than a one-line edit.

## Starting Point

`fallingRecords` emits one entry per record kind, so a set holding both records yields two. Both
resolve to `no_sets_left`, and `impactSentence`'s `no_sets_left` branch is the only one that does not
interpolate `RECORD_LABEL` — because it cannot: _"the exercise leaves your records"_ is a fact about
the **exercise**, not about a record kind. The list is keyed by record kind while one of its three
outcomes is exercise-scoped.

The component's own header already states the invariant it breaks: _"One line per affected record …
Different futures never share a sentence."_ And `impactSentence` has **no test at all** — it lives
inside a React island, which the render suite cannot mount and the integration suites never reach.

## Desired End State

The exercise-scoped sentence prints once, however many record kinds resolve to it. `impactSentence`
lives in `src/lib/services/record-display.ts`, is unit-tested including the duplicate case, and the
collapse holds because the sentence **declares its scope** — not because two strings happened to
match. `fallingRecords`, `impactOf` and the `…/impact` payloads are untouched.

## Key Decisions Made

| Decision              | Choice                               | Why                                                                                                                    |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Where to fix          | Presentation, not the service        | Two entries is a **true** statement about the data — both records really fall. The sentence is what is wrong.          |
| How to collapse       | Sentence returns `{ scope, text }`   | Makes the collapse structural. String-equality dedupe works today only because the other branches interpolate `label`. |
| Home for the function | `src/lib/services/record-display.ts` | Already holds `FallTo` and the comment governing these three futures; already browser-safe; already has a test file.   |
| Test depth            | Unit tests **plus** a mutation proof | The defect exists because nothing tested this function; a guard nobody broke may not guard.                            |
| Deploy                | Its own phase, via `npm run deploy`  | `lessons.md`: a change that ends in a screen is verified by a request to the public address.                           |

## Scope

**In scope:** move `impactSentence` + `RECORD_LABEL` into the display service; add `scope`; collapse
per `(scope, exerciseId)`; correct the header comment that states the broken invariant; unit tests
including the defect case and a control; deploy and see it.

**Out of scope:** `fallingRecords` / `impactOf` / the `…/impact` payloads; the `edit` sentences
(verified unaffected — they interpolate `label`); dedupe by comparing rendered strings; an e2e spec.

## Architecture / Approach

One idea: **a sentence knows what it is about.** `impactSentence` returns `{ scope, text }` — `"record"`
for anything naming one of the two records, `"exercise"` for the delete-path `no_sets_left` case. The
dialog renders one row per distinct `(scope, exerciseId)`. For record-scoped rows that is unchanged
behaviour; for the exercise-scoped one it collapses the pair.

## Phases at a Glance

| Phase                             | What it delivers                                               | Key risk                                                                                 |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. The sentence carries its scope | Extraction, collapse, corrected comment, unit tests + mutation | Collapsing too much — a control case pins that two different futures still print twice   |
| 2. On the public URL, seen        | Deployed and observed in a browser                             | Deploys to production; the manual check needs an exercise with a single both-records set |

**Prerequisites:** none beyond a clean tree. Phase 2 must run from `main` — `npm run deploy`'s git
guard refuses a feature branch, and that refusal is correct.
**Estimated effort:** one session.

## Open Risks & Assumptions

- **The real dialog is still rendered by no suite.** Unit tests cover the function; nothing mounts the
  component. That gap is why this reached production and it is **not** closed here — named in the plan
  rather than left implied.
- The manual check needs a specific state (an exercise whose only set holds both records). Building it
  takes a minute; forgetting it makes the check vacuous.

## Success Criteria (Summary)

- Deleting the last set of a both-records exercise shows the sentence **once**, on the deployed URL.
- A set holding both records with other sets left still shows **two** lines — the collapse did not
  swallow a real distinction.
- `impactSentence` is reachable by `npm test`, and reverting the fix turns the duplicate assertion red.
