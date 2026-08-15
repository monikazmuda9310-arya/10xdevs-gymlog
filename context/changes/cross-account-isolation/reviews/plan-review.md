# Plan review — cross-account-isolation

**Reviewed:** `plan.md` @ `b03672e`, with `plan-brief.md` and `change.md`
**Date:** 2026-08-15 · **Reviewer:** fresh-context subagent (~145k tokens, 19 tool calls)
**Result:** 3 critical, 3 warnings, 3 observations · verdict **RETHINK**
**Applied in:** `1e63f67` — all nine addressed

> **Why this file exists.** F1 below is the reason. The plan now records in `AGENTS.md` that the
> `left join` in `public.daily_exercise_tonnage` is **no longer test-guarded**, and the first reader
> of that sentence will reasonably ask "then restore assertion 9". The answer — that no suite can
> construct the hazard row any more, because the only remaining route is `service_role`, which the
> harness strips — is a piece of reasoning, not a conclusion, and it lives here. The commit message
> carries the verdict; this carries the evidence.
>
> **One correction to the report as written.** F3 states that no owner escalation appears. The
> reviewer worked from the artefacts alone and could not see the planning conversation: the mechanism
> **was** put to the owner, who chose the trigger on 2026-08-15. The surviving half of F3 is real and
> was fixed — the alternative was not weighed _in writing_, and the stated reason for rejecting a
> composite key was technically wrong.

---

## Scorecard

| Dimension             | Result      |
| --------------------- | ----------- |
| End-State Alignment   | WARNING (1) |
| Lean Execution        | PASS        |
| Architectural Fitness | FAIL (2)    |
| Blind Spots           | FAIL (3)    |
| Plan Completeness     | WARNING (2) |

Grounding: 6/6 paths, 4/4 symbols, all four inline `file:line` citations exact; brief↔plan consistent;
Progress↔Phase contract clean (12/3/5 rows, all matched).

---

## CRITICAL

### F1 — The trigger makes `tonnage-breakdown` assertion 9 unconstructible: the gate goes red and an existing documented guard is destroyed

The plan cites `tests/integration/tonnage-breakdown.test.ts` assertion 9 **three times** —
`plan.md:36`, `plan-brief.md:9`, `change.md:34` — as proof the hazard row is "constructible rather than
hypothetical". It never notices that its own trigger removes that constructibility.

Verified:

- `tonnage-breakdown.test.ts:531-539` builds the hazard row by having `ownerA` log a workout whose entry
  names `theirs`, an exercise created by `ownerB` (`:533`).
- That insert goes through `logWorkout`, which **throws** on any insert error (`:188-190`). With the
  trigger in place the insert is refused with `23503`, so assertion 9 does not fail an expectation — it
  dies in setup.
- `vitest.integration.config.ts:33` includes every suite, so `npm run test:integration` is red the
  moment the migration lands. Phase 1 criterion 1.3, Phase 2 criterion 2.3 and Phase 3 criterion 3.1
  become unachievable.

The larger loss is what the suite was holding:

- `AGENTS.md` § Domain rules: assertion 9 "is the only thing here that would notice the `left` being
  'simplified' away."
- `lessons.md:316-323`: "`left join` to any RLS-protected table … Then **construct the hazard row in
  the suite rather than describing it**." After this trigger no suite can, because the only remaining
  route is `service_role`, which `AGENTS.md` § Testing forbids.

And the halves compound. A `before insert` trigger does not validate rows already stored
(`plan.md:102-105`), so pre-existing hazard rows survive in production and `left join` still matters for
them — while Phase 3 rewrites `AGENTS.md` to say the hazard is _closed_. A future reader meets "closed"
plus an unguarded `left join`, simplifies it to `join`, and those rows silently drop their kilograms out
of the breakdown with nothing going red. **That is precisely the failure S-08 was built to prevent,
reintroduced by the slice that claims to close it.**

**Fix:** an explicit Phase 1 step, _before_ the migration is written, that owns assertion 9's fate. The
`lessons.md`-sanctioned response is "fix the claim, never the test" (`:54-61`): retire or rewrite it,
and in the same commit write into `AGENTS.md` and `lessons.md` that the `left join` guard is now
**unguarded**, naming the exact future edit (`left join` → `join`) that would exploit it. Do not delete
it quietly. `tonnage-breakdown.test.ts`, `AGENTS.md` § Domain rules and `access-control.md` belong in
Phase 1's file list, not Phase 3's.

### F2 — Phase 1's measurement will report non-zero on `gymlog-test` and trigger a spurious escalation

Criterion 1.1 says "if either is non-zero, stop and escalate". `gymlog-test` will be non-zero nearly
every time, for a reason that is not a defect: `tonnage-breakdown.test.ts` cleans its fixtures at the
**start** of a run, not the end (`:314-325`), so assertion 9's cross-account entry persists from the end
of one run until the beginning of the next.

The implementer hits an escalation gate written for "somebody's real logged sets" while looking at a
test fixture, with no way to tell them apart.

**Fix:** exclude this suite's `s08-` fixtures from the count, or measure immediately after a clean run
and re-check. Scope the escalation language to production.

### F3 — The plan pre-decides a mechanism `change.md` reserved, and the stated rejection reason is wrong

`change.md:30-31` and `:45` reserve the schema decision and ask for options compared. The plan compares
nothing, and records the result in `plan-brief.md:35` as decided.

The dismissal is also technically wrong, which matters because it was scheduled to be copied into
`access-control.md` (`plan.md:262-264`):

> "`exercises.user_id` is nullable for the 38 seeded rows, `exercise_entries.user_id` is `not null`, and
> **a policy admits a row only on `TRUE`**."

"A policy admits a row only on `TRUE`" is an **RLS** rule — the shared-catalogue variant's explanation
of why seeded rows are unwritable (`access-control.md:72-75`). A foreign key is not a policy and does
not evaluate policies; `AGENTS.md` and `lessons.md:310-311` both say FK checks **bypass** RLS. The
actual reason: under `MATCH SIMPLE`, a referencing tuple with a `NOT NULL` `user_id` can never match a
referenced row whose `user_id` is `NULL`, because FK matching is equality and `NULL = NULL` is not
`TRUE`. Right conclusion, wrong mechanism — and the wrong mechanism is the one being written down.

Nor is the option space empty. A declarative formulation exists: a stored generated sentinel owner key
on `exercises` (`coalesce(user_id, <nil uuid>)`) with `unique (id, owner_key)`, a matching column on
`exercise_entries` constrained by `check (exercise_owner_key = user_id or exercise_owner_key = <nil
uuid>)`, and a composite FK to it. It may well lose — a new column callers must supply, plus a backfill
— but "lost on cost after being weighed" and "not considered" are different documents.

---

## WARNING

### F4 — Assertion 5, "the seam", cannot be asserted from an integration suite

Neither the claimed form nor its weaker version is observable:

- Deleting an account needs `auth.admin.deleteUser`, i.e. `service_role`. `AGENTS.md` § Testing forbids
  it, and `vitest.integration.config.ts:20-25` actively strips every `SUPABASE_*`/`GYMLOG_*` variable
  outside the three allowed, so the capability does not exist in the process.
- "No entry owned by another account references A's exercise" is equally unreachable: under RLS, A reads
  only A's entries and B only B's. The hazard row is by construction visible to **neither**
  (`access-control.md:96-97`).

It collapses into a restatement of assertion 1 or a green body checking nothing — `lessons.md:37-39`:
"decoration that reads as coverage, which is worse than an obvious gap."

**Fix:** demote to prose in the suite header, in the "name the guarantee, name the future edit"
shape (`lessons.md:232-237`). If something assertable is wanted, the honest candidate is that A can
still delete its own **unused** private exercise.

### F5 — The mutation protocol has a duplicate, an out-of-order criterion, and omits the keystone

- **(a)** coherent, fails for its own reason. ✓
- **(b)** coherent ✓ — note it turns `tonnage-breakdown` 9 _green_, which is the tell for F1.
- **(c)** "make the function `return new` unconditionally" is **observationally identical to (b)**.
  One mutation counted twice.
- **(d)** incoherent as placed: a Phase 1 criterion that names a Phase 2 assertion which does not exist
  yet (`plan.md:195` pauses at the end of Phase 1). The claim itself is sound — a non-`23503` code makes
  `addExerciseEntry` re-throw at `workouts.ts:161`, `index.ts:51` misses, and the endpoint answers
  `500 unexpected`.

**Missing, and it is the important one:** flip the function to **`security definer`**. That is the
keystone, it is the most plausible future edit — `security definer` is the reflex for trigger functions
and this repository already has one (`handle_new_user`, `20260810063450_...sql:62`) — and it silently
makes the check pass everything, because the function then runs as `postgres`, which owns the tables
and is not subject to their RLS.

### F6 — Two supporting claims are wrong; the keystone claim itself is right

**The keystone — verified TRUE.** A plpgsql function is `SECURITY INVOKER` by default, so `current_user`
inside it remains the caller; under PostgREST that is `authenticated`, which owns none of these tables
and holds no `BYPASSRLS`; RLS has no exemption for statements issued inside a function body. PostgreSQL
also re-plans RLS-dependent cached plans when the effective user changes, so there is no stale-plan leak.
Phase 1's design is sound on this point.

Two claims around it are not:

1. **"This is the repository's first trigger"** (`plan-brief.md:78`) is false. Five triggers and two
   trigger functions already exist: `set_updated_at` (`20260810063450_...sql:24-25`, invoker,
   `set search_path = ''`) fires on `profiles`, `exercises`, `workouts`, **`exercise_entries`** and
   `sets`; `handle_new_user` (`:61-62`) is `security definer`. The conclusion is still right but for a
   different reason: the novelty is a trigger used as an _access-control_ mechanism.
2. **"Gets the visibility check for free"** holds only for `authenticated`. `postgres` and
   `service_role` bypass RLS. Worth a line in the migration header.

Also: "pin `search_path`" without naming the value. House convention is `set search_path = ''`, which
requires the body to schema-qualify everything.

---

## OBSERVATIONS

### F7 — Claims 1 and 3 verified; one citation is positional and will rot

The coverage table holds up row by row: read-back coverage (`workout-mutations-rls` `:185-187`, `:197`,
`:210-217`, `:233-236`, `:247-249`); all three levels (`workout-log-rls` `:226`, `:253`, `:286`, `:312`);
sign-out uncovered — `signOut` appears only at `src/pages/api/auth/signout.ts:8` and two forms, nothing
under `tests/`, and `workout-endpoints`' unauthenticated assertion (`:200`) constructs
`{ supabase: client, user: null }` rather than ending a session.

**Claim 3 also verified.** `addExerciseEntry` re-throws anything that is not `23505`
(`workouts.ts:160-162`), so a trigger's `23503` reaches `index.ts:51` untouched and maps to
`exercise_not_found` at `:55`. One consequence to record: a `BEFORE` trigger fires ahead of constraint
checks, so afterwards the trigger — not the plain FK — raises for a genuinely missing exercise.
`workout-endpoints`' "tells a missing exercise apart from a workout that is not the caller's" (`:176`)
keeps passing **only** because the trigger's message will not contain
`exercise_entries_workout_owner_fkey`. That rule is now load-bearing for a second assertion in a second
suite.

Weak spot: the table cites "`workout-endpoints` 5", but that suite's `it` titles carry no numbers
(`:92`–`:221`), so the citation is positional and silently wrong once anyone inserts a test. Quote the
title text.

### F8 — The migration contract omits `notify pgrst, 'reload schema';`

Six of the seven existing migrations end with it; only the pure seed does not.

### F9 — Two shared-resource hazards with the parallel branch are unlisted

- **Concurrent integration runs.** `fileParallelism: false` (`vitest.integration.config.ts:36`) orders
  files _within_ one run. It does nothing about two worktrees running against the same `gymlog-test`
  simultaneously — and the sibling suite deletes accounts.
- **A window where the documents are ahead of production.** Phase 3 rewrites `AGENTS.md` to say the
  hazard is closed; deployment is deferred until after both PRs merge. Between merge and `db:push`,
  `main` documents a guarantee production does not have — and F1 makes the `left join` unguarded during
  exactly that window.

---

## Verdict

**Not safe to implement as written.** The research is unusually good — every inline `file:line` citation
checks out, the US-04 coverage table is accurate on all three rows, the "endpoint needs no change"
finding is correct, and the `security invoker` keystone is genuinely true in PostgreSQL. The failure is
not in what it verified; it is in one thing it never asked: **what happens to the test that constructs
the hazard row on purpose.**

Smallest set of changes that makes it safe:

1. Own `tonnage-breakdown` assertion 9 in Phase 1, before the migration is written (F1).
2. Exclude known test fixtures from the measurement; scope the escalation to production (F2).
3. Weigh at least one alternative in writing and correct the composite-key rejection reason (F3).
4. Demote assertion 5 to prose in the suite header (F4).
5. Fix the mutation list: drop (c), move (d) to Phase 2, add the `security definer` mutation (F5).

Items 1 and 3 change the shape of the work. The rest are edits.
