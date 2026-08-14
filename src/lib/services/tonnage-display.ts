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
 *
 * **Since S-08 there are TWO answers to "what does this number round to", and the second one costs
 * something.** `tonnageFigure` rounds one number on its own and serves the two weekly totals.
 * `apportionedFigures` rounds a LIST together, so the column of breakdown rows sums to the total
 * printed above it — and the price is that a row can read one whole unit away from its own
 * independently rounded value. A row of `33.5` in a week of `100.5` may print `33` where
 * `tonnageFigure` would print `34`.
 *
 * That price was paid deliberately. **The owner ruled on 2026-08-14** (plan review finding F1), given
 * the choice between a row that is individually truthful and a column that adds up: **the column
 * wins**, because adding the rows up is the only check the user can actually perform, and US-03's
 * acceptance criterion is about exactly that. The declined alternative was to keep rounding each row
 * independently and print an on-screen admission that the column drifts — rejected because a
 * breakdown whose own caption says it does not add up answers the user's question with an apology.
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

  return formatWholeUnits(Math.round(converted));
}

/**
 * A list of breakdown rows and the total they belong to, rounded TOGETHER so the printed column adds
 * up to the printed total (FR-018, FR-019, US-03).
 *
 * `foldBreakdown` already guarantees the kilograms reconcile. That guarantee stops at the display
 * layer: rounded one at a time, a week of `100.5 kg` split three ways as `33.5` prints `101` above
 * and `34 + 34 + 34 = 102` below, and across seven group rows the visible drift reaches several
 * units — more in pounds, where the conversion multiplies each residual. So this function does the
 * rounding for the whole list at once.
 *
 * **Largest remainder.** Every value and the total are converted first — for the reason
 * `tonnageFigure` converts before rounding — then each row is floored and the whole units left over
 * are handed out to the rows with the largest fractional parts until the rows sum to the rounded
 * total. Ties go to the earlier row, which makes the output a function of the input alone: the
 * breakdown arrives already sorted, so a render assertion on positions is not testing a coin flip.
 *
 * **The deficit is clamped, and the clamp is not the guard.** With rows that sum to the total, the
 * number of units to hand out is between zero and the row count by construction — sum-of-floors is
 * never above floor-of-sum. The clamp exists so a caller who ignored `foldBreakdown`'s
 * reconciliation gets a wrong-but-sane column rather than a negative figure or a crash; the thing
 * that actually keeps the column honest is that guard, one module away.
 */
export function apportionedFigures(kilograms: number[], totalKilograms: number, unit: WeightUnit): string[] {
  const converted = kilograms.map((value) => kilogramsIn(value, unit));
  const target = Math.round(kilogramsIn(totalKilograms, unit));

  const figures = converted.map((value) => Math.floor(value));
  const allocated = figures.reduce((sum, value) => sum + value, 0);
  const remaining = Math.min(Math.max(target - allocated, 0), figures.length);

  const byRemainder = converted
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder - a.remainder));

  for (const { index } of byRemainder.slice(0, remaining)) {
    figures[index] += 1;
  }

  return figures.map(formatWholeUnits);
}

/**
 * The one place a tonnage number becomes a string, so both functions above make the same formatting
 * decision — including the explicit locale, whose absence the test one file away spies for.
 *
 * The formatter is constructed per call rather than once at module scope. That is deliberate: a
 * module-level instance would be invisible to that spy, which asserts what the code ASKED FOR rather
 * than what this machine happened to answer.
 */
function formatWholeUnits(wholeUnits: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(wholeUnits);
}
