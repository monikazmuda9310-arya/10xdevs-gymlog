import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // **The suite runs in a zone that has daylight saving AND a negative UTC offset, deliberately.
    // Both halves are load-bearing and each was measured during S-07 Phase 1.**
    //
    // `calendar.ts` computes week boundaries in a frame with no zone and no DST. Two different
    // reflexes break that, and each needs a different property of the ambient zone to be caught:
    //
    //   * a LOCAL `Date` plus millisecond arithmetic (a week is 167 or 169 hours across a
    //     transition) — caught only where the ambient zone HAS DST. Passes under UTC.
    //   * `getDay()` where `getUTCDay()` is meant — for a value anchored at `T00:00:00Z` the two
    //     differ only where the ambient offset is NEGATIVE, because only there is local midnight-UTC
    //     the previous day. Passes under UTC and under `Europe/Warsaw` alike.
    //
    // CI runners are UTC, so without this line neither guard bites where it matters. The first
    // version of this pin was `Europe/Warsaw` — the product's default and the owner's zone, which
    // read as principled and silently disabled the second guard. `America/New_York` has both
    // properties; that it is nobody's actual zone is the point, since the value under test is
    // supposed to be zone-independent.
    //
    // Nothing else in the unit suite reads the ambient zone — every `todayIn` call names its own.
    // **This setting overrides a `TZ` prefix on the command line**, so mutating either guard means
    // editing here, not exporting a variable.
    env: { TZ: "America/New_York" },
  },
});
