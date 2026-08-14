---
project: "GymLog"
version: 1
status: draft
created: 2026-08-08
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# GymLog — Product Requirements

## Vision & Problem Statement

Someone who lifts three or four evenings a week already writes every set down — a notebook in
the gym bag, or a notes app on the phone. The data is there. What is missing is the arithmetic.
To answer "am I actually getting stronger?" or "did I do more work this week than last?" that
person would have to compare sets at different rep counts and different loads by hand, across
weeks, so they don't. The result is training by feel: guessing what to load at the rack,
half-remembering whether 100 kg × 5 was ever hit before, and noticing a stalled block only weeks
after it stalled.

Every number needed to answer those questions is already in an ordinary training log.
Repetitions and weight are enough to derive a comparable strength score for each set, to sum a
week's work into a single figure, and to know the moment a set beats everything that came
before it. This is not a data-capture problem that needs more input from the user — it is an
arithmetic problem the product can do silently at save time. No coaching, no generated advice,
no wearables: the same notebook, with the maths already done.

## User & Persona

**Primary persona — the after-hours lifter.** Recreational, self-coached, trains 3–4 evenings a
week at a commercial gym after a full workday. Runs a simple progression on a handful of
compound lifts plus accessories. Not a competitor and not a beginner: knows what an RPE is, does
not know last month's estimated one-rep max. Logs sets on a phone, one-handed, between sets,
standing at the rack — so entry has to be fast and forgiving. Reaches for the product twice:
during the session to record and to decide the next load, and once at the weekend to see whether
the week added up.

No secondary persona. There is no coach, no training partner, and no one the data is ever
shown to.

## Success Criteria

### Primary

- A signed-in user can record a complete workout — date, at least one exercise, at least one set
  with repetitions and weight — on a phone in under two minutes, and on save sees, without any
  further input, an estimated one-rep max for each exercise and an explicit flag on any set that
  beat their previous best for that exercise.
- Opening the product shows tonnage for the current training week and the previous one, so the
  week-over-week comparison requires no manual arithmetic.

### Secondary

- Tonnage broken down by muscle group and by exercise, so the user can see where the week's work
  actually went and spot a neglected group at a glance.
- Kilogram / pound switching, so the numbers read naturally regardless of how the gym's plates
  are labelled.
- A per-exercise history of estimated one-rep max over time.

### Guardrails

- No user can ever reach another user's workouts, sets, or records — through the interface or
  through a request that names an identifier directly. A breach here is a failure even if
  everything else works.
- A saved workout is never silently lost, reordered, or altered. Edits are explicit.
- The derived numbers never fabricate a result: no rounding or unit conversion may turn a
  non-record into a record, and no estimate is shown where the formula is not valid.

## User Stories

### US-01: Lifter logs a session and immediately sees what it was worth

- **Given** a signed-in user with at least one exercise available in their catalogue
- **When** they create a workout for today, add an exercise, enter a set of repetitions and
  weight, and save
- **Then** the workout appears in their list with an estimated one-rep max shown for that set,
  and the week's tonnage on the home screen includes it

#### Acceptance Criteria

- The date field defaults to today; the user does not have to touch it in the common case.
- Repetitions and weight are the only mandatory fields on a set; RPE and the workout note are
  optional and never block a save.
- The estimated one-rep max is computed with the formula the user has selected and is shown for
  sets of one to twelve repetitions; outside that range no estimate is displayed.
- A set of exactly one repetition shows an estimate equal to the weight lifted.
- Saving is confirmed visibly; a workout that was saved is present after a page reload.

### US-02: A personal record is announced at the moment it happens

- **Given** a user who has previously logged at least one valid set for a given exercise
- **When** they save a set whose estimated one-rep max exceeds every previous estimate for that
  same exercise
- **Then** that set is flagged as a personal record at save time, and the exercise's entry in
  the records list updates to the new value

#### Acceptance Criteria

- The first-ever set for an exercise establishes the baseline and is NOT announced as a record.
- Sets excluded from estimation — over twelve repetitions, or assisted with a negative load —
  never trigger a record.
- Unit conversion and rounding cannot by themselves produce a record: a set equal to the previous
  best once both are expressed in the same unit is not a record.
- The heaviest absolute weight ever handled for the exercise is shown alongside the estimate
  record, and the two may belong to different sets.
- If the set holding a record is edited or deleted, the record recomputes from the sets that
  remain, and may go down. Records are never kept as free-standing trophies: every record shown
  is backed by a set that still exists.
- Before deleting a workout or a set that holds a standing record, the user is told which record
  it holds and what value that record will fall to, and must confirm.

### US-03: The week's work is comparable to last week's

- **Given** a user with sets logged across the current and the previous training week
- **When** they open the home screen
- **Then** they see total tonnage for both weeks, plus a breakdown of the current week by muscle
  group and by exercise

#### Acceptance Criteria

- A training week runs Monday to Sunday evaluated in the user's own timezone; a session logged
  on Sunday evening belongs to that week, not the next.
- Each exercise contributes its tonnage to exactly one muscle group, so the per-group figures
  sum precisely to the week's total — no set is counted twice and none is left out.
- Tonnage is repetitions multiplied by weight, summed across sets; sets with zero weight
  contribute nothing to the total, and assisted sets with a negative load contribute nothing
  rather than a negative amount.
- Both figures are expressed in the user's chosen unit and change together when the unit changes.
- Moving a workout to a different date recomputes both affected weeks.
- A week with no logged sets reads as zero with an explanatory empty state, not as a blank.

### US-04: One account's training is unreachable from another

- **Given** two accounts, each with its own workouts
- **When** one account attempts to read, edit, or delete a workout belonging to the other,
  including by naming that workout's identifier directly
- **Then** the attempt fails and the target workout is left exactly as it was

#### Acceptance Criteria

- The failure is verified against the recorded data, not only against the response the caller
  sees.
- The same protection applies at every level of the record — workouts, exercise entries, and
  individual sets.
- Signing out and returning requires authenticating again before any training data is shown.

## Functional Requirements

### Authentication & access

- FR-001: Visitor can create an account with an email address and a password. Priority: must-have
  > Socrates: Counter-argument considered: "for a single user, a login screen is pure overhead —
  > a local-only app would ship faster." Resolution: kept. The data has to survive a phone
  > change and be reachable from two devices, and access control is a first-class goal of this
  > product, not incidental scaffolding.
- FR-002: User can sign in and sign out. Priority: must-have
  > Socrates: Counter-argument considered: "sign-out is dead weight on a personal device."
  > Resolution: kept; without it the account is untestable and unshareable across devices, and
  > it costs almost nothing.
- FR-003: Unauthenticated visitor is redirected to sign-in when requesting any screen that shows
  or edits training data. Priority: must-have
  > Socrates: Counter-argument considered: "a redirect is a nicety; the real check is what
  > matters." Resolution: kept, but reframed — the enforcement of ownership is the real
  > requirement and is covered by the guardrail; the redirect is what makes the boundary visible
  > and testable.

### Workout logging

- FR-004: User can create a workout with a date, defaulting to today, and an optional note.
  Priority: must-have
  > Socrates: Counter-argument considered: "notes invite freeform text that nothing ever reads."
  > Resolution: kept as optional; it is the escape hatch for everything the product does not
  > model (sleep, injuries, gym was busy) and it prevents scope creep into structured fields.
- FR-005: User can view a list of their own workouts, most recent first. Priority: must-have
  > Socrates: Counter-argument considered: "a calendar view would be more natural for training."
  > Resolution: list kept for the MVP — it is the flow's confirmation step and works on a narrow
  > screen; a calendar is a presentation change that can follow later.
- FR-006: User can edit a workout's date and note. Priority: must-have
  > Socrates: Counter-argument considered: "editing dates lets the user move a workout across a
  > week boundary and silently rewrite two weekly tonnage figures." Resolution: kept — logging a
  > session a day late is the common case — but the recomputation on date change becomes an
  > explicit acceptance criterion rather than an assumption.
- FR-007: User can delete a workout together with all of its exercise entries and sets.
  Priority: must-have
  > Socrates: Counter-argument considered: "deleting a workout can destroy the set that holds a
  > standing personal record, leaving a record pointing at nothing." Resolution: kept, and the
  > consequence is now named: records are derived from surviving sets, never kept as
  > free-standing trophies — so a deletion may lower a record, and the user is warned by how
  > much before confirming (see US-02).
- FR-008: User can add an exercise entry to a workout, chosen from the exercise catalogue.
  Priority: must-have
  > Socrates: Counter-argument considered: "free-text exercise names would be faster to log."
  > Resolution: rejected — free text makes personal records and per-exercise tonnage impossible
  > to compute, because 'bench' and 'Bench Press' would not be the same lift. The catalogue is
  > what makes the domain rule work at all.
- FR-009: User can log sets under an exercise entry, each with repetitions, weight, and an
  optional RPE. Priority: must-have
  > Socrates: Counter-argument considered: "RPE is subjective and most users skip it."
  > Resolution: kept as optional and excluded from every computation — it is recorded for the
  > human reader only, so it cannot corrupt any derived number.
- FR-010: User can edit and delete an individual set. Priority: must-have
  > Socrates: Counter-argument considered: "mistyped sets could just be fixed by deleting the
  > workout." Resolution: rejected as absurd in practice; a fat-fingered weight is the single
  > most common correction, and every derived figure must react to it.

### Exercise catalogue

- FR-011: User can browse and search a catalogue of exercises. Priority: must-have
  > Socrates: Counter-argument considered: "a seeded catalogue is content work that delays the
  > first working flow." Resolution: kept but bounded — a small seeded set covering the main
  > lifts, not an exhaustive collection; FR-012 covers the rest.
- FR-012: User can add a custom exercise to their own catalogue. Priority: must-have
  > Socrates: Counter-argument considered: "custom exercises fragment the catalogue and weaken
  > per-exercise records." Resolution: kept — without it the product is unusable the first time
  > someone does a lift we did not seed, and the fragmentation is the user's own to manage.
- FR-013: Every exercise carries exactly one primary muscle group, and the user selects it when
  creating a custom exercise. Priority: must-have
  > Socrates: Counter-argument considered: "a single primary group is anatomically wrong — a
  > squat trains quadriceps, glutes and the back at once, so per-group tonnage will understate
  > half of what the user actually did." Resolution: accepted as a deliberate trade. A weighted
  > multi-group split would be more anatomically faithful, but the weights would be invented and
  > per-group tonnage would stop summing to the total. A single primary group keeps every
  > displayed figure exactly reconcilable with the week's total, which matters more here than
  > anatomical precision. The alternative — omitting the attribute — was rejected because it
  > cannot be added later without retroactively tagging every custom exercise the user has
  > already created.
- FR-014: User can mark an exercise as bodyweight-based, so its sets may carry zero or negative
  (assisted) load. Priority: must-have
  > Socrates: Counter-argument considered: "bodyweight work could simply be excluded from the
  > MVP." Resolution: rejected — pull-ups and dips are in almost every real training week, and
  > excluding them would push the product's most awkward arithmetic out of sight instead of
  > solving it. This FR is what forces the zero/negative-load rules to be explicit.

### Computed insights

- FR-015: User sees an estimated one-rep max for each logged set and, per exercise entry, the
  best estimate of that entry. Priority: must-have
  > Socrates: Counter-argument considered: "1RM estimates are inaccurate and could mislead
  > someone into a dangerous attempt." Resolution: kept, with the validity range made a hard
  > rule (FR-016 and Business Logic): no estimate is shown where the formula does not hold, and
  > the number is framed as a comparison score, not a weight to attempt.
- FR-016: User can choose which estimation formula is applied, Epley or Brzycki, and the choice
  applies consistently everywhere estimates are shown. Priority: must-have
  > Socrates: Counter-argument considered: "one formula would be simpler; exposing a choice is
  > a settings screen nobody visits." Resolution: kept — the two formulas disagree most exactly
  > where lifters live (3–8 repetitions), and pinning one silently would make the headline
  > number an arbitrary opinion. Consistency across screens is the acceptance criterion.
- FR-017: User sees total tonnage for the current training week and for the previous one.
  Priority: must-have
  > Socrates: Counter-argument considered: "tonnage rewards junk volume — more repetitions at a
  > light weight beats a hard heavy session." Resolution: kept, because it answers a question the
  > user actually asks ("was this week more work?"), and it is deliberately paired with the
  > one-rep-max estimate so that volume is never the only signal on screen.
- FR-018: User sees the week's tonnage broken down per exercise. Priority: must-have
  > Socrates: Counter-argument considered: "a single weekly number is enough for one person."
  > Resolution: kept — the aggregate alone cannot tell the user _where_ the work went, which is
  > the only actionable part of the figure.
- FR-019: User sees the week's tonnage broken down per muscle group. Priority: must-have
  > Socrates: Counter-argument considered: "this is the per-exercise breakdown with fewer rows —
  > redundant." Resolution: rejected. Twelve exercise rows is a table nobody reads; four or five
  > muscle-group rows is the view that makes an imbalance obvious at a glance, which is the only
  > reason to look at volume at all. The two breakdowns answer different questions and both are
  > cheap once FR-013 exists.
- FR-020: User is told, at the moment of saving, when a set beats their previous best for that
  exercise. Priority: must-have
  > Socrates: Counter-argument considered: "a record notification at save time will fire on
  > every session in the first weeks, when every set is a first-ever, and become noise."
  > Resolution: kept, and the first-ever case becomes an explicit acceptance criterion — the
  > first set for an exercise establishes a baseline and is not announced as a record.
- FR-021: User can view their current personal records per exercise. Priority: must-have
  > Socrates: Counter-argument considered: "records are already surfaced at save time; a separate
  > list is redundant." Resolution: kept — the save-time flag is ephemeral and only covers the
  > set just logged, while the list is what the user checks before deciding a load.

### Units

- FR-022: User can set a preferred unit, kilograms or pounds, and every weight shown or totalled
  is expressed in it. Priority: must-have
  > Socrates: Counter-argument considered: "a Polish user will only ever use kilograms; pound
  > support is invented scope." Resolution: kept — it is the requirement that forces conversion
  > and rounding to be handled deliberately rather than accidentally, and the round-trip rule it
  > implies is one of the sharpest edge cases in the product.
- FR-023: User can see a per-exercise history of their estimated one-rep max over time.
  Priority: nice-to-have
  > Socrates: Counter-argument considered: "a trend chart is the fun part and will eat the
  > timeline." Resolution: demoted to nice-to-have; the record list and the weekly comparison
  > already answer the core question, and this is the first thing to cut if three weeks tighten.

## Non-Functional Requirements

- No account's training data is obtainable by another account through any interface, including a
  request that names a workout, exercise entry, or set identifier directly. This holds for
  reads, modifications, and deletions alike.
- Recording one set requires entering only repetitions and weight; every other field is optional.
  The entry surface is operable one-handed on a screen 360 px wide.
- A user opening any screen sees usable content in under 2 seconds at the 95th percentile on a
  mid-range phone over a mobile connection, and sees acknowledgement of any save within 200 ms.
- Derived values are deterministic and reproducible: the same set, formula, and unit always yield
  the same displayed number, and displayed weights carry at most one decimal place.
- A weight entered in pounds and read back in pounds is the number the user typed; switching the
  display unit and switching back never changes a logged value.
- A user can delete their account together with all associated training data, after which none of
  it is retrievable through the product.
- The product remains usable on the latest two major versions of the four mainstream desktop
  browsers and on current mobile Safari and Chrome.
- Nothing about a user's training is exposed publicly; there is no unauthenticated read path to
  any training data.

## Business Logic

**Every logged set is converted into a single comparable strength score — an estimated one-rep
max — and it is that score, not the raw weight, that decides whether the user has just set a
personal record.**

The rule consumes only what the user already types: the exercise, the number of repetitions, the
weight, and the unit it was entered in, together with the workout's date. It produces three
things. First, a per-set estimated one-rep max, computed by the formula the user selected —
Epley or Brzycki. Second, a weekly tonnage figure: repetitions multiplied by weight, summed over
every set in a training week — in total, per exercise, and per muscle group. Because each
exercise belongs to exactly one muscle group, the per-group figures always reconcile exactly
with the total; the product never invents a split. Third, a record verdict: a set is
a personal record when its estimated one-rep max exceeds every previous estimate for that same
exercise on the same account; the heaviest absolute weight ever handled is tracked separately as
a secondary record, because a heavy single and a high estimate are different achievements and
lifters care about both.

The user encounters all three without asking for them. The estimate appears next to each set as
it is logged. The record verdict arrives at save time, on the set that earned it. The weekly
tonnage is on the first screen after sign-in, alongside the previous week's figure.

The rule is only as good as its boundaries, and the boundaries are part of the rule:

- **Single repetitions.** At one repetition the estimate must equal the weight lifted. Brzycki
  yields this naturally; Epley does not and has to be pinned at one repetition. A product that
  reports a 100 kg single as a 103 kg estimate is wrong in the most visible possible place.
- **Validity range.** Both formulas degrade as repetitions climb, and Brzycki breaks outright in
  the high thirties. Estimates are shown for one to twelve repetitions; beyond that no estimate
  is shown rather than a fabricated one, and such sets take no part in record detection.
- **Zero and negative load.** A bodyweight set carries no external weight and therefore adds
  nothing to tonnage; it is still recorded, and its repetitions still count as work done. An
  assisted set carries negative load and is excluded from both estimates and record detection —
  there is no meaningful strength score for a lift someone helped you do.
- **Units.** Weights are held in one canonical unit and presented in the user's chosen one.
  Conversion and rounding may never move a value far enough to invent a record or erase one.
- **Week boundaries.** A training week runs Monday to Sunday in the user's own timezone, held on
  their profile — not in a fixed universal one. A Sunday-evening session must not land in next
  week's total because a clock elsewhere is an hour ahead.
- **Records are derived, never awarded.** A record is always the best surviving set, recomputed
  whenever the sets it is drawn from change. Nothing is written down as a permanent trophy. The
  cost is that a record can fall when a set is corrected or removed; the benefit is that no
  number in the product can outlive the evidence for it — the same stance as refusing to show an
  estimate outside the formula's valid range.

## Access Control

Sign-in with **email and password**. Account creation is self-service; no invitation flow, no
social sign-in, no passwordless option in the MVP.

Flat user model — a single role. There are no administrators, no coaches, no shared workouts.
Every workout, exercise entry, and set belongs to exactly one account, and a user can only read
or modify their own; ownership is enforced by the product, not merely hidden in the interface.
An unauthenticated visitor requesting any data screen is redirected to sign-in and, after
signing in, lands on the screen originally requested.

The seeded exercise catalogue is readable by every signed-in account. Custom exercises added by
a user (FR-012) are private to that account.

## Non-Goals

- **No training programme generation, coaching cues, or load recommendations.** The product
  reports what happened and what it implies; deciding the next block is the user's job. This is
  the boundary that keeps the domain rule small enough to be correct.
- **No generative or predictive intelligence of any kind.** The value here is arithmetic that is
  verifiable and reproducible; a probabilistic layer would make the headline numbers unauditable.
- **No social surface** — no sharing, following, leaderboards, or comparison against other users.
  Single-tenant by design; it also keeps the access-control model flat.
- **No nutrition, bodyweight, sleep, or cardio tracking.** Each would bring its own domain rules
  and none of them improves the strength question the product exists to answer.
- **No import from other trackers or wearables.** Manual entry only; an import path would need a
  mapping onto the exercise catalogue before the first working flow even exists.
- **No native mobile application and no offline-first guarantee.** The gym has signal;
  connectivity is assumed. Offline synchronisation is a product of its own.
- **No coach/athlete roles or shared workouts**, now or implied by the MVP's shape.
- **No multi-region availability target and no compliance work beyond baseline GDPR duties** —
  own-data deletion, and no unnecessary personal data collected.

## Open Questions

1. ~~**What is the muscle-group taxonomy, and which exercises ship in the seeded catalogue?**~~ —
   **The taxonomy half is RESOLVED (owner, 2026-08-10); the seeded exercise list is not yet.**

   **Six groups: `legs`, `back`, `chest`, `shoulders`, `arms`, `core`.** Six sits inside the band
   this document already argued for — coarser than push/pull/legs, which says nothing, and far
   from fifteen, which makes every week look sparse. Glutes were considered as a seventh and
   biceps/triceps as an eighth and ninth; both were declined for now on an asymmetry that decides
   the whole question: **adding a group later is cheap** (a new enum value, no historical figure
   moves) **while merging or removing one is expensive** (every exercise re-tagged and every
   historical per-group tonnage rewritten — Open Question 2). When in doubt, start narrower.

   **The assignment rule for multi-joint lifts: the group the lifter has in mind when they put
   the exercise in their programme.** This is the load-bearing half of the decision — without a
   stated rule the catalogue goes inconsistent at the first deadlift. Worked examples, which are
   the rule rather than illustrations of it: deadlift → `back`, pull-up → `back`, dip → `chest`,
   overhead press → `shoulders`, squat → `legs`, row → `back`, skull crusher → `arms`.

   Rejected alternatives, with the reason: _primary anatomical mover_ is objective and checkable
   but counter-intuitive here — it files the deadlift under `legs`, so the `back` bar reads as
   neglected for someone who trains it on pull day, and the chart's whole job is to show whether
   a real training week is unbalanced. _Whichever muscle limits the load_ is closest to what the
   lift actually taxes, but it is per-person and drifts over time, so the same seeded exercise
   would belong to different groups for two accounts — unusable for a shared catalogue.

   **The seeded catalogue is RESOLVED too (owner, 2026-08-10): 38 exercises.** Chosen for the
   persona — a recreational lifter, three or four evenings a week, commercial gym, a few compound
   lifts plus accessories — not for completeness. `bw` marks the bodyweight flag of FR-014, which
   means "may carry zero or negative load", not "never loaded": a weighted pull-up still works.

   | Group       | Exercises                                                                                                              |
   | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `legs`      | Back Squat, Front Squat, Leg Press, Romanian Deadlift, Dumbbell Lunge, Hip Thrust, Leg Extension, Leg Curl, Calf Raise |
   | `back`      | Deadlift, Pull-Up (bw), Chin-Up (bw), Lat Pulldown, Barbell Row, Dumbbell Row, Seated Cable Row                        |
   | `chest`     | Bench Press, Incline Bench Press, Dumbbell Bench Press, Dumbbell Fly, Cable Crossover, Dip (bw), Push-Up (bw)          |
   | `shoulders` | Overhead Press, Dumbbell Shoulder Press, Lateral Raise, Rear Delt Fly, Face Pull                                       |
   | `arms`      | Barbell Curl, Dumbbell Curl, Hammer Curl, Skull Crusher, Triceps Pushdown, Overhead Triceps Extension                  |
   | `core`      | Plank (bw), Hanging Leg Raise (bw), Cable Crunch, Ab Wheel Rollout (bw)                                                |

   Five assignments are deliberate and should not be "corrected" without a decision:
   - **Deadlift → `back` while Romanian Deadlift → `legs`.** This looks inconsistent and is the
     clearest demonstration that the rule works: the conventional pull is programmed on pull day,
     the Romanian variant on leg day for the hamstrings. An anatomical rule would file both under
     `legs`.
   - **Hip Thrust → `legs`**, the direct consequence of declining a `glutes` group. If it is
     trained heavily and often, it will inflate the `legs` bar — that is the signal that a seventh
     group has become worth its cost.
   - **Dip → `chest`**, per the rule. The forward-leaning variant is mostly triceps; a lifter who
     programmes it that way re-tags their own copy.
   - **Face Pull → `shoulders`**, not `back`: usually done on pull day, but it targets the rear
     delts and that is how lifters think of it.
   - **Push-Up and Plank carry the bodyweight flag** even though nobody assists them, because the
     flag is what permits a zero load — a plank logged with weight 0 must not be a validation
     error.

   Deliberately absent: Olympic lifts (a different population), brand-specific machines (not
   portable between gyms), and grip or angle variants such as close-grip bench — FR-012 exists so
   the user adds those themselves.

2. ~~**How is an exercise's muscle group corrected after the fact?**~~
   — **RESOLVED (owner, 2026-08-14).**

   **The correction is retroactive, and it is retroactive by construction rather than by choice.**
   Nothing stores the muscle group beside a set: `sets` carries no copy and `exercise_entries`
   deliberately carries none either, so the group is joined from `public.exercises` at read time.
   Changing it therefore moves every historical per-group figure that exercise contributed to, on the
   next read, with no write and nothing to invalidate.

   **What that costs is smaller than it first sounds, and saying where it stops is the point.** The
   correction moves tonnage **between** buckets and **cannot change the week's total**, because the
   total never learns what a group is — `public.daily_tonnage` does not join `exercises` at all. So
   the number the user checks their week against is bit-identical before and after, and only the
   split under it moves. A correction is also self-evidently a correction: the figures move because
   the user said the old ones were wrong.

   Rejected alternative, with the reason: **snapshotting the group onto the exercise entry**, which
   would make corrections forward-only and leave already-seen numbers frozen. It was declined
   because it contradicts the load-bearing absence recorded in
   `supabase/migrations/20260811005248_create_workout_log_with_row_ownership.sql:71-76` ("No
   muscle_group column, and that absence is load-bearing"), and because it turns a re-derivation into
   stored state — the same move that would turn S-06's formula switch from a recomputation into a lie
   about history. It also buys less than it appears to: the split would then be wrong in the log
   forever, with no way to fix it, which is the failure the user is trying to correct.

   **No edit path exists yet.** S-08 settled the semantics because its figures depend on them;
   shipping `PATCH /api/exercises/[id]` is a separate slice, and it inherits this answer rather than
   re-opening it.

Resolved during shaping, recorded here so the reasoning is not lost:

- **Records are tracked per exercise, not per repetition-range.** A five-repetition best and a
  one-repetition best are different goals, and the single per-exercise record hides one of them —
  but the secondary absolute-weight record covers the case lifters care about most, and because
  records are derived rather than awarded (see Business Logic), repetition-range buckets can be
  added later from existing data alone. Out of MVP scope.
- **A record may fall when the set holding it is corrected or deleted**, and the user is warned
  by how much before confirming (US-02). The alternative — permanent trophies — was rejected
  because a mistyped weight would then sit in the log forever and block a future genuine record.
