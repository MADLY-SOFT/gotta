# Zombix Case Simulator v1.11 — Visual refinement

- Fixed history item art alignment by making each slot a square viewport and centering the image absolutely within it. The five-column grid now remains stable on narrow screens.
- Fixed the quest claim button placement: legacy `.zone-quest button` rules assigned it to grid column 2, outside the single-column action wrapper. The current action button explicitly resets grid row/column placement and stretches across the card.
- Unified case-opening typography with the Press Start 2P game font.
- Reworked case-opening backdrop, reel panel and action buttons to use the active skin colors and corner-radius setting instead of hard-coded colors/radii.
- Bumped service-worker cache name to `zombix-v111-visual-refinement`.

Database files are intentionally excluded from the release archive.
