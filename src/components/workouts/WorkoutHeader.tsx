import React, { useState } from "react";
import { Check, CircleAlert, Pencil, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRecordImpact } from "@/components/hooks/useRecordImpact";
import { RecordImpactDialog } from "@/components/workouts/RecordImpactDialog";
import { MAX_NOTE_LENGTH, workoutMessageForCode } from "@/lib/validation/workout";
import type { EstimationFormula, WeightUnit } from "@/types";

// Imports the RULES and the message catalogue, never the zod schemas and never a service — this is a
// hydrated island, so everything reachable from here ships to the browser (S-01 measured zod at
// ~59 KB). Same split as the two forms beside it.

interface Props {
  workoutId: string;
  /** The stored `YYYY-MM-DD`, and what the date input round-trips. */
  performedOn: string;
  note: string | null;
  weightUnit: WeightUnit;
  estimationFormula: EstimationFormula;
}

export default function WorkoutHeader({ workoutId, performedOn, note, weightUnit, estimationFormula }: Props) {
  // The server's row is the seed; every later value is the row the server ECHOED BACK from the
  // update, never the one typed here — so what the screen shows is what was stored.
  const [saved, setSaved] = useState({ performedOn, note });
  const [editing, setEditing] = useState(false);
  const [dateField, setDateField] = useState(performedOn);
  const [noteField, setNoteField] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const impact = useRecordImpact();

  function startEditing() {
    setDateField(saved.performedOn);
    setNoteField(saved.note ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (dateField === "") {
      setError(workoutMessageForCode("date_required"));
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/workouts/${workoutId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ performedOn: dateField, note: noteField }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        setError(workoutMessageForCode((body as { code?: string }).code));
        return;
      }

      // Replaced with what came back, not with what was typed: the note is trimmed server-side and
      // an empty one becomes null, so echoing the typed value would show a string the row does not
      // hold. Changing the date needs nothing recomputed — no weekly figure is stored anywhere.
      const { workout } = body as { workout: { performed_on: string; note: string | null } };
      setSaved({ performedOn: workout.performed_on, note: workout.note });
      setEditing(false);
    } catch {
      setError(workoutMessageForCode("unexpected"));
    } finally {
      setPending(false);
    }
  }

  function openDeleteDialog() {
    setError(null);
    setConfirmingDelete(true);
    // Fetched when the dialog opens, never at page load: sets get logged throughout a session, so a
    // figure fetched with the page would be stale by the time somebody acted on it.
    void impact.load(`/api/workouts/${workoutId}/impact`);
  }

  function closeDeleteDialog() {
    setConfirmingDelete(false);
    impact.clear();
    setError(null);
  }

  async function handleDelete() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/workouts/${workoutId}`, { method: "DELETE" });

      if (!response.ok) {
        const body: unknown = await response.json();
        setError(workoutMessageForCode((body as { code?: string }).code));
        return;
      }

      // The workout this page is about is gone, so there is no state to reconcile — leave.
      window.location.href = "/workouts";
    } catch {
      setError(workoutMessageForCode("unexpected"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <form
          onSubmit={(event) => {
            void handleSave(event);
          }}
          className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4"
          noValidate
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:w-44">
              <label htmlFor="edit-workout-date" className="mb-1 block text-xs text-blue-100/60">
                Date
              </label>
              {/* A plain YYYY-MM-DD value, never reformatted through `new Date`: parsed as UTC
                  midnight it would show the previous day to anybody west of it — the exact bug
                  `performed_on` being a date rather than an instant avoids. */}
              <input
                id="edit-workout-date"
                type="date"
                value={dateField}
                onChange={(event) => {
                  setDateField(event.target.value);
                  setError(null);
                }}
                className={cn(
                  "w-full rounded-lg border bg-white/10 px-3 py-2 text-white focus:ring-2 focus:outline-none",
                  error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
                )}
              />
            </div>

            <div className="flex-1">
              <label htmlFor="edit-workout-note" className="mb-1 block text-xs text-blue-100/60">
                Note <span className="text-blue-100/40">(optional)</span>
              </label>
              <input
                id="edit-workout-note"
                type="text"
                value={noteField}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(event) => {
                  setNoteField(event.target.value);
                  setError(null);
                }}
                placeholder="e.g. Push day, felt strong"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:ring-2 focus:ring-purple-400 focus:outline-none"
              />
            </div>
          </div>

          {error !== null && (
            <p className="flex items-start gap-1 text-xs text-red-300">
              <CircleAlert className="mt-0.5 size-3 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
            >
              <Check className="size-4" />
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              <X className="size-4" />
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
              {saved.performedOn}
            </h1>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startEditing}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-blue-100 transition-colors hover:bg-white/10"
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={openDeleteDialog}
                className="flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-500/15"
              >
                <Trash2 className="size-3.5" />
                Delete workout
              </button>
            </div>
          </div>

          {saved.note !== null && <p className="text-sm text-blue-100/70">{saved.note}</p>}

          {/* A failed delete has no dialog left to show it, so it belongs here. */}
          {!confirmingDelete && error !== null && (
            <p className="flex items-start gap-1 text-xs text-red-300">
              <CircleAlert className="mt-0.5 size-3 shrink-0" />
              {error}
            </p>
          )}
        </>
      )}

      <RecordImpactDialog
        open={confirmingDelete}
        action="delete"
        title="Delete this workout?"
        consequence="This removes the workout with every exercise and every set logged under it. It cannot be undone."
        confirmLabel="Delete workout"
        state={impact.state ?? { kind: "loading" }}
        unit={weightUnit}
        formula={estimationFormula}
        pending={pending}
        error={confirmingDelete ? error : null}
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={closeDeleteDialog}
      />
    </div>
  );
}
