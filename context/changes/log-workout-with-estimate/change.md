---
change_id: log-workout-with-estimate
title: Log workout with estimate
status: implemented
created: 2026-08-10
updated: 2026-08-11
archived_at: null
deviations:
  - phase: 2
    criterion: "2.3 — no `astro:` import in set-estimate.ts or calendar.ts"
    what: >-
      The criterion is written as `git grep -n "astro:"`, which matches prose as well as code and
      therefore false-positives on calendar.ts's own comment explaining that it has no `astro:*`
      import. Verified instead with `git grep -nE 'from "astro:|import "astro:'`, which matches an
      import and nothing else; that returns nothing. The criterion's intent holds — the wording
      does not, and a later phase should not copy the loose pattern.
  - phase: 3
    criterion: "3.5 — scripted create-workout / add-entry / add-set round trip"
    what: >-
      Implemented as an integration suite (tests/integration/workout-endpoints.test.ts) calling the
      exported handlers, not as a standalone script over HTTP. `astro dev` reads its Supabase
      credentials from `.dev.vars`, which points at production, and a process-env override does not
      displace it — so an HTTP round trip would have written test data into the database the owner
      trains against, or failed to authenticate at all. Overwriting the owner's `.dev.vars` was
      refused. The suite exercises the same validation, ownership checks, unit-from-profile rule and
      error mapping against gymlog-test, and unlike a one-off script it stays inside the gate. Not
      covered: Astro's routing and origin check, which Phase 4 exercises through a browser.
  - phase: 6
    criterion: "6.4 — read AGENTS.md § Access control and judge whether the pattern is obvious"
    what: >-
      Reworded before it was asked. As written it is a code-quality judgement about Postgres RLS put
      to a non-specialist, which lessons.md:36-51 exists to forbid — the same question in S-02 got
      "I don't understand any of it", and the question was the deficiency, not the answer. Asked
      instead as three facts checkable by looking: does the section state what an account could do
      without the composite key, that it must be the only foreign key to that parent, and which
      assertion guards it. All three confirmed by the owner, and both of the section's pointers were
      verified to resolve — assertion 4 is literally named "4. THE GRAFT" and the migration carries
      the only-foreign-key comment at lines 18-23. A document pointing at something that does not
      exist is the defect this phase fixed in calendar.ts.
  - phase: 5
    criterion: '5.1 — `git grep -n "tz-probe"` returns nothing'
    what: >-
      Unscoped, that grep can never return nothing: this plan, this file and the plan review all
      name the probe, and they should — the measurement it made is the record of why `todayIn` is
      trusted. Verified as `git grep -n "tz-probe" -- src/`, which returns nothing and is what the
      criterion means. Two source comments in calendar.ts and calendar.test.ts pointed at the file
      as though it still existed and were rewritten to state the measurement instead; a comment
      naming a deleted file is a small lie that sends the next reader looking for it. Same class of
      wording problem as the 2.3 deviation.
  - phase: 4
    criterion: "4.4 — account B gets 404 on account A's workout URL, scripted"
    what: >-
      The HTTP half cannot be scripted from this machine for the reason recorded against 3.5:
      `astro dev` takes its Supabase credentials from `.dev.vars`, which points at production, so a
      two-account scripted run would have to create both accounts and the workout in the database
      the owner trains against. Verified instead at the exact value the page branches on:
      `tests/integration/workout-page-access.test.ts` calls `getWorkout` against gymlog-test as the
      owner (row returned, with its entries and sets) and as a second account (null), plus a
      non-existent id (also null, so absent and somebody-else's are indistinguishable). The page
      answers 404 on precisely that null. The browser half stays with manual criterion 4.12.
  - phase: 3
    criterion: "3.6 — a signed-out POST creates no row (was manual)"
    what: >-
      Automated inside the same suite rather than performed by hand: all three handlers are called
      with `locals.user` null, each must answer 401 `unauthenticated`, and the tables are re-read as
      the owner afterwards to prove nothing landed. Stronger than the manual version and repeatable.
---

## Notes

### Phase 1 — the graft is not theoretical

The mutation test on the composite ownership key did more than fail a test. Replacing it with a
plain `references workouts (id)` in `gymlog-test` let account B attach an exercise entry to account
A's workout, and the row **persisted** — restoring the key failed until that row was deleted by
hand. Whatever else changes in this schema, the composite keys stay, and assertion 4 of
`tests/integration/workout-log-rls.test.ts` stays with them.

### Phase 4 — a placeholder that shows a valid value is a broken field

Manual verification caught the one defect of this phase, and no automated check could have. The set
form's weight field carried `placeholder="0"` on a bodyweight exercise — the exact value such a set
needs. Greyed out at 360 px it is indistinguishable from a filled field, so submitting it answered
"Weight is required": a correct message about a field the owner believed they had completed.

Fixed by seeding the field with a real `0` for bodyweight exercises. The rule the code comment now
carries: **a placeholder must never display a value that is valid for the thing being logged.**
Every gate was green while this was on screen, which is the same shape as S-01's `site_url`.

### Phase 2 — Workers really does carry full ICU data

`src/pages/api/dev/tz-probe.ts` answered from real workerd with three distinct dates for
Kiritimati (+14), UTC and Niue (−11). This was an open assumption flagged by the plan review (F1):
no primary Cloudflare document states it, and no file in this repository had used `Intl` before.
It is now measured rather than assumed. **The probe was deleted in Phase 5** (`3ebf634`), before the
build, so what deployed never contained it.
