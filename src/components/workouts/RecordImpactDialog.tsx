import { useId } from "react";
import { CircleAlert, Loader2, TriangleAlert } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ImpactState } from "@/components/hooks/useRecordImpact";
import { impactSentences } from "@/lib/services/record-display";
import { workoutMessageForCode } from "@/lib/validation/workout";
import type { EstimationFormula, WeightUnit } from "@/types";

/**
 * The sentence a user reads before an irreversible correction (US-02), written once for all four
 * operations: editing a set, deleting a set, removing an exercise from a workout, deleting a workout.
 *
 * **No arithmetic happens here.** Every figure comes from `fallToFigure`, which re-derives it in
 * TypeScript from the surviving set's own typed `weight` and `weight_unit` — so the number promised
 * in this dialog is the same number `/records` shows afterwards, rather than a rounding of one
 * Postgres computed in exact `numeric`.
 *
 * ## Three states, and the third is the point
 *
 * 1. **Nothing at stake.** A deletion still asks, because it is irreversible whether or not a record
 *    depends on it, and says plainly that none does. An edit is not irreversible, so the caller skips
 *    the dialog entirely for that case rather than nagging about a typo fix.
 * 2. **These records fall.** One line per distinct **future** — which is NOT one line per affected
 *    record, and the difference is a defect that reached the deployed app. `fallingRecords` emits an
 *    entry per record KIND and is right to, because a set holding both records really does take both
 *    down; but "this lift will no longer appear in your records at all" is a fact about the
 *    **exercise**, so a set that was the last one logged for its lift printed that sentence twice,
 *    word for word. Most futures are per-record and still get their own line, naming the exercise, the
 *    record, and what it falls to; `no_sets_left` is per-exercise and collapses. The collapse is
 *    `impactSentences`, and it holds because each sentence declares its own `scope` — **not** because
 *    two strings matched, which would silently merge two real records the day a branch stopped
 *    naming its own. Different futures still never share a sentence.
 * 3. **The cost is unknown.** Shown when the preflight answered `impact_unavailable`. Confirmation
 *    stays available — a database hiccup must not make the product uncorrectable again, which is the
 *    condition this whole slice exists to remove — but the dialog says so. **State 3 must never
 *    render as state 1**, and every branch below is written so it cannot.
 */
interface Props {
  open: boolean;
  /** Whether the user is removing rows or changing one. It decides the mood of every sentence. */
  action: "delete" | "edit";
  title: string;
  /** What is about to happen, in the user's terms — independent of any record. */
  consequence: string;
  confirmLabel: string;
  state: ImpactState;
  unit: WeightUnit;
  formula: EstimationFormula;
  /** The action is running; the dialog stays open so the outcome lands where the user is looking. */
  pending: boolean;
  /** A failure of the action itself, already resolved to a sentence by the caller. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecordImpactDialog({
  open,
  action,
  title,
  consequence,
  confirmLabel,
  state,
  unit,
  formula,
  pending,
  error,
  onConfirm,
  onCancel,
}: Props) {
  // Two islands mount this component on the same page, so the ids that wire the heading and the body
  // to the dialog cannot be literals — duplicates would point both dialogs at one description.
  const titleId = useId();
  const bodyId = useId();

  return (
    <ConfirmDialog open={open} labelledBy={titleId} describedBy={bodyId} onCancel={onCancel}>
      <div className="space-y-4 p-5">
        <h2 id={titleId} className="text-lg font-semibold text-white">
          {title}
        </h2>

        <div id={bodyId} className="space-y-3 text-sm">
          <p className="text-blue-100/80">{consequence}</p>

          {state.kind === "loading" && (
            <p className="flex items-center gap-2 text-blue-100/60">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Checking which records depend on this…
            </p>
          )}

          {/* State 3. Deliberately loud, and deliberately NOT the "nothing at stake" sentence. */}
          {state.kind === "unavailable" && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {workoutMessageForCode("impact_unavailable")}
            </p>
          )}

          {state.kind === "ready" &&
            (state.impact.length === 0 ? (
              <p className="text-blue-100/60">No personal record depends on this.</p>
            ) : (
              <ul className="space-y-2">
                {impactSentences(state.impact, action, unit, formula).map((row) => (
                  <li
                    key={row.key}
                    className="flex items-start gap-2 rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-purple-100"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-purple-300" />
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>
            ))}

          {error !== null && (
            <p className="flex items-start gap-2 text-red-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Cancel takes the opening focus and is first in the DOM, so the way out is where both the
            keyboard and the eye land first — never the irreversible control. `flex-col-reverse`
            keeps the visual order conventional at 360 px without reordering the document. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-initial-focus
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || state.kind === "loading"}
            className={
              action === "delete"
                ? "flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
                : "flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
            }
          >
            {pending && <Loader2 className="size-4 shrink-0 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ConfirmDialog>
  );
}
