import React, { useState } from "react";
import { CalendarPlus, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_NOTE_LENGTH, workoutMessageForCode } from "@/lib/validation/workout";

// Imports the RULES and the message catalogue, never the zod schemas and never the service — this
// component is hydrated, so anything reachable from here ships to the browser. Same split as the
// exercise form, and the reason it exists: S-01 measured the difference at ~59 KB.

interface Props {
  /**
   * Today, computed on the server in the account's own timezone. Not `new Date()` in the browser:
   * the phone's clock is usually right, but the profile is the product's answer to "which day is
   * this", and the two must not disagree on the value the user is about to accept without reading.
   */
  defaultDate: string;
}

export default function NewWorkoutForm({ defaultDate }: Props) {
  const [performedOn, setPerformedOn] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The same rule the server enforces, checked here so the common mistake costs no round trip.
    if (performedOn === "") {
      setError(workoutMessageForCode("date_required"));
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ performedOn, note }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        // The response carries a CODE; the wording comes from this project's catalogue and never
        // from the body, so a server that started echoing prose could put no words on this screen.
        setError(workoutMessageForCode((body as { code?: string }).code));
        return;
      }

      const { workout } = body as { workout: { id: string } };
      window.location.href = `/workouts/${workout.id}`;
    } catch {
      setError(workoutMessageForCode("unexpected"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4"
      noValidate
    >
      <h2 className="text-sm font-medium text-blue-100/80">Log a new workout</h2>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-44">
          <label htmlFor="workout-date" className="mb-1 block text-xs text-blue-100/60">
            Date
          </label>
          <input
            id="workout-date"
            type="date"
            value={performedOn}
            onChange={(event) => {
              setPerformedOn(event.target.value);
              setError(null);
            }}
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white transition-colors focus:ring-2 focus:outline-none",
              error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div className="flex-1">
          <label htmlFor="workout-note" className="mb-1 block text-xs text-blue-100/60">
            Note <span className="text-blue-100/40">(optional)</span>
          </label>
          <input
            id="workout-note"
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(event) => {
              setNote(event.target.value);
              setError(null);
            }}
            placeholder="e.g. Push day, felt strong"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
      </div>

      {error !== null && (
        <p className="flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60 sm:w-auto"
      >
        {pending ? (
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <CalendarPlus className="size-4" />
        )}
        {pending ? "Creating…" : "Start workout"}
      </button>
    </form>
  );
}
