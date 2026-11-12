# v1.16 — Item atlas runtime fix

## Why v1.15 failed when the old folder was renamed

The frontend had begun drawing item sprites from `public/png/items-atlas.png`, but two legacy assumptions remained:

- `server.js` and `scripts/validate-data.js` still required every `png/items/items_N.png` file to exist. The first missing file (`items_1.png`) caused startup to abort before the web server could start.
- A few result/contract/roulette paths and the admin editor still created ordinary `<img src="png/items/items_N.png">` elements. They did not use the atlas background renderer.

## v1.16 changes

- Added one shared server-side atlas validator. It checks the atlas metadata, safe public path, actual PNG signature and dimensions, item ID coverage, and each legacy image identifier's matching cell.
- Kept `items.json` image values unchanged as stable logical IDs. No database/state/API migration is needed; old item references are still understood.
- Removed the server and data-audit dependency on the retired per-item PNG directory.
- Fixed single-result, contract-result, and roulette winner nodes to update atlas-backed spans (not `img.src`). Roulette now waits for the shared atlas texture to load/decode.
- Migrated item thumbnails and drop-row previews in the admin editor to the same shared renderer.
- Added an image preload and bumped the service-worker cache name.
- Updated the visual test fixture and added regression tests for a deployment that contains the atlas but has no `png/items` directory.

## Compatibility notes

- `public/png/items-atlas.png` is now the only required physical image file for regular items.
- `items.json` continues to store `png/items/items_N.png` strings for backwards compatibility; the application interprets these as IDs, not as file locations.
- Case artwork, avatar atlas, artifact atlas, house art, and UI icons remain separate assets.

## Verification

`npm run check` verifies the full automated suite and static data. A separate startup check is also run with `public/png/items` renamed out of the way to reproduce the user's test.
