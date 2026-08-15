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
  unexpected: "Your account could not be deleted. Nothing was removed. Please try again.",
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
