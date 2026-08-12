import React, { useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { readSetFields, workoutMessageForCode } from "@/lib/validation/workout";
import type { LoggedSetView } from "@/types";

/**
 * Correcting one set in place (FR-010).
 *
 * **The weight field is labelled with the SET's own stored unit, not the account's.** The unit is a
 * property of the row being edited: after S-06 lets somebody switch to pounds, a set typed in
 * kilograms still holds kilograms, and the update payload deliberately carries no unit so the column
 * keeps what it has. Labelling this field from the profile would invite a number typed in one unit
 * to be stored as the other, and every figure derived from `weight_kg` would be wrong afterwards.
 *
 * The pre-check goes through `readSetFields` — the same rules `AddSetForm` uses and the same the
 * server enforces — so a correction is never refused by a rule a new set is not held to.
 */
interface Props {
  set: LoggedSetView;
  /** Whether this exercise may carry a zero or assisted load (FR-014). */
  isBodyweight: boolean;
  pending: boolean;
  /** A failure of the save itself, already resolved to a sentence by the caller. */
  error: string | null;
  onSubmit: (fields: { reps: number; weight: number; rpe: number | null }) => void;
  onCancel: () => void;
}

export function EditSetForm({ set, isBodyweight, pending, error, onSubmit, onCancel }: Props) {
  const [reps, setReps] = useState(String(set.reps));
  const [weight, setWeight] = useState(String(set.weight));
  const [rpe, setRpe] = useState(set.rpe === null ? "" : String(set.rpe));
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const fields = readSetFields({ reps, weight, rpe }, isBodyweight);
    if (!fields.ok) {
      setLocalError(workoutMessageForCode(fields.code));
      return;
    }

    onSubmit({ reps: fields.reps, weight: fields.weight, rpe: fields.rpe });
  }

  const shown = localError ?? error;

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 space-y-2 rounded-lg border border-white/15 bg-white/5 p-3"
      noValidate
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`edit-reps-${set.id}`} className="mb-1 block text-xs text-blue-100/60">
            Reps
          </label>
          <input
            id={`edit-reps-${set.id}`}
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(event) => {
              setReps(event.target.value);
              setLocalError(null);
            }}
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white focus:ring-2 focus:outline-none",
              shown ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <label htmlFor={`edit-weight-${set.id}`} className="mb-1 block text-xs text-blue-100/60">
            Weight ({set.weight_unit})
          </label>
          <input
            id={`edit-weight-${set.id}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value);
              setLocalError(null);
            }}
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white focus:ring-2 focus:outline-none",
              shown ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div className="w-16 shrink-0">
          <label htmlFor={`edit-rpe-${set.id}`} className="mb-1 block text-xs text-blue-100/60">
            RPE
          </label>
          <input
            id={`edit-rpe-${set.id}`}
            type="number"
            inputMode="decimal"
            step="0.5"
            value={rpe}
            onChange={(event) => {
              setRpe(event.target.value);
              setLocalError(null);
            }}
            placeholder="—"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-white placeholder-white/30 focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
      </div>

      {shown !== null && (
        <p className="flex items-start gap-1 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {shown}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
        >
          <Check className="size-3.5" />
          Save set
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-blue-100 transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}
