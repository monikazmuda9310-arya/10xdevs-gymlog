# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame,
> /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.
>
> **Planning anything that creates a table or a view: read
> `context/foundation/access-control.md` first.** It holds the four RLS shapes and the reason each
> line of them is there. It is not auto-loaded and `AGENTS.md` only summarises it, so this pointer
> is where a planning skill meets it. The pointer lives in the header rather than in an entry
> because it is not a lesson — it is a reading instruction, and the register below stays
> append-only.

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

## Under RLS, a write that touches nothing SUCCEEDS — so "it failed" has to be built

- **Context**: `src/lib/services/workouts.ts` and the six routes under
  `src/pages/api/{sets,workouts,exercise-entries}/[id]/`, added during S-05. Confirmed by mutation
  (b) of Phase 2's protocol on 2026-08-12: making `DELETE` answer `204` on zero rows fails the
  suite's `404` assertion.
- **Problem**: Row-level security **filters**, it does not raise. An `update` or a `delete` naming
  another account's row matches zero rows and reports success, indistinguishable at the client from
  a write that worked. Answering `204` there tells one account it just deleted another's data — a
  lie, and an existence oracle in the same breath. Nothing about the query looks wrong, and the
  policy is doing exactly its job.
- **Rule**: **every mutation `.select()`s what it touched, and a zero-row result becomes a `404`
  carrying the same message code as "absent".** The read-back is not decoration: it is the only
  thing that can tell the two cases apart. Pair it with an integration assertion that checks the
  **status code**, not just the persisted state — "the row survived" and "the caller was told it
  did not" are two different defects and only the second one lies.
- **Applies to**: every `update`/`delete` path added to an RLS-protected table, in this repository
  and in any other. It is the mutation-side twin of the read-side rule that a policy filter and an
  application filter are different things.

## A query shape that is exact for one row can be wrong for a set of them

- **Context**: `topTwoEstimatesForExercise` in `src/lib/services/records.ts`. S-04 handed S-05 the
  note "the query behind the warning already exists — nothing to add to the data layer"; planning
  S-05 found that was true for one of the four operations.
- **Problem**: "the record falls to the runner-up" is exact when **one** set disappears, because
  exactly one row leaves the ranking. Removing an exercise entry takes every set of that exercise in
  that workout, and deleting a workout can take the leader **and** the runner-up together — after
  which the record falls to the third-best, which a two-row query cannot see. The handover note was
  not wrong about the query; it was wrong about the scope, and the two read identically. Separately,
  the same query covered only one of the product's two records, so it was silent on a real fall.
- **Rule**: **before reusing a ranking query at a new scope, ask how many rows the new operation
  removes, and whether the answer is still bounded by the query's `limit`.** Where it is not, the
  shape that generalises is "the best surviving candidate, **excluding** what is about to disappear"
  — an exclusion filter plus `limit(1)`, which costs the same and is exact at every level. And when
  a product keeps two rankings, a warning built on one of them is silent by construction, not by
  accident.
- **Applies to**: any reuse of a `limit(n)` ranking at a wider scope than it was written for, and
  any handover note that says "the query you need already exists".

## Write the threshold into the plan BEFORE taking the measurement

- **Context**: S-05 Phase 3's dialog primitive. The plan named the shadcn `alert-dialog` and, in the
  same paragraph, a fallback and a number: "if `WorkoutDetail`'s built island grows by more than
  ~15 KB, fall back to the native `<dialog>`".
- **Problem**: the component was installed and measured, and it took the island from 10 689 B to
  50 720 B — **+40 KB**, plus a new 5 194 B chunk, on a `client:load` island in a product whose NFR
  is a 2 s p95 on mobile. With no number agreed in advance, that measurement is a debate: the
  component is the house convention, it is already half-installed, and "40 KB" sounds tolerable
  right up until somebody has to defend it. With the number written first, it was arithmetic. The
  native `<dialog>` shipped at +5 397 B and gives focus containment, Escape, an inert background and
  focus restoration from the platform rather than from a package.
- **Rule**: **when a plan says "use X unless it is too expensive", the plan must state what "too
  expensive" is, in a unit that can be measured, before anything is installed.** A threshold decided
  after the measurement is not a threshold. State the measurement in Progress either way — including
  when the default wins — so the next reader knows the question was actually asked.
- **Applies to**: any dependency added to a hydrated island or other size-sensitive boundary, and
  more generally to any plan step phrased as a conditional preference.

## "A user cannot do X yet" is not "X is untested" — read the suite before planning around the gap

- **Context**: S-06's first plan draft, caught by `/10x-plan-review` on 2026-08-12 (finding F1).
- **Problem**: the plan's headline risk was the `s.reps::numeric / 30` cast inside `set_estimates` —
  the one that makes Epley degenerate to `estimate = weight` under integer division. The plan
  reasoned: this defect only shows for an account that switches formula, nobody can switch formula
  yet, therefore it is untested, therefore the slice's largest phase should be built around proving
  it. Every step of that follows except the third. `tests/integration/personal-records.test.ts` had
  been toggling `estimation_formula` since S-04 — `setFormula` at `:212`, assertions 4 and 4b — so
  dropping the cast already failed the gate on every push. **An entire phase was designed to cover
  something already covered**, and it survived until a reader who had not written the plan checked
  the suite.
- **Rule**: **"the user cannot reach this yet" describes the UI, not the test suite.** Before
  planning work around an untested behaviour, open the suite and look for it — grep the column name,
  the function name, the constant. Tests reach past the UI routinely: an integration check can write
  a column no screen exposes. The two claims feel identical when writing a plan and are not, and the
  false one costs a phase.
- **Applies to**: every `/10x-plan` that justifies a phase with "nothing covers this today", and
  every plan review — verifying that claim is cheap and it is where the largest phases hide.

## A mutation that fails for the WRONG REASON has not confirmed the guard

- **Context**: S-06 Phase 1's mutation (b), 2026-08-13. The criterion read "resolving the row from
  anything other than `locals.user.id` fails the fabricated-id assertion".
- **Problem**: the obvious mutation — delete `.eq("id", userId)` from `updateProfile` — made the
  suite go red, and stopping there would have recorded the guard as confirmed. It was not. PostgREST
  **refuses an `UPDATE` carrying no filter at all**, so the endpoint answered `500` and the assertion
  failed on a status code it never intended to test. The claim being checked was "the handler writes
  only the row named by `locals.user.id`", and a malformed query says nothing about it. Sharpened to
  "resolve the row from `supabase.auth.getUser()` instead", the mutation failed **correctly**:
  `200` where the suite wanted `404`, and the fabricated call's payload written onto a real account.
- **Rule**: **when a mutation goes red, read the failure and check it is the failure the criterion
  describes.** A guard is confirmed by the assertion failing _for its own reason_ — the wrong value,
  the wrong row, the wrong status — not merely by the suite turning red. Red for an unrelated reason
  is the mutation-testing twin of a test that cannot fail: it reads as evidence and is not.
- **Applies to**: every mutation step. It is cheap to check and it is the only thing separating
  "I broke the guard" from "I broke the query".

## A manual criterion whose outcome depends on the hour it runs is a badly written criterion

- **Context**: S-06 criterion 3.10 and § Manual Testing Steps step 6 — "switch the timezone to
  something far away, start a new workout, and confirm the default date follows". Run by the owner on
  2026-08-13 at 10:26 Warsaw time; it appeared to fail.
- **Problem**: the instruction named `Pacific/Kiritimati`, which is UTC+14 — as far away as a zone
  gets. At 08:26 UTC that reads 22:26 on the **same calendar date** as Warsaw, so the default date
  did not move and the product looked broken. Exactly **9 of the 418 zones** were on a different date
  at that hour; by late evening in Warsaw almost all of them would have been. **"Far away" is not the
  property being tested** — "currently on a different calendar date" is, and the two coincide often
  enough that the wrong one reads as correct while the plan is being written.
- **Rule**: **state a manual criterion in terms of the property it tests, and give the reader a way
  to establish that property at the moment they run it.** Where the property is time-dependent, the
  step carries the one-liner that computes it rather than a fixed example. And prefer to pin the
  hour-independent half in an automated check: here `preferences-derive.test.ts` assertion 3 asserts
  the invariant — a 25-hour swing moves no `performed_on` — which holds at every hour, while only the
  "the default follows" half genuinely needs a human.
- **Applies to**: every `#### Manual Verification` item involving dates, times, zones, expiry or
  anything else whose observable value depends on when the check is performed.

## An assertion you keep because it cannot fail YET must say so in the same words you'd use to refuse one

- **Context**: `tests/integration/preferences-derive.test.ts`, S-06. Found by implementation review
  on 2026-08-13 (F7).
- **Problem**: the file contains two assertions in identical epistemic positions and presents them
  as opposites. At `:309` it **declines** to assert that changing the unit leaves record holders
  unchanged, with a comment naming `weight_kg` as the reason no path exists and citing the rule
  below about decoration that reads as coverage. Twenty lines earlier, assertion 3 asserts that a
  25-hour timezone swing moves no `performed_on` — which also cannot fail today, for exactly the
  same kind of reason: `profiles.timezone` has no path to a `date` column the user stated. Both
  calls are defensible. Keeping assertion 3 is right, because a plausible future edit (a
  Monday–Sunday week view that converts dates through the profile zone) would make it bite. But the
  file argues carefully for one and says nothing for the other, so a reader learns the wrong lesson
  from whichever they read second.
- **Rule**: **when you keep an assertion that cannot currently fail, write the same paragraph you
  would write to refuse it** — name the guarantee, say plainly that no mutation available today
  breaks it, and name the specific future edit that would. That paragraph is the difference between
  a tripwire and decoration, and it is the only thing distinguishing them, because the code looks
  identical. Deciding differently in two similar places is fine; deciding differently _silently_ is
  what leaves the next reader guessing which one was the accident.
- **Applies to**: any suite where some assertions are guards and others are tripwires — and to every
  pair of similar decisions inside one file, where an unexplained asymmetry reads as an oversight.

## A `finally` that restores shared state does not survive a killed process — let each consumer establish its own preconditions

- **Context**: `tests/integration/preferences-derive.test.ts` and `profile-mutations-rls.test.ts`
  flip `weight_unit` and `estimation_formula` on `rls-owner-a`, an account `workout-endpoints.test.ts`
  and `personal-records.test.ts` also read. Found by implementation review on 2026-08-13 (F8).
- **Problem**: the discipline was followed exactly — reset in `beforeAll`, run-unique values,
  restore in `finally`, plus a closing tripwire assertion in each suite — and it still has a hole,
  because `finally` is application-level. A **process kill** (Ctrl-C, a cancelled CI job, an OOM)
  between the flip and the restore skips it, and so does a network failure inside the restore's own
  write. The closing tripwire never runs either, so the damage does not surface where it was caused:
  it surfaces on the _next_ run, in `workout-endpoints.test.ts`, which asserts a new set is stamped
  `"kg"` and does not reset preferences itself. That is precisely the "a suite failing for reasons
  unrelated to the code under test" outcome the discipline exists to prevent — the prevention was
  one run short, and both suites' comments claimed otherwise.
- **Rule**: **teardown protects the happy path; only setup protects the next run.** Where suites
  share mutable fixture state, every suite that DEPENDS on a value must establish it in its own
  `beforeAll` rather than trusting the suite that changes it to put it back. Keep the `finally` — it
  is what keeps an ordinary failure from leaking — but do not let it carry the whole guarantee, and
  do not write a comment saying it does.
- **Applies to**: every shared-fixture integration suite, and more generally to any cleanup-based
  guarantee where the cleanup can be skipped by something outside the program's control.

## A handover that passes two decisions in one sentence is inherited as one decision

- **Context**: `context/archive/2026-08-11-edit-and-delete-log/plan.md:123-126`, written by S-05 and
  read by S-07's planning on 2026-08-13.
- **Problem**: one sentence handed the next slice **two different open questions** — FR-006's
  warning-on-a-date-change and PRD Open Question 2's warning-on-a-muscle-group-change. They have
  different subjects, different consequences and, as the roadmap already recorded in three places,
  different owners: the second belongs to S-08, because a muscle-group correction moves tonnage
  **between** per-group buckets and cannot change the weekly total at all. `STATE.md` copied the
  merged version, and the next slice's own `change.md` copied it from there. It took a fresh reader
  and a second document to separate them again — and by then the merged claim had been repeated in
  three places and had budgeted a phase for a question that could not arise.
- **Rule**: **a handover names one decision per sentence, with its owner and the reason it is
  theirs.** Where two open questions touch the same feature, say what makes them different in the
  same breath as handing them over — otherwise the difference is the first thing lost, and what
  survives is the shorter, wronger version. And when you inherit one, check it against the roadmap
  and the schema before planning around it: an inherited claim about SCOPE is exactly as checkable as
  an inherited claim about coverage, and this project has now been wrong about both.
- **Applies to**: every `## Phase 5` document contract, every "what X left Y" section in a handoff,
  and every plan that opens by restating what it inherited.

## A test whose title claims more than its body asserts becomes the citation

- **Context**: assertion 9 of `tests/integration/record-impact.test.ts`, titled "moving a session
  across a Monday changes its week and leaves every record alone". Found during S-07 planning.
- **Problem**: the body asserts that `getUTCDay()` of two hardcoded constants is 0 and 1 — a fact
  about JavaScript, not about the product — that `performed_on` propagates through a view, and that
  the record is unchanged. It computes no week, sums no tonnage and never varies the timezone.
  "Changes its week" is arithmetic the reader does in their head from two date literals. The title
  was then cited as proof of week-boundary behaviour in three separate documents, and on that basis
  a real acceptance criterion (US-03's "moving a workout recomputes both affected weeks") was
  recorded as covered while nothing in the repository could even answer which week a workout was in.
- **Rule**: **a test title is a claim, and it will be quoted by people who do not open the file.**
  Title the assertion after what the body actually checks, and when the setup implies more than the
  assertions verify, say so in a comment inside the test. The failure is not the missing coverage —
  gaps are normal and cheap to fill — it is that the gap became invisible, because every later reader
  found a green test with the right name.
- **Applies to**: every test whose name contains a domain claim, and to any document citing a test as
  evidence — cite the assertion, not the title.

## Under `security_invoker`, a JOIN is a FILTER — an inner join to an RLS-protected table deletes rows from an aggregate and reports success

- **Context**: `public.daily_exercise_tonnage`, S-08 Phase 1, 2026-08-14. The view breaks a week's
  tonnage down per muscle group, which lives on `public.exercises` and is reachable only by joining.
- **Problem**: a view marked `security_invoker = true` executes with the READER's permissions, so
  **every relation it touches is filtered by that relation's policy** — including the one being
  joined for a single descriptive column. `exercises` admits a row only when it is seeded or owned,
  and `exercise_entries.exercise_id` is a single-column foreign key that is **not** ownership-scoped;
  foreign-key checks bypass RLS, so a row can exist in which account A's entry points at account B's
  private exercise. An **inner** join would then drop that set's kilograms from **A's own** breakdown
  while the coarser view still counted them. No error, no warning, both figures plausible — and the
  only symptom is that two numbers on the same screen stop agreeing. The join reads as a lookup and
  behaves as a `where`.
- **Rule**: **`left join` to any RLS-protected table inside a `security_invoker` view, and put a
  reconciliation guard at read time.** Losing a descriptive column is an inconvenience the screen can
  name ("Unattributed"); losing the row's numbers is a wrong total. Then **construct the hazard row
  in the suite rather than describing it** — an account's entry naming another account's private
  row — and assert both that the tonnage survives and that the two aggregates still agree, in that
  assertion's **own** fixture window, so an access defect and an arithmetic defect stay
  distinguishable. Measured under mutation: `expected 500 to be close to 680`, short by exactly the
  hazard set's tonnage.
- **Applies to**: every view joining a table that carries a select policy — not only aggregates — and
  every figure claimed to reconcile with another figure derived by a different query. Two numbers
  that must agree need a test that computes both from one fixture; "they are derived from the same
  rows" is not the same claim once a policy sits between them.

## A guard can be inert because of the ENVIRONMENT it runs in, not because of what it asserts

- **Context**: `src/lib/services/calendar.ts` and `vitest.config.ts`, S-07 Phase 1, 2026-08-13.
- **Problem**: two mutations from the plan's own protocol were expected to break the week-boundary
  suite and **neither did**. Not because the assertions were weak — they were fine — but because the
  ambient timezone of the test process decided whether the defect was observable at all. Subtracting
  milliseconds is exact when the value is anchored at `T00:00:00Z`, because UTC has no daylight
  saving; `getDay()` and `getUTCDay()` differ only where the ambient offset is negative. CI runners
  are UTC, so both guards were decoration **in the gate**, which is the only place they matter. Worse,
  the first fix chosen — pinning `TZ` to `Europe/Warsaw`, the product's own default and the owner's
  zone — read as principled and silently left the second mutation inert, because Warsaw's offset is
  positive. Only a zone with **both** properties (DST and a negative offset) exercises both.
- **Rule**: **when a guard's subject is environment-dependent, pin the environment in the config and
  say which property of it is load-bearing.** Then re-run every mutation under the pin: a mutation
  that passed before the pin and fails after it was never testing what you thought. Beware the
  "principled" choice of environment — matching production sounds right and often exercises fewer
  paths than a deliberately hostile one, because the value under test is usually supposed to be
  environment-independent.
- **Applies to**: timezones, locales, filesystem case-sensitivity, line endings, and any other
  ambient setting that differs between a developer's machine and CI.

## Measurement record — the evidence behind the rules in `AGENTS.md`

> **These entries are not rules and must not be read as ones.** They are the measurements and
> incidents that made the rules in `AGENTS.md` believable, moved here on 2026-08-14 so that file
> could hold rules alone (it is auto-loaded every session; this one is not). Each entry names the
> rule it backs. **The rule is the thing to follow — read these when you need to know how it was
> proven, or before planning work that would change it.** Nothing here was edited in substance;
> nothing here is a new decision.

### Tonnage: what removing `greatest(weight_kg, 0)` costs

- **Backs**: `AGENTS.md` § Domain rules → "Zero-weight sets contribute reps but no tonnage".
- **Measured**: under the S-07 mutation protocol, dropping `greatest` made an assisted set subtract
  rather than contribute zero, at **−160 kg** over the fixture window. S-08's protocol reproduced
  the same figure against `daily_exercise_tonnage`.

### The conversion constant has been miscounted twice, in the same direction

- **Backs**: `AGENTS.md` § Domain rules → the `0.45359237` bullet, and its instruction to say "two
  in production" rather than a bare count.
- **Incident**: the sentence stating how many copies of `0.45359237` exist has been "corrected" to
  three, and later to four, by readers who grepped the literal and counted the hits. **Both
  corrections were wrong**: `preferences-derive`, `weekly-tonnage` and `workout-mutations-rls`
  restate the constant on purpose, because each checks the generated column from OUTSIDE and sharing
  the production constant would make the check circular. A bare count invites exactly this edit,
  which is why the rule names the category rather than the number alone.

### The graft is real: a plain foreign key let account B attach a row to account A's workout

- **Backs**: `context/foundation/access-control.md` § the nested-ownership variant.
- **Measured**: replacing the composite key with a plain `references workouts (id)` in
  `gymlog-test`, account B inserted an `exercise_entries` row carrying its **own** `user_id` and
  account A's `workout_id`. The insert passed the policy — which never looks at the parent — and
  **the row persisted**. Restoring the composite key then failed, because the orphan violated it;
  the row had to be deleted by hand before the migration would apply.
- **Why it matters to a planner**: the four-policy template reads as complete and is a defect at
  depth 2. The tripwire that would notice the key being "simplified" away is assertion 4 of
  `tests/integration/workout-log-rls.test.ts`.

### `security_invoker`: which of the four flags leak, measured one at a time

- **Backs**: `context/foundation/access-control.md` § the derived-view variant ("three flags are guards and
  one is a tripwire").
- **Measured**, each by removing the flag from one view alone:
  - `set_estimates` — leaks immediately; assertion 2 of `tests/integration/personal-records.test.ts`
    fails.
  - `daily_tonnage` — with the flag off, account B read **ten rows of account A's tonnage**;
    assertion 7 of `tests/integration/weekly-tonnage.test.ts` fails.
  - `daily_exercise_tonnage` — with the flag off, account B received A's row **verbatim, exercise
    name and muscle group included**; assertion 7 of `tests/integration/tonnage-breakdown.test.ts`
    fails.
  - `personal_records` — **nothing observable changes**, because every row it emits is drawn through
    `set_estimates`, whose own flag hands the permission decision back to the real caller partway
    down the chain. No assertion writable from the integration suite can catch it: `authenticated`
    has no `pg_class` access through PostgREST. See also "When a mutation does not break anything,
    fix the claim — never the test" above.

### The application filter is the index path on `sets` and load-bearing on `profiles`

- **Backs**: `AGENTS.md` § Access control → "A zero-row UPDATE or DELETE is a SUCCESS", the bullet
  refusing "the application filter is only the index path" as a general claim.
- **Measured on `sets`**: dropping `.eq("user_id", …)` from `deleteSet` breaks **nothing**. The
  DELETE policy's own predicate is `(select auth.uid()) = user_id` — read from `pg_policies` rather
  than believed — so the policy alone matches zero rows for account B. No assertion writable from
  `workout-mutations-rls.test.ts` can catch the removal. The edit that would make it load-bearing is
  RLS being disabled on `sets`, which `workout-log-rls.test.ts` covers from the other side. Named
  rather than papered over.
- **Measured on `profiles`**: removing `.eq("id", userId)` from `updateProfile` does **not** quietly
  widen the update — it fails outright with a `500`, because PostgREST refuses an `UPDATE` carrying
  no filter at all. The two cases look identical in the code and are not. This is also the origin of
  "A mutation that fails for the WRONG REASON has not confirmed the guard" above.

### Two island-size measurements that decided a shape

- **Backs**: `AGENTS.md` § Architecture → `src/lib/validation/auth.ts` "imports nothing", and
  § Conventions → "A large collection is rendered by Astro and slotted into an island".
- **Measured**: moving the zod schemas into `auth.ts` costs **~59 KB** in the browser bundle, because
  both auth forms are `client:load` islands and everything reachable from that module ships with
  them. Separately, passing S-06's 418-entry timezone list as an island prop would have serialised
  **~7 KB** of zone names into the `<astro-island props="…">` attribute, to be parsed at hydration,
  for a `<select>` that needs no JavaScript at all.
- **Why the guard is a render check**: server-rendered HTML does not live in `dist/client/`, so a
  bundle check cannot see the island-prop mistake at all. `tests/render/settings-island.test.ts` is
  the only thing that would.

### A full-replacement PATCH cleared the column its own suite cleaned up by

- **Backs**: `AGENTS.md` § Testing → "Never mutate the column your own cleanup keys on".
- **Incident**: S-07's moved-workout assertion PATCHed `note: null`. `updateWorkoutSchema` is a full
  replacement, so the write cleared the very `note` column `beforeAll` deletes fixtures by. The moved
  row survived every later teardown and **poisoned its date window permanently**; the orphan had to
  be deleted by hand. The fix is to re-send the mark instead of clearing it, and to prove the suite
  repeatable by running it twice.

### `site_url` shipped wrong and no test could see it

- **Backs**: `AGENTS.md` § Environment → "`site_url` is the trap that no test can see".
- **Incident**: the value shipped as `http://localhost:3000` — a Next.js port inherited from the
  starter template, which `astro dev` does not even use — and stayed wrong until a human clicked a
  real confirmation link during S-01. The failure is silent in exactly the worst way: the account is
  confirmed correctly, the database looks right, every test passes, and the user sees "site
  unreachable" and concludes the signup failed. It lives in Supabase project config, not in this
  repository, so nothing in the gate can reach it.

### Two runtime facts measured in workerd rather than assumed

- **Backs**: `AGENTS.md` § Known state → the timezone bullet, and § Testing → "do not assert anything
  runtime-specific" in the render config.
- **Measured through `astro dev`**, which runs the real workerd runtime:
  `Intl.supportedValuesOf("timeZone")` **is** available and answers **418 zones** — `hasWarsaw` and
  `hasKiritimati` both true, **6825 bytes** of joined names. Whether workerd has full ICU is exactly
  the kind of question the render suite cannot answer, because `configFile: false` drops the
  Cloudflare adapter.

### The three enum assertions were mutated to confirm they fail

- **Backs**: `AGENTS.md` § Known state → "Three enums … pinned in both directions".
- **Measured**: `MUSCLE_GROUPS` already had its `Assert<MutuallyAssignable<…>>`; S-06 added
  `WEIGHT_UNITS` and `ESTIMATION_FORMULAS` beside it and mutated **both** to confirm the build
  breaks — `ts(2344) Type 'false' does not satisfy the constraint 'true'`. This is the same discipline
  as "A guard you have not mutated may not guard" above, applied at the type level, where F-03's
  first attempt had resolved to `never` and silently passed.
