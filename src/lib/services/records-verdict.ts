/**
 * Whether the set that was just saved is a personal record — decided by WHICH ROW WON, never by
 * comparing two numbers.
 *
 * This is the seam between the two implementations of the one-rep-max formula. `one-rep-max.ts`
 * computes in binary float64; the `case` expression inside the `set_estimates` view computes in
 * exact `numeric`. They agree to far more digits than the product displays and never to the last
 * bit, so a record decided by comparing one against the other could be invented or erased — the
 * exact failure the PRD forbids ("no rounding or unit conversion may turn a non-record into a
 * record"). Postgres therefore ranks the sets and this function reads off the ranking: the only
 * comparison here is between two **ids**.
 *
 * The caller hands in the top TWO estimable sets for the exercise, ordered
 * `estimate desc, created_at asc, set_id asc` — the same ordering the view uses. That ordering is
 * itself the equality rule: an equal but OLDER set sorts first, so a set that merely ties the
 * previous best does not win and is not announced (US-02).
 *
 * Browser-safe and dependency-free at runtime: the one import is a type and is erased at build, so
 * a hydrated island can import the verdict shape without pulling in the Supabase client.
 */

import type { DisplayableSet } from "./set-display";

/**
 * One set as the record query ranks it.
 *
 * Extends `DisplayableSet` rather than restating its columns, because the screen re-derives the
 * displayed estimate from `weight` / `weight_unit` through `estimateForLoggedSet` — no number this
 * module carries from SQL is ever rendered.
 */
export interface RankedSet extends DisplayableSet {
  set_id: string;
  estimate_kg: number;
  performed_on: string;
}

/** What the endpoint puts on the wire when — and only when — there is something to announce. */
export interface RecordAnnouncement {
  previousBest: RankedSet;
}

/**
 * Three answers, and only one of them is announced.
 *
 * `baseline` is deliberately distinct from `none` even though both render nothing: the difference
 * is *why* nothing is shown, and collapsing them here would make the first-ever-set rule (US-02)
 * invisible to the test that pins it.
 */
export type RecordVerdict = { kind: "record"; previousBest: RankedSet } | { kind: "baseline" } | { kind: "none" };

/**
 * Total by construction: a set that carries no estimate at all — bodyweight, assisted, or outside
 * 1–12 repetitions — is absent from `topTwo` and therefore answers `none`, with no branch of its
 * own. That is the same exclusion `isEstimable` applies, arrived at by not being in the ranking.
 */
export function verdictForSet(topTwo: readonly RankedSet[], savedSetId: string): RecordVerdict {
  // Length checks rather than truthiness on an index. This project does not enable
  // `noUncheckedIndexedAccess`, so `topTwo[1]` is TYPED as always present while at runtime it is
  // precisely the thing that may be absent — and a truthiness guard there reads to the type-checked
  // lint rule as dead code. Asking the length says the same thing and says it honestly.
  if (topTwo.length === 0 || topTwo[0].set_id !== savedSetId) {
    return { kind: "none" };
  }

  // Top of the ranking with nothing behind it is the first estimable set for this exercise. It
  // establishes the baseline and must NOT be announced — FR-020's recorded noise argument, which
  // would otherwise fire on every set of the first few weeks.
  return topTwo.length > 1 ? { kind: "record", previousBest: topTwo[1] } : { kind: "baseline" };
}
