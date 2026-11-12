# Zombix Case Simulator v1.15 — Item Atlas (first pass)

- Added one lossless RGBA PNG atlas for all 171 item sprites.
- Source cells are preserved pixel-for-pixel at 30×30; no resampling, palette reduction, or lossy encoding.
- Atlas layout: 16 columns × 11 rows, 30×30 cells, total 480×330 px (158,400 canvas pixels). Actual source artwork: 153,900 pixels.
- Added `public/data/items-atlas.json` mapping metadata and `public/js/item-atlas.js` shared sprite renderer.
- Migrated the main item display paths: case drop list, roulette reel, bulk result cards, inventory, contract fan/cards, promo rewards, daily rewards, house requirements, and single-item result/detail views.
- Legacy item PNGs and JSON image paths remain in this first pass for compatibility with the editor, old clients, and any unconverted external integrations. Runtime views migrated above render from the atlas.
- Service worker cache version bumped to `zombix-v115-item-atlas`.
