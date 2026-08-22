<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account deletion

- **Plan**: `context/changes/account-deletion/plan.md`
- **Scope**: Phases 1–4 of 6 (5 and 6 are gated on merging both PRs)
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION — triaged 2026-08-15: all 10 fixed (F5 and F7 as documentation by owner decision)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

**What passed, so it is not re-litigated.** Twenty-two plan items audited: 18 MATCH, 3 DRIFT (two
cosmetic, one an improvement that resolved a contradiction inside the plan itself), **0 MISSING, 0
scope violations**. The RPC itself survived a deliberate attempt to break it: `search_path` is pinned
and every name schema-qualified; `auth.uid()` cannot be spoofed, because `request.jwt.claims` is set
by PostgREST from a verified JWT and `authenticated` has no route to `set_config`; both deletes are
`= caller` with `caller` provably non-null; and the 38 seeded rows are unreachable even with the
predicate rewritten, because the zero-row raise rolls the transaction back. **Atomicity is the best
part of the change** — a partial deletion is genuinely unreachable.

Two claims were checked rather than accepted. **`src/db/database.types.ts` was NOT hand-edited**: a
reviewer flagged `Args: never` as un-generator-like, and re-running `npm run db:types` produced a
**zero diff**. And the sibling-branch copies are byte-identical where claimed and supersets where
claimed, matching what Progress 1.3, 1.5 and 4.3 record.

## Findings

### F1 — The migration header claims a tripwire the suite says does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260815140000_delete_own_account.sql:57`; the same claim repeated at `tests/integration/account-deletion.test.ts:219-222`
- **Detail**: The header ends its `is not distinct from` warning with **"Assertion 3 of the suite is
  what notices."** The suite's own closing note contradicts it from measurement (`:415-418`): *"NOT
  guarded, and cannot be… Measured: the rewrite breaks nothing on its own."* The note is right —
  `<uuid> is not distinct from NULL` is FALSE, so the rewrite is inert while a real uid exists.
  Both sentences were written by this slice, the header first and the note after the mutation
  protocol disproved it; the header was never corrected. **This is the exact failure `lessons.md`
  § "When a mutation does not break anything, fix the claim — never the test" names**, and it points
  the wrong way: a future reader opens the migration first and is told a guard exists where none does.
  Assertion 3 is not useless — it would catch the exercises delete losing its `where` clause
  entirely — but that is a different mutation.
- **Fix**: Rewrite the header sentence to name the mutation assertion 3 actually catches (an unscoped
  delete) and point at the closing note for why the `is not distinct from` rewrite is
  unguarded-and-unguardable. Correct the inline comment at `:219-222` the same way.
- **Decision**: FIXED — the migration header now names the mutation assertion 3 actually catches (an unscoped delete) and points at the closing note for why the `is not distinct from` rewrite is unguardable from there. The inline comment at the assertion says the same, including that the header used to be wrong.

### F2 — "Nothing was removed" is asserted on paths that cannot know it, and `signOut()` is unguarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/validation/account.ts:27`; `src/pages/api/account/index.ts:58`; `src/components/settings/DeleteAccountPanel.tsx:60`
- **Detail**: `ACCOUNT_MESSAGES.unexpected` states as fact *"Your account could not be deleted.
  Nothing was removed."* That is provable for `account_delete_blocked` — a `23503` comes from Postgres,
  so the transaction rolled back. It is **not** provable for `unexpected`, which is reachable on at
  least three paths where the deletion may already have committed:
  1. **`supabase.auth.signOut()` at `index.ts:58` is unguarded.** `deleteOwnAccount` cannot reject
     (PostgREST's builder resolves `{error}`), but `signOut()` re-throws anything that is not an
     `AuthError`. A throw there escapes the handler, Astro answers a generic HTML 500, the panel's
     `response.json()` fails, `.catch(() => ({}))` yields `{}` — and the user is told "Nothing was
     removed" **after the account was removed**.
  2. **A lost response after a committed RPC** resolves as `{error: {code: "", message: "fetch
     failed"}}`, which maps to `unexpected` for the same sentence.
  3. **The panel's own `catch`** reuses the server-authored sentence for a browser-side network
     failure, where the client provably knows nothing about what the server did.
  `src/lib/services/accounts.test.ts:40-47` pins this wording as load-bearing, which makes the
  overclaim harder to notice rather than easier. The irony is that the sentence was added for exactly
  the right reason — a half-deleted account is what a user fears most — and it is the one claim that
  must not be made when it cannot be known.
- **Fix A ⭐ Recommended**: Guard the `signOut()` in a `try/catch` with the "deleted, session not
  ended" logging already beside it, and split the message: keep the absolute claim on
  `account_delete_blocked`, give `unexpected` a version that does not assert the outcome ("Sign in
  again to check whether it went through"), and give the panel's `catch` its own transport-failure
  sentence.
  - Strength: Removes the only path that turns a **successful** deletion into a false "nothing
    happened", and stops the product asserting something it cannot know. The endpoint already treats
    "deleted but not signed out" as its own condition — this makes that branch reachable.
  - Tradeoff: A third message and one more branch in the panel; the reassuring sentence gets weaker
    in exactly the case where the user most wants reassurance.
  - Confidence: HIGH — the endpoint's existing `signOut`-failed branch shows the intended shape.
  - Blind spot: Whether `signOut()` throwing is reachable in workerd has not been observed, only
    read from the library source.
- **Fix B**: Guard the `signOut()` only, and leave the wording.
  - Strength: One-line change; closes the path that actually loses the truth.
  - Tradeoff: `unexpected` still asserts "Nothing was removed" on the two transport paths.
  - Confidence: HIGH — narrowly scoped.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `signOut()` wrapped in try/catch with its own diagnostic, so a throw can no longer turn a committed deletion into a generic 500. `unexpected` no longer claims "Nothing was removed" and says how to find out instead; the panel's transport failure gets its own `request_failed` code, because that layer knows even less. The unit test now asserts the ASYMMETRY — only the message that can know says it.

### F3 — `noticeForCode`'s inverted fallback has no test, and it is the line a reader will "harmonise"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `src/lib/validation/auth.ts:97-102`; `src/lib/validation/auth.test.ts` has no coverage
- **Detail**: `messageForCode` falls back to the generic message; `noticeForCode` returns `null`,
  deliberately, because a generic **reassurance** is a positive claim. The asymmetry is correct and is
  explained in three places. But nothing fails if somebody changes `: null` to the generic message —
  and "make this consistent with the function ten lines below it" is exactly the tidy-up that will be
  proposed, with the diff looking like a simplification. `messageForCode` next door has three
  assertions including prototype-pollution cases. This repository's answer to a load-bearing one-line
  decision is a test, not a comment: `AGENTS.md` says so about `signUpDestination()` in those words.
- **Fix**: Four assertions beside the `messageForCode` block — recognised → the sentence; absent →
  `null`; unrecognised → `null` **and not** the generic message; `__proto__` → `null`. Plus one
  asserting `AUTH_MESSAGES` and `AUTH_NOTICES` have disjoint keys, so a code can never grow a red-box
  twin.
- **Decision**: FIXED — four `noticeForCode` cases beside the `messageForCode` block (recognised, absent, unrecognised → null and NOT the generic message, `__proto__`), plus one asserting `AUTH_MESSAGES` and `AUTH_NOTICES` have disjoint keys. 248 unit tests, up from 244.

### F4 — Assertion 8's "the account is gone" proof can pass vacuously

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test quality
- **Location**: `tests/integration/account-deletion.test.ts:341`
- **Detail**: `expect(again.data.session?.user.id).not.toBe(victim.userId)` — with no null-check on
  the session. Assertion 5 guards the identical line with `expect(again.data.session).not.toBeNull()`
  at `:272`; assertion 8 does not. If `signUp` returns `{error: null, session: null}` — precisely what
  happens if **Confirm email is switched on for `gymlog-test`** — then `undefined !== victim.userId`
  and the external proof passes while proving nothing. `throwawayAccount` catches that condition for
  accounts it creates, but this `signUp` goes through a bare client and bypasses it.
- **Fix**: Add `expect(again.data.session).not.toBeNull();` before the id comparison, matching
  assertion 5.
- **Decision**: FIXED — `expect(again.data.session).not.toBeNull()` added before the id comparison in assertion 8, matching assertion 5, with the Confirm-email failure mode named in a comment.

### F5 — The revoke does not name `service_role`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260815140000_delete_own_account.sql:108`
- **Detail**: The header presents the revoke list as exhaustive and says "Assertion 7 is what
  notices". Supabase's bootstrap runs `alter default privileges … grant all on functions to postgres,
  anon, authenticated, service_role`, so `service_role` holds an **explicit** EXECUTE grant that
  `revoke … from public, anon, authenticated` never removes. Assertion 7 cannot cover it — the test
  config strips that credential by design. **Not exploitable today**: a service_role JWT carries
  `role` but no `sub`, so `auth.uid()` is null and the function raises before any delete. This is
  completeness, not a hole.
- **Fix**: Add `service_role` to the revoke list; confirm with `select proacl from pg_proc where
  proname = 'delete_own_account'` on both projects. Amend the header to say the service_role revoke is
  deliberately untested because the suite is *incapable* of holding that key — the same honesty the
  closing note already applies to layers 2 and 3.
- **Decision**: FIXED as documentation, deliberately not as a migration — owner decision. The header now states that the revoke list is NOT exhaustive, that `service_role` keeps an explicit grant, why it is nonetheless unreachable (no `sub` in that JWT, so `auth.uid()` is null and the guard raises first), and that it is not assertable because the suite is incapable of holding that key. Closing it would cost a migration and a production push for something four other things already prevent.

### F6 — `account_delete_failed` is absent from the catalogue, and nothing records the decision

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/validation/account.ts:22-27` vs `plan.md:305`
- **Detail**: The plan listed five codes "at minimum"; four exist. The absence is arguably **correct**
  — `accountDeletionFailureCode` returns only `account_delete_blocked` or `unexpected`, so a fifth
  entry would be dead and untestable, and a message nothing can emit is a claim nobody checks. The
  defect is procedural: neither the code nor Progress 2.1 records the decision, so a reader comparing
  plan to catalogue finds a silent shortfall.
- **Fix**: One sentence in `account.ts` saying the code was dropped because nothing can emit it, and a
  clause in Progress 2.1.
- **Decision**: FIXED — `account.ts` now records why the fifth code was dropped: nothing can emit it, so the entry would be dead and untestable.

### F7 — The definer's owning role is implicit

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260815140000_delete_own_account.sql:64-66`
- **Detail**: The whole guarantee rests on the function being owned by a role that can delete from
  `auth.users` — `postgres`, because `db:push` connects as it. Nothing in the migration or in
  `access-control.md` states or pins that. A future migration applied by a different role would give
  the function that role's rights instead, silently, and for a definer function the owner is the one
  variable deciding everything.
- **Fix**: One line in the header naming the expected owner and why; optionally an explicit
  `alter function public.delete_own_account() owner to postgres;`.
- **Decision**: FIXED as documentation — the header now names `postgres` as the owner, why (it is what `db:push` connects as), and that a migration applied by a different role would silently change the function's rights while the SQL looked identical. No `alter function … owner to`, which would need a migration and a push.

### F8 — Double-submit on the confirm button

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: `src/components/settings/DeleteAccountPanel.tsx:43-45`
- **Detail**: `pending` is React state, so `disabled` only takes effect on the next render. Two fast
  clicks fire two `DELETE`s; the second gets `no_data_found` → `unexpected` → the "Nothing was
  removed" sentence flashes in the dialog while the first request's navigation is in flight. Benign,
  and alarming at exactly the wrong moment.
- **Fix**: `if (pending) return;` at the top of `remove()`, or a `useRef` latch.
- **Decision**: FIXED — an `if (pending) return;` latch at the top of `remove()`, with the reason (React state means `disabled` lags a render, and the second DELETE would flash a failure sentence mid-navigation).

### F9 — `README.md` gained a section where the plan allowed a paragraph

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `README.md:183-197`
- **Detail**: The plan said "one row, one paragraph, no new section". What landed is a
  `### Deleting your account` heading plus four bullets. The content is exactly what `AGENTS.md`
  requires be stated to a user and none of it is filler — but the new heading sits between the routes
  table and the S-05 mutations table, so that second table now reads as if it belongs under
  "Deleting your account".
- **Fix**: Move the section below the S-05 mutations table, or collapse it to the paragraph the plan
  described.
- **Decision**: FIXED — the section moved below the S-05 mutations table, so the two route tables are no longer split by a heading. Its wording also picked up F2's distinction between a refusal and a lost response.

### F10 — Six documents cite `account-boundary.test.ts`, which does not exist on this branch

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AGENTS.md:149`, `AGENTS.md:560`, `access-control.md:177`, `access-control.md:189`, `tonnage-breakdown.test.ts:560`, `20260815090000_…sql:31`
- **Detail**: All six citations arrived with the sibling-branch documents this phase deliberately
  took. They resolve the moment `feature/cross-account-isolation` merges, so this is a transient
  artefact of the split rather than a defect in the work. But **Progress 4.3 asserts "the five cited
  paths all resolve"**, and that is true only of the paths cited by this slice's own additions —
  the row states the check more broadly than it was performed.
- **Fix**: Narrow the Progress 4.3 wording to what was actually checked, and note that the
  sibling-owned citations dangle until PR #1 merges.
- **Decision**: FIXED — Progress 4.3 narrowed to what was actually checked, and now names the six `account-boundary.test.ts` citations that dangle until PR #1 merges.
