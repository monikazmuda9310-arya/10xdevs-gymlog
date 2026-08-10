---
change_id: exercise-catalogue
title: Exercise catalogue with one primary muscle group and a bodyweight flag
status: implemented
created: 2026-08-10
updated: 2026-08-10
archived_at: null
---

## Notes

Roadmap S-02, the second user-visible slice. Outcome: the user can browse and search a catalogue of
exercises, add their own to a private catalogue, and give each one exactly one primary muscle group
and a bodyweight flag. PRD refs: FR-011, FR-012, FR-013, FR-014, Access Control §catalogue
visibility.

**S-02 has no open unknowns** — both halves of the PRD's open question 1 were settled by the owner
on 2026-08-10, immediately before this change was opened. Do not re-litigate them; do read them:

- **Six muscle groups: `legs`, `back`, `chest`, `shoulders`, `arms`, `core`.** Glutes and a
  biceps/triceps split were considered and declined, on the asymmetry that adding a group later is
  cheap while merging or removing one means re-tagging every exercise and rewriting historical
  per-group tonnage.
- **A multi-joint lift is filed under the group the lifter programmes it for, not its primary
  anatomical mover.** Deadlift → `back`, Romanian Deadlift → `legs`. That pair looks inconsistent
  and is the clearest evidence the rule works — do not "fix" it.
- **The seed is 38 exercises**, listed in full with groups and bodyweight flags in
  `context/foundation/prd.md` § Open Questions #1, along with five deliberate assignments and what
  is excluded on purpose.

Rules this slice inherits and must not improvise around:

- **`AGENTS.md` § Access control carries the table template.** Two tables are likely here and their
  visibility differs: the seeded catalogue is readable by **every** signed-in account, while custom
  exercises are private to their owner. That is not the plain `user_id = auth.uid()` shape the
  template gives, so the policy set needs deciding rather than copying — and the integration check
  must prove both halves against persisted state.
- **The bodyweight flag exists so a set may carry zero or negative load** (FR-014). Zero-weight sets
  contribute reps but no tonnage; negative (assisted) sets are excluded from 1RM and records and
  contribute zero, never a negative amount.
- **Open question 2 is still open and this slice will meet it**: correcting an exercise's muscle
  group after the fact rewrites every historical per-group tonnage that exercise contributed to.
  Decide during planning whether that is acceptable or whether a correction applies forward only.
  It does not block the catalogue itself, only the edit path.
