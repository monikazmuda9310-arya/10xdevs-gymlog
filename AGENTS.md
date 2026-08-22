# AGENTS.md — GymLog

Guidance for AI agents working in this repository. Source of truth; `CLAUDE.md` points here.

GymLog is a training log: the user records workouts (date, exercises, sets of reps × weight) and
the app derives estimated one-rep max, weekly tonnage, and personal records. Product contract:
`context/foundation/prd.md`.

**This file holds rules. The measurements and incidents that produced them live in
`context/foundation/lessons.md`** — read that when you need to know how a rule was proven, or before
planning work that would change one. Every rule here that a test defends names the test file and the
assertion number; those pointers are load-bearing and move with the rule.

## Domain rules that are easy to get wrong

These are not style preferences. Getting any of them wrong produces a number the user will
believe and that will be false. **Every one of them has a unit test; do not change behaviour here
without changing the test and saying so.**

- **1RM estimates are valid for 1–12 repetitions only.** Outside that range, show no estimate —
  never a fabricated one — and exclude the set from record detection. Brzycki (`w × 36 / (37 − r)`)
  divides by zero at 37 reps and goes negative beyond.
- **At exactly 1 repetition the estimate equals the weight lifted.** Brzycki yields this naturally;
  Epley (`w × (1 + r/30)`) returns `1.033 × w`, so Epley must be pinned at `r == 1`.
- **The 1RM formula has exactly TWO implementations and they must agree**: `estimateOneRepMax` in
  `src/lib/services/one-rep-max.ts`, and the `case` expression inside `public.set_estimates`
  (`20260811143000_derive_personal_records_from_surviving_sets.sql`). The SQL copy exists because the
  records list walks every set the account has ever logged, which cannot run in the Worker under the
  10 ms CPU cap. Same hazard as `0.45359237` below and **weaker**, because a constant can be grepped
  and a `case` expression cannot: assertion 4 of `tests/integration/personal-records.test.ts` is the
  only thing that would notice them drifting apart. Do not delete it as redundant.
  - **In SQL, `reps::numeric / 30` needs the cast.** `reps` is `smallint`, so `reps / 30` is integer
    division and evaluates to `0` across the entire 1–12 range — Epley silently degenerates to
    `estimate = weight`, with plausible numbers and a green pipeline. Brzycki is safe only by
    accident, which is worse: the defect surfaces only for accounts that switch formula.
  - **The two formulas cross at exactly 10 repetitions** (`36/27` and `1 + 10/30` are both `4/3`), so
    a set of ten proves nothing about the formula toggle — and is the first thing to suspect when
    somebody reports that switching does nothing.
  - **The view reads the formula PER ROW, from the joined profile** —
    `coalesce(p.estimation_formula, 'brzycki')` in `set_estimates`. Nothing anywhere reads a
    hardcoded formula, which is why the column became user-settable with no migration at all.
    **A formula change is a re-derivation, never a data migration.** Anyone who "optimises" this by
    storing an estimate turns it back into one.
  - **A formula switch can change WHICH SET HOLDS a record, not merely the number on it**, because
    the formulas rank differently either side of ten repetitions: with `100 kg × 5` and `82 kg × 12`
    logged, Brzycki puts the twelve-rep set first and Epley the five-rep set.
    `tests/integration/preferences-derive.test.ts` assertion 1 pins this, deciding by
    **`best_estimate_set_id`** rather than by comparing numbers across the SQL/TS boundary. Value
    parity for both formulas is a different claim: `personal-records.test.ts` assertions 4 and 4b.
- **Records are derived, never stored as trophies.** A record is always the best _surviving_ set,
  recomputed when the underlying sets change — so it may go _down_ after an edit or delete, and the
  user is warned by how much before confirming. Never write a record row that can outlive the set
  that justifies it. Two views derive them (`public.set_estimates`, `public.personal_records`) and
  **nothing is stored**; see the derived-view variant in `context/foundation/access-control.md`.
  - **The two records have different exclusion rules, deliberately** (owner, 2026-08-10). The
    estimate record takes sets of 1–12 repetitions with `weight_kg > 0`; the heaviest-weight record
    takes **every** set with `weight_kg > 0`, at any repetition count, because "heaviest ever
    handled" is a fact about the load rather than an estimate. US-02's "sets outside the range never
    trigger a record" governs the save-time **announcement**, of which there is exactly one, on the
    estimate record.
  - **A warning about a falling record must cover BOTH rankings, and this is the trap.** The estimate
    ranking alone is silent on the common case: with `100 kg × 1` (estimate 100) and `90 kg × 10`
    (estimate 120) logged, the heaviest record belongs to the first set and the estimate record to the
    second, so deleting the `100 kg × 1` drops a real record while the estimate ranking correctly
    reports "this set is not the leader". Two rankings, two queries — `bestSurvivingEstimate` and
    `bestSurvivingHeaviest` in `src/lib/services/records.ts`.
  - **"The runner-up" is only the right answer for removing ONE set.** `topTwoEstimatesForExercise`
    is exact there because exactly one row disappears; removing an exercise entry or a whole workout
    can take the leader **and** the runner-up together, after which the record falls to a third-best
    a two-row query cannot see. The shape that answers all three levels is "the best surviving
    candidate, excluding what is about to disappear": one ordered query, one `.neq(…)`, `.limit(1)`.
    `set_estimates` carries `set_id`, `exercise_entry_id` and `workout_id` so one query serves all
    three.
- **A personal record is decided on estimated 1RM**, not raw weight. The heaviest absolute weight is
  tracked separately as a second, distinct record.
- **A training week is Monday–Sunday in the user's own timezone** (stored on their profile), not
  UTC. A Sunday-evening session belongs to that week.
- **Zero-weight sets contribute reps but no tonnage. Negative-weight (assisted) sets are excluded
  from 1RM and from record detection**, and contribute zero — never a negative amount — to tonnage.
  - **That is one SQL term, not two branches**: `sum(s.reps * greatest(s.weight_kg, 0))`. Removing
    `greatest` makes an assisted set subtract.
  - **That term has TWO copies IN MIGRATION FILES and they must agree** — `daily_tonnage` and
    `daily_exercise_tonnage`. **If the tonnage expression changes, both change in the same
    migration.** Third instance of the two-implementations hazard (after the 1RM `case` expression
    and `0.45359237`) and the weakest, because migration files are append-only and because
    assertion 1 of `tests/integration/tonnage-breakdown.test.ts` compares the two views' figures over
    the same window directly. **The day something replaces a view rather than adding one it stops being
    weaker** — the migration header is then reachable only from the newer file, which is why the rule
    is restated here.
  - **`weight_kg`, never `weight`.** One account can hold both units at once, so summing the number
    typed produces a figure with no unit and no meaning. Nothing but a reader would catch it:
    assertion 3 of `tests/integration/weekly-tonnage.test.ts` is that reader.
  - **A week with sets but zero tonnage is not an empty week.** A week of planks has `hasSets: true`
    and `kilograms: 0`, and the screen must say "no external load" rather than "you did not train".
    The figure cannot carry that distinction; `hasSets` does.
- **A training week is decided in TypeScript and nowhere else, and the database never learns what a
  week is.** `trainingWeeksFor` in `src/lib/services/calendar.ts` is the single definition — pinned
  at both DST transitions, the Sunday boundary, and month and year ends. `public.daily_tonnage` is
  grouped by the raw `performed_on` and receives four date strings. **Never add `date_trunc('week',
…)` to SQL**: that is a second answer to the same question.
  - **The profile timezone decides what "today" is, and nothing else.** Turning an instant into a
    calendar date needs a zone; reinterpreting a stored `performed_on` through one invents an instant
    that never existed and moves dates by a day at the edges. **No SQL in this repository may
    reference `profiles.timezone`.**
  - **Week arithmetic must not subtract milliseconds.** `Europe/Warsaw` has two DST transitions a
    year, so a week is sometimes 167 or 169 hours. `calendar.ts` works on the `getUTC*` accessors of
    a zoneless date — not "converting through UTC", because there is no zone to convert from; UTC is
    simply the frame with no DST.
  - **A zero or negative load requires the exercise's `is_bodyweight` flag** (FR-014). A plank at 0
    is honest; a squat at 0 is a typo that would silently zero out a week's tonnage. **This cannot be
    a check constraint** — the answer lives in `exercises.is_bodyweight`, a different table, and
    copying the flag onto the set would be the snapshot forbidden above. Enforced in the endpoint,
    which already loads the entry to verify ownership, and pre-checked by the form through the same
    `isWeightAllowed` in `src/lib/validation/workout.ts`. One definition, two callers.
- **Unit round-trip is exact.** A weight entered in lb and read back in lb must be the number the
  user typed. Rounding or conversion must never create or erase a record.
  - **The storage shape is what makes that true, not a precision argument.** `sets` holds `weight`
    exactly as typed, `weight_unit` as typed in, and a **generated** `weight_kg` derived from both.
    Read `weight` for anything shown back to the user; read `weight_kg` for every comparison and
    every total. **Never write `weight_kg`** — Postgres refuses a non-DEFAULT value for a generated
    column, and the generated types cannot express that, so they list it as optional on Insert.
  - **The conversion factor `0.45359237` has exactly two copies IN PRODUCTION CODE and they must
    agree**: the generated column in `20260811005248_create_workout_log_with_row_ownership.sql` and
    `KG_PER_LB` in `src/lib/services/set-display.ts`. Convert scalars through `kilogramsIn` and sets
    through `weightInUnit`, both in that module — never with a literal at a call site.
    **`preferences-derive`, `weekly-tonnage` and `workout-mutations-rls` restate the constant on
    purpose and are not copies in this sense**: each checks the generated column from OUTSIDE, so
    sharing the production constant would make the check circular. **Say "two in production" rather
    than a bare count** — a bare count invites a reader grepping the literal to "correct" it, and
    every such correction so far has been wrong.
  - **The stored unit comes from `profiles.weight_unit` on the server, never from a request body.**
    A client that could name the unit could store `100` marked as pounds while the user typed
    kilograms, and every figure derived from `weight_kg` would be wrong afterwards.
- **Every exercise has exactly one primary muscle group**, so per-group tonnage sums exactly to the
  week's total. Never invent weighted multi-group splits.
  - **Under `security_invoker`, a JOIN is a FILTER.** The group lives on `public.exercises`, whose
    select policy is `user_id is null or (select auth.uid()) = user_id`;
    `exercise_entries.exercise_id` is a **single-column** foreign key, is **not** ownership-scoped,
    and foreign-key checks bypass RLS — so a row could exist in which account A's entry points at
    account B's private exercise. An **inner** join inside `public.daily_exercise_tonnage` would drop
    that set's kilograms from **A's own** breakdown while `daily_tonnage` still counted them, with no
    error and both figures plausible. The view uses **`left join`**, and an unreadable exercise keeps
    its kilograms as an `Unattributed` row.
    - **An `authenticated` caller can no longer CREATE that row, and that changes nothing about the
      `left join`.** `20260815090000_scope_exercise_entries_to_visible_exercises.sql` refuses it on
      insert and on `update of exercise_id`, with a `security invoker` trigger whose visibility check
      **is** the `exercises` select policy (§ the access-control trigger in
      `context/foundation/access-control.md`). Assertions 1 and 2 of
      `tests/integration/account-boundary.test.ts` are what would notice it being dropped, narrowed to
      `insert`, or flipped to `security definer`. **What is NOT closed**: rows stored before
      2026-08-15, and anything acting as `postgres` or `service_role` — both bypass RLS, so the check
      admits everything on those paths.
    - **Nothing in this repository would notice the `left` being "simplified" away, and that is a
      known gap rather than an oversight.** Assertion 9 of `tests/integration/tonnage-breakdown.test.ts`
      used to construct the hazard row on purpose; `cross-account-isolation` refused that row at the
      source on 2026-08-15, so the assertion died in setup and was **retired**. Its reasoning is
      preserved at the foot of that file. The guarantee did **not** retire with it: the trigger is a
      `before` trigger and validates nothing already stored, and it binds `authenticated` only, so
      `postgres` and `service_role` are unconstrained. **Keep the `left join`.**
  - **A muscle-group correction is retroactive by construction, and it cannot move the weekly total.**
    Nothing stores the group — not `sets`, not `exercise_entries` — so changing
    `exercises.muscle_group` moves historical tonnage **between** buckets on the next read, with no
    write and nothing to invalidate, and leaves the week's total bit-identical. PRD Open Question 2,
    **resolved by the owner on 2026-08-14**; the rejected alternative was snapshotting the group onto
    the entry, which would make corrections forward-only and contradict the load-bearing absence
    `20260811005248_create_workout_log_with_row_ownership.sql:71-76` documents. **No edit path exists
    yet** — `PATCH /api/exercises/[id]` is a separate slice.
  - **A breakdown that does not reconcile is not shown at all.** `foldBreakdown`
    (`src/lib/services/tonnage-breakdown.ts`) sums its own rows and throws when they differ from the
    week total `weeklyTonnage` already produced by more than `RECONCILIATION_TOLERANCE_KG` (`0.001` —
    a float artefact, not a data allowance: `numeric` in Postgres is exact, `double` in the Worker is
    not, and the two summation orders are what differ). `/dashboard` catches that separately from the
    tonnage read, so a breakdown failure costs the breakdown and **leaves both totals on screen**.
  - **The printed column is rounded TOGETHER, not row by row** (`apportionedFigures` in
    `tonnage-display.ts`). Rounded independently, a week of `100.5 kg` split three ways prints `101`
    above and `102` below. The cost — a row can read one whole unit away from its own independently
    rounded value — was accepted by the **owner on 2026-08-14**, because adding the rows up is the
    only check the user can actually perform. Do not "fix" a row that looks one off.
  - **The groups are exactly six: `legs`, `back`, `chest`, `shoulders`, `arms`, `core`** (owner,
    2026-08-10). Do not add a seventh without asking — glutes and a biceps/triceps split were both
    considered and declined. Adding one later is cheap; merging or removing one means re-tagging
    every exercise and rewriting every historical per-group figure.
  - **A multi-joint lift is filed under the group the lifter has in mind when they programme it**,
    not under its primary anatomical mover: **deadlift → `back`** (not `legs`), pull-up → `back`,
    dip → `chest`, overhead press → `shoulders`, squat → `legs`, row → `back`, skull crusher →
    `arms`. The chart's only job is to show whether a real training week is unbalanced, and people
    plan in splits: filing the deadlift anatomically makes `back` read as neglected for someone who
    trains it on pull day. Rejected alternatives: `context/foundation/prd.md` § Open Questions #1.

## Access control is a hard guardrail

No account may reach another account's workouts, exercise entries, or sets — including by naming
an identifier directly. This is enforced in the database, not only in the UI.

- **Enable RLS on every new table in the same migration that creates it**, with granular
  per-operation, per-role policies. A table without RLS is a defect, not a follow-up.
- Tests for this must assert against **persisted state**, not just the response status code.

### The six shapes live in `context/foundation/access-control.md` — read it before writing a migration

**Creating a table, a view over one, or a function without opening that file is how this guardrail
breaks.** It carries the SQL to copy and the reason each line is there. They are not interchangeable,
and each has one thing that bites in silence. **Four are declarative; the last two are not, and they
fail in opposite directions** — the trigger enforces procedurally, so its rule is invisible in the
table definition a reader inspects first; the RPC deliberately escapes RLS, and is the only shape here
where being wrong hands out **more** than it should rather than less:

| Shape                            | Use it when                                                                                                                                                    | What bites, silently                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The table template**           | every data-bearing table                                                                                                                                       | Supabase's implicit `ALL` grant to `anon`/`authenticated` — **revoke before granting**. `UPDATE` needs both `using` and `with check`                                                                                                      |
| **The shared-catalogue variant** | some rows belong to everybody (`public.exercises`)                                                                                                             | only the **select** policy changes; the ordinary owner check is what makes seeded rows unwritable, and that protection is invisible in the policy text                                                                                    |
| **The nested-ownership variant** | the row hangs off another owned row (`exercise_entries`, `sets`)                                                                                               | **the plain template alone is a defect at depth 2** — a policy never looks at the parent. Closed by a composite foreign key, which must be the **only** key between each pair                                                             |
| **The derived-view variant**     | the read is a view (`set_estimates`, `personal_records`, `daily_tonnage`, `daily_exercise_tonnage`)                                                            | **without `security_invoker = true` a view executes as its OWNER** and hands every account's training to every account, with no error                                                                                                     |
| **The access-control trigger**   | the reference is INTO the shared catalogue, where a composite key cannot reach (`exercise_entries.exercise_id`)                                                | **`security definer` disables it while the SQL still reads correctly** — the function then runs as `postgres`, sees every row, and admits everything. It binds `authenticated` only                                                       |
| **The `security definer` RPC**   | the operation is IMPOSSIBLE under RLS by construction (`public.delete_own_account()` — `authenticated` has no `DELETE` on `auth.users` and must never get one) | the default `EXECUTE` grant on a **function** goes to **`PUBLIC`**, so a revoke naming only `anon`/`authenticated` leaves it callable by anybody. Takes **no parameters**, and a null `auth.uid()` must RAISE rather than match zero rows |

- **`(select auth.uid())`, never bare `auth.uid()`.** The subselect is evaluated once as an InitPlan
  instead of once per row. Required, not stylistic — see § Cloudflare traps.
- **The policy is the guarantee; `.eq("user_id", user.id)` in the query is the index path.** Every
  table and every view carries **both**. Without the explicit filter, a read leans on the policy
  predicate to do the filtering, which on `workouts` and `sets` is a full scan under the 10 ms CPU
  cap. (`profiles` is the one table where the unfiltered read is honest: a single-row primary-key
  lookup whose whole demonstration is that RLS returns one row.) This is not a general licence to
  drop the filter — see the next section for where it is load-bearing and where it is not.
- **Three assertions carry "do not delete it as redundant"** — `exercises-rls` assertion 4 and
  `workout-log-rls` assertion 4, both stated in that file, plus `personal-records` assertion 4 in
  § Domain rules above. Each is the only thing in the repository that would notice one specific
  "simplification". Do not treat a green suite without them as equivalent.

### A zero-row UPDATE or DELETE is a SUCCESS — turning it into a 404 is the application's job

RLS filters rows; it does not raise. An `update` or a `delete` naming **another account's** row does
not error — it matches **zero rows** and reports success, exactly like a delete that worked. A
handler that answers `204` to that has told one account it just deleted another's data: a lie and an
existence oracle in one.

- **Every mutation `.select()`s what it touched**, and the handler answers `404` when nothing came
  back. `src/lib/services/workouts.ts` returns `null` / `false` for the zero-row case and the six
  routes under `src/pages/api/{sets,workouts,exercise-entries}/[id]/` map that to the resource's own
  message code. The same code answers "absent" and "somebody else's", so neither is distinguishable.
- **`tests/integration/workout-mutations-rls.test.ts` is what makes this load-bearing** — the first
  thing here to exercise the twelve update/delete policies. Every cross-account attempt is paired
  with a **read back as the row's owner**: the failure worth catching is a caller told "nothing
  happened" while the write landed.
- **"The application filter is only the index path" is FALSE as a general claim.** On `sets`,
  dropping `.eq("user_id", …)` from `deleteSet` breaks nothing, because the DELETE policy's own
  predicate already matches zero rows for account B; no assertion writable from that suite can catch
  its removal, and the edit that would make it load-bearing is RLS being disabled on `sets`, covered
  from the other side by `workout-log-rls.test.ts`. On `profiles`, `updateProfile`'s
  `.eq("id", userId)` **is** load-bearing for a reason unrelated to RLS: PostgREST refuses an
  `UPDATE` with no filter at all, so removing it fails outright with a `500`. Both measured:
  `lessons.md`.
- **A malformed `[id]` must never reach a query.** Postgres answers `22P02` for a uuid column handed
  something that is not one, surfacing as a `500` for what is really "no such row" — and a 500 is a
  different fact about the system than a 404. `resolve()` in
  `src/pages/api/_shared/mutation-route.ts` checks `UUID_PATTERN` first, for all six routes.

## Commands

Scripts, local Supabase setup, and deploy steps: @README.md

The gate, in the order CI runs it: `npm run lint` → `npm run typecheck` → `npm test` →
`npm run test:render` → `npm run test:integration` → `npm run test:middleware` → `npm run build` →
`npm run test:e2e`. Run all **eight** before claiming a change is done — the integration check needs
network and the test project's credentials, so it is the one that fails first on a fresh clone.
`npm run typecheck` is `astro check`, covering `.astro` and `.ts` alike; `npm test` is a single
non-interactive Vitest run.

- **`test:e2e` is required locally before claiming done on anything touching pages, islands,
  `src/middleware.ts`, `src/lib/supabase.ts` or the adapter**, and required in CI on every PR. It is
  last because it consumes a build, and it is the only step that can tell a screen that renders from
  a screen that works.
- **`main` is protected and the `ci` check is REQUIRED, admins included** (since 2026-08-20). A red or
  still-running PR cannot be merged and a direct push to `main` is refused —
  `GH006 … Required status check "ci" is expected`. **`enforce_admins` is the load-bearing half**:
  this is a single-maintainer repository, so protection exempting admins exempts everyone. Before
  that date every gate here said "required" and **nothing enforced any of it**; it was found by a
  merge that `gh pr merge --auto` allowed with the check still in flight, because with no required
  checks configured there was nothing for `--auto` to wait for.
  - **It lives in repository settings, not in this repository, so nothing in the gate can see it** —
    same class as `site_url` in § Environment. Read it back with
    `gh api repos/<owner>/<repo>/branches/main/protection`; the emergency path is
    `--method DELETE` on that endpoint, merge, then re-apply.
  - **The required context string must equal the job name exactly.** A typo looks identical to
    working protection and leaves `main` permanently unmergeable, because GitHub waits for a status
    nothing emits.
  - **Protecting `main` also made every plan's Progress SHAs unreachable from `main`, and nobody
    wrote that down.** A plan's Progress rows carry the commit each step landed in, so a reader can
    `git show` it. Work now reaches `main` by **squash**, which replaces those commits with one new
    SHA — so the recorded ones survive **only while their branch does**. Measured 2026-08-21 across
    every archived plan: the ten from 2026-08-09…08-14 have **51 of 51** SHAs on `main`, because
    that work was pushed straight there; the four from 2026-08-16 onward have **0 of 22**, because
    that work went through squash-merged PRs. The split is the PR flow arriving, not a regression.
    - **So do not delete a change's feature branch after merging.** `delete_branch_on_merge` is
      `false` for exactly this reason. Deleting one turns its plan's Progress column into dead
      pointers, silently — `git show` simply stops resolving.
    - **An `archive-*` branch IS safe to delete**: it carries one folder-rename commit whose
      content is wholly on `main`, and no Progress row ever cites it. Check before assuming, the
      way `chore(archive): close testing-environment-parity` was checked: compare the SHAs the
      archived `plan.md` names against `origin/main` and against the branch you are about to drop.
    - **FIVE branches must not be deleted, and they are named here because the general rule is not
      enough.** The first four were traced on 2026-08-22, all 22 SHAs accounted for; the fifth was
      created the same day and is listed the moment its plan was archived rather than at the next
      audit:

      | Archived plan                      | SHAs | Held only by                               |
      | ---------------------------------- | ---- | ------------------------------------------ |
      | `testing-browser-layer`            | 7    | `phase-2-browser-layer-plan`               |
      | `testing-silent-failure-audit`     | 5    | `feature/testing-silent-failure-audit`     |
      | `testing-week-boundary-seam`       | 4    | `testing-week-boundary-seam`               |
      | `testing-environment-parity`       | 6    | `testing-environment-parity`               |
      | `duplicate-record-impact-sentence` | 2    | `feature/duplicate-record-impact-sentence` |

      **The list grows whenever a plan is archived, and the moment to extend it is the archive
      itself.** Waiting for an audit is how a branch spends weeks looking deletable: its PR is
      merged, its content is on `main`, and only this table says otherwise.

      **`phase-2-browser-layer-plan` is the trap in that list.** Its name says _plan_, so it reads
      like a drafting branch to throw away; it actually holds the whole of Phase 2's implementation.
      Its PR is merged, so the cheap check — _is the content on `main`?_ — answers **yes** and would
      clear it for deletion. Only the second check catches it. A guess about which branch held those
      SHAs was made before the measurement and was **wrong**.

    - **The two checks, in the order that matters.** _Is the PR merged?_ answers whether the CONTENT
      survived. _Does any `plan.md` cite a SHA reachable only from this branch?_ answers whether the
      POINTERS do. They are different questions and the first one passing is not the second one
      passing.
      - Do **not** use `git diff main <branch>` for the first check: it reports differences in both
        directions, so an old merged branch looks full of unmerged content when what it is really
        showing is everything `main` gained afterwards. Measured 2026-08-22 — it flagged four of five
        already-merged branches.

**There are FOUR Vitest projects and they cannot see each other's files** — deliberately, by include
glob: `src/**` for `npm test`, `tests/integration/**`, `tests/render/**`, `tests/middleware/**`.
Playwright is a fifth runner over `tests/e2e/**`, outside Vitest entirely. See § Testing.

**There is no local database stack and none is wanted.** Every migration and every data-touching
check runs against a hosted project through `--db-url`. There are **two**: `gymlog` is production and
is what the deployed Worker serves; `gymlog-test` is what CI and the integration check write to.

| Command                    | What it does                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run db:status`        | prints **both** migration histories, labelled — histories only, see below |
| `npm run db:parity`        | compares the two **schemas**, the seeded catalogue and the auth contract  |
| `npm run db:push`          | applies every pending migration to **both**, `gymlog-test` first          |
| `npm run db:types`         | regenerates `src/db/database.types.ts` from the **production** schema     |
| `npm run test:integration` | the RLS check against `gymlog-test`; never runs inside `npm test`         |
| `npm run test:render`      | renders pages through Astro's container and asserts on the HTML           |
| `npm run test:middleware`  | drives `onRequest` with real `gymlog-test` session cookies                |
| `npm run test:e2e`         | builds the worker, strips its credentials, serves it, drives Chromium     |
| `npm run deploy`           | build → check the Worker's secret NAMES → `wrangler deploy` → smoke       |

- **`db:status` compares HISTORIES; `db:parity` compares what they PRODUCED.** Two documented
  paths let the histories agree while the schemas do not: the dashboard SQL editor writes no
  history row, and a production push that fails after the test push succeeded gets repaired by
  hand. `db:push` now runs the comparison on **both sides** — it **warns** before (a difference
  there predates the push, and refusing would block its own repair) and **fails** after.
  - **Every Supabase-CLI route to a schema comparison needs Docker**, which this machine does not
    have: `supabase db dump --db-url` answers `failed to run docker`, the same wall `db:types`
    met. The comparison goes through the Management API's query endpoint with `read_only: true`
    — a genuine refusal (`25006`), proven with a positive control, running as
    `supabase_read_only_user` rather than `postgres`.
  - **Every aspect carries a row-count FLOOR, and that is not defensiveness.** The first draft
    sourced grants from `information_schema.role_table_grants`, which hides every grant from
    that role: it answered **zero rows on both projects and was reported as parity**. Floors come
    from documented invariants, never from today's counts. Full rules: `test-plan.md` § 6.9.
  - **The check is proven able to fail, and the proof is committed**:
    `node scripts/parity-selftest.mjs gymlog-test` mutates the test schema, asserts the named
    aspect reports the named object and nothing else moved, and reverts in a `finally`. Not in any
    gate, and must not be — the eight steps stay incapable of mutating a database.
  - **Three exit codes, and the third is the point**: agree, differ, and **could not be**
    **compared**. An unreadable project is not an agreeing one.
  - **`SUPABASE_ACCESS_TOKEN` must never reach CI.** It is account-wide and can run arbitrary SQL
    against production through the same endpoint — strictly more powerful than the database
    password CI is already refused. This is why the check is local rather than a CI job.
- **There is deliberately no single-target push.** Advancing one schema and forgetting the other is
  the only way the two drift, so forgetting is not an available mistake. If the production push fails
  after the test push succeeded, the wrapper says so by name; fix the cause and re-run `db:push`,
  which is idempotent per database.
- **The dashboard SQL editor is an emergency path only.** It does not write
  `supabase_migrations.schema_migrations`, so the next `db push` re-applies everything. Recover with
  `npx supabase migration repair --status applied <version>` **against whichever database it was used
  on**, then confirm with `npm run db:status`.
- **`supabase gen types --db-url` needs a container runtime**, which this machine does not have.
  `db:types` goes through the Management API with `--project-id`, authenticated by
  `SUPABASE_ACCESS_TOKEN`. The project ref is derived from `SUPABASE_URL`, so types cannot be
  generated from anything but production.
- `src/db/database.types.ts` is **generated and exempt from ESLint**. Never hand-edit it — not even
  to satisfy a lint rule. Change the schema and regenerate. **Every view column comes back
  `T | null`**, because Postgres cannot guarantee not-null through a view; narrow it once in the
  service that reads the view, not with assertions.
- `npx astro sync` regenerates types — run it after changing `astro.config.mjs` or any content
  schema, or type errors will be stale and misleading. Pre-commit (husky + lint-staged) runs
  `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`; a commit that
  fails lint will not land.

## Architecture

Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase auth + shadcn/ui, deployed to Cloudflare.

**Rendering**: `output: "server"` — every page is server-rendered by default. API routes must export
`const prerender = false`.

**Auth wiring** (already built by the starter — read it before adding to it). `src/lib/supabase.ts`
is the SSR client via `@supabase/ssr`, cookie-based sessions, reading `SUPABASE_URL` / `SUPABASE_KEY`
through `astro:env/server`. Endpoints are `src/pages/api/auth/{signin,signup,signout}.ts`; pages are
`src/pages/auth/{signin,signup,confirm-email}.astro`.

- **Route protection lives in `src/middleware.ts`, in both directions**, never in per-page checks.
  `PROTECTED_ROUTES` sends a request with no user to `/auth/signin`; `AUTH_ROUTES` sends a request
  that _has_ a user away from `/auth/signin` and `/auth/signup` to `/dashboard`. The middleware also
  resolves the current user onto `context.locals.user`. `/auth/confirm-email` is deliberately in
  **neither** list: with confirmation on, `signUp` returns no session, so somebody who has just
  signed up is not authenticated, and bouncing them off the page that explains what to do next would
  be actively unhelpful.
- **Every endpoint validates through the shared schema before touching Supabase, and no provider
  error text ever reaches a response.** They read `context.locals.supabase` — the client the
  middleware already built — rather than calling `createClient` a second time.
- `src/lib/validation/auth.ts` — the single definition of each credential rule
  (`MIN_PASSWORD_LENGTH`, `MAX_EMAIL_LENGTH`, `MAX_PASSWORD_LENGTH`, `isValidEmail`) **and of
  `AUTH_MESSAGES`, the catalogue of every sentence an auth screen can show**. It **imports nothing**,
  on purpose: both auth forms are `client:load` islands, so everything reachable from it ships to the
  browser.
- **A REDIRECT-SHAPED endpoint signals failure by its DESTINATION, because the status cannot.**
  `/api/auth/signout` answers `302` whether it worked or not, which is why `signout.ts` once
  discarded `signOut()`'s result and nobody noticed: a provider refusal left the cookie live, the
  route still sent the user to `/auth/signin`, and `AUTH_ROUTES` bounced them straight back to
  `/dashboard`. It now does two things on failure, and **both are needed** — it clears the jar
  through `clearSessionCookies` in `src/lib/supabase.ts`, so the sign-out is true on this device and
  the middleware has no session left to bounce; and it redirects to `?error=sign_out_failed`, so the
  caller can tell. **Two failure shapes**: `signOut()` resolves `{ error }` for an ordinary auth
  failure and **re-throws** anything that is not an `AuthError` (`src/pages/api/account/index.ts`
  handles the same pair) — a route written as `if (error)` alone handles one and lets the other
  escape as a generic HTML 500. Assertions 6 and 7 of `tests/middleware/session-lifecycle.test.ts`
  are what would notice either half being dropped. **The message is deliberately partial**: the
  refresh token survives at the provider, and the sentence says "on this device" rather than
  claiming a global sign-out.
- **The redirect carries a message CODE, never text.** `?error=sign_in_failed`, resolved by
  `messageForCode()` on the page. Passing prose through the query string turns every auth page into a
  phishing kit — `?error=Account+locked.+Call+500-123-456` rendered as a genuine system message on
  our own domain. Not XSS (React escapes it), which is why it was easy to miss. An unrecognised code
  resolves to the generic message, never to the visitor's own words.
- `src/lib/validation/auth-schemas.ts` builds the zod schemas _from_ those rules and turns `FormData`
  into a parse result carrying a code. **Server-only.** Nothing hydrated may import it.
- `src/lib/validation/auth-errors.ts` maps a Supabase `AuthError` onto one of those codes, matching
  on `error.code` rather than on its prose (the prose changes between releases; the codes are the
  contract). Every sign-in _identity_ failure collapses to `sign_in_failed`; rate limiting is reported
  honestly because Supabase throttles per IP, not per address, so it is not an account-existence
  oracle. **Validation failures are NOT routed through it** — "password is too short" is caused by
  the user and must stay specific, or the form becomes unusable.
- `src/lib/validation/auth-outcomes.ts` holds `signUpDestination()`, separate and unit-tested because
  the decision is load-bearing and one line long: **it reads `session`, never `user`.** With
  confirmation on, Supabase returns an obfuscated `user` and no session, so reading `user` sends
  unconfirmed accounts to `/dashboard`, where the middleware bounces them back — an endless loop on
  production that a green pipeline cannot see. A mutation test pins exactly that.
- **`signup.ts` branches on whether `signUp` returned a session**, which is the real outcome. Do not
  reintroduce a config flag, an env var or `import.meta.env.DEV` — all three can disagree with what
  the Supabase project is set to right now. `confirm-email.astro` is unconditional: it is reached
  only when a confirmation email is genuinely on its way.

## Conventions

- **Path alias** `@/*` → `./src/*`.
- **Astro components for static content and layout; React only where interactivity is needed.**
- **Tailwind classes**: use `cn()` from `@/lib/utils`. Never concatenate class strings by hand.
- **shadcn/ui** lives in `src/components/ui/` ("new-york" variant). Add with
  `npx shadcn@latest add [name]`.
- **API routes** export uppercase `GET` / `POST` / `PATCH` / `DELETE`; validate every input with zod.
- **A large collection is rendered by Astro and slotted into an island, never passed as a prop.**
  Astro serialises island props into an `<astro-island props="…">` attribute, so a prop is a wire,
  not a reference. `settings.astro` emits the `<option>` elements for the 418-entry timezone list and
  slots the `<select>` into `PreferencesForm`, which reads its value from the form on submit — a
  `<select>` needs no JavaScript at all. **A check against `dist/client/` cannot see this mistake**,
  because server-rendered HTML does not live there, which is why the guard is
  `tests/render/settings-island.test.ts` instead.
- **Migrations**: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- **React**: no Next.js directives (`"use client"` and friends). Hooks go in
  `src/components/hooks/`.
- **Business logic** goes in `src/lib/services/`, shared entity and DTO types in `src/types.ts`.
  Keep the 1RM / tonnage / record calculations in plain, dependency-free functions so they stay
  directly unit-testable.

## Testing

- **Unit tests are the primary defence for the domain rules above.** Cover the boundaries explicitly:
  1-rep sets, the 12-rep edge, zero and negative loads, kg↔lb round-trip, week boundaries across
  timezones.
- **Unit tests live beside the code** as `src/**/*.test.ts` (`vitest.config.ts` at the root). Import
  the subject through the `@/` alias, and import `describe` / `it` / `expect` from `"vitest"` —
  globals are off on purpose.
- **`vitest.config.ts` pins `TZ` to `America/New_York`, and both properties of that zone are
  load-bearing**: `calendar.ts`'s week boundaries are broken by local-`Date` millisecond arithmetic
  only where the ambient zone HAS daylight saving, and by `getDay()` for `getUTCDay()` only where the
  ambient offset is NEGATIVE. CI runners are UTC, so without the pin neither guard bites where it
  matters. That the pinned zone is nobody's real zone is the point: the value under test is supposed
  to be zone-independent. **The config setting overrides a `TZ` prefix on the command line**, so
  mutating either guard means editing the config. Measurement: `lessons.md`.
- **The harness deliberately does not load Astro's Vite pipeline.** Anything under test must not
  import an `astro:*` virtual module (`astro:env/server` and friends) — it will fail to resolve. That
  guardrail is what keeps the domain calculations plain and dependency-free.
- **Render checks live in `tests/render/`**, under `vitest.render.config.ts`, run by
  `npm run test:render`. The **only** suite that loads Astro's Vite pipeline, and it exists for the
  one question neither other project can ask: _what does the rendered HTML actually contain?_ It
  renders a real page through Astro's container with fake `locals` — no server, no session, no
  network — which is what makes it usable on pages behind `PROTECTED_ROUTES`.
  - **`configFile: false` in that config is not a preference.** Loading `astro.config.mjs` pulls in
    `@astrojs/cloudflare`, which brings `@cloudflare/vite-plugin` and hands Vitest's runner to
    workerd, where it dies with `ReferenceError: exports is not defined` before a test runs. The
    config restates the real one minus the adapter and the sitemap.
  - **So do not assert anything runtime-specific here.** Island prop serialisation and `<option>`
    emission are Astro core and do not vary by adapter; whether workerd has full ICU does, and was
    measured in workerd (`src/lib/services/timezones.ts`).
- **Integration checks that touch stored data live in `tests/integration/`**, under
  `vitest.integration.config.ts`, run by `npm run test:integration` — never by `npm test`, whose
  include glob is `src/**` so it cannot match them. Keep it that way: a network-dependent test inside
  `npm test` makes the whole gate flaky and untrustworthy.
  - They run against **`gymlog-test` only**, with that project's publishable key. Never a
    `service_role` key — a check that bypasses RLS proves nothing — and never a production
    credential, so the suite is _incapable_ of reaching production rather than merely disinclined.
  - **Assert against re-read rows.** Every negative assertion is paired with a read back as the row's
    owner: the failure mode worth catching is a caller told "nothing happened" while the write landed.
  - **Pick a MARK that is not a prefix of, and not prefixed by, an existing one.** `s03-` is a strict
    prefix of `s03-endpoints-` and `s03-page-`, so `workout-log-rls` deletes two other suites'
    fixtures. Benign only because `fileParallelism: false` orders them, and a live trap.
  - **Never mutate the column your own cleanup keys on.** A full-replacement PATCH that clears the
    column `beforeAll` deletes by leaves a row no later teardown can reach. Re-send the mark instead,
    and prove the suite repeatable by running it twice.
  - **A suite that filters by DATE RANGE cannot rely on a name prefix at all**, because the range does
    not care what anything is called. `weekly-tonnage.test.ts` gives every test its own pair of weeks,
    anchored in a year no other suite writes to, and passes an explicit `now` to get there.
  - **Fixture discipline**: reset the fixture rows in `beforeAll`, write run-unique values, restore in
    a `finally`. Shared rows plus an interrupted run is how a suite starts failing for reasons
    unrelated to the code, repairable only by hand-written SQL.
  - **Auth flows are covered in `tests/integration/auth-flows.test.ts`**, which creates its own
    account per run (`s01-signup-<run>@gymlog-test.dev`) rather than reusing `rls-owner-a/b` — a
    signup test must own the account it asserts about. Two of its assertions look redundant and are
    not: **"a fresh signup returns a session"** is the only automated signal that would catch email
    confirmation being switched on for the wrong project (the other outcome, production left
    unprotected, is silent); and **"an address with no account is indistinguishable from a wrong
    password"** compares the provider's `status`, `code` _and_ `message` across both cases, because
    asserting only that both fail would pass against a real account-existence oracle sitting
    underneath a neutral message.
- **Cookie / middleware checks live in `tests/middleware/`**, under `vitest.middleware.config.ts`,
  run by `npm run test:middleware`. The one question the other three cannot ask: **what identity does
  a real cookie produce?** Everything between an inbound HTTP request and `locals.user` executes
  **zero times** in the gate without it, because every integration suite hands a handler a hand-built
  `locals` whose client and user id agree by construction.
  - **Its credential guarantee has TWO parts and neither is sufficient alone.** The subtractive strip
    (`vitest.integration.config.ts`'s, copied) removes production from `process.env`; **`vite.envDir`**
    pointed at the committed, credential-free `tests/middleware/no-env/` closes the second door,
    because this project loads Astro's Vite pipeline and `loadEnv` reads `.env*` from the env
    directory as well. A load-time `readdirSync` guard throws if anything `.env*` appears there.
  - **Three cookie states, and the third is the dangerous one**: valid, cleared, and
    **invalid/forged** — dangerous because a forgery that was silently mis-built behaves exactly like
    one that was correctly refused. **Every forged cookie needs a positive control** in the same
    test: the identical reassemble/re-encode path with the original claims must still authenticate.
  - **No `LIKE` sweeps in this project.** Accounts are per-run and removed through
    `delete_own_account()` on the client that owns them. Mark: `t2c-`.
- **The browser layer lives in `tests/e2e/`**, under `playwright.config.ts`, run by
  `npm run test:e2e`. Chromium only. It answers the question no other runner can: **does a screen
  that renders also DO anything?** Every island is `client:load`.
  - **The harness is the BUILT worker under `wrangler dev`, never `astro dev`** — dev **inlines**
    whatever `.dev.vars` names (production) into `astro:env/server` and cannot be re-aimed by any
    per-process mechanism, while the build defers to the workerd env at request time.
    `scripts/e2e-build.mjs` deletes `dist/server/.dev.vars`; `scripts/e2e-serve.mjs` **asserts its
    absence before every launch** and is the only way the server starts. **The delete and the assert
    are in different processes on purpose**, so the refusal is provable rather than unfireable.
  - **A `fill()` that lands before an island hydrates is SILENTLY LOST** — the DOM takes the text,
    React's state does not, hydration restores the empty value. Measured at **one run in three**.
    Retry the fill until the island's own state reflects it, and give any assertion that proves
    something by ABSENCE a positive control, or a lost fill turns it into a vacuous pass.
  - One per-run account, mark `t2e-`, removed in `globalTeardown`. Never a shared fixture.
- **E2E locators**: `getByRole` / `getByLabel` / `getByText` first. `getByTestId` only when
  accessibility attributes are genuinely ambiguous. Never CSS selectors, XPath, or DOM structure.
- **Never `page.waitForTimeout()`.** Wait on state: `toBeVisible()`, `waitForURL()`,
  `waitForResponse()`.
- **Every test is independent**: its own setup, action, assertion, and cleanup. Use unique ids
  (timestamp suffix) so parallel runs and re-runs cannot collide.
- DOM snapshots are the default for E2E; vision is a supplement for visual-only risks. For pixel
  regression prefer deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel).

## Environment

Node version, secrets and deployment: @README.md. **Never commit a real key** — `.env` and
`.dev.vars` are gitignored and must stay that way.

`.env` carries **eight** keys. Which project each belongs to matters more than the values:

| Key                                      | Project       | Used by                                      |
| ---------------------------------------- | ------------- | -------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_KEY`           | `gymlog`      | the app, locally and deployed                |
| `SUPABASE_DB_URL`                        | `gymlog`      | `db:push` / `db:status` only                 |
| `SUPABASE_ACCESS_TOKEN`                  | account-wide  | `db:types` only                              |
| `SUPABASE_TEST_URL`, `SUPABASE_TEST_KEY` | `gymlog-test` | the integration check                        |
| `SUPABASE_TEST_DB_URL`                   | `gymlog-test` | `db:push` / `db:status` only                 |
| `GYMLOG_TEST_PASSWORD`                   | `gymlog-test` | the integration check's two fixture accounts |

- **`.env` is owner-edited.** Agent file tools are denied `Read(./.env)` in `.claude/settings.json`,
  so any step that needs a new key must be handed to the owner or it silently cannot be done.
  `.env.example` is _not_ denied and documents every key with placeholders.
- **No test-project credential and no database URL ever becomes a Worker secret.** The Worker holds
  exactly `SUPABASE_URL` and `SUPABASE_KEY`. A running application has no business holding a database
  password, and no business being able to reach the test project.
- Repository secrets are five: the production pair (build-time) plus `SUPABASE_TEST_URL`,
  `SUPABASE_TEST_KEY` and `GYMLOG_TEST_PASSWORD`. **CI never holds a production database
  credential** — migrations are applied by hand from the machine, deliberately, so no merge can
  rewrite the schema the owner trains against.
- **Supavisor caches credentials after a database password rotation.** For a few minutes the _old_
  password still works while the _new_ one is rejected (`SQLSTATE 28P01`). Both signals at once look
  exactly like "the owner did not confirm the reset" and it is not that. Poll every 60 s before
  concluding anything.

### The two projects differ on email confirmation, deliberately

**`gymlog` has Confirm email ON. `gymlog-test` has it OFF.** Making them uniform in either direction
breaks something: OFF for `gymlog` lets anybody create an account on an address they do not own (the
thing FR-001 and US-04 exist to prevent); ON for `gymlog-test` breaks `npm run test:integration`
immediately, because `signUp` stops returning a session and both suites depend on bootstrapping
accounts without an inbox. `auth-flows.test.ts`'s first assertion exists to fail loudly the moment
that happens.

Read the current state instead of trusting this paragraph — no dashboard needed:

```bash
node -e "process.loadEnvFile();const t=process.env.SUPABASE_ACCESS_TOKEN;const r=v=>new URL(process.env[v]).hostname.split('.')[0];(async()=>{for(const[l,v]of[['gymlog','SUPABASE_URL'],['gymlog-test','SUPABASE_TEST_URL']]){const c=await(await fetch('https://api.supabase.com/v1/projects/'+r(v)+'/config/auth',{headers:{Authorization:'Bearer '+t}})).json();console.log(l,'Confirm email:',c.mailer_autoconfirm===false?'ON':'off')}})()"
```

`mailer_autoconfirm: false` means confirmation is **on** — the field names the bypass, not the
feature.

**`site_url` is the trap that no test can see.** It decides where Supabase sends a user after they
click a confirmation link, it lives in project config rather than in this repository, and getting it
wrong is silent in the worst way: the account is confirmed correctly, the database looks right, every
test passes, and the user sees "site unreachable" and concludes the signup failed. It is
`https://gymlog.10x-astro-starter.workers.dev/auth/signin`, with `uri_allow_list` covering that host
and `http://localhost:4321/**`. **If the deployed URL ever changes, this must change with it, and
the only way to verify is to click a real link.**

Line endings are LF, pinned by `.gitattributes`. Do not disable this: the machine has
`core.autocrlf=true`, and without the pin every file checks out as CRLF and prettier fails all
1022 lines of the repository.

## Cloudflare traps

Deployment target is Cloudflare **Workers**, not Pages: `@astrojs/cloudflare` v13 dropped Pages
support, and `wrangler.jsonc` declares a Workers Static Assets project. The deploy command is
`wrangler deploy`; `wrangler pages deploy` does not read this config shape.

- **Missing secrets fail silently, not loudly.** `src/lib/supabase.ts` returns `null` when
  `SUPABASE_URL` / `SUPABASE_KEY` are absent, and `src/middleware.ts` then sets `locals.user = null`.
  The app builds, deploys, serves 200s, and nobody can sign in. GitHub repository secrets are
  **build-time only** — the Worker needs its own `wrangler secret put`. No pipeline can catch this.
  - **`npm run deploy` now catches it, and a GET never could.** The smoke
    (`scripts/deploy-smoke.mjs`) POSTs deliberately-invalid credentials and reads the `?error=`
    code on the redirect: `sign_in_failed` means the Worker reached Supabase and was accepted,
    `not_configured` means the secrets are absent, `unexpected` means they are present and wrong,
    and `rate_limited` is **inconclusive rather than a failure**. An unauthenticated GET answers
    identically in every one of those cases — measured 2026-08-21, which is also why the
    banner-absence check `infrastructure.md` proposed passes in exactly the broken case.
  - **A `fetch` POST must send `Origin`** or `security.checkOrigin` answers `403` before any
    handler runs, which reads exactly like an absent credential.
  - **What the smoke does NOT prove**, and it prints this on every pass: which Supabase project
    the Worker points at, and that a real account can complete a session. Only signing in does —
    the `sb-<ref>-auth-token` cookie is what names the project.
  - **No automatic rollback.** Absent secrets are Worker state, not deployment state, so the
    previous version lacks them too; rolling back would turn a loud failure into a quiet one.
  - **Deploy stays manual and out of CI**, so no merge can overwrite production — the same
    property CI is already denied for the database.
- **`astro dev` already runs the real workerd runtime** (adapter v13 bundles
  `@cloudflare/vite-plugin`). Do not add a `wrangler dev` step **to the development loop** — it is
  legacy there, and `platformProxy` was removed. **That sentence is about the dev loop only and does
  not foreclose running the BUILT worker as a test harness**, where credential resolution genuinely
  differs — see the third bullet below.
  - **It reads its Supabase credentials from `.dev.vars`, which points at PRODUCTION, and a
    process-env override does not displace them.** The mechanism, so nobody re-litigates it: the
    adapter does `Object.assign(process.env, parseEnv(readFileSync(".dev.vars")))` in
    `astro:config:done`, and Vite's `loadEnv` applies `process.env` **last**, after every `.env*`
    file — so `.dev.vars` beats a shell variable, `.env` and `.env.<mode>` alike. In dev the value is
    then **inlined** into the `astro:env/server` virtual module, so the workerd env is not even
    consulted. There is no flag, no mode and no second file. The dev server cannot be aimed at
    `gymlog-test`, and any scripted check that signs in and writes rows would be writing them into
    the database the owner trains against. Verify write paths by calling the exported handlers from
    an integration suite instead (`tests/integration/workout-endpoints.test.ts` is the pattern);
    reserve the dev server for read-only probes and for a human clicking through.
  - **`npm run build` copies the production credentials into `dist/server/.dev.vars`**, emitted by
    `@cloudflare/vite-plugin` from the root file. `astro preview` and `wrangler dev` read them from
    **there**, not from the repository root — so the build output is aimed at production too, by
    default, through a file no test author would think to look at. **118 bytes, both key names
    present** — measured 2026-08-16. It is gitignored and the adapter's own `.assetsignore` lists
    `.dev.vars`, so nothing leaks to the CDN; the hazard is entirely local, and it is that any harness
    pointed at the build output inherits production **silently**. Anything that launches the built
    worker must **delete that file and assert its absence immediately before launch**, not once at
    setup: an ordinary rebuild re-creates it.
    - **`scripts/e2e-build.mjs` deletes it; `scripts/e2e-serve.mjs` asserts its absence and refuses.
      The two live in different processes deliberately** — a launcher that deleted the file and then
      checked for it would hold an assertion that can never fire, and a check that never fires is
      indistinguishable from one that passes. Kept apart, the refusal is provable by planting the
      file and running the launcher directly.
  - **The built worker resolves its credentials at REQUEST time, and that is the one aimable path.**
    Unlike dev, the build emits `_internalGetSecret("SUPABASE_URL")` against the workerd env rather
    than an inlined value, so a launcher that strips the environment and sets the test pair controls
    what the worker sees. The failure mode when the launcher is bypassed is **absent** credentials,
    not production ones — `src/lib/supabase.ts` returns `null`, every protected route redirects, and a
    browser suite goes red on its first step. Measured 2026-08-16; the **`testing-browser-layer`**
    change folder carries the file:line evidence, in `research.md`.
- Adapter v13 also removed `Astro.locals.runtime` and `cloudflareModules`, and flipped `imageService`
  to default `cloudflare-binding`. Guidance written for v12 or earlier is wrong.
- **The Workers Free plan caps CPU at 10 ms per invocation** — a hard kill (Error 1102), not a
  throttle. Weekly tonnage and per-muscle-group rollups must be aggregated in Postgres, not looped
  over every set inside the Worker. Doing it in the Worker passes in week one and fails once the log
  grows.

## Known state

Routes, endpoints and payload shapes are documented in @README.md; this section carries only what a
reader could not infer from there.

- **Astro is held at 6.x.** Astro 7 resolves the four outstanding `npm audit` advisories but its
  build fails against the Cloudflare adapter (`Could not find the prerender entry point`), reproduced
  on 7.1.6 and 7.2.0. Do not "helpfully" bump it; full record in the **`bootstrap-verification`**
  change folder, in `verification.md`.
- CI (`.github/workflows/ci.yml`) runs the **eight** gate steps in order on every push and PR to
  `main`, with a `concurrency` group so two runs cannot race the shared fixture rows.
  `test:middleware` and `test:e2e` are steps of the **existing `ci` job** rather than a new workflow,
  which is what puts them inside that group — a separate workflow would **not** join it and would
  reintroduce the race the group exists to prevent. **No new repository secret was needed**: the five
  existing ones cover both, and neither step carries a production credential.
  - **The group orders CI against CI and nothing else, so a LOCAL run races it.** It is keyed on the
    workflow, which cannot see a developer running `test:integration`, `test:middleware` or
    `test:e2e` from their machine — and all three write the same `gymlog-test` fixture rows. Measured
    2026-08-22: a local integration run overlapped a PR's own run by **53 seconds** and went red on
    one assertion, against a change no suite under `tests/` even imports. **Check `gh run list
--limit 1` before running one locally**, and when a shared-state suite fails once and passes on
    re-run, settle the cause from timing and coupling before debugging the diff. Full record:
    `lessons.md` § "The CI concurrency group serialises CI against CI".
- **Five tables.** `public.profiles` (one row per account, created by a trigger on `auth.users` and
  backfilled); `public.exercises` (the catalogue — **38 seeded rows** with `user_id is null` plus
  custom rows private to their owner, § shared-catalogue variant in `context/foundation/access-control.md`); and `public.workouts` →
  `public.exercise_entries` → `public.sets`, three levels deep, each carrying its own `user_id`
  **and** a composite foreign key to its parent's `(id, user_id)` (§ nested-ownership variant, same file).
  - `performed_on` is a `date` the user states, not an instant.
  - `exercise_id` carries `on delete restrict`, so **an exercise with logged history can no longer be
    deleted at all** — whoever builds catalogue editing will meet that.
  - **`exercise_id` is the one reference NOT closed by a composite key**, because it points into the
    shared catalogue and `MATCH SIMPLE` equality can never match the 38 null-owner rows. It is closed
    by a trigger instead — § the access-control trigger in `context/foundation/access-control.md`,
    and the paragraph under "a JOIN is a FILTER" above for what that closure does and does not cover.
    **Two things follow that a reader will not guess.** A `BEFORE` trigger fires ahead of constraint
    checks, so it is now the trigger — not the plain foreign key — that raises for a genuinely
    missing exercise as well; and the endpoint needed **no change at all**, because the trigger raises
    `23503` and its message does not name `exercise_entries_workout_owner_fkey`. `account-boundary`
    assertion 7 and `workout-endpoints`' "tells a missing exercise apart from a workout that is not
    the caller's" both depend on that message rule.
  - **A failed impact read answers a non-2xx `impact_unavailable`, never `{ impact: [] }`.** An empty
    list is a positive claim — "no record is at stake" — and the screen renders it as reassurance.
    The **opposite** of the rule `/api/sets` follows for the save-time badge, and deliberately: there
    the verdict decorated a write that had already committed, so losing it cost nothing; here the
    preflight **is** the guarantee US-02 asks for. The action stays available and the dialog says the
    consequence is unknown.
  - **The update payload carries no `weight_unit` and no `weight_kg`.** The unit belongs to the row,
    not to the account editing it: re-stamping it from the profile would turn 100 lb into 100 kg the
    first time somebody fixed a typo after the unit became switchable.
- **One RPC, and it is the only thing here that escapes RLS on purpose.**
  `public.delete_own_account()` (`20260815140000_delete_own_account.sql`) deletes the caller's account
  — `security definer`, no parameters, reached by `DELETE /api/account`, which signs the caller out in
  the same request so the cookie-clearing headers ride that response. § the `security definer` RPC in
  `context/foundation/access-control.md`.
  - **It deletes explicitly, in dependency order** — `workouts`, then the caller's own `exercises`,
    then `auth.users` — and the header says plainly that **a bare `delete from auth.users` also
    works**. That was measured on 2026-08-15, against the planning assumption that it would not: the
    `RESTRICT` on `exercise_entries.exercise_id` is itself an AFTER trigger, queued **behind** the
    cascade that removes the referencing rows, so it never fires. The order stays for independence
    from that queue ordering, which is observed rather than contracted. **Do not restate the
    self-block as a fact; it does not exist.**
  - **What deletion does NOT remove**: `auth.audit_log_entries`, which carries no foreign key to
    `auth.users` and keeps the address in its payload. Provider-managed and outside this repository's
    control, and named in `README.md` rather than in the confirmation dialog.
  - **The blocked path has no end-to-end test and that is written down, not implied** — closing note
    of `tests/integration/account-deletion.test.ts`. Neither route into it is reachable: the
    same-account one does not exist (above), and the cross-account one is refused at insert by the
    trigger shape. `src/lib/services/accounts.test.ts` guards the half that can be checked —
    `23503` → `account_delete_blocked`, never `unexpected`.
- **Four views, all `security_invoker = true`, all read-only, none storing anything** (§ derived-view
  variant in `context/foundation/access-control.md`).
  - `public.set_estimates` — one row per set with its estimated 1RM under the row owner's own
    formula. `public.personal_records` — one row per exercise the account has logged, with the best
    estimate and the heaviest weight, each backed by the set that still holds it. Read at `/records`
    and by `/api/sets`. An exercise logged only at zero load still gets a row with both records null,
    so the screen can say why rather than omitting a lift the user logged.
  - `public.daily_tonnage` — one row per account per day, `sum(reps * greatest(weight_kg, 0))`. **It
    emits no row for a day with no sets**, so the zero a screen shows for an empty week is
    synthesised in `src/lib/services/tonnage.ts` and must never be produced by a failed read — that
    read throws instead, and `/dashboard` catches it and shows its failure sentence with no figure at
    all. **The Worker folds at most 14 rows, and that is not a violation of "aggregate in
    Postgres"**: the rule exists because work proportional to the number of SETS is unbounded, and
    folding daily totals is work proportional to DAYS. The service throws rather than folding a wider
    window.
  - `public.daily_exercise_tonnage` — the same sum at `(user_id, performed_on, exercise_id)`,
    carrying the exercise's name and muscle group **joined at read time** so neither is ever stored.
    Read only by `/dashboard`, through `weeklyBreakdown` in `tonnage.ts` and `foldBreakdown` in
    `tonnage-breakdown.ts`.
    - **The bound is no longer a constant, so it is asserted rather than assumed.** A week at this
      grain is `days × distinct exercises per day` rows; `MAX_BREAKDOWN_ROWS` (`7 * 30`) throws above
      that. **A throw, never a `.limit()`** — a limit is a silent truncation, and here it would fail
      the reconciliation guard and get blamed on the arithmetic. The read asks for
      `MAX_BREAKDOWN_ROWS + 1` rows, so the refusal costs no unbounded transfer.
    - **The range predicate descends to `workouts_user_performed_on_idx` only while the filter is on
      GROUP BY columns.** `(user_id, performed_on, exercise_id)` keeps that property; grouping by
      `(user_id, exercise_id)` and filtering by a date range would not. A property of this grain, not
      a general one.
- **Three enums**: `weight_unit`, `estimation_formula`, `muscle_group` (exactly six values). **All
  three are pinned in both directions** by `MUSCLE_GROUPS`, `WEIGHT_UNITS` and `ESTIMATION_FORMULAS`
  in `src/types.ts`, each carrying its own `Assert<MutuallyAssignable<…>>`. Add a value to the
  database without adding it there and the build fails, rather than the value existing in storage and
  silently missing from every filter on screen. `WEIGHT_UNIT_LABELS` and `ESTIMATION_FORMULA_LABELS`
  in `src/lib/validation/profile.ts` are typed as `Record` over the enum for the same reason one step
  further on: a new value cannot reach the screen unnamed.
- **The account's three preferences are settable, and needed no migration** — the columns, the grant
  and the update policy already existed, and the view already read the formula per row.
  - `PATCH /api/profile` replaces all three at once. **A partial patch is refused on purpose**:
    "absent" and "explicitly set" are indistinguishable in JSON, so one Save sends every value the
    user was looking at.
  - **Nothing stored is converted, ever.** Changing `weight_unit` changes what NEW sets are stamped
    with; every set already logged keeps the unit it was typed in, and **editing one must not
    re-stamp it** — `updateSet` takes no unit, and `preferences-derive.test.ts` assertion 2 fails if
    it ever does. Changing `estimation_formula` re-derives. Changing `timezone` moves no
    `performed_on`, because that column is a calendar date the user stated rather than an instant.
  - **`Intl.supportedValuesOf("timeZone")` is available in workerd and answers 418 zones.**
    `src/lib/services/timezones.ts` is the single source the `<select>` and the validator both read —
    if they came from two places the form could offer a value the server then refused. Its small
    hardcoded fallback is a **tripwire, not a supported mode**.
  - **An unknown timezone is refused server-side**, by membership rather than by shape. `todayIn`
    catches the `RangeError` a bad zone raises and answers in UTC (`calendar.ts:29`), deliberately —
    so `Europe/Warsawa` would produce a wrong week boundary with nothing on screen saying so. That
    was unreachable while nobody could write the column; a form makes it reachable.
