import React, { useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoggedSetView, RecordAnnouncement, WeightUnit } from "@/types";
import { readSetFields, workoutMessageForCode } from "@/lib/validation/workout";

// Repetitions and weight are the only required fields: this form is meant to be usable one-handed
// on a 360 px screen between sets, which is the situation the product exists for.

interface Props {
  entryId: string;
  /** Whether this exercise may carry a zero or assisted load (FR-014), from `exercises`. */
  isBodyweight: boolean;
  /** The account's unit, rendered as a label — the client never chooses what a weight is stored in. */
  weightUnit: WeightUnit;
  /**
   * The saved set, and the record verdict that arrived with it (FR-020).
   *
   * `null` covers both "did not beat anything" and "first set for this exercise" — the screen
   * renders nothing for either, and US-02 requires the baseline to be silent.
   */
  onLogged: (set: LoggedSetView, record: RecordAnnouncement | null) => void;
}

export function AddSetForm({ entryId, isBodyweight, weightUnit, onLogged }: Props) {
  const [reps, setReps] = useState("");
  // A bodyweight exercise starts at zero ADDED load, which is the value most of its sets carry, so
  // the field holds a real 0 rather than showing one as a hint. Found in manual verification: a
  // greyed-out placeholder reading "0" is indistinguishable from a filled field, and submitting it
  // answered "Weight is required" — a correct message about a field the user believed they had
  // filled. A placeholder must never display a value that is valid for the thing being logged.
  const [weight, setWeight] = useState(isBodyweight ? "0" : "");
  const [rpe, setRpe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The same rules the endpoint enforces, checked here first so the ordinary mistake costs no
    // round trip — and the same call `EditSetForm` makes, so a correction can never be refused by a
    // rule a new set is not held to. The server still validates every one of them.
    const fields = readSetFields({ reps, weight, rpe }, isBodyweight);
    if (!fields.ok) {
      setError(workoutMessageForCode(fields.code));
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No unit in the body, deliberately: the endpoint reads it from the profile. A client that
        // could name it could store a number under the wrong unit and poison every derived figure.
        body: JSON.stringify({
          exerciseEntryId: entryId,
          reps: fields.reps,
          weight: fields.weight,
          rpe: fields.rpe,
        }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        // A CODE, resolved against this project's catalogue. The response's own words never reach
        // the screen, whatever the server sends.
        setError(workoutMessageForCode((body as { code?: string }).code));
        return;
      }

      const logged = body as { set: LoggedSetView; record: RecordAnnouncement | null };
      onLogged(logged.set, logged.record);
      setRpe("");
      // Repetitions and weight are deliberately KEPT: the next set is usually the same, and on a
      // failure the typed values must survive so the retry is one tap rather than a re-entry.
    } catch {
      setError(workoutMessageForCode("unexpected"));
    } finally {
      // Re-enabled for a MANUAL retry. Never an automatic one: a retry after a lost response writes
      // the same set twice, inflating tonnage and inventing a record nobody performed.
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-2 border-t border-white/10 bg-white/5 px-4 py-3"
      noValidate
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`reps-${entryId}`} className="mb-1 block text-xs text-blue-100/60">
            Reps
          </label>
          <input
            id={`reps-${entryId}`}
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(event) => {
              setReps(event.target.value);
              setError(null);
            }}
            placeholder="5"
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/30 focus:ring-2 focus:outline-none",
              error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <label htmlFor={`weight-${entryId}`} className="mb-1 block text-xs text-blue-100/60">
            Weight ({weightUnit})
          </label>
          <input
            id={`weight-${entryId}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value);
              setError(null);
            }}
            placeholder="100"
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/30 focus:ring-2 focus:outline-none",
              error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div className="w-16 shrink-0">
          <label htmlFor={`rpe-${entryId}`} className="mb-1 block text-xs text-blue-100/60">
            RPE
          </label>
          <input
            id={`rpe-${entryId}`}
            type="number"
            inputMode="decimal"
            step="0.5"
            value={rpe}
            onChange={(event) => {
              setRpe(event.target.value);
              setError(null);
            }}
            placeholder="—"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-white placeholder-white/30 focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          aria-label="Add set"
          className="flex shrink-0 items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
        >
          {pending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Plus className="size-4" />
          )}
        </button>
      </div>

      {error !== null && (
        <p className="flex items-start gap-1 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
}
