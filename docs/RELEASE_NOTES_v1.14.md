# Zombix Case Simulator v1.14 — Quest & Roulette Polish

## Case-opening history
- Re-centered item art inside each square rarity tile.
- Changed the tile well to a neutral dark-gray gradient while preserving rarity borders and active corner settings.

## Quest hub
- Replaced the separate achievement button plus two quest tabs with one three-part segmented control: Achievements / Daily / Weekly.
- Simplified the period header to one compact line: completed count on the left and countdown only on the right.
- Removed period and status badges from each quest card; the selected tab already communicates the period.
- Kept the existing achievement-card visual language for quest cards.
- Claimed tasks are sorted after unclaimed tasks and visibly dimmed while remaining readable.
- Daily quest count increased from 7 to 8; weekly count increased from 5 to 6.
- Existing quest IDs, progress and claims are preserved when the current period's saved quest list is expanded. The new slot is deterministically appended from the existing period seed.

## Roulette
- Reel lanes and their item cards are rendered as soon as the case-opening view opens.
- Switching x1 / x3 / x5 / x10 rebuilds the correct number and layout of ready-to-spin lanes before the user presses Open.
- The server-selected result replaces only the pre-rendered center placeholder; the lane is not rebuilt after the request returns.
- Item cards are square and image-only. Names and tier captions were removed from the moving reel.
- The center stop position now has a stronger square frame using the active skin color and corner setting.
- Roll duration reduced from about 5.2s to about 4.65s, with a smoother, more deliberate easing curve.
- A short single-voice tick is attempted for every item crossing the center marker; the audio voice is restarted instead of cloned to avoid sound stacking.
- The winning item remains centered at index 42 with two trailing cards after it.

## Compatibility and verification
- Existing server-side open-case result, rewards, and history remain authoritative.
- Daily/weekly quest migration preserves prior task IDs and progress; integration tests cover the 7-to-8 and 5-to-6 expansion.
- No production SQLite database is included in the release archive.
- Validation: 87/87 automated tests passed; 16 JSON data files validated; CSS modules rebuilt; CSS audit completed; JavaScript syntax and ZIP integrity checked.
- A headless Chromium visual pass was attempted but did not complete in this environment, so this release is not represented as visually verified on Android.
