import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type {
  EstimationFormula,
  Exercise,
  ExerciseEntryView,
  LoggedSetView,
  RecordAnnouncement,
  WeightUnit,
} from "@/types";
import { bestEstimateOf, estimateForLoggedSet, roundForDisplay } from "@/lib/services/set-display";
import type { SetEstimate } from "@/lib/services/set-estimate";
import { workoutMessageForCode } from "@/lib/validation/workout";
import { AddSetForm } from "@/components/workouts/AddSetForm";
import { ExercisePicker } from "@/components/workouts/ExercisePicker";

// Holds the workout in state and appends to it, so a lifter logging six sets between efforts never
// waits for a page load. Every write is still a real write — nothing is buffered here for later.

interface Props {
  workoutId: string;
  initialEntries: ExerciseEntryView[];
  catalogue: Exercise[];
  weightUnit: WeightUnit;
  estimationFormula: EstimationFormula;
}

export default function WorkoutDetail({ workoutId, initialEntries, catalogue, weightUnit, estimationFormula }: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // An object rather than a bare id: choosing the same exercise twice must scroll to it twice, and
  // an unchanged id would not re-run the effect below.
  const [focusRequest, setFocusRequest] = useState<{ entryId: string } | null>(null);
  // Record announcements, keyed by the set that earned one.
  //
  // **Deliberately not read back from the server on load** (PRD: "the save-time flag is ephemeral
  // and only covers the set just logged, while the list is what the user checks"). So this state is
  // seeded empty and only ever gains entries from a save in this session: after a reload the badges
  // are gone and `/records` is where the record lives. Keeping them would also mean inventing
  // behaviour for what happens when S-05 lets a set be edited out from under one.
  //
  // A `Map` rather than an object: `.get()` returns `RecordAnnouncement | undefined`, which is the
  // truth, whereas indexing a `Record<string, T>` is typed as always present because this project
  // does not enable `noUncheckedIndexedAccess` — and a guard against that reads to the type-checked
  // lint rule as dead code.
  const [records, setRecords] = useState(() => new Map<string, RecordAnnouncement>());

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    // Runs after the render that added the entry, so the element is in the document by now.
    document.getElementById(`entry-${focusRequest.entryId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusRequest]);

  async function handlePick(exercise: Exercise) {
    setPickerError(null);

    const present = entries.find((entry) => entry.exercise_id === exercise.id);
    if (present) {
      // The visible half of the idempotent-entry decision: an exercise already in this workout is
      // not an error, it is somewhere to go.
      setFocusRequest({ entryId: present.id });
      return;
    }

    setAdding(true);
    try {
      const response = await fetch("/api/exercise-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workoutId, exerciseId: exercise.id }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        setPickerError(workoutMessageForCode((body as { code?: string }).code));
        return;
      }

      const { entry, created } = body as { entry: { id: string; exercise_id: string }; created: boolean };

      if (created) {
        setEntries((current) => [
          ...current,
          {
            id: entry.id,
            exercise_id: entry.exercise_id,
            exercises: {
              id: exercise.id,
              name: exercise.name,
              muscle_group: exercise.muscle_group,
              is_bodyweight: exercise.is_bodyweight,
            },
            sets: [],
          },
        ]);
      }
      setFocusRequest({ entryId: entry.id });
    } catch {
      setPickerError(workoutMessageForCode("unexpected"));
    } finally {
      setAdding(false);
    }
  }

  function handleLogged(entryId: string, set: LoggedSetView, record: RecordAnnouncement | null) {
    setEntries((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, sets: [...entry.sets, set] } : entry)),
    );
    if (record) {
      setRecords((current) => new Map(current).set(set.id, record));
    }
  }

  return (
    <div className="space-y-6">
      <ExercisePicker
        catalogue={catalogue}
        presentExerciseIds={entries.map((entry) => entry.exercise_id)}
        onPick={(exercise) => {
          void handlePick(exercise);
        }}
        pending={adding}
        error={pickerError}
      />

      {entries.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-8 text-center text-blue-100/60">
          No exercises in this workout yet. Pick one above and log your first set.
        </p>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry) => {
            const best = bestEstimateOf(entry.sets, weightUnit, estimationFormula);
            return (
              <li
                key={entry.id}
                id={`entry-${entry.id}`}
                className="scroll-mt-4 overflow-hidden rounded-lg border border-white/10 bg-white/5"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <h2 className="font-medium text-white">{entry.exercises.name}</h2>
                  <span className="flex items-center gap-2 text-xs">
                    {entry.exercises.is_bodyweight && (
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-200">bodyweight</span>
                    )}
                    <span className="text-blue-100/50">{entry.exercises.muscle_group}</span>
                  </span>
                </header>

                {best !== null && (
                  // FR-015: the best estimate among this entry's own sets, not a stored trophy —
                  // it is recomputed from whatever sets are here, so it can go down as well as up.
                  <p className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-sm text-amber-200">
                    <Trophy className="size-4 shrink-0" />
                    Best estimated 1RM here: <strong>{roundForDisplay(best)}</strong> {weightUnit}
                  </p>
                )}

                {entry.sets.length > 0 && (
                  <ol className="divide-y divide-white/5 border-t border-white/10">
                    {entry.sets.map((set, index) => {
                      const announcement = records.get(set.id);
                      return (
                        <li key={set.id} className="px-4 py-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-white">
                              <span className="mr-2 text-xs text-blue-100/40">#{index + 1}</span>
                              {set.reps} × {set.weight} {set.weight_unit}
                              {set.rpe !== null && <span className="ml-2 text-xs text-blue-100/50">RPE {set.rpe}</span>}
                            </span>
                            <SetEstimateLabel
                              estimate={estimateForLoggedSet(set, weightUnit, estimationFormula)}
                              unit={weightUnit}
                            />
                          </div>
                          {announcement && (
                            // Its own line rather than a third item in the row above: at 360 px the
                            // row already wraps, and a record is the one thing here that must not
                            // arrive looking like an afterthought squeezed between two numbers.
                            <RecordBadge announcement={announcement} unit={weightUnit} formula={estimationFormula} />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                <AddSetForm
                  entryId={entry.id}
                  isBodyweight={entry.exercises.is_bodyweight}
                  weightUnit={weightUnit}
                  onLogged={(set, record) => {
                    handleLogged(entry.id, set, record);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * "You just beat your best" — the one thing this product exists to say at the moment it happens.
 *
 * **Both numbers on this line are re-derived in TypeScript.** The set's own estimate comes from the
 * estimator above; what it beat is computed here from the previous best set's typed weight, through
 * the same `estimateForLoggedSet`. The verdict came from SQL, but no number SQL computed is
 * rendered — which is what keeps the badge and the workout row from ever disagreeing by a digit.
 *
 * The previous best is estimable by construction (it came out of a ranking that excludes everything
 * unestimable), so the guard below is unreachable in practice. It is written rather than asserted
 * because the alternative is a non-null assertion that would be wrong exactly once.
 */
function RecordBadge({
  announcement,
  unit,
  formula,
}: {
  announcement: RecordAnnouncement;
  unit: WeightUnit;
  formula: EstimationFormula;
}) {
  const previous = estimateForLoggedSet(announcement.previousBest, unit, formula);

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-amber-300">
      <Trophy className="size-3.5 shrink-0" />
      Personal record
      {previous.kind === "estimate" && (
        <span className="font-normal text-amber-200/80">
          — beat {roundForDisplay(previous.oneRepMax)} {unit}
        </span>
      )}
    </p>
  );
}

/**
 * What a set is worth — or, in three cases out of four, why there is no number.
 *
 * Showing nothing would teach the user nothing. "Outside 1–12 reps" says the product is declining
 * to guess rather than failing, which is the difference between a limit and a bug.
 */
function SetEstimateLabel({ estimate, unit }: { estimate: SetEstimate; unit: WeightUnit }) {
  if (estimate.kind === "estimate") {
    return (
      <span className="text-sm text-purple-200">
        ≈ <strong>{roundForDisplay(estimate.oneRepMax)}</strong> {unit} 1RM
      </span>
    );
  }

  const phrase =
    estimate.kind === "bodyweight"
      ? "bodyweight — no load to estimate from"
      : estimate.kind === "assisted"
        ? "assisted — no estimate"
        : "outside 1–12 reps — no estimate";

  return <span className="text-sm text-blue-100/50">{phrase}</span>;
}
