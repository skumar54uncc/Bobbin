# Phase 4 notes (from the Phase 2 live test, 2026-10-08)

Bugs on the current Connect AI Agents tab, to be fixed in the Phase 4 rewrite, not before:

- Expanding "Setup and sheet rules" overlaps and hides the assistant cards and the prompt box.
  The accordion must push content down, never overlay it.
- The card row scrolls horizontally and the last card is cut off. Cards wrap into a grid with no
  horizontal scrolling at the popup's real width.
- Add a visual test at that width with the accordion open and closed.
