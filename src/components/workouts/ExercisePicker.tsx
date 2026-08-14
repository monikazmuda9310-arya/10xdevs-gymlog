import { useMemo, useState } from "react";
import { CircleAlert, Dumbbell, Search } from "lucide-react";
import type { Exercise } from "@/types";
import { MUSCLE_GROUP_LABELS } from "@/lib/validation/exercise";

// The catalogue was fetched once by the page; filtering runs HERE rather than as a request per
// keystroke. Tens of rows, so a round trip would be slower and would spend Worker CPU the free plan
// caps at 10 ms per invocation — the same call `/exercises` makes, for the same reason.

interface Props {
  catalogue: Exercise[];
  /** Exercises already in this workout — choosing one again jumps to it rather than erroring. */
  presentExerciseIds: string[];
  onPick: (exercise: Exercise) => void;
  pending: boolean;
  error: string | null;
}

export function ExercisePicker({ catalogue, presentExerciseIds, onPick, pending, error }: Props) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term === "" ? catalogue : catalogue.filter((exercise) => exercise.name.toLowerCase().includes(term));
  }, [catalogue, search]);

  return (
    <section className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-medium text-blue-100/80">Add an exercise</h2>

      <div className="relative">
        <label htmlFor="picker-search" className="sr-only">
          Search exercises
        </label>
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
        <input
          id="picker-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search by name"
          className="w-full rounded-lg border border-white/20 bg-white/10 py-2 pr-3 pl-10 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />
      </div>

      {error !== null && (
        <p className="flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-blue-100/60">
          No exercise matches “{search}”. Add it on the exercises page first.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-white/10 overflow-y-auto rounded-lg border border-white/10">
          {visible.map((exercise) => {
            const present = presentExerciseIds.includes(exercise.id);
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onPick(exercise);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  <span className="flex min-w-0 items-center gap-2 text-white">
                    <Dumbbell className="size-4 shrink-0 text-white/40" />
                    <span className="truncate">{exercise.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    {exercise.is_bodyweight && (
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-200">bodyweight</span>
                    )}
                    {present && (
                      // Saying so up front is the visible half of the idempotent-entry decision:
                      // choosing it again moves to that entry instead of refusing.
                      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-purple-200">in workout</span>
                    )}
                    <span className="text-blue-100/50">{MUSCLE_GROUP_LABELS[exercise.muscle_group]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
