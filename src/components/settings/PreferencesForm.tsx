import React, { useRef, useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { ESTIMATION_FORMULAS, WEIGHT_UNITS, type EstimationFormula, type WeightUnit } from "@/types";
import {
  ESTIMATION_FORMULA_HINTS,
  ESTIMATION_FORMULA_LABELS,
  WEIGHT_UNIT_LABELS,
  profileMessageForCode,
} from "@/lib/validation/profile";

// Imports the RULES, the labels and the message catalogue — never the zod schemas. This component
// is hydrated, so anything reachable from here ships to the browser, and `profile-schemas.ts`
// reaches both zod (~59 KB, measured in S-01) and the 418-entry timezone list.
//
// **THE TIMEZONE OPTIONS ARE NOT A PROP AND MUST NEVER BECOME ONE.** Astro serialises island props
// into an `<astro-island props="…">` attribute in the rendered HTML, so passing the list would ship
// ~7 KB of zone names to the browser to be parsed at hydration — for a control that needs no
// JavaScript at all. The `<select>` is rendered by `settings.astro` and arrives here as CHILDREN,
// which Astro passes through the DOM rather than through props. This component knows only the
// currently selected value, and reads the rest off the form on submit.

interface Props {
  timezone: string;
  weightUnit: WeightUnit;
  estimationFormula: EstimationFormula;
  /** The server-rendered timezone `<select>`, slotted in by `settings.astro`. */
  children?: React.ReactNode;
}

/** The three columns the endpoint answers with. Narrow on purpose: the island needs nothing else. */
interface SavedProfile {
  timezone: string;
  weight_unit: WeightUnit;
  estimation_formula: EstimationFormula;
}

export function PreferencesForm({ timezone, weightUnit, estimationFormula, children }: Props) {
  const [unit, setUnit] = useState<WeightUnit>(weightUnit);
  const [formula, setFormula] = useState<EstimationFormula>(estimationFormula);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * The timezone lives in the DOM rather than in state, because the `<select>` holding it was
   * rendered by the server and this component never owned its options.
   */
  function selectedTimezone(form: HTMLFormElement): string {
    const field = form.elements.namedItem("timezone");
    return field instanceof HTMLSelectElement ? field.value : timezone;
  }

  // `React.SubmitEvent`, not the deprecated `FormEvent` — the other forms in this project agree.
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);

    const form = event.currentTarget;
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timezone: selectedTimezone(form),
          weightUnit: unit,
          estimationFormula: formula,
        }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        // The response carries a CODE; the wording comes from this project's catalogue, never from
        // the body. A server that started echoing prose could not put words on this screen.
        setError(profileMessageForCode((body as { code?: string }).code));
        return;
      }

      // **Replace our own state with the row the server actually stored**, rather than assuming the
      // write matched what was sent. The two differ the moment validation normalises anything, and
      // a form that shows its own optimistic guess is how a screen and a database disagree quietly.
      const profile = (body as { profile: SavedProfile }).profile;
      setUnit(profile.weight_unit);
      setFormula(profile.estimation_formula);
      const field = form.elements.namedItem("timezone");
      if (field instanceof HTMLSelectElement) {
        field.value = profile.timezone;
      }
      setSaved(true);
    } catch {
      setError(profileMessageForCode("unexpected"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <fieldset className="rounded-lg border border-white/10 bg-white/5 p-4">
        <legend className="px-1 text-sm font-medium text-blue-100/80">Weight unit</legend>
        <p className="mb-3 text-xs text-blue-100/50">
          What new sets are entered and stored in. Sets you have already logged keep the unit you typed them in.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          {WEIGHT_UNITS.map((value) => (
            <label
              key={value}
              className={cn(
                "flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                unit === value
                  ? "border-purple-400/60 bg-purple-500/20 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/10",
              )}
            >
              <input
                type="radio"
                name="weightUnit"
                value={value}
                checked={unit === value}
                onChange={() => {
                  setUnit(value);
                  setSaved(false);
                }}
                className="accent-purple-400"
              />
              {WEIGHT_UNIT_LABELS[value]} <span className="text-blue-100/50">({value})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-white/10 bg-white/5 p-4">
        <legend className="px-1 text-sm font-medium text-blue-100/80">Estimation formula</legend>
        <p className="mb-3 text-xs text-blue-100/50">
          Which formula estimates a one-rep max. Both are used for 1–12 repetitions only, and they agree exactly at ten.
        </p>
        <div className="flex flex-col gap-2">
          {ESTIMATION_FORMULAS.map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                formula === value
                  ? "border-purple-400/60 bg-purple-500/20 text-white"
                  : "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/10",
              )}
            >
              <input
                type="radio"
                name="estimationFormula"
                value={value}
                checked={formula === value}
                onChange={() => {
                  setFormula(value);
                  setSaved(false);
                }}
                className="mt-0.5 accent-purple-400"
              />
              <span>
                {ESTIMATION_FORMULA_LABELS[value]}
                <span className="mt-0.5 block text-xs text-blue-100/50">{ESTIMATION_FORMULA_HINTS[value]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-white/10 bg-white/5 p-4">
        <legend className="px-1 text-sm font-medium text-blue-100/80">Training week timezone</legend>
        <p className="mb-3 text-xs text-blue-100/50">
          Your training week runs Monday to Sunday in this zone, and a new workout defaults to today here.
        </p>
        {/* The server-rendered <select>. See the note at the top of this file for why it is slotted
            rather than built from a prop. */}
        {children}
      </fieldset>

      {/*
        **The sentence that stands in for a confirmation dialog.** S-05's dialog guards irreversible
        actions; this change is reversible to the digit, and cheapening that dialog is how people
        learn to click through the one that matters.
      */}
      <p className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-100/70">
        Changing these recomputes every estimate and record from the sets you have already logged — nothing stored is
        rewritten. A weight typed in kilograms still reads back as that number in kilograms, no workout changes date,
        and switching back restores exactly the figures you had.
      </p>

      {error !== null && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-300">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-400/40 bg-purple-500/30 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {pending ? "Saving…" : "Save preferences"}
        </button>

        {/* `aria-live` so the outcome reaches a screen reader too — the visual tick is not the only
            reader of this form. */}
        <span aria-live="polite" className="text-sm text-green-300">
          {saved && (
            <span className="inline-flex items-center gap-1">
              <Check className="size-4" aria-hidden="true" />
              Saved
            </span>
          )}
        </span>
      </div>
    </form>
  );
}
