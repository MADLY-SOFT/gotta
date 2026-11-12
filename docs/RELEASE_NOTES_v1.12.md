# Zombix Case Simulator v1.12 — quest and roulette polish

## Quest interface
- Removed quest descriptions entirely; the card now shows only period, state, task title, progress, rewards and action.
- Moved current/target values and percent into the progress bar itself.
- Rebuilt the card as one vertical layout with a full-width, always-visible claim button.
- Increased pixel-font sizing for the task title and progress values.
- Uses active skin colors and `--border-radius`, with small-screen layout adjustments.

## Case opening
- Normal roll animation now lasts about 7.6 seconds per lane (staggered for multi-open), instead of about 4.2 seconds.
- The winning item is placed third from the end; two decoy cards remain after it so the strip does not stop at an empty edge.
- Removed rarity-name captions from reel cards; item names and rarity-colored frames remain.
- Removed NPC valuation and duplicate fast-open fee copy from the result summary. The fast-open button itself still displays its actual gem cost so the transaction remains transparent.
- Roulette ticks now use one audio voice, a 300 ms cooldown, every-third-card playback and lower volume; overlapping clones are prevented.
- Roulette and result dialogs use the game's pixel font and active skin/corner settings.

## CSS typography pass
- Converted roulette, guide, mini-game body, main-menu microcopy, inventory numeric labels and market sales-history data to the game font where these are game-facing labels.
- Kept normal text rendering only for the editable promo-code field; icon glyphs such as close/back arrows retain their symbol font.
- Rebuilt `public/css/app.css` from the source modules.

## Validation
- `npm run check` passes: all automated tests and game-data validation.
- `npm run audit:css` completed; it remains a read-only report because repeated selectors and `!important` declarations can be intentional.
- Database files are not included or modified in this release.
- A headless Chromium screenshot attempt did not complete in the build environment, so mobile visual acceptance still needs a real-device check.
