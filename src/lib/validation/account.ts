// One definition of each account-deletion message. The fifth catalogue, beside ./auth, ./exercise,
// ./profile and ./workout, and it exists rather than borrowing one of them because the sentence
// "your account could not be deleted" has no home in a module that ships to the set form's island.
//
// **This file imports nothing, on purpose.** The delete panel is a `client:load` island, so whatever
// is reachable from here ships to the browser. It must also stay free of `astro:*` imports so the
// hermetic unit suite can reach it (AGENTS.md § Testing).

/**
 * Every message the account-deletion flow can show, and its code.
 *
 * **The response carries the code, never the text.** S-01's implementation review found that prose
 * travelling through a channel the caller can influence turns any screen into a phishing kit, and the
 * discipline is kept uniform even where the channel is a JSON body.
 */
// **The plan listed a fifth code, `account_delete_failed`, and it was dropped on purpose.**
// `accountDeletionFailureCode` returns only `account_delete_blocked` or `unexpected`, so a fifth
// entry would be dead: the same sentence as `unexpected`, for the same condition, emitted by nothing
// and testable by no one. A message the product cannot produce is a claim nobody checks.
export const ACCOUNT_MESSAGES = {
  // The honest failure this slice exists to produce. Reachable when another account holds an entry
  // pointing at one of this account's private exercises: `exercise_entries.exercise_id` carries
  // `on delete restrict`, so the cascade into `public.exercises` is refused and the whole deletion
  // is rolled back. **Nothing was deleted** — which is what the message has to convey, because a
  // half-deleted account is the outcome a user would most fear here.
  account_delete_blocked:
    "Your account could not be deleted because some of your exercises are still in use. Nothing was removed — please try again later.",
  // Outcomes the user did not cause.
  unauthenticated: "You need to be signed in to delete your account",
  not_configured: "Supabase is not configured",
  // **THIS ONE DELIBERATELY DOES NOT SAY "NOTHING WAS REMOVED", AND `account_delete_blocked` ABOVE
  // DELIBERATELY DOES.** The difference is what each layer can actually know. A `23503` came from
  // Postgres, so the transaction rolled back and "nothing was removed" is a fact. `unexpected` is
  // also reached when the RPC's RESPONSE was lost after it committed — at which point the account is
  // gone and the reassurance would be a lie told at the worst possible moment. Saying "sign in again
  // to check" is less comforting and is the only thing that is true on every path that reaches here.
  unexpected: "Your account could not be deleted. Try signing in again to check whether it went through.",
  // The browser could not reach the server at all, so the CLIENT knows even less than the server
  // would. Separate from `unexpected` because the endpoint never emits it — the panel does, for its
  // own `fetch` failure — and because reusing a server-authored sentence there would attribute
  // knowledge to a layer that has none.
  request_failed:
    "We could not reach the server, so we do not know whether your account was deleted. Try signing in again to check.",
} as const;

export type AccountMessageCode = keyof typeof ACCOUNT_MESSAGES;

/** Absent → no message; unrecognised → the generic one, never the caller's own words. */
export function accountMessageForCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return Object.hasOwn(ACCOUNT_MESSAGES, code)
    ? ACCOUNT_MESSAGES[code as AccountMessageCode]
    : ACCOUNT_MESSAGES.unexpected;
}
