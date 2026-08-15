import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { accountMessageForCode } from "@/lib/validation/account";
import type { AccountFootprint } from "@/lib/services/accounts";

interface Props {
  /** `null` when the counts could not be read — see `accountFootprint`. Never coerced to zeros. */
  footprint: AccountFootprint | null;
}

/** "42 workouts, 310 sets and 6 custom exercises" — an Oxford-free list the sentence can absorb. */
function describe({ workouts, sets, customExercises }: AccountFootprint): string {
  const parts = [
    `${workouts} ${workouts === 1 ? "workout" : "workouts"}`,
    `${sets} ${sets === 1 ? "set" : "sets"}`,
    `${customExercises} ${customExercises === 1 ? "custom exercise" : "custom exercises"}`,
  ];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The account-deletion control, and the confirmation in front of it.
 *
 * **It lives OUTSIDE `settings.astro`'s `loadFailed` branch on purpose.** That branch replaces the
 * whole preferences form when the profile read fails — and a user whose profile cannot be read is
 * more likely to want this control, not less. `tests/render/settings-delete-panel.test.ts` asserts
 * the panel renders in both states, which is the only thing that would catch it being moved inside.
 *
 * **The counts are named rather than summarised.** "Your whole history" is an abstraction nobody can
 * weigh; the same reasoning put the falling-record figure into S-05's dialog. When they could not be
 * read the sentence says so — a zero here would read as "you have nothing to lose" at the exact
 * moment that is the question.
 */
export function DeleteAccountPanel({ footprint }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two islands could mount a dialog on one page, so the ids cannot be constants.
  const titleId = useId();
  const bodyId = useId();

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string };
        // The catalogue resolves the code; the server's prose never reaches the screen.
        setError(accountMessageForCode(body.code) ?? accountMessageForCode("unexpected"));
        setPending(false);
        return;
      }
      // **Leave, rather than reconcile.** There is no state left to update — the account is gone and
      // the endpoint has already cleared the session cookie on this very response. Same move as
      // `WorkoutHeader` after deleting a workout.
      window.location.href = "/auth/signin?notice=account_deleted";
    } catch {
      setError(accountMessageForCode("unexpected"));
      setPending(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-red-400/30 bg-red-950/20 p-4">
      <h2 className="text-sm font-semibold text-red-200">Delete account</h2>
      <p className="mt-1 text-sm text-blue-100/60">
        Removes your account and every workout, set and custom exercise stored with it. This cannot be undone.
      </p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-3 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/25 focus:ring-2 focus:ring-red-300 focus:outline-none"
      >
        Delete my account
      </button>

      <ConfirmDialog
        open={open}
        labelledBy={titleId}
        describedBy={bodyId}
        onCancel={() => {
          if (!pending) setOpen(false);
        }}
      >
        <div className="p-6">
          <h3 id={titleId} className="text-lg font-semibold text-red-200">
            Delete your account?
          </h3>
          <p id={bodyId} className="mt-2 text-sm text-blue-100/80">
            {footprint
              ? `This removes ${describe(footprint)}, along with your account. It cannot be undone.`
              : "This removes your account and everything stored with it. We could not count your training just now, so this dialog cannot say how much — it cannot be undone either way."}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-400/40 bg-red-900/40 px-3 py-2 text-sm text-red-100"
            >
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {/* Cancel FIRST in the DOM and carrying the initial focus: `showModal()` otherwise lands
                on the first focusable descendant, which for a destructive dialog would be the
                destructive control. */}
            <button
              type="button"
              data-initial-focus
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm text-blue-50 hover:bg-white/10 focus:ring-2 focus:ring-purple-300 focus:outline-none disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void remove()}
              className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus:ring-2 focus:ring-red-300 focus:outline-none disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
      </ConfirmDialog>
    </section>
  );
}
