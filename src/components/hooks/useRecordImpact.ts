import { useCallback, useState } from "react";

import type { FallingRecord } from "@/lib/services/record-impact";

/**
 * What the confirmation dialog knows about the cost of the action it is guarding.
 *
 * **`unavailable` is a state, not an error to swallow, and it must never collapse into an empty
 * `ready`.** An empty impact list is a positive claim — "no record is at stake" — so answering it
 * when the preflight failed would hand the user reassurance at the exact moment the product cannot
 * know. The endpoints refuse to degrade for the same reason (`impact_unavailable`, a non-2xx); this
 * is the client half of that promise.
 */
export type ImpactState = { kind: "loading" } | { kind: "ready"; impact: FallingRecord[] } | { kind: "unavailable" };

/**
 * Fetch what an edit or a deletion would cost, when the dialog opens.
 *
 * **Never at page load, deliberately.** This is the one screen in the product whose underlying state
 * changes under the user throughout a session — they log sets between efforts — so a figure fetched
 * with the page would be stale by the time it is read, and stale is worse than absent for a number
 * somebody is about to act on.
 *
 * Every failure route lands on `unavailable`: a non-2xx (including the 503 the endpoint answers when
 * the ranking read fails), a 404 for a row somebody removed in another tab, and a dropped connection
 * are all "we cannot say what this costs", which is one sentence on screen.
 */
export function useRecordImpact() {
  const [state, setState] = useState<ImpactState | null>(null);

  /**
   * Also RETURNS the outcome, not only stores it. A deletion opens its dialog first and lets this
   * fill it in, but an edit has to know whether anything is at stake before deciding whether to ask
   * at all — and reading that back out of React state on the next render would mean guessing when
   * the render happened.
   */
  const load = useCallback(async (url: string): Promise<ImpactState> => {
    setState({ kind: "loading" });

    const resolved = await request(url);
    setState(resolved);
    return resolved;
  }, []);

  const clear = useCallback(() => {
    setState(null);
  }, []);

  return { state, load, clear };
}

async function request(url: string): Promise<ImpactState> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { kind: "unavailable" };
    }
    const body = (await response.json()) as { impact?: FallingRecord[] };
    // A 200 whose body is not the agreed shape is not evidence of nothing at stake either.
    return body.impact ? { kind: "ready", impact: body.impact } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
