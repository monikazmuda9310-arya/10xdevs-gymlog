/**
 * TEMPORARY. Deleted in Phase 5 of context/changes/log-workout-with-estimate/plan.md, where its
 * absence and its 404 on the deployed host are both success criteria.
 *
 * Why it exists: `todayIn` is unit-tested under Vitest, which runs in Node, and Node ships full ICU
 * data for every IANA timezone. The runtime this application actually runs in is workerd. No
 * primary Cloudflare document states that Workers carries complete timezone data, and nothing else
 * in this repository has ever used `Intl` — so a green unit suite says nothing about the deployed
 * behaviour. If the runtime were timezone-blind, every zone would collapse to UTC, the default date
 * on the workout form would be silently wrong for anybody east or west of UTC, and no test in the
 * gate would notice.
 *
 * `astro dev` runs the real workerd (AGENTS.md § Cloudflare traps), so a request against the dev
 * server is a genuine measurement rather than a Node one.
 *
 *     curl -s localhost:4321/api/dev/tz-probe
 *
 * Kiritimati is UTC+14 and Niue is UTC-11, twenty-five hours apart. At the fixed instant below a
 * correct ICU build puts them on THREE different calendar dates; a reduced one collapses them to
 * one. `distinctDates` is the whole answer.
 */

import type { APIRoute } from "astro";

import { todayIn } from "@/lib/services/calendar";

export const prerender = false;

/** Fixed, so the probe answers the same thing whenever it is run. 10:00 UTC sits mid-day. */
const INSTANT = new Date("2026-08-11T10:00:00Z");

const ZONES = ["Pacific/Kiritimati", "UTC", "Pacific/Niue"] as const;

export const GET: APIRoute = () => {
  const dates = Object.fromEntries(ZONES.map((zone) => [zone, todayIn(zone, INSTANT)]));
  const distinctDates = new Set(Object.values(dates)).size;

  return new Response(
    JSON.stringify(
      {
        instant: INSTANT.toISOString(),
        dates,
        distinctDates,
        verdict: distinctDates === 3 ? "real timezone data" : "REDUCED ICU — todayIn cannot be trusted here",
      },
      null,
      2,
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
