---
change_id: log-workout-with-estimate
title: Log workout with estimate
status: implementing
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
---

## Notes

### Phase 1 — the graft is not theoretical

The mutation test on the composite ownership key did more than fail a test. Replacing it with a
plain `references workouts (id)` in `gymlog-test` let account B attach an exercise entry to account
A's workout, and the row **persisted** — restoring the key failed until that row was deleted by
hand. Whatever else changes in this schema, the composite keys stay, and assertion 4 of
`tests/integration/workout-log-rls.test.ts` stays with them.

### Phase 2 — Workers really does carry full ICU data

`src/pages/api/dev/tz-probe.ts` answered from real workerd with three distinct dates for
Kiritimati (+14), UTC and Niue (−11). This was an open assumption flagged by the plan review (F1):
no primary Cloudflare document states it, and no file in this repository had used `Intl` before.
It is now measured rather than assumed. **The probe is deleted in Phase 5** — that is criterion 5.1,
not a thing to remember.
