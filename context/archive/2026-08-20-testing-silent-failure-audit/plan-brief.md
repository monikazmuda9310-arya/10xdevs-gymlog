# Silent-Failure Audit (Rollout Phase 3) — Plan Brief

> Full plan: `context/changes/testing-silent-failure-audit/plan.md`
> Research: `context/changes/testing-silent-failure-audit/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md` closes Risk #5 — _"an operation fails, the
failure is logged, and the caller is told it succeeded."_ Research enumerated all 43 catch sites in
`src/` and found 41 already correct, so this is not a hardening exercise: it is **one real defect**
(`signout.ts` discards the result of `supabase.auth.signOut()`), plus the pinning of four
guarantees that are correct today and would break silently tomorrow because nothing witnesses them.

## Starting Point

`await supabase.auth.signOut()` at `src/pages/api/auth/signout.ts:8` drops its result.
`@supabase/auth-js` returns `{ error }` **without clearing the session** on any failure other than
404/401/403, so the route answers `302 → /auth/signin` while the browser still holds a live cookie —
and `middleware.ts:38-40` then bounces the user to `/dashboard`. It reads as a UI glitch; it is an
unended session on a shared machine. Alongside it: `impact_unavailable` is proven for 1 of 3 impact
routes, four pages' `loadFailed` branches have no render test in existence, and the two deliberate
swallows have nothing stopping a future author from "fixing" them into a 500.

## Desired End State

A failed sign-out **ends the session on this device anyway** and says so: the jar is cleared, the
destination carries `?error=sign_out_failed`, the middleware does not bounce, and the sign-in page
renders the message. All three impact routes are proven to answer `impact_unavailable` rather than a
reassuring empty list. Four pages are proven to state a failed read instead of rendering as "you
have nothing". The two deliberate swallows are pinned so reversing one goes red.

## Key Decisions Made

| Decision                          | Choice                                                       | Why (1 sentence)                                                                                                                | Source   |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| What a failed sign-out does       | Clear the jar locally, then redirect with a code             | Makes US-04's third criterion true on the failure path, and an empty jar means the middleware does not bounce the message away.  | Plan     |
| How the jar is cleared            | `cookies.set(name, "", { maxAge: 0 })`, never `delete()`     | The test double implements `set()` only, and `applyCookieWrites` already decodes that shape — the same path a success travels.   | Plan     |
| Class-E fallbacks (`todayIn`, zones) | Named here, tested in Phase 4                             | Both are week-boundary-shaped and Phase 4 owns that seam; testing them here separates the proof from its context.                | Research |
| The two class-B swallows          | Pinned, one assertion each                                   | The only thing that would enforce the plan's own "do not reverse a deliberate swallow" — today it is a comment.                  | Plan     |
| Render breadth                    | All four pages, one suite                                    | The fourth page costs a few lines once the stub exists, and each has a different failure shape worth a distinct claim.           | Plan     |
| Home for the impact assertions    | New suite, mark `t3s-`                                       | `workout-mutations-rls` already carries 14 assertions under a title about RLS policies — growing it is documented drift.         | Plan     |
| `records.astro` null-profile      | Pin today's behaviour in the repository's refusal language   | No path produces the input today, so a fix would be unprovable; an assertion with a named trigger beats prose nobody reads.      | Plan     |

## Scope

**In scope:** the `signout.ts` fix + `sign_out_failed` catalogue entry + `clearSessionCookies`;
middleware assertions 6–7; a new integration suite covering two untested impact routes and both
class-B swallows; a render suite for four `loadFailed` branches; `test-plan.md` §6 cookbook entries,
§6.6 phase note, §3 status, and three named gaps.

**Out of scope:** reversing any deliberate swallow; testing the two class-E fallbacks; changing
`records.astro`'s behaviour; closing the two gaps `account-deletion.test.ts:387-429` refuses in
writing; any browser test; any assertion on log output; any migration.

## Architecture / Approach

```
signOut() -> { error }  OR  throws (non-AuthError)   <-- two shapes, one branch
      |
      v
clearSessionCookies(request.headers, cookies)        <-- src/lib/supabase.ts
   sb-<ref>-auth-token[.n]  ->  set(name, "", maxAge: 0)
      |
      v
302 -> /auth/signin?error=sign_out_failed
      |
next request carries NO session -> no AUTH_ROUTES bounce -> message renders
```

Everything else is additive test surface at three existing layers — middleware for the session,
integration for the endpoints (broken-read `Proxy`, ownership read left live), render for the pages
(table-dispatching stub that throws on an unstubbed table).

## Phases at a Glance

| Phase                              | What it delivers                                                              | Key risk                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Sign-out failure path           | The fix, the catalogue entry, and middleware assertions 6–7                   | The harness's `signoutContext` lacks `cookies` and a `Cookie` header — both must grow first        |
| 2. Impact routes                   | `impact_unavailable` proven for 3 of 3, plus `404` ≠ `503`                    | Breaking every table yields a 404 and the assertion passes for the wrong reason                    |
| 3. The two class-B swallows        | `/api/sets` still 201; `/api/account` still `{ deleted: true }`, truthfully   | The per-run accounts delete themselves — teardown must tolerate that and still catch a failed run |
| 4. Four `loadFailed` branches      | Render suite; `workouts/[id]`'s 404 ≠ failure ≠ malformed-id                  | Absence assertions ("no figures", "no island") are vacuous without their positive controls        |
| 5. `test-plan.md` §6               | Cookbook patterns, phase note, three named gaps, status → complete            | Patterns filed by phase rather than by layer are never found again                                |

**Prerequisites:** `.env` with the `gymlog-test` credentials (phases 2–3 need network); nothing else
— no migration, no new secret, no schema change.
**Estimated effort:** ~4–5 sessions across five sub-phases; phase 4 is the largest, phase 5 the
shortest.

## Open Risks & Assumptions

- **The cleared cookie's `path` must match what `setAll` wrote**, or the browser keeps it — invisible
  to a test that inspects written cookies by name only. Phase 1 compares names against the real
  success path and the implementer must read the options rather than assume `path: "/"`.
- **The message is honest but partial**: a failed sign-out ends the session on this device, while the
  refresh token survives at the provider. The sentence must not claim a global sign-out.
- **`account.session.jar` is shared by four existing assertions** — the new ones must copy it
  (`new Map(...)`), or a later assertion loses its session and fails for an unrelated reason.
- **Phase 3's accounts delete themselves as the assertion's subject.** There is no `LIKE` sweep in
  this project, so a leaked `t3s-` account is recoverable only through the dashboard.

## Success Criteria (Summary)

- Clicking Sign out when the provider is down leaves you signed out and told so — not on your
  dashboard wondering what happened.
- A failed impact read never reassures the user that no record is at stake, on any of the three
  routes that can answer.
- A page that could not read your training says so, instead of showing you an empty log.
