---
starter_id: 10x-astro-starter
package_manager: npm
project_name: gymlog
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo builder shipping a training-log MVP in three weeks of after-hours work, with sign-in as a
hard requirement and a guardrail that no account may ever reach another's data. That combination
is what picks the stack: auth, a relational store with per-row ownership, and a public URL all
have to come out of the box, because three weeks does not survive hand-rolling an auth layer.
`10x-astro-starter` is the vetted default for a JavaScript web product and clears all four
agent-friendly gates — typed end to end, convention-based, well represented in training data,
and currently documented. Its scaffolding confidence is first-class rather than verified, which
is acceptable here since the starter installs by clone. Deployment targets Cloudflare Workers —
corrected from `cloudflare-pages` after infrastructure research established that
`@astrojs/cloudflare` v13 dropped Pages support entirely and that `wrangler.jsonc` already
declares a Workers Static Assets project. CI runs on GitHub Actions with auto-deploy on merge, so
a green pipeline and a live URL stay coupled. Only the auth feature flag is set — payments, realtime, background
jobs, and AI are all ruled out by the PRD's non-goals. The starter's own warning about
configuring row-level authorization early is treated as a first-slice obligation, not a
follow-up.
