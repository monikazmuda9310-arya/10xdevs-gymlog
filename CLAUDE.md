# GymLog

Projekt realizowany wg kontraktu kursu 10xdevs. **Przed rozpoczęciem pracy przeczytaj w kolejności:**

1. `C:\10xdev\handoff\STATE.md` — bieżący stan, decyzje, następny krok (czytaj to najpierw)
2. `C:\10xdev\handoff\CONTRACT.md` — cel, fazy, tryb pracy, punkty eskalacji do usera
3. `C:\10xdev\handoff\module-0{1,2,3}-summary.md` — streszczenia modułów kursu

Aplikacja to **dziennik treningowy (GymLog)**, nie SubTrack — kontrakt opisuje SubTracka,
zamiana jest zatwierdzona i udokumentowana w `STATE.md`.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
