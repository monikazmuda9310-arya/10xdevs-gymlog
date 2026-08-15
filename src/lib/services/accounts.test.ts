import { describe, expect, it } from "vitest";

import { accountDeletionFailureCode, FOREIGN_KEY_VIOLATION } from "@/lib/services/accounts";
import { ACCOUNT_MESSAGES } from "@/lib/validation/account";

// **The one guard the blocked path actually has.** The database state that produces a real `23503`
// here cannot be built from an integration test — see the closing note of
// `tests/integration/account-deletion.test.ts` — so this suite feeds the mapping a fabricated error
// instead. What it proves is narrow and worth stating: that a blocked deletion is answered with the
// sentence the user can act on rather than collapsed into the generic one. What it cannot prove is
// that Postgres raises `23503` on that path at all.

describe("accountDeletionFailureCode", () => {
  it("maps a foreign-key violation onto the blocked message, not the generic one", () => {
    // The whole claim: `on delete restrict` refusing the cascade is the ONE failure this product can
    // explain, and `unexpected` would throw that explanation away.
    expect(accountDeletionFailureCode({ code: FOREIGN_KEY_VIOLATION })).toBe("account_delete_blocked");
    expect(accountDeletionFailureCode({ code: FOREIGN_KEY_VIOLATION })).not.toBe("unexpected");
  });

  it("maps everything else onto unexpected", () => {
    // Non-vacuity: each of these is a code the function or PostgREST can really raise, so a mapping
    // that started matching too widely would be caught here rather than by a reader.
    for (const code of ["42501", "P0002", "23505", "PGRST202", "", "not-a-code"]) {
      expect(accountDeletionFailureCode({ code })).toBe("unexpected");
    }
    expect(accountDeletionFailureCode(null)).toBe("unexpected");
    expect(accountDeletionFailureCode(undefined)).toBe("unexpected");
    expect(accountDeletionFailureCode({})).toBe("unexpected");
  });

  it("every code it can return has a message", () => {
    // The catalogue and the mapping are two files, and nothing else would notice them drifting: a
    // code with no entry resolves to the generic sentence, so the failure would be silent.
    for (const error of [{ code: FOREIGN_KEY_VIOLATION }, { code: "whatever" }]) {
      expect(ACCOUNT_MESSAGES[accountDeletionFailureCode(error)]).toBeTruthy();
    }
  });

  it("only the message that can KNOW nothing was removed says so", () => {
    // **Load-bearing wording, and the asymmetry is the whole point.** A `23503` came from Postgres,
    // so the transaction rolled back and "Nothing was removed" is a fact worth stating — without it
    // the user assumes a half-deleted account, the outcome they would most fear and the one thing
    // that cannot happen.
    expect(ACCOUNT_MESSAGES.account_delete_blocked).toContain("Nothing was removed");

    // `unexpected` is ALSO reached when the RPC's response was lost after it committed, so the same
    // reassurance there would be a lie told at the worst possible moment. An implementation review
    // found it being told: an unguarded `signOut()` throw turned a successful deletion into
    // "Nothing was removed". These two assertions are what stop the sentence being copied back.
    expect(ACCOUNT_MESSAGES.unexpected).not.toContain("Nothing was removed");
    expect(ACCOUNT_MESSAGES.request_failed).not.toContain("Nothing was removed");

    // What they say instead: how the user can find out for themselves.
    expect(ACCOUNT_MESSAGES.unexpected).toContain("signing in again");
    expect(ACCOUNT_MESSAGES.request_failed).toContain("signing in again");
  });
});
