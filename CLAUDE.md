# CLAUDE.md

@AGENTS.md

`AGENTS.md` is the source of truth for how to work in this codebase — domain rules, access
control, commands, conventions, testing. Read it. Everything below is specific to running this
project as a 10xdevs course deliverable and does not belong in a portable agent file.

## Course contract (this machine only)

Work follows the 10xdevs course contract. Before starting, read in order:

1. `C:\10xdev\handoff\STATE.md` — current state, decisions, next step (read this first)
2. `C:\10xdev\handoff\CONTRACT.md` — goal, phases, working mode, escalation points
3. `C:\10xdev\handoff\module-0{1,2,3}-summary.md` — course module summaries

The contract text describes a subscription tracker (SubTrack); the approved project is **GymLog**,
a training log. The substitution is recorded in `STATE.md`.

Working mode from the contract: work autonomously and escalate only the points listed in
`CONTRACT.md` §6 (magic-link auth, account creation, PRD sign-off, first production deploy, the
Circle submission form, and scope-changing product decisions). Update `STATE.md` as phases land.

## Course skills

The `/10x-*` skills in `.claude/skills/` are the course workflow. Run Claude Code from
`C:\10xdev\gymlog` — a session started in `C:\10xdev` will not see them.

For E2E work use the `/10x-e2e` skill; it is the single source of truth for that workflow
(risk → seed test + rules → generate → review against the five anti-patterns → re-prompt →
verify). The locator, waiting, and test-independence rules it enforces are summarized in
`AGENTS.md` § Testing and apply even before the skill is invoked.
