import { useMemo, useState } from "react";
import { Search, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUSCLE_GROUPS, type Exercise, type MuscleGroup } from "@/types";
import { ExerciseForm } from "@/components/exercises/ExerciseForm";

// Filtering and search run HERE, over the catalogue the page already rendered, rather than as a
// request per keystroke. The catalogue is 38 seeded rows plus whatever one person adds, so a round
// trip would be slower and would spend Worker CPU the free plan caps at 10 ms per invocation.

const GROUP_LABELS: Record<MuscleGroup, string> = {
  legs: "Legs",
  back: "Back",
  chest: "Chest",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

interface Props {
  initialExercises: Exercise[];
}

export default function ExerciseCatalogue({ initialExercises }: Props) {
  const [exercises, setExercises] = useState(initialExercises);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<MuscleGroup | "all">("all");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return exercises.filter(
      (exercise) =>
        (group === "all" || exercise.muscle_group === group) &&
        (term === "" || exercise.name.toLowerCase().includes(term)),
    );
  }, [exercises, search, group]);

  // Counts come from the whole catalogue, not the filtered view: a group's tab should say how many
  // it holds, not how many survive the current search.
  const countFor = (value: MuscleGroup | "all") =>
    value === "all" ? exercises.length : exercises.filter((exercise) => exercise.muscle_group === value).length;

  return (
    <div className="space-y-6">
      <ExerciseForm
        onCreated={(exercise) => {
          setExercises((current) => [...current, exercise].sort((a, b) => a.name.localeCompare(b.name)));
        }}
      />

      <div className="space-y-3">
        <div className="relative">
          <label htmlFor="exercise-search" className="sr-only">
            Search exercises
          </label>
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
          <input
            id="exercise-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search by name"
            className="w-full rounded-lg border border-white/20 bg-white/10 py-2 pr-3 pl-10 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by muscle group">
          {(["all", ...MUSCLE_GROUPS] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={group === value}
              onClick={() => {
                setGroup(value);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                group === value
                  ? "border-purple-400 bg-purple-600 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/10",
              )}
            >
              {value === "all" ? "All" : GROUP_LABELS[value]} <span className="text-white/50">{countFor(value)}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        // Distinct from an empty catalogue, which cannot happen after the seed — this is "your
        // search matched nothing", and saying so is the difference between a dead end and a hint.
        <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-8 text-center text-blue-100/60">
          No exercise matches “{search}”. Try a shorter term, or add it below.
        </p>
      ) : (
        <ul className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-white/5">
          {visible.map((exercise) => (
            <li key={exercise.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-white">
                <Dumbbell className="size-4 shrink-0 text-white/40" />
                <span className="truncate">{exercise.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {exercise.is_bodyweight && (
                  <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-200">bodyweight</span>
                )}
                {exercise.user_id !== null && (
                  // The one distinction worth showing: which rows are this account's own.
                  <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-purple-200">yours</span>
                )}
                <span className="text-blue-100/50">{GROUP_LABELS[exercise.muscle_group]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-sm text-blue-100/50">
        Showing {visible.length} of {exercises.length}
      </p>
    </div>
  );
}
