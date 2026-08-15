# Account deletion — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`
> Research: `context/changes/account-deletion/research.md`

## What & Why

Let a signed-in account delete itself — its `auth.users` row and every training row hanging off it —
with no `service_role` key anywhere in this repository. The PRD puts compliance out of scope *except*
baseline data-protection duties and names own-data deletion as one of them, so this is a requirement
rather than a nice-to-have. It has no user story of its own, which is why the acceptance criteria are
written rather than quoted.

## Starting Point

Every table already cascades from `auth.users`, and nothing has ever executed that cascade — there is
no code anywhere in the repository that deletes an account, and no `.rpc()` call of any kind.
`public.handle_new_user` is the only `security definer` function. Eight throwaway accounts have been
sitting in **production** since F-03 waiting for exactly this feature, one of them holding the owner's
real training rows.

## Desired End State

A signed-in account deletes itself from `/settings`, after a dialog naming how much training goes and
stating plainly that it cannot be undone. Every row keyed to that account is gone; the 38 seeded
exercises and every other account's data are untouched; the browser is left holding no session, on the
sign-in screen, told what happened in a neutral sentence rather than an error box.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Mechanism | `security definer` function, no parameters, granted to `authenticated` | `postgres` holds `DELETE` on `auth.users` and `authenticated` does not — measured, and the only path that avoids an admin key | Research |
| Deletion order | The function deletes `workouts` → `exercises` → `auth.users` itself | Cascades to `exercises` (OID 17556) fire **before** cascades to `exercise_entries` (17601), and `exercises` carries the schema's only `restrict` — so a bare delete fails for any account with a custom exercise and a logged set | Plan |
| Preflight | None | RLS hides the blocking row from both accounts, so a plain-query preflight would answer "not blocked" while blocked — the empty-list-as-reassurance failure `…/impact` exists to prevent | Plan |
| Coverage of the blocked path | Hermetic mapping test + a named gap | Dependency-order deletion makes the self-block unreachable and the sibling slice makes the cross-account row unconstructible, so no integration test can build the state | Plan |
| Suite fixtures | Throwaway accounts per run, deleted through the function itself | First suite in this repository able to clean up after itself; the cleanup is itself a use of the subject | Plan |
| Destination after deletion | `/auth/signin?notice=account_deleted`, neutral slot | Reuses a screen the user needs anyway; reusing `?error=` would render a success in error styling | Plan |
| Confirmation dialog | Counts of workouts, sets and custom exercises + an irreversibility sentence | "Your whole history" is an abstraction the user cannot weigh — the same reasoning as S-05's falling-record warning | Plan |
| Production cleanup | Its own phase, owner-executed, **after** deployment | It is the feature's first real use, and deleting the owner's own data is `CONTRACT.md` §6.6 | Plan |
| Deployment | One shared `wrangler deploy` after **both** PRs merge | This is the half that ends in a screen, so `lessons.md` puts the deploy phase here | Plan |

## Scope

**In scope:** the RPC and its migration; a `DELETE /api/account` endpoint that signs the caller out in
the same request; a new `account` message catalogue; a delete panel on `/settings` with a confirmation
dialog; a new integration suite; documents including a sixth shape in `access-control.md`; the shared
deployment; the production account cleanup.

**Out of scope:** any preflight; changing `on delete restrict` on `exercise_id`; deleting another
account by any path; exporting data before deletion; E2E; merging either PR.

## Architecture / Approach

```
/settings → DeleteAccountPanel (island)
              ├─ counts (RLS reads) ──────────→ dialog names what goes
              └─ DELETE /api/account
                     ├─ rpc delete_own_account()   [security definer, no params]
                     │     workouts → exercises → auth.users
                     ├─ 23503 → account_delete_blocked   (never `unexpected`)
                     └─ supabase.auth.signOut()   ← same request, so the cookie clears
                            → /auth/signin?notice=account_deleted
```

The function takes no parameters, so there is no argument a caller could aim at another account; the
uid comes from `auth.uid()` inside the body, and a null uid raises rather than deleting zero rows and
reporting success.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The function | The RPC, regenerated types, the suite, four mutations | The self-block measurement could contradict the catalogue reading — the design is correct either way, but the header's justification changes |
| 2. The endpoint | `DELETE /api/account`, the `account` catalogue, the hermetic mapping test, the named gap | `23503` currently lands on `unexpected` — a 500 is exactly what this slice exists to prevent |
| 3. The screen | The panel, the dialog with counts, the neutral notice, a render check | Placing the panel inside `settings.astro`'s `loadFailed` ternary would hide it from the users most likely to want it |
| 4. Documents & PR | Sixth shape, `AGENTS.md`, `README.md`, `lessons.md`, PR #2 | Guaranteed `AGENTS.md` conflict on the second merge — expected, not a surprise |
| 5. Deployment | One shared `wrangler deploy`, verified on the public URL | Cannot start until PR #1 merges |
| 6. Production cleanup | Eight accounts, owner-executed | Irreversible, zero-day backup retention, and one account holds real training data |

**Prerequisites: done on 2026-08-15.** Worktrees receive no git-ignored paths, so this one needed both
`.env`/`.dev.vars` copied in (owner action — agent file tools are denied `Read(./.env)`) **and**
`npm ci`. `npm run db:status` now reaches both projects from here, and shows the remote already two
migrations ahead of this branch — the sibling slice's, which is why the new migration must be
timestamped after `20260815120000`.

**Estimated effort:** ~3–4 sessions for phases 1–4; phases 5 and 6 are short but gated on PR #1 merging.

## Open Risks & Assumptions

- **The self-block is read from the catalogue, not yet observed.** Phase 1 step 2 measures it. The
  dependency-order design is correct either way, so a contradicting result costs a paragraph, not a
  phase.
- **`auth.audit_log_entries` survives the deletion** and carries the email address. Provider-managed
  and outside this repository's control, but a feature justified by a data-protection duty should say
  so — in `README.md`, not in the dialog.
- **Teardown depends on the subject.** The suite deletes its own accounts through the function it is
  testing, so a broken function leaks accounts exactly when the run is red. Accepted deliberately and
  written into the suite header.
- **`STATE.md` is materially out of date** — no mention of the S-09 split, the two worktrees, PR #1 or
  the `s09i-` accounts. Anybody resuming from it alone would start work that is already finished.

## Success Criteria (Summary)

- A user with custom exercises and logged sets can delete their account from `/settings` and sees the
  scale of what goes before confirming.
- After deletion, signing in with that address fails and signing up with it succeeds — the account is
  genuinely gone, not merely hidden.
- No other account's data, and none of the 38 seeded exercises, is affected by any deletion.
