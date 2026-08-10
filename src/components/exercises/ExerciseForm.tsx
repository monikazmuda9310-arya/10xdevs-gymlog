import React, { useState } from "react";
import { Plus, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUSCLE_GROUPS, type Exercise, type MuscleGroup } from "@/types";
import { MAX_EXERCISE_NAME_LENGTH, exerciseMessageForCode } from "@/lib/validation/exercise";

// Imports the RULES and the message catalogue, never the zod schema — this component is hydrated,
// so anything reachable from here ships to the browser. Same split as the auth forms.

interface Props {
  onCreated: (exercise: Exercise) => void;
}

export function ExerciseForm({ onCreated }: Props) {
  const [name, setName] = useState("");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>("legs");
  const [isBodyweight, setIsBodyweight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // `React.SubmitEvent`, not the deprecated `FormEvent` — the auth forms use the same type.
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The same rule the server enforces, checked here first so the common mistake never costs a
    // round trip. The server still validates — this is convenience, not the guarantee.
    if (name.trim() === "") {
      setError(exerciseMessageForCode("name_required"));
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/exercises", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, muscleGroup, isBodyweight }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        // The response carries a CODE; the wording comes from this project's catalogue, never from
        // the body. A server that started echoing prose could not put words on this screen.
        setError(exerciseMessageForCode((body as { code?: string }).code));
        return;
      }

      onCreated((body as { exercise: Exercise }).exercise);
      setName("");
      setIsBodyweight(false);
    } catch {
      setError(exerciseMessageForCode("unexpected"));
    } finally {
      setPending(false);
    }
  }

  const remaining = MAX_EXERCISE_NAME_LENGTH - name.length;

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4"
      noValidate
    >
      <h2 className="text-sm font-medium text-blue-100/80">Add your own exercise</h2>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="exercise-name" className="sr-only">
            Exercise name
          </label>
          <input
            id="exercise-name"
            type="text"
            value={name}
            maxLength={MAX_EXERCISE_NAME_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="e.g. Zercher Squat"
            className={cn(
              "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
              error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
            )}
          />
        </div>

        <div>
          <label htmlFor="exercise-group" className="sr-only">
            Muscle group
          </label>
          <select
            id="exercise-group"
            value={muscleGroup}
            onChange={(event) => {
              setMuscleGroup(event.target.value as MuscleGroup);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none sm:w-auto"
          >
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group} className="bg-slate-900">
                {group}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-blue-100/80">
        <input
          type="checkbox"
          checked={isBodyweight}
          onChange={(event) => {
            setIsBodyweight(event.target.checked);
          }}
          className="size-4 rounded border-white/30 bg-white/10"
        />
        Bodyweight — allows sets with zero or assisted (negative) load
      </label>

      {error !== null && (
        <p className="flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className={cn("text-xs", remaining < 10 ? "text-amber-300" : "text-blue-100/40")}>
          {remaining} characters left
        </span>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
        >
          {pending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Plus className="size-4" />
          )}
          {pending ? "Adding…" : "Add exercise"}
        </button>
      </div>
    </form>
  );
}
