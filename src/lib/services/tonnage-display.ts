/**
 * What a weekly tonnage total looks like on screen (FR-017, FR-022).
 *
 * The same split `records.ts` / `record-display.ts` uses: `tonnage.ts` reads, this decides what
 * prints. Pure, dependency-free and free of `astro:*` imports, so the hermetic unit suite reaches it
 * — the arithmetic that turns a number into a string must not live in a `.astro` file, where only a
 * render test could see it and only by parsing HTML.
 *
 * **This is the repository's first formatter.** `record-display.ts` returns `{ value: number }` and
 * lets the page print the unit beside it; a tonnage figure returns a finished string, because the
 * thousands separator is part of the formatting decision rather than of the page's layout. Said here
 * rather than left to be noticed.
 */

import { kilogramsIn } from "@/lib/services/set-display";
import type { WeightUnit } from "@/types";

/**
 * A weekly total, converted to the reader's unit and formatted for a screen.
 *
 * **Whole units, not the one decimal place the rest of the product shows.** `roundForDisplay` is
 * right for a weight — a tenth of a kilogram is a real distinction on a barbell — and wrong for a
 * five-digit sum: `12 345.7 kg` claims a precision a week's tonnage does not have, and pounds are
 * worse. A weekly figure is a comparison score, which is how the PRD frames it.
 *
 * **The conversion happens BEFORE the rounding, never after.** Rounding first and converting second
 * lets the rounding error through the conversion factor, which is the same rule `roundForDisplay`'s
 * own comment states: round at the last possible moment and nowhere upstream.
 *
 * **The locale is explicit, and that is not decoration.** `new Intl.NumberFormat()` with no locale
 * inherits the runtime default: `12,345` under `en-US` and `12.345` under `de-DE` — a number a
 * reader parses as twelve. This is the hazard `calendar.ts:38` already pins for dates ("a locale
 * that happens to produce ISO order is how a date silently becomes `11/08/2026` on somebody else's
 * build"), and the render suite cannot catch it: `vitest.render.config.ts` disclaims runtime
 * fidelity, so a separator proven in Node proves nothing about workerd.
 */
export function tonnageFigure(kilograms: number, unit: WeightUnit): string {
  const converted = kilogramsIn(kilograms, unit);

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(converted));
}
