---
project: "GymLog"
version: 1
status: draft
created: 2026-08-09
updated: 2026-08-15
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: GymLog

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.
>
> **Sequencing framing — answered by the owner, not inferred.** The goal is `speed`: the product
> has three weeks of after-hours time and twenty-two must-have requirements, so only work that a
> must-have requirement forces is sequenced at all — everything else is parked rather than
> scheduled late.
> The main constraint is `time`, and the consequence is deliberate: **every slice below is
> independently deliverable**, so stopping part-way still leaves something whole. The one layer
> that gets deep investment is **data** — the product's hardest guardrail is that no account can
> reach another's training, the codebase has no data layer at all today, and ownership has to be
> enforced in the database rather than in request code. Interface, request handling and hosting
> stay deliberately plain.

## Vision recap

Someone who lifts three or four evenings a week already writes every set down. The data is
there; the arithmetic is not. Comparing sets at different rep counts and different loads by hand,
across weeks, is work nobody does — so people train by feel, guess the next load at the rack, and
notice a stalled block weeks after it stalled.

Repetitions and weight are enough to derive a comparable strength score for each set, sum a
week's work into one figure, and know the moment a set beats everything before it. This is not a
data-capture problem needing more input — it is arithmetic the product can do silently at save
time. The same notebook, with the maths already done.

## North star

**S-03: user can log a workout, add an exercise, enter a set of repetitions and weight, and
immediately see an estimated one-rep max** — this is the flow that proves the product's whole
premise, because the value on offer is the arithmetic, not the recording. It maps directly onto
the primary success criterion, and it is placed as early as its prerequisites allow.

> "North star" here means: the smallest end-to-end slice whose successful delivery would prove
> the core product idea works — everything else in this roadmap only matters if this one does,
> which is why it is sequenced as early as its prerequisites permit rather than saved for later.

## At a glance

| ID   | Change ID                         | Outcome (user can …)                                                                    | Prerequisites                                                                                                                   | PRD refs                                                                            | Status   |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| F-01 | verification-harness              | (foundation) wrong derived numbers fail the pipeline instead of reaching a screen       | —                                                                                                                               | Business Logic §boundaries, NFR §determinism, US-04 AC §assert-against-stored-state | done     |
| F-02 | smoke-deploy                      | (foundation) the product is reachable at a stable public address from a green pipeline  | —                                                                                                                               | NFR §browser support, NFR §2s p95 on mobile                                         | done     |
| F-03 | owned-persistence-baseline        | (foundation) rows belong to accounts and the database enforces it                       | F-02, a provisioned hosted database project (URL + key set as pipeline secrets and as runtime secrets on the deployed instance) | US-04, Access Control §ownership enforced, NFR §no cross-account reach              | done     |
| S-01 | account-access                    | create an account, sign in, sign out, and be sent to sign-in when signed out            | F-03                                                                                                                            | FR-001, FR-002, FR-003, US-04, Access Control                                       | done     |
| S-02 | exercise-catalogue                | browse and search exercises, and add their own with a muscle group and bodyweight flag  | S-01, F-03                                                                                                                      | FR-011, FR-012, FR-013, FR-014, Access Control §catalogue visibility                | done     |
| S-03 | log-workout-with-estimate         | log a workout and see the estimated one-rep max for the set they just entered           | S-02, F-01, F-03                                                                                                                | US-01, FR-004, FR-005, FR-008, FR-009, FR-015                                       | done     |
| S-04 | personal-records                  | be told at save time when a set beats their best, and see current records per exercise  | S-03, F-01                                                                                                                      | US-02, FR-020, FR-021                                                               | done     |
| S-05 | edit-and-delete-log               | correct or remove a workout or a set, warned first about any record that will fall      | S-04, F-01                                                                                                                      | FR-006, FR-007, FR-010, US-02                                                       | done     |
| S-06 | unit-formula-timezone-preferences | choose kilograms or pounds, the estimation formula, and the timezone their week runs in | S-03, F-03                                                                                                                      | FR-016, FR-022, US-03, NFR §unit round-trip                                         | done     |
| S-07 | weekly-tonnage                    | see this training week's total tonnage next to last week's                              | S-05, S-06, F-01                                                                                                                | US-03, FR-017                                                                       | done     |
| S-08 | tonnage-breakdown                 | see where the week's work went, per exercise and per muscle group                       | S-07, F-01                                                                                                                      | US-03, FR-018, FR-019                                                               | done     |
| S-09 | account-boundary                  | be certain no other account can reach their training, and delete their own account      | S-02, S-03, S-06, F-01, F-03                                                                                                    | US-04, NFR §no cross-account reach, NFR §own-data deletion                          | in-progress |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                   | Chain                             | Note                                                                                                                                                |
| ------ | ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Correctness gate        | `F-01`                            | Needs nothing at all — the only work available while the database project is still being provisioned.                                               |
| B      | Environment & ownership | `F-02` → `F-03` → `S-01`          | The critical path; nothing that stores data can start until this stream's data foundation lands.                                                    |
| C      | Log, derive, correct    | `S-02` → `S-03` → `S-04` → `S-05` | The north-star chain. Joins Stream B at its account slice, and consumes Stream A's gate throughout.                                                 |
| D      | The week in numbers     | `S-06` → `S-07` → `S-08`          | Joins Stream C at the north star; its totals also wait on Stream C's edit slice, so corrections are already reflected when the weekly figures ship. |
| E      | Account boundary        | `S-09`                            | Joins C and D once every level of the record exists; runs alongside the whole of Stream D.                                                          |

## Baseline

What's already in place in the codebase as of `2026-08-09` (auto-researched + owner-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — server-rendered pages with interactive islands, a utility CSS system and a component library are all wired; `src/pages/`, `src/components/`, `src/components/ui/`.
- **Backend / API:** server rendering is on by default. Three authentication endpoints under `src/pages/api/auth/` (form posts) and four JSON endpoints called from hydrated islands: `src/pages/api/exercises/`, `workouts/`, `exercise-entries/` and `sets/`. Business logic lives in `src/lib/services/`, input validation in `src/lib/validation/` split so the zod schemas never reach the browser. **Five tables**: `profiles`, `exercises` and the training record `workouts` → `exercise_entries` → `sets`. `exercises` is the one that mixes shared and owned rows — 38 seeded exercises readable by every account and writable by none, plus custom exercises private to their owner. The estimated one-rep max is derived on read from `sets`, never stored, so changing the formula later re-derives history instead of contradicting it. Boundaries proven against persisted state by `tests/integration/exercises-rls.test.ts` and `workout-log-rls.test.ts`; the endpoints themselves by `workout-endpoints.test.ts`.
- **Data:** present, five tables — every migration in `supabase/migrations/` is applied to **both** hosted projects, `gymlog` (production, served by the deployed Worker) and `gymlog-test` (CI and the integration check), by a single `npm run db:push` that cannot advance one without the other. `public.profiles` carries one row per account with the training-week timezone, weight unit and estimation formula; `public.exercises` is the catalogue; `workouts` → `exercise_entries` → `sets` is the training record. RLS is enabled on all five with per-operation policies scoped `to authenticated` and `anon` revoked outright. **The three nested tables also carry a composite foreign key to their parent's `(id, user_id)`** — without it the ordinary policies admit a row grafted onto another account's parent, which was reproduced before it was closed. Weights are stored as typed alongside their unit, with a generated canonical `weight_kg`, so the unit round-trip is exact by construction. Boundaries proven by checks that re-read stored rows (`tests/integration/profiles-rls.test.ts`, `exercises-rls.test.ts`, `workout-log-rls.test.ts`, `workout-page-access.test.ts`). Records: the **`owned-persistence-baseline`** and **`log-workout-with-estimate`** change folders, each in its `plan.md`.
- **Auth:** complete for S-01's scope, and hardened rather than scaffolded. A cookie-session client (`src/lib/supabase.ts`) and request middleware (`src/middleware.ts`) that protects routes in **both** directions — signed-out visitors are sent to sign-in, signed-in visitors are sent away from the sign-in and sign-up forms. Every auth endpoint validates its input through a shared zod schema before touching Supabase, and no provider error text reaches a response: sign-in failures collapse to one message regardless of cause, so no account learns whether another exists. Sign-in and sign-up land on `/dashboard`; sign-out lands on `/auth/signin`. The post-signup page is shown only when a confirmation email is genuinely on its way, because the endpoint branches on whether `signUp` returned a session rather than on build mode. Row-ownership enforcement exists in the database and is demonstrated on `public.profiles`: the policy shape every later table copies is established, and the deployed page reads the signed-in account's own row through RLS. Covered by unit tests for the schemas and by `tests/integration/auth-flows.test.ts` for the flows. **Email confirmation is on for `gymlog` and off for `gymlog-test`, deliberately** — see `AGENTS.md` § Environment for what breaks if that is made uniform. Verified against the deployed URL with a real address and a real confirmation link.
- **Deploy / infra:** present — the product is deployed at `https://gymlog.10x-astro-starter.workers.dev` with both runtime secrets set on the Worker and both build-time secrets set on the repository, and the pipeline (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the integration check against `gymlog-test` and build on `main`, green. Record: `context/deployment/deploy-plan.md`.
- **Observability:** partial — platform-level observability is switched on in the hosting configuration. No error tracking, no metrics, no dashboards.
- **Verification tooling (correction to the six probed layers):** partial — a unit-test runner is wired (Vitest, `vitest.config.ts`, `npm test` / `npm run test:watch`) and the pipeline gate runs lint, typecheck, unit tests, the integration check and build, so a wrong derived number fails the pipeline. This is what `F-01` closes; `F-03` added the integration check (`tests/integration/`, `vitest.integration.config.ts`), which asserts the row-ownership boundary against stored rows. Still absent: a browser-test runner, and unit tests for every domain rule other than the one-rep-max boundaries — those land with the slices that own them.

## Foundations

### F-01: Domain-rule verification harness

- **Outcome:** (foundation) a unit-test runner is wired into the repository and the pipeline gate runs type checking and unit tests alongside the existing lint and build, so a wrong derived number fails the pipeline instead of reaching a screen.
- **Change ID:** verification-harness
- **PRD refs:** Business Logic §boundaries, NFR §determinism, US-04 AC §assert-against-stored-state
  — the boundary rules under Business Logic §"The rule is only as good as its boundaries"; the
  requirement that derived values are deterministic and reproducible; and US-04's criterion that
  a failure is "verified against the recorded data, not only against the response the caller sees".
- **Unlocks:** S-03, S-04, S-05, S-07, S-08 — every slice whose acceptance turns on a numeric boundary (one repetition, the twelve-repetition edge, zero and negative loads, unit round-trip, week boundaries across timezones). Also creates the assert-against-stored-state verification path that S-09 and US-04 require.
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** sequenced first because the boundary arithmetic needs no database and no deployed environment — it is the only work available while the data environment is still being provisioned, which is exactly what the time constraint asks for. Scope is the runner and the pipeline gate only; the tests themselves belong to the slices that own the rules. Over-scoping this into a full test strategy would spend the scarcest resource on work no user ever sees.
- **Status:** done

### F-02: Public deployment path

- **Outcome:** (foundation) the product is deployed and reachable at a stable public address from a green pipeline, with the deployment configuration validated while the surface area is still small enough that a failure is easy to read.
- **Change ID:** smoke-deploy
- **PRD refs:** NFR §browser support, NFR §2s p95 on mobile
  — "remains usable on the latest two major versions of the four mainstream desktop browsers and
  on current mobile Safari and Chrome", and "usable content in under 2 seconds at the 95th
  percentile on a mid-range phone over a mobile connection".
- **Unlocks:** F-03 — a deployed instance is where the runtime credentials have to be set, and that step fails silently rather than loudly if skipped. Also opens the only honest verification path for the mobile-performance and browser-support requirements, which no pipeline can check.
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** the first production deployment is the owner's call, not the implementer's — `context/deployment/deploy-plan.md` is `status: awaiting-approval`. Planning may proceed; execution waits.
- **Unknowns:** —
- **Risk:** nothing stands in front of it — the hosting account is already authenticated and the build is green (`context/deployment/deploy-plan.md` §Preconditions) — so it is deliberately thin and deliberately early. What it produces is a page that renders and cannot sign anybody in — the expected outcome at this stage, not a defect, and it must not be reported as "the product is deployed". Validating the deployment path now costs one throwaway run; discovering a misconfiguration after application code exists costs a debugging session in the middle of the build.
- **Status:** done — both stages, 2026-08-09. `https://gymlog.10x-astro-starter.workers.dev`, verified by a full signup → dashboard → signout → signin round trip against the deployed URL. Record: `context/deployment/deploy-plan.md`.

### F-03: Account-owned persistence with database-enforced isolation

- **Outcome:** (foundation) a hosted database is connected to development, the pipeline and the deployed instance, and the row-ownership policy shape that every later table must follow is established and demonstrated on the account's own profile row — including a check that asserts against stored rows rather than the status code a caller sees.
- **Change ID:** owned-persistence-baseline
- **PRD refs:** US-04, Access Control §ownership enforced, NFR §no cross-account reach
  — Access Control's "ownership is enforced by the product, not merely hidden in the interface",
  and the requirement that "no account's training data is obtainable by another account through
  any interface".
- **Unlocks:** S-01, S-02, S-03, S-06, S-09 — every slice that stores anything at all. It also closes the roadmap's single largest unknown (there is no data layer today) and creates the persisted-state verification path US-04 demands.
- **Prerequisites:** F-02, a provisioned hosted database project (URL + key set as pipeline secrets and as runtime secrets on the deployed instance)
- **Parallel with:** F-01
- **Blockers:** — (cleared 2026-08-09: project `cdzybmwxtefhbanfytna` provisioned in Central EU, free plan; URL and publishable key are set as repository secrets and as runtime secrets on the Worker, and authentication was verified end to end against the deployed URL). The database still has no tables — that is this item's work.
- **Unknowns:**
  - ~~How are migrations applied, and how does a check run avoid disturbing the data the owner is actually training with?~~ **Resolved 2026-08-10** — hosted only, `supabase db push --db-url` through `npm run db:push` (both projects, test first); checks run against `gymlog-test` with no production credential. Full decision in Open Roadmap Question 3 below.
- **Risk:** this is the deep-investment item and the only foundation that is not thin, because the product's hardest guardrail lives here: ownership is enforced in the database, not only in request code. From this point on the ownership policy is written in the same migration that creates each table — a table that lands without one is a defect, not a follow-up. Sequenced before every data-bearing slice because retrofitting ownership onto tables that already exist is precisely where isolation defects are born.
- **Status:** done

## Slices

### S-01: Account access

- **Outcome:** user can create an account with an email address and a password, sign in, sign out, and is sent to sign-in when they request a training screen while signed out — landing afterwards on the screen they originally asked for.
- **Change ID:** account-access
- **PRD refs:** FR-001, FR-002, FR-003, US-04, Access Control
  — US-04 here specifically for its criterion that "signing out and returning requires
  authenticating again before any training data is shown"; the adversarial half of US-04 is S-09.
- **Prerequisites:** F-03
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the sign-in surface already exists in the repository but has never run against a real identity provider, and the known failure mode is silent: absent runtime credentials produce a deployment that serves pages, returns success, and treats every visitor as anonymous. This slice is where that is caught, and it is caught by signing in against the deployed address — a green pipeline cannot see it.
- **Status:** done

### S-02: Exercise catalogue

- **Outcome:** user can browse and search a catalogue of exercises, add their own to a private catalogue, and give each one exactly one primary muscle group and a bodyweight flag.
- **Change ID:** exercise-catalogue
- **PRD refs:** FR-011, FR-012, FR-013, FR-014, Access Control §catalogue visibility
  — "the seeded exercise catalogue is readable by every signed-in account. Custom exercises added
  by a user are private to that account."
- **Prerequisites:** S-01, F-03
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - ~~What is the muscle-group taxonomy?~~ **Resolved 2026-08-10**: six groups — `legs`, `back`, `chest`, `shoulders`, `arms`, `core` — and multi-joint lifts are filed under the group the lifter programmes them for, not their primary anatomical mover (deadlift → `back`). See `AGENTS.md` § Domain rules and `prd.md` § Open Questions #1.
  - ~~Which exercises ship in the seeded catalogue?~~ **Resolved 2026-08-10**: 38 exercises, listed in full with their groups and bodyweight flags in `prd.md` § Open Questions #1, together with the five assignments that are deliberate rather than accidental. **S-02 now has no open unknowns.**
- **Risk:** the group list is load-bearing rather than cosmetic — because every exercise carries exactly one group, the per-group figures later have to reconcile with the week's total, so a taxonomy chosen carelessly here is re-tagged across every custom exercise the owner has already created. Sequenced before the north star because logging a workout requires an exercise to log it against, and free-text names would make per-exercise records impossible to compute at all. The bodyweight flag lands here rather than later so the zero and negative load rules are explicit at the moment sets first become storable.
- **Status:** done

### S-03: Log a workout and see what it was worth

- **Outcome:** user can create a workout dated today with an optional note, add an exercise from the catalogue, log a set of repetitions and weight, save, and immediately see an estimated one-rep max for that set — with the workout present in their list, most recent first, after a reload.
- **Change ID:** log-workout-with-estimate
- **PRD refs:** US-01, FR-004, FR-005, FR-008, FR-009, FR-015
- **Prerequisites:** S-02, F-01, F-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the estimate is the product, so its boundaries are the risk: at exactly one repetition the estimate must equal the weight lifted, and above twelve repetitions no estimate may be shown rather than a fabricated one. Two storage decisions are also made here and are expensive to reverse — weights are held in one canonical unit, and estimates are derived on read rather than written down — because S-06 later lets the user change both the unit and the formula, and neither change may rewrite a logged value or a past estimate.
- **Status:** done

### S-04: A record is announced when it happens, and listed afterwards

- **Outcome:** user is told at the moment of saving when a set beats their previous best for that exercise, and can open a list of their current records per exercise — the best estimate and the heaviest absolute weight side by side.
- **Change ID:** personal-records
- **PRD refs:** US-02, FR-020, FR-021
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** three exclusions decide whether this number is true — the first-ever set for an exercise establishes a baseline and is not announced, sets outside the estimate's valid range and assisted sets with a negative load take no part at all, and a set equal to the previous best once both are expressed in the same unit is not a record. Records are read from the surviving sets rather than written down as trophies, which is what keeps them honest under S-05 and is far cheaper to establish now than to unwind later.
- **Status:** done

### S-05: Correct or remove what was logged

- **Outcome:** user can edit a workout's date and note, edit or delete an individual set, and delete a workout together with everything under it — being told first which record it holds and what that record will fall to, and having to confirm.
- **Change ID:** edit-and-delete-log
- **PRD refs:** FR-006, FR-007, FR-010, US-02
  — US-02 here for its criteria that "the record recomputes from the sets that remain, and may go
  down", and that the user "is told which record it holds and what value that record will fall to,
  and must confirm".
- **Prerequisites:** S-04, F-01
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** — (planning surfaced two: the heaviest-weight record needs its own ranking, and the
  top-two shape is exact only for a single set — both settled in the plan)
- **Risk:** this is where a derived number goes stale without anybody noticing — deleting the set behind a record has to lower that record rather than leave it pointing at nothing, and a fat-fingered weight is the single most common correction a real log receives. Sequenced immediately after records exist so the warn-then-fall behaviour has something to act on. The weekly figures this also disturbs are covered when S-07 lands, which is why S-07 lists this slice as a prerequisite rather than the other way round.
- **Status:** done

### S-06: Units, formula, and the week's timezone

- **Outcome:** user can choose kilograms or pounds, choose whether estimates use Epley or Brzycki, and set the timezone their training week is evaluated in — and every weight, estimate and total on screen follows the choice consistently.
- **Change ID:** unit-formula-timezone-preferences
- **PRD refs:** FR-016, FR-022, US-03, NFR §unit round-trip
  — US-03 here only for its criterion that "a training week runs Monday to Sunday evaluated in the
  user's own timezone"; the weekly figures themselves are S-07. The round-trip requirement is "a
  weight entered in pounds and read back in pounds is the number the user typed".
- **Prerequisites:** S-03, F-03
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the round-trip is the whole risk — a value typed in pounds, displayed in kilograms and read back in pounds must be the number typed, and neither conversion nor rounding may turn a non-record into a record or erase one. Sequenced after the north star on purpose: shipping sensible defaults first keeps the first end-to-end flow small, and that only works because S-03 stores weights in one canonical unit and derives estimates on read, so changing either preference re-derives rather than migrates.
- **Status:** done

### S-07: The week's work, against last week's

- **Outcome:** user opens the home screen and sees total tonnage for the current training week next to the previous one, with a week that has no logged sets reading as zero and an explanation rather than a blank.
- **Change ID:** weekly-tonnage
- **PRD refs:** US-03, FR-017
- **Prerequisites:** S-05, S-06, F-01
- **Parallel with:** S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** one failure — a weekly figure that is wrong and looks right — reaches this screen by two routes. The week has to run Monday to Sunday in the user's own timezone, so a Sunday-evening session belongs to that week rather than the next; and the totals have to be summed in the database rather than by walking every set inside the request, because the hosting runtime enforces a hard per-request processing cap that kills the request outright instead of slowing it — a shape that passes in the first week and fails once the log grows. Zero-weight sets contribute repetitions but nothing to the total, and assisted sets contribute nothing rather than a negative amount. **Note the standing constraint S-04 recorded: there is no environment in this project where that processing cap can be measured.** The test project holds a few dozen sets, so query plans there prefer sequential scans and prove nothing about index behaviour at real volume. Aggregating in the database stays the right call on the architecture argument, but it is not a measured one — seeding a volume fixture (~2,000 sets) is the prerequisite for claiming otherwise, and it collides with the suites that clean up by name prefix. Full record: `context/archive/2026-08-11-personal-records/plan.md` § Performance Considerations. **S-07 measured the blocker half of this and it is weaker than stated**: no cleanup predicate would touch a distinctly-marked volume fixture, and the only real interaction is two account-wide reads in `preferences-derive.test.ts`, removed entirely by seeding a third account.
- **Status:** done

### S-08: Where the week's work went

- **Outcome:** user can see the current week's tonnage broken down per exercise and per muscle group, with the group figures summing exactly to the week's total.
- **Change ID:** tonnage-breakdown
- **PRD refs:** US-03, FR-018, FR-019
- **Prerequisites:** S-07, F-01
- **Parallel with:** S-09
- **Blockers:** —
- **Unknowns:**
  - ~~How is an exercise's muscle group corrected after the fact?~~ **RESOLVED (owner, 2026-08-14):** retroactively, and retroactively **by construction** — nothing stores the group beside a set, so a correction moves historical tonnage between buckets on the next read and cannot change the week's total at all. The snapshot alternative was declined. No edit path shipped; that is a separate slice. PRD Open Question 2.
- **Risk:** the breakdown is only worth showing if it reconciles: every exercise contributes to exactly one group precisely so the group rows sum to the week's total, with no set counted twice and none left out. Sequenced immediately after the total so both figures come from the same aggregation and cannot drift apart. Inherits S-07's unmeasurable-processing-cap constraint unchanged — see that item's Risk. It is also the natural stopping point if the schedule tightens — the total answers the primary question on its own, and this slice answers the secondary one.
- **Status:** done

### S-09: The account boundary, proven and reversible

- **Outcome:** user's training is unreachable from any other account — reads, edits and deletes alike, including a request that names a workout, exercise entry or set identifier directly, verified against the stored rows — and the user can delete their own account together with all of its training data, after which none of it is retrievable.
- **Change ID:** account-boundary — **SPLIT (2026-08-15)** into `cross-account-isolation` (the boundary, and the unscoped `exercise_id` behind it) and `account-deletion` (own-data deletion). Two worktrees, two PRs: this is M2 deliverable 5, and S-09 was the last slice able to produce it.
- **PRD refs:** US-04, NFR §no cross-account reach, NFR §own-data deletion
  — "no account's training data is obtainable by another account through any interface … for
  reads, modifications, and deletions alike", and "a user can delete their account together with
  all associated training data, after which none of it is retrievable through the product".
- **Prerequisites:** S-02, S-03, S-06, F-01, F-03
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the enforcement itself is not deferred to this slice — the ownership policy is written in the same migration as every table from F-03 onwards, and a table that lands without one is a defect rather than a follow-up. What is sequenced here is the adversarial proof, which can only run once all three levels of the record exist, and which has to assert against stored rows rather than the status code the caller sees: a check that only reads the response passes happily against a broken boundary. Account deletion joins it because it is the same boundary read from the other side. **The proof turned out to be nearly complete already** — twelve suites covered every criterion but one, so `cross-account-isolation` spent its effort on a real schema defect (the unscoped `exercise_id`) and added the single missing assertion, signing out.
- **Status:** in-progress

## Backlog Handoff

| Roadmap ID | Change ID                         | Suggested issue title                                                     | Ready for `/10x-plan` | Notes                                                                  |
| ---------- | --------------------------------- | ------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| F-01       | verification-harness              | Wire a unit-test runner and add typecheck + tests to the pipeline gate    | yes                   | Run `/10x-plan verification-harness`. Needs no database, no deploy.    |
| F-02       | smoke-deploy                      | Deploy the current build to a stable public address and verify the config | yes                   | Run `/10x-plan smoke-deploy`. Execution waits on the owner's go-ahead. |
| F-03       | owned-persistence-baseline        | Connect a hosted database and establish the row-ownership policy shape    | no                    | Needs F-02 and a provisioned database project (owner action).          |
| S-01       | account-access                    | Sign up, sign in, sign out, and gate the training screens                 | no                    | Needs F-03.                                                            |
| S-02       | exercise-catalogue                | Browse, search, and add exercises with a muscle group and bodyweight flag | no                    | Needs S-01, F-03. Taxonomy decision open (non-blocking).               |
| S-03       | log-workout-with-estimate         | Log a workout and show the estimated one-rep max                          | no                    | Needs S-02, F-01, F-03. North star.                                    |
| S-04       | personal-records                  | Announce a personal record at save time and list current records          | no                    | Needs S-03, F-01.                                                      |
| S-05       | edit-and-delete-log               | Edit and delete workouts and sets, warning before a record falls          | no                    | Needs S-04, F-01.                                                      |
| S-06       | unit-formula-timezone-preferences | Preferred unit, estimation formula, and training-week timezone            | no                    | Needs S-03, F-03.                                                      |
| S-07       | weekly-tonnage                    | Weekly tonnage for the current and previous training week                 | no                    | Needs S-05, S-06, F-01. Aggregate in the database, not in-request.     |
| S-08       | tonnage-breakdown                 | Weekly tonnage broken down per exercise and per muscle group              | no                    | Needs S-07, F-01. Retroactive-group decision open (non-blocking).      |
| S-09       | account-boundary                  | Prove cross-account isolation against stored data; account deletion       | no                    | Needs S-02, S-03, S-06, F-01, F-03.                                    |

## Open Roadmap Questions

1. **What is the muscle-group taxonomy, and which exercises ship in the seeded catalogue?** — FR-013 requires every exercise to carry exactly one primary muscle group, so the list of groups is now load-bearing: too coarse (push / pull / legs) and the breakdown says nothing, too fine (fifteen groups) and every week looks sparse. A working starting point is legs, back, chest, shoulders, arms, core. Roughly 30–40 seeded exercises covering the main lifts is the target; an exhaustive collection is explicitly not. Owner: user. By: before the catalogue is seeded. Block: gates **S-02** (which seeds it) and shapes **S-08** (which reports on it) — neither is blocked from being planned, but S-02 cannot be implemented without the list.
2. **How is an exercise's muscle group corrected after the fact?** — If a user assigns the wrong group to a custom exercise, changing it retroactively rewrites every historical per-group tonnage figure that exercise contributed to. Whether that is acceptable (numbers the user already saw will change) or whether the change should apply only going forward needs deciding. Owner: user. By: implementation planning. Block: gates the correction behaviour in **S-02** and the historical figures in **S-08**; neither is blocked from being planned.
3. ~~**How are migrations applied and integration checks run without a local database stack?**~~ — **Decided 2026-08-10 in F-03**; full record and the measurements behind it in the **`owned-persistence-baseline`** change folder's `plan.md`. Hosted only, no container runtime anywhere in the loop. Migrations go through `supabase db push --db-url <session-mode pooler URI>`, wrapped by `scripts/supabase-db.mjs` and exposed as `npm run db:push`, which applies to **both** projects in one invocation — `gymlog-test` first, then `gymlog` — so there is no supported way to advance one schema and forget the other; `npm run db:status` prints both histories side by side. Integration checks (`npm run test:integration`) run against **`gymlog-test` only**, with that project's publishable key and no production credential at all, and are confined within it by the RLS policies under test — so "a check might disturb the data the owner trains against" is not a risk the design can carry. Two consequences to revisit: type generation needs a personal access token because `gen types --db-url` requires a container runtime; and **at S-02, when CI starts writing workout rows rather than two preference rows, revisit whether two projects still beat one** — the plan review's condition, adopted.

## Parked

- **The account's own email address in the delete-account confirmation dialog** — **DECIDED by the owner on 2026-08-15, not yet built**, and parked only behind the outstanding E2E requirement. The decision has two halves and the rejected half matters as much. **Rejected: a persistent signed-in-account indicator on `/settings`** (the page shows none — `Layout.astro` renders no `Topbar`). It was proposed after a near-miss during S-09's Phase 6 account cleanup, where two remaining addresses differed only by a `+gymlog1` suffix and one held the only real training; the owner's ruling is that this is an **operator** problem produced by that cleanup, not a user one — a real lifter has one account and one session — and fixing it with ambient chrome would put our problem in their product. **Adopted: the address in the confirmation dialog instead**, which is strictly better on this product's own stated reasoning: the dialog already names how much training goes because "your whole history" is an abstraction nobody can weigh, and the address is the same class of fact one step over — it names *whose* history, at the moment the decision is actually made, where a Topbar becomes wallpaper within a day. It is also the only line in that dialog that **cannot fail**: the three counts come from a read that can fail (and then deliberately drops the numbers rather than showing zeros), while the address sits on `locals.user`, which `PROTECTED_ROUTES` guarantees for this page — so it can be stated unconditionally. **One constraint to carry into implementation**: the address must come from `locals.user.email` server-side and never from anything a client can supply. This repository's `?error=` lesson — attacker prose rendered as a system message, not XSS — does **not** apply here because the source is the middleware-resolved session, and the distinction is subtle enough to be worth a sentence in the code. Cost: one string as an island prop (the "large collection is not a prop" rule is about the 418-entry timezone list, not this), plus an update to `tests/render/settings-delete-panel.test.ts`, which pins five properties of that dialog.
- **Password recovery for a user who has forgotten their password** — Why parked: **PRD §Open Questions #3, and it is an open question rather than a Non-Goal on purpose** — it was overlooked during shaping, not declined, and everything genuinely declined sits in Non-Goals with its reason. Raised on 2026-08-15 by S-09's Phase 6 rather than by planning: five of the eight production accounts could not be deleted through `/settings` because no password was recorded and no recovery path exists, so the account-deletion feature could not perform its own first cleanup. Since S-09 the product can permanently delete an account and still cannot recover one; a user who forgets their password loses every workout, the rows surviving untouched and unreachable because US-04 is doing its job. **Not a checkbox**: Supabase will send the link, but it lands on `site_url` and this application has no `/auth/callback` route to exchange the PKCE code and no screen for choosing a new password — so the database side would work while the user saw a page that cannot help them, the same shape as the `site_url` defect S-01 found by clicking a real link, and invisible to every test for the same reason.
- **Per-exercise history of the estimated one-rep max over time (FR-023)** — Why parked: the only `nice-to-have` in the PRD, and named there as the first thing to cut if three weeks tighten. The record list and the weekly comparison already answer the core question.
- **Records bucketed by repetition range** — Why parked: PRD §Open Questions, resolved during shaping. Because records are derived from surviving sets rather than awarded, buckets can be added later from existing data alone; deferring costs nothing.
- **Calendar view of workouts** — Why parked: PRD §FR-005 resolution. The list is the confirmation step in the logging flow and works on a narrow screen; a calendar is a presentation change that can follow.
- **Training programme generation, coaching cues, load recommendations** — Why parked: PRD §Non-Goals. The boundary that keeps the domain rule small enough to be correct.
- **Generative or predictive intelligence of any kind** — Why parked: PRD §Non-Goals. The value here is arithmetic that is verifiable and reproducible.
- **Any social surface — sharing, following, leaderboards, comparison** — Why parked: PRD §Non-Goals. Single-tenant by design, which also keeps the access-control model flat.
- **Nutrition, bodyweight, sleep, cardio tracking** — Why parked: PRD §Non-Goals. Each brings its own domain rules and none improves the strength question.
- **Import from other trackers or wearables** — Why parked: PRD §Non-Goals. Manual entry only; an import path would need a mapping onto the exercise catalogue before the first working flow even exists.
- **Native mobile application and offline-first behaviour** — Why parked: PRD §Non-Goals. Connectivity is assumed; offline synchronisation is a product of its own.
- **Coach / athlete roles and shared workouts** — Why parked: PRD §Non-Goals, now and in what the MVP's shape implies.
- **Multi-region availability and compliance work beyond baseline data-protection duties** — Why parked: PRD §Non-Goals. Own-data deletion is in scope (S-09); nothing beyond it is.
- **Error tracking, metrics and dashboards beyond what the platform provides** — Why parked: the goal is speed and the observability layer is not a launch gate for a single-account product. Platform-level observability is already on.

## Done

- **F-01: (foundation) a unit-test runner is wired into the repository and the pipeline gate runs type checking and unit tests alongside the existing lint and build, so a wrong derived number fails the pipeline instead of reaching a screen** — Archived 2026-08-09 → `context/archive/2026-08-09-verification-harness/`. Lesson: —.
- **F-03: (foundation) a hosted database is connected to development, the pipeline and the deployed instance, and the row-ownership policy shape that every later table must follow is established and demonstrated on the account's own profile row — including a check that asserts against stored rows rather than the status code a caller sees** — Archived 2026-08-10 → `context/archive/2026-08-09-owned-persistence-baseline/`. Lesson: a guardrail you have not mutation-tested may not guard — the first form of the estimation-formula type assertion resolved to `never`, which is an unused declaration rather than an error, and silently passed the exact mutation it was written to catch.
- **F-02: (foundation) the product is deployed and reachable at a stable public address from a green pipeline, with the deployment configuration validated while the surface area is still small enough that a failure is easy to read** — Done 2026-08-09 → `https://gymlog.10x-astro-starter.workers.dev`. No change folder: executed directly from `context/deployment/deploy-plan.md`, which holds the full record. Lesson: the plan's own warning held — stage 1 returned 200 on every public page while nobody could sign in, and only signing in against the deployed URL distinguished the two.
- **S-02: user can browse and search a catalogue of exercises, add their own to a private catalogue, and give each one exactly one primary muscle group and a bodyweight flag** — Archived 2026-08-10 → `context/archive/2026-08-10-exercise-catalogue/`. Lesson: the plan had no deployment phase, so closing it left 38 seeded exercises in the production database with no route able to reach them while every success criterion passed — a slice whose outcome is a screen needs a deploy phase of its own, now recorded in `context/foundation/lessons.md`.
- **S-01: user can create an account with an email address and a password, sign in, sign out, and is sent to sign-in when they request a training screen while signed out — landing afterwards on the screen they originally asked for** — Archived 2026-08-10 → `context/archive/2026-08-10-account-access/`. Lesson: the three defects that mattered most were all invisible to a green pipeline — a confirmation link pointing at `localhost:3000` (the account confirmed correctly while the user was told the site was unreachable), a redirect channel that rendered any text from `?error=` as a system message, and the plan's self-described "heart of this change" having no test at all, so swapping `data.session` for `data.user` passed every assertion while breaking every production signup. Two were found by a human clicking a real link and by a post-hoc review, not by the gate.
- **S-04: user is told at the moment of saving when a set beats their previous best for that exercise, and can open a list of their current records per exercise — the best estimate and the heaviest absolute weight side by side** — Done 2026-08-11 → `https://gymlog.10x-astro-starter.workers.dev/records`. Lesson: **a guard you mutate may turn out not to be a guard at all, and the honest fix is to correct the claim rather than fake a test.** The mutation protocol ran five mutations against the two new views; four broke their named assertion and one — removing `security_invoker` from the outer view — broke nothing, because every row it emits is drawn through the inner view whose own flag hands the permission decision back to the real caller. No assertion writable from the integration suite can catch that case, so the migration now says which flag is load-bearing, which is defence in depth, and names the future edit that would make the second one matter. Two smaller ones: the two 1RM formulas are numerically identical at exactly ten repetitions, so a parity test written there proves nothing about the formula toggle; and a test whose own comment admits it cannot reach the path it names is an empty test that reads as coverage.
- **S-06: user can choose kilograms or pounds, choose whether estimates use Epley or Brzycki, and set the timezone their training week is evaluated in — and every weight, estimate and total on screen follows the choice consistently** — Archived 2026-08-13 → `context/archive/2026-08-12-unit-formula-timezone-preferences/`. Lesson: **"a user cannot do X yet" is not the same as "X is untested"** — the plan's headline risk was the `reps::numeric / 30` cast, on the reasoning that only an account switching formula could see the defect and nobody could switch yet; the integration suite had been toggling that column since S-04, so the largest phase was designed to cover something already covered, and only a reader who had not written the plan checked. Three more this slice paid for: a mutation that goes red **for the wrong reason** has confirmed nothing (deleting `.eq("id", userId)` fails because PostgREST refuses an unfiltered `UPDATE`, which says nothing about which row the handler resolves); a manual criterion whose outcome depends on the **hour it runs** is badly written (`Pacific/Kiritimati` is "far away" and was on the same calendar date, so 9 of 418 zones qualified that morning); and an assertion kept because it cannot fail **yet** must carry the same paragraph you would write to refuse it, since the code for a tripwire and for decoration is identical. The implementation review — two sub-agents, because the implementer was also the reviewer — found the screen offering a timezone the endpoint then refused, and a strengthened assertion then surfaced zod's own prose reaching the `code` field in three places, two of them in modules this slice had deliberately left alone.
- **S-03: user can create a workout dated today with an optional note, add an exercise from the catalogue, log a set of repetitions and weight, save, and immediately see an estimated one-rep max for that set — with the workout present in their list, most recent first, after a reload** — Archived 2026-08-11 → `context/archive/2026-08-10-log-workout-with-estimate/`. Lesson: row-level security as written here protects a row, not a record — every policy checks `user_id` on the row in front of it, so an account could insert a row carrying its OWN owner id and SOMEBODY ELSE'S parent id and have it accepted. Reproduced in `gymlog-test`, where the grafted row persisted until it was deleted by hand; closed declaratively with composite foreign keys to `(id, user_id)` rather than a trigger, and written into `AGENTS.md` as the nested-ownership variant. Two smaller ones: a placeholder showing a value that is valid for the thing being logged reads as a filled field (found by a human at 360 px, invisible to a green gate), and a criterion demanding a unit test must name the module that will hold it.
- **S-05: user can edit a workout's date and note, edit or delete an individual set, and delete a workout together with everything under it — being told first which record it holds and what that record will fall to, and having to confirm** — Archived 2026-08-12 → `context/archive/2026-08-11-edit-and-delete-log/`. Lesson: **under row-level security a write that touches nothing SUCCEEDS**, so "it failed" has to be built — every mutation now selects what it touched and a zero-row result becomes a 404 carrying the same code as "absent", proven by the first suite in this repository to exercise the twelve update/delete policies S-03 created. Two smaller ones: a ranking query that is exact for removing ONE row can be silently wrong for a set of them (deleting a workout can take the leader AND the runner-up, so the record falls past both), and a plan that says "use X unless it is too expensive" must state the number BEFORE the measurement — the shadcn dialog cost +40 KB in a hydrated island against a ~15 KB threshold written in advance, which made the decision arithmetic instead of a debate.
- **S-07: user opens the home screen and sees total tonnage for the current training week next to the previous one, with a week that has no logged sets reading as zero and an explanation rather than a blank** — Archived 2026-08-14 → `context/archive/2026-08-13-weekly-tonnage/`. Lesson: **a mutation protocol proves nothing if the ambient environment makes the guard inert** — both week-boundary guards passed under UTC, the zone CI runs in, so `vitest.config.ts` now pins `TZ` to `America/New_York` for two load-bearing properties (daylight saving and a negative offset); the first pin tried, `Europe/Warsaw`, read as principled and left the second guard silent because its offset is positive. That the pinned zone is nobody's real zone is the point: the value under test is supposed to be zone-independent. Three more this slice paid for: a suite that filters by **date range** cannot be isolated by a name prefix, because the range does not care what a row is called, so every test now gets its own pair of weeks in a year no other suite writes to; **never mutate the column your own cleanup keys on** — the moved-workout test PATCHed `note: null` against a full-replacement schema and cleared the very mark `beforeAll` deletes by, leaving an orphan that survived every later teardown and had to be removed by hand; and a column carried "for completeness" is one a future reader assumes something depends on — `set_count` was dropped before it was written once the review showed a grouped view emits a row iff the day has a set.
- **S-08: user can see the current week's tonnage broken down per exercise and per muscle group, with the group figures summing exactly to the week's total** — Archived 2026-08-14 → `context/archive/2026-08-14-tonnage-breakdown/`. Lesson: **under `security_invoker`, a JOIN is a FILTER** — the muscle group lives on `exercises`, whose select policy admits only seeded or owned rows, and `exercise_entries.exercise_id` is a single-column key that foreign-key checks reach without RLS, so a row can point at another account's private exercise. An inner join would have deleted that set's kilograms from its **own owner's** breakdown while the weekly total still counted them: no error, both figures plausible, and the only symptom two numbers on one screen that stop agreeing. The view uses `left join`, the fold refuses any breakdown that does not reconcile within a stated tolerance, and integration assertion 9 constructed the grafted row rather than describing it — until S-09's `cross-account-isolation` refused that row at the source on 2026-08-15, which made the assertion unconstructible and retired it. **The `left join` is still load-bearing and is now unguarded**; `lessons.md` § "Closing a defect can retire the only test of an unrelated guarantee" carries the record. Three more this slice paid for: **reconciling the kilograms does not reconcile the SCREEN** — rounded one at a time, three rows of `33.5` print `102` under a total of `101`, so the column is rounded together by largest remainder and the owner ruled that the column adding up beats a row being individually truthful; **a mutation anchored on a fragment can mutate the comment instead of the code** — `greatest(s.weight_kg, 0)` appears in the migration header before it appears in the `SELECT`, `String.replace` took the first match, and an unmutated view passed 9/9, caught only because the harness read `pg_get_viewdef` back; and **a guard on the wrong side of the network does not guard what it claims** — the row cap refused an implausible week only after the whole payload had crossed into the Worker and been parsed, which is the work the 10 ms CPU cap makes dangerous, found by the implementation review and fixed with a `+ 1` limit that keeps the refusal reachable.
