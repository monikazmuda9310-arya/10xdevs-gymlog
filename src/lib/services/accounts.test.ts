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

  it("the blocked message says that nothing was removed", () => {
    // Load-bearing wording, not a style check. The deletion runs in one transaction, so a blocked
    // attempt leaves every row intact — and "we could not delete your account" without that
    // reassurance invites the user to assume a half-deleted account, which is the outcome they would
    // most fear and the one thing that cannot happen.
    expect(ACCOUNT_MESSAGES.account_delete_blocked).toContain("Nothing was removed");
    expect(ACCOUNT_MESSAGES.unexpected).toContain("Nothing was removed");
  });
});
