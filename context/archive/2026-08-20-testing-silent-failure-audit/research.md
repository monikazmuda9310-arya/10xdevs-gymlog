---
date: 2026-08-20T00:00:00+02:00
researcher: Monika Zmuda
git_commit: c400378d58a922e7f311dc25bc98997af354b6dd
branch: main
repository: 10xdevs-gymlog
topic: "Rollout Phase 3 — Silent-failure audit: a failure that is caught must still be told to the caller"
tags: [research, codebase, risk-5, error-handling, signout, impact, render-coverage]
status: complete
last_updated: 2026-08-20
last_updated_by: Monika Zmuda
---

# Research: Rollout Phase 3 — Silent-failure audit (Risk #5)

**Date**: 2026-08-20
**Researcher**: Monika Zmuda
**Git Commit**: `c400378d58a922e7f311dc25bc98997af354b6dd`
**Branch**: `main`
**Repository**: `10xdevs-gymlog`

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md` — Risk #5, "an operation fails, the
failure is logged, and the caller is told it succeeded". Verify (not accept) the response guidance:
prove non-2xx **and** persisted state; challenge the assumption that every caught error is a defect;
enumerate every catch site in `src/` and classify each as decoration over a committed write or as the
guarantee itself. Flag misleading hot-spot evidence.

## Summary

**Six findings, in the order they should change the plan.**

1. **There is exactly one real defect, and it is `src/pages/api/auth/signout.ts:8`.** `await
supabase.auth.signOut()` discards the result. When the provider's `/logout` call fails with
   anything other than 404/401/403, `@supabase/auth-js` returns `{ error }` **without clearing the
   session** — and the route redirects to `/auth/signin` anyway. The user is told they signed out
   while holding a live cookie. Verified against the installed library source, not inferred. It is
   the **only** awaited Supabase call in `src/` whose result is dropped.

2. **The response guidance's "answers non-2xx" criterion cannot see this defect and would score it
   as passing.** `/api/auth/signout` answers `302` in the success case _and_ in the failure case —
   `302` is already non-2xx. For a redirect-shaped endpoint the success signal is the **destination**,
   not the status. The criterion needs restating (§ Corrections).

3. **The second half — "persisted state confirms nothing was written" — does not apply to this
   defect either.** Signing out writes nothing. The state that proves it is the **session**: does the
   surviving cookie jar still obtain training? `tests/middleware/session-lifecycle.test.ts` already
   knows how to ask exactly that, for the success case, and is where the failure case belongs.

4. **"Challenge the assumption that every caught error is a defect" is correct, and the count is
   understated.** The test plan names three deliberate swallows. There are **five**, in two different
   classes, and two of them (`todayIn`'s UTC fallback, the timezone-list fallback) are _not_ named
   anywhere in the response guidance. All 43 catch blocks are classified in § The catch inventory.

5. **The hot-spot evidence behind Risk #5 points at the best-defended code in the repository.**
   `src/`'s churn in the 30 days to 2026-08-16 concentrates on `dashboard.astro` (11 touches),
   `tonnage.ts`, `records.astro` — every one of which already carries a purpose-built failure branch
   _and_ a test. `signout.ts` has **zero commits in that window**; it was last touched during
   `account-access`. Churn found the hardening, not the hole.

6. **Three coverage gaps beyond the defect**, all cheap: the `impact_unavailable` guarantee is proven
   for **one of three** impact routes; **four pages** carry a `loadFailed` branch with no render test
   in existence; and the two deliberate swallows the plan warns against reversing have **nothing
   pinning them** — a future author could "fix" `/api/sets`'s verdict swallow into a 500 and the whole
   gate would stay green.

**Cheapest useful layer: `tests/middleware/` for the defect, `tests/integration/` for the impact
routes and the deliberate swallows, `tests/render/` for the four page branches. No browser needed
anywhere in this phase.**

## Detailed Findings

### The defect: `signout.ts` discards the one result that decides whether it worked

```ts
// src/pages/api/auth/signout.ts:3-12
export const POST: APIRoute = async (context) => {
  const { supabase } = context.locals;
  if (supabase) {
    await supabase.auth.signOut(); // ← result discarded
  }
  // Sign-in, not "/": returning must require authenticating again (US-04's third criterion).
  return context.redirect("/auth/signin");
};
```

**Why the discard matters** — from the installed library, `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js`:

```js
async _signOut({ scope } = { scope: 'global' }) {
  return await this._useSession(async (result) => {
    const { data, error: sessionError } = result;
    if (sessionError && !isAuthSessionMissingError(sessionError)) {
      return this._returnResult({ error: sessionError });        // ← returns BEFORE _removeSession
    }
    const accessToken = data.session?.access_token;
    if (accessToken) {
      const { error } = await this.admin.signOut(accessToken, scope);
      if (error) {
        // ignore 404s since user might not exist anymore
        // ignore 401s since an invalid or expired JWT should sign out the current session
        if (!((isAuthApiError(error) && (error.status === 404 || error.status === 401 || error.status === 403))
              || isAuthSessionMissingError(error))) {
          return this._returnResult({ error });                  // ← returns BEFORE _removeSession
        }
      }
    }
    if (scope !== 'others') {
      await this._removeSession();                               // ← the cookie clearing lives here
      ...
    }
```

`_removeSession()` is what drives the `setAll` in `src/lib/supabase.ts:20-24` and therefore the
cleared `Set-Cookie` on the response. On either early return it **never runs**.

**The consequence chain, end to end.** A GoTrue 500, a 429, or a dropped connection
(`AuthRetryableFetchError`) → `{ error }` returned → no cookie cleared → `signout.ts` ignores it and
issues `302 → /auth/signin` → the browser still holds a valid session → `src/middleware.ts:38-40`
sees `locals.user` on an `AUTH_ROUTE` and redirects **back to `/dashboard`**.

What the user experiences is _"I clicked Sign out and landed on my dashboard"_ — which reads as a UI
glitch and is in fact an unended session on a shared machine. US-04's third criterion ("returning
requires authenticating again") is the guarantee, and this is the one path that quietly breaks it.

**The same call is handled correctly one directory away**, which is what makes this an oversight
rather than a house style — `src/pages/api/account/index.ts:63-74` catches the throw, branches on
`signOut.error`, logs it, and explains in a comment why reporting success is still right _there_ (the
account is genuinely gone). Two endpoints, one call, opposite treatment; only one of them is
defensible.

**Proof it is the only one.** A regex over `src/` for an awaited-or-voided Supabase call whose result
is not destructured returns exactly one hit:

```
src\pages\api\auth\signout.ts:8:    await supabase.auth.signOut();
```

**What would catch it today: nothing, at any layer.**

- `tests/middleware/session-lifecycle.test.ts:227-276` (assertion 2) drives the real route and proves
  the _successful_ sign-out ends access — including the `42501` grant-layer refusal. It never
  exercises a failing `signOut()`.
- `tests/e2e/critical-flow.spec.ts:149-165` clicks the button and proves the data is gone. Success
  path only, and it says so at `:167-170`.
- No unit test exists for the route (it has no extractable decision to test — today).

### The catch inventory: 43 blocks in `src/`, in six classes

Counted with `catch\s*(\{|\()` over `src/`, excluding `*.test.ts`. **Prose containing the word
"catch" inflates a naive grep to ~54** — three of those hits are comments (`types.ts:135`,
`tonnage-display.ts:48`, `DeleteAccountPanel.tsx:28`). Use the stricter pattern.

| Class                                                 | Count | Sites                                                                                                                                                                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. The catch IS the guarantee**                     | 12    | `sets/[id]/impact.ts:36`, `workouts/[id]/impact.ts:33`, `exercise-entries/[id]/impact.ts:35`; `dashboard.astro:44,75`; `settings.astro:48,70`; `records.astro:28`; `workouts/index.astro:24`; `workouts/[id].astro:27`; `exercises.astro:17`; `accounts.ts` footprint (`null`, never zeros) | **Correct.** Each converts a failure into a _stated_ failure — `503 impact_unavailable`, a failure sentence, `loadFailed`. Never a zero, never `[]`, never a default presented as a choice.                                                                                                                                                |
| **B. Decoration over a write that already committed** | 2     | `sets/index.ts:84` (record badge), `account/index.ts:71` (sign-out after deletion)                                                                                                                                                                                                          | **Deliberate, documented, must not be reversed.** Both carry their reasoning inline. Reversing either invites a retry after a successful write — a duplicated set, or a user told a completed deletion failed.                                                                                                                             |
| **C. Translate a provider error into a message code** | 12    | `sets/index.ts:96`, `sets/[id]/index.ts:52,71`, `workouts/index.ts:43`, `workouts/[id]/index.ts:32,56`, `exercise-entries/index.ts:42`, `exercise-entries/[id]/index.ts:28`, `exercises/index.ts:49`, `profile/index.ts:59`, plus the `23503`/`unique_violation` branches                   | **Correct.** All answer a non-2xx carrying a code. No provider prose escapes.                                                                                                                                                                                                                                                              |
| **D. Malformed-body guards**                          | 6     | `sets/index.ts:28`, `workouts/index.ts:28`, `exercise-entries/index.ts:25`, `exercises/index.ts:32`, `profile/index.ts:37`, `_shared/mutation-route.ts:66`                                                                                                                                  | **Correct.** Each answers `400` with a specific code; `readBody` defers to the schema. Deliberately not a 500 — `exercises/index.ts:33-35` states why.                                                                                                                                                                                     |
| **E. Fallback swallows that hide a real condition**   | 2     | `calendar.ts:29` (`todayIn` → UTC on an unknown zone), `timezones.ts:60` (418 zones → 12-entry fallback)                                                                                                                                                                                    | **Deliberate, and NOT named in the test plan's list of three.** Both trade a crash for a wrong-but-visible value. `AGENTS.md` already concedes `Europe/Warsawa` "would produce a wrong week boundary with nothing on screen saying so". The `settings.astro:125-142` amber banner is the compensating control — and it is on **one** page. |
| **F. Client islands**                                 | 9     | `useRecordImpact.ts:61`, `AddSetForm.tsx:78`, `NewWorkoutForm.tsx:53`, `ExerciseForm.tsx:52`, `PreferencesForm.tsx:94`, `WorkoutHeader.tsx:71,106`, `WorkoutDetail.tsx:128,234,254`, `DeleteAccountPanel.tsx:57,67`                                                                         | **Correct, uniformly.** Every one calls `setError(...)` with a code from a catalogue. `useRecordImpact` lands on `unavailable` and never on an empty `ready` — the client half of the `impact_unavailable` promise.                                                                                                                        |

**So the answer to "which catch sites decorate a committed write, and which one IS the guarantee" is
class B (two) and class A (twelve) respectively — and they are already written correctly. The audit's
value is not in fixing them; it is in the one route that is in neither class, and in pinning the
classes so they cannot drift.**

### Corrections to the test plan's Risk Response Guidance

The §2 row for Risk #5 reads: _"A failed operation answers non-2xx and the persisted state confirms
nothing was written."_ **Both clauses are wrong for the defect this phase exists to find.**

1. **"Answers non-2xx" is satisfied by the defect.** `/api/auth/signout` answers `302` whether it
   worked or not. The honest criterion is _"the caller can tell the failure from the success"_ — for a
   JSON endpoint that is the status and the code; for a redirect-shaped endpoint it is the
   **destination and its `?error=` code** (the house pattern, `signin.ts:11-12`).
2. **"Nothing was written" has no subject here.** Sign-out writes no row. The state that proves the
   claim is the session: the surviving jar must obtain no training. Generalise to _"the persisted
   state — row, or session — confirms the operation did not take effect."_
3. **"Three swallows are deliberate" should read five** (add `todayIn`'s UTC fallback and the
   timezone-list fallback), or name the _category_ rather than the count. `lessons.md` § "The
   conversion constant has been miscounted twice, in the same direction" is the precedent: a bare
   count invites a reader to correct it wrongly.
4. **The Source column's hot-spot citation is misleading for this risk** and should say so. Churn in
   the window (30 days to 2026-08-16, `src/ supabase/ tests/`):

   ```
   11 src/pages/dashboard.astro     7 src/middleware.ts      4 src/pages/records.astro
    7 src/types.ts                  4 src/lib/services/tonnage.ts
   ```

   Every high-churn file is one whose failure branch was _built and tested_ in that window.
   `src/pages/api/auth/signout.ts` appears **zero** times. The evidence that raised the risk is real;
   it just does not point where the failure lives — which is §1 principle #3 working as designed.

### What is already proven — do not plan a phase around any of it

Checked against `lessons.md` § "'A user cannot do X yet' is not 'X is untested'" by opening the
suites rather than reasoning about the UI.

| Guarantee                                                                 | Where it is already pinned                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A failed impact read answers `impact_unavailable`, never `{ impact: [] }` | `workout-mutations-rls.test.ts:369-398` (assertion 13), **for `/api/sets/[id]/impact` only** |
| `{ impact: [] }` remains reachable and meaningful                         | same file, assertion 14 (`:400-414`) — the non-vacuity control                               |
| A failed tonnage read shows no figure at all                              | `render/dashboard-tonnage.test.ts:350-358`                                                   |
| An absent profile is a failed read, not an empty week                     | `render/dashboard-tonnage.test.ts:360-367`                                                   |
| A breakdown failure degrades alone and leaves both totals                 | `render/dashboard-tonnage.test.ts:430-443`                                                   |
| A zero week is distinguishable from a failed read                         | `weekly-tonnage.test.ts:320-336`; `render/dashboard-tonnage.test.ts:343-346`                 |
| A failed profile read replaces the settings form                          | `render/settings-island.test.ts:220`; `render/settings-delete-panel.test.ts:73-75`           |
| Footprint counts say so rather than showing zeros                         | `render/settings-delete-panel.test.ts:88`                                                    |
| `23503` → `account_delete_blocked`, never `unexpected`                    | `src/lib/services/accounts.test.ts` (hermetic, mutation-confirmed)                           |
| A zero-row UPDATE/DELETE answers 404, not 204                             | `workout-mutations-rls.test.ts`, twelve policies                                             |

**And two gaps are already named in writing and must not be "closed" with a weaker assertion**:
`account-deletion.test.ts:387-429` refuses an end-to-end test of the blocked deletion path and of two
`delete_own_account` guards, in the repository's own refusal language. Leave them.

### Coverage gaps, ranked by (risk × cost)

| #   | Gap                                                                                                                                                                                               | Cheapest layer       | Precedent to copy                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`signout.ts` failure path** — a failing `signOut()` still reports success and leaves the session live                                                                                           | `tests/middleware/`  | `session-lifecycle.test.ts:159-170` already builds a `signoutContext(locals, redirectedTo)`; the locals' client is injectable, so a `signOut` resolving `{ error }` needs no new harness                                                                                            |
| 2   | **`impact_unavailable` proven for 1 of 3 routes** — `workouts/[id]/impact` and `exercise-entries/[id]/impact` are imported by **no test in the repository**                                       | `tests/integration/` | the `new Proxy(client, { get })` at `workout-mutations-rls.test.ts:376-388` — the repository's only broken-client precedent                                                                                                                                                         |
| 3   | **Four pages' `loadFailed` branches** — `records.astro`, `workouts/index.astro`, `workouts/[id].astro`, `exercises.astro`. `tests/render/` holds three files and none of them touches these pages | `tests/render/`      | `dashboard-tonnage.test.ts:116-170` — the table-dispatching stub with a `throw` on an unstubbed table                                                                                                                                                                               |
| 4   | **The two deliberate swallows are unpinned** — nothing fails if `/api/sets`'s verdict `catch` is "fixed" into a 500, or if `/api/account`'s post-deletion `signOut` guard is removed              | `tests/integration/` | drive `addSetRoute` with a client whose ranking reads throw (Proxy again); assert `201` **and** the set persisted **and** `record: null`                                                                                                                                            |
| 5   | **`records.astro` treats a null profile as defaults, where `dashboard.astro` and `settings.astro` treat it as a failure** — `records.astro:26-27` prints headline figures under a defaulted unit  | —                    | **Name it, do not build a phase on it.** No path makes the row null today (trigger-created, no delete path), so this is a `lessons.md` § "an assertion you keep because it cannot fail YET" case. The future edit that makes it bite is any change to the `profiles` select policy. |

### Mechanics the plan can rely on

- **Breaking a read without mocking**: `new Proxy(ownerA.client, { get })` intercepting `from` and
  throwing for named tables — `workout-mutations-rls.test.ts:376-388`. Leaves the ownership read
  working, which is the shape a real hiccup takes.
- **Breaking an auth call**: the middleware suite hands the route a `locals` it constructed, so
  substituting `{ ...locals, supabase: { auth: { signOut: () => Promise.resolve({ error }) } } }` is
  a one-line change with the real route under test. **Give it a positive control in the same test**
  (`AGENTS.md` § Testing, the forged-cookie rule): the identical path with a succeeding `signOut`
  must still clear the jar, or a mis-built double and a correctly-refused sign-out are the same
  observation.
- **Render stub discipline**: dispatch on table name and `throw` on an unstubbed one. That tripwire is
  what reddened the dashboard suite the moment S-08 added a third read — the mechanism is documented
  at `dashboard-tonnage.test.ts:139-142`.
- **Marks in use** (`s03-`, `s03-endpoints-`, `s03-page-`, `s04-`, `s05-`, `s05m-`, `s06-`, `s07-`,
  `s08-`, `s09d-`, `s09i-`, `t2c-`, `t2e-`). A new integration suite needs one that is neither a
  prefix of nor prefixed by any of these.
- **There is no `sign_out_failed` code in `AUTH_MESSAGES`** (`src/lib/validation/auth.ts:56-69`).
  Whatever shape the fix takes, it needs a catalogue entry — and `messageForCode` resolves an
  unrecognised code to the generic message, so a code added to the redirect without a catalogue entry
  degrades silently rather than failing.

## Code References

- `src/pages/api/auth/signout.ts:8` — the discarded result; the whole defect
- `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` `_signOut` — two early returns ahead of `_removeSession()`
- `src/lib/supabase.ts:20-24` — `setAll`, the only path by which a cleared cookie reaches the response
- `src/middleware.ts:38-40` — `AUTH_ROUTES`, which turns a failed sign-out into a bounce back to `/dashboard`
- `src/pages/api/account/index.ts:58-74` — the same call, handled; the contrast that proves the omission
- `src/pages/api/sets/index.ts:67-90` — deliberate swallow #1, with its reasoning
- `src/pages/api/sets/[id]/impact.ts:36-46` — the `impact_unavailable` guarantee, and the only one tested
- `src/pages/api/workouts/[id]/impact.ts:33-41`, `src/pages/api/exercise-entries/[id]/impact.ts:35-43` — the same guarantee, untested
- `src/lib/services/tonnage.ts:102-104,172-174` — throw rather than answer zero
- `src/lib/services/accounts.ts:47-76` — `null`, never a partially-filled footprint
- `src/lib/services/calendar.ts:26-35`, `src/lib/services/timezones.ts:50-63` — the two unlisted deliberate swallows
- `src/pages/records.astro:22-35` — the catch that guards, beside the `?? "kg"` that does not
- `tests/middleware/session-lifecycle.test.ts:227-276` — the success path, and the harness the failure path needs
- `tests/integration/workout-mutations-rls.test.ts:369-414` — assertions 13 and 14, the pattern to generalise
- `tests/render/dashboard-tonnage.test.ts:116-170` — the stub shape for the four uncovered pages

## Architecture Insights

- **This repository already treats silent failure as a first-class hazard, and treats it well.** Of 43
  catch blocks, 41 either state the failure to the caller or are documented decoration over a
  committed write. The audit's finding is not that error handling is weak; it is that the _policy_ is
  enforced by comments and reviewer attention, and the one place that predates the policy was never
  revisited.
- **The failure that survived is the one with no body to inspect.** Every endpoint answering JSON got
  a code, a status and a test. The two redirect-shaped auth endpoints got codes too — `signin.ts` and
  `signup.ts` both route their error through `neutralAuthCode`. `signout.ts` is the only one with
  nothing to say on failure, and so it says nothing.
- **"Log it and carry on" is defensible exactly when the caller's next action cannot be improved by
  knowing.** That is the real line separating class A from class B, and both existing class-B sites
  articulate it: after a committed write, an error invites a retry that _duplicates_ the write. The
  plan should state this as the test's decision rule rather than "every catch must produce a non-2xx".

## Historical Context (from prior changes)

- The **`testing-browser-layer`** change folder — Phase 2's finding that the real gap behind risks #2
  and #3 was the cookie path, not the browser, is why `tests/middleware/` exists at all. That project
  is the cheapest home for finding #1, and it did not exist when Risk #5 was written.
- The **`account-deletion`** change folder — established the "a refusal must be distinguishable from a
  success" stance the PRD section cited in Risk #5's evidence column, and produced
  `accountDeletionFailureCode`, the one hermetically-tested piece of failure translation in the repo.
- `lessons.md` § "Under RLS, a write that touches nothing SUCCEEDS — so 'it failed' has to be built"
  is the mutation-side twin of this phase. It closed the _write_ half in S-05; nothing closed the
  _session_ half.
- `lessons.md` § "The assertion carrying the claim goes FIRST" was measured on
  `session-lifecycle.test.ts` assertion 2 — the exact test this phase extends. Its ordering discipline
  applies directly: the data read must be the line a mutation lands on, not the redirect check.

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Response Guidance) — corrected above
- `context/foundation/lessons.md` — five entries bear directly on this phase, cited inline
- `context/foundation/access-control.md` § the derived-view variant — why the impact routes read
  through `security_invoker` views, and therefore what a failing ranking read looks like

## Open Questions

1. **What should a failed sign-out actually do?** A planning decision, not a research one. The
   constraint research establishes: the user must not be left believing the session ended. The house
   pattern (`?error=<code>` back to the sign-in page, resolved by `messageForCode`) is available and
   needs one new `AUTH_MESSAGES` entry. Note the interaction — redirecting to `/auth/signin` with a
   live session means the middleware bounces to `/dashboard`, so a message on the sign-in page may
   never be seen; the destination is part of the decision.
2. **Should the two class-E fallbacks (`todayIn`, the timezone list) be in scope for this phase?**
   They are genuine silent degradations, and both are compensated on `/settings` only. Cheap to pin,
   but they are week-boundary-shaped and Phase 4 owns that seam. Recommend: name them here, test them
   in Phase 4.
3. **Does gap #4 (pinning the deliberate swallows) belong in this phase or is it Phase 5's?** It is
   the direct answer to the plan's own "anti-pattern to avoid: reversing a deliberate swallow" — a
   warning nothing currently enforces. Recommend: in scope, one assertion each.
