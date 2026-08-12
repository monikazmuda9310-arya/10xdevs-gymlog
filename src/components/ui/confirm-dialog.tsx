import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal confirmation, on the platform's own `<dialog>`.
 *
 * **This is the measured fallback the plan named, not a shortcut.** `npx shadcn@latest add
 * alert-dialog` was installed and measured first: it pulls `radix-ui` into a `client:load` island and
 * took `WorkoutDetail`'s built chunk from 10 689 B to 50 720 B — **+40 KB**, plus a 5 194 B shared
 * chunk — against a threshold of ~15 KB written into the plan before the measurement was taken. The
 * package was removed again.
 *
 * `showModal()` is what makes that trade honest rather than a downgrade. The browser supplies, in
 * the top layer and without a line of JavaScript from us:
 *
 * - **focus containment** — Tab cannot leave the dialog while it is modal;
 * - **Escape** — raised as a `cancel` event, so the keyboard route out is native;
 * - **inert background** — everything behind it stops taking clicks and stops being reachable;
 * - **focus restoration** — the invoking control is focused again on close.
 *
 * Two deliberate departures from the UA default:
 *
 * 1. **`cancel` is intercepted.** Left alone, Escape closes the element while the `open` prop this
 *    component is driven by stays `true` — React's state and the DOM then disagree, and the next
 *    render cannot reopen it. Preventing the default and reporting the cancel upward keeps the caller
 *    the single source of truth.
 * 2. **A click on the backdrop does nothing.** These are the first irreversible actions in this
 *    product, and dismissing them by an accidental click-through is exactly the mistake a
 *    confirmation exists to prevent. Cancelling is a control or the Escape key, both explicit.
 */
interface Props {
  open: boolean;
  /** Id of the element naming the dialog — a heading the caller renders inside `children`. */
  labelledBy: string;
  /** Id of the element describing it, so a screen reader announces the consequence with the title. */
  describedBy: string;
  onCancel: () => void;
  children: ReactNode;
}

export function ConfirmDialog({ open, labelledBy, describedBy, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    // Guarded both ways: `showModal()` on an already-open dialog throws, and `close()` on a closed
    // one fires a spurious `close` event.
    if (open && !dialog.open) {
      dialog.showModal();
      // Explicitly, rather than through React's `autoFocus`: that prop is a `.focus()` call on
      // MOUNT, and this element is mounted — closed — from the moment the page loads, so it would
      // be aimed at the wrong moment entirely. `showModal()` otherwise lands on the first focusable
      // descendant, which for a destructive confirmation is the destructive control.
      dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-white/15 bg-slate-900 p-0 text-blue-50 shadow-2xl backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm"
    >
      {children}
    </dialog>
  );
}
