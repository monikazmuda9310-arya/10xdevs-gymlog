# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame,
> /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## A slice that ends in a screen needs a deployment phase

- **Context**: `context/changes/exercise-catalogue/plan.md` — five phases ending at documentation.
  Found during /10x-impl-review on 2026-08-10 (finding F4).
- **Problem**: S-01 deployed in its Phase 4; S-02 had no deployment step at all. Because
  `npm run db:push` writes to **both** databases while application code reaches production only
  through `npx wrangler deploy`, closing the plan left 38 exercises sitting in the production
  database with no route able to reach them. Every success criterion passed and every Progress row
  was checked while the user, on the public URL, saw nothing new.
- **Rule**: **If a slice's outcome is something a user can see, the plan carries a phase that
  deploys it and verifies it on the deployed URL.** Not a bullet inside another phase — a phase,
  with its own success criteria. The check that matters is a request against the public address,
  because a green gate and a green CI run are both blind to this.
- **Applies to**: every `/10x-plan` for a slice with a page, a route, or a user-visible change.
  Foundations that only touch schema or tooling are exempt — their outcome is not on a screen.

## A guard you have not mutated may not guard

- **Context**: `src/types.ts` type assertion added during F-03's review; three integration
  assertions written during S-02 Phase 1.
- **Problem**: Two separate instances of the same failure. F-03's first type assertion resolved to
  `never`, which is an unused declaration rather than an error, and silently passed the mutation it
  was written to catch. S-02's assertions 3/6/7 were guarded with `if (!seededId) return;` and
  reported green while asserting nothing, because the seed they needed did not exist yet.
- **Rule**: **After writing a guard, break the thing it guards and confirm it fails.** A test that
  cannot be made to fail is not coverage — it is decoration that reads as coverage, which is worse
  than an obvious gap. An empty test is worse than a missing one.
- **Applies to**: type-level assertions, integration assertions with setup preconditions, and any
  test whose body is reachable only under a runtime condition.

## When a mutation does not break anything, fix the claim — never the test

- **Context**: `supabase/migrations/20260811143000_derive_personal_records_from_surviving_sets.sql`
  and `tests/integration/personal-records.test.ts`. Found during S-04 Phase 1's mutation protocol on
  2026-08-11.
- **Problem**: both new views were marked `security_invoker = true`, and the migration's comment
  claimed the suite would fail if **either** were unmarked. Mutating them one at a time showed that
  only the inner view's flag is load-bearing: every row the outer view emits is drawn through the
  inner one, whose own flag hands the permission decision back to the real caller. The outer flag
  protects nothing today, and no assertion writable from the integration suite could catch its
  removal. The comment was describing coverage that did not exist.
- **Rule**: **a mutation that breaks nothing is a finding, not a nuisance.** It means either the
  guard is unnecessary or the claim about it is false — and the response is to say which, in the
  place the claim lives. Do not delete the guard to make the docs true (defence in depth is cheap,
  and the edit that makes it matter is usually one somebody will plausibly make). Do not restructure
  the code so the mutation bites, if that costs more than the guard is worth. And never write an
  assertion that merely appears to cover it. Name the untested guarantee explicitly, and name the
  future edit that would make it load-bearing, so the next reader gets a tripwire instead of false
  confidence.
- **Applies to**: every mutation-testing step, and any comment that asserts "test X fails if Y
  changes" — that sentence is itself a claim, and it is checkable.

## Verify with a script that attacks, not by asking the owner to read code

- **Context**: S-02 Phase 1 manual verification asked the owner to judge whether the migration's
  comments made the nullable-`user_id` convention obvious. The owner replied "I don't understand any
  of it".
- **Problem**: The question required reading Postgres RLS policies. It was the wrong task for the
  reader — and the reader is not the deficiency, the question was. Manual criteria that ask a
  non-specialist to assess code quality produce either a rubber stamp or confusion.
- **Rule**: **When a manual criterion is about whether a guarantee holds, replace it with a script
  that tries to break the guarantee and prints the raw responses.** For S-02 that was eight attempts
  to cross the access boundary — write to the shared catalogue, read another account's row, connect
  without signing in — each showing what the database answered. Stronger evidence than a code review
  and it needs no SQL. Reserve genuinely manual checks for what only a human can observe: whether a
  screen is usable, whether an email arrives, whether a link leads somewhere real.
- **Applies to**: every `#### Manual Verification` block. If the item can be demonstrated by a
  script, it belongs in the automated list with a script that demonstrates it.

## A criterion that demands a unit test must name the module that will hold it

- **Context**: `src/lib/services/set-display.ts`, created during S-03 Phase 4 and named nowhere in
  the plan. Found during /10x-impl-review on 2026-08-11 (finding F4).
- **Problem**: Phase 4 stated the "which weight column feeds the estimate" rule in prose that read
  as though it lived inside the `WorkoutDetail` island, and separately required a unit test covering
  both of its branches (criterion 4.6). Those two instructions contradict each other: the unit suite
  is hermetic and renders no components, so a rule living in an island is a rule that criterion
  cannot reach. The implementer had to invent a module mid-phase to make the criterion satisfiable.
  It worked — but the plan's file list and the plan's success criteria disagreed, and only one of
  the two was checkable.
- **Rule**: **When a success criterion says "a unit test covers X", the plan must name the module
  that will export X.** If no module can be named, X is not unit-testable as designed and the
  criterion describes a test that cannot be written. Prose describing a rule is not a location
  for it.
- **Applies to**: every `/10x-plan` phase whose Success Criteria mention unit tests — especially
  rules that read as belonging to a UI component, because components are where untestable logic
  accumulates.
