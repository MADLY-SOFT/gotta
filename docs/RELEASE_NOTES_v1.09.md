# Zombix Case Simulator v1.09 — Progression UI overhaul

## Scope
A focused redesign of achievements, daily/weekly quests, and case-opening history. No gameplay economy, server API, account data, or database schema changes were made.

## Main changes
- Rebuilt the three feature source modules and the final theme module instead of layering another generic stylesheet over the old UI.
- Fixed the actual typography conflict: legacy feature styles used `font` shorthands with `!important`, which overrode the previous late `font-family` declarations. Replaced the system-font declarations in the achievements, quests, and history source modules with the game font, then added scoped final rules with stronger selector precedence as a safeguard. All three views now use the Press Start 2P game font throughout.
- Achievements: clearer card hierarchy, descriptions, status chips, progress rows/bars, reward grouping, claim actions, and completed section.
- Quests: clearer daily/weekly tabs, period/reset strip, status, task title and description, progress, reward chips, and a full-width action row on very narrow screens.
- Case history: compact session cards, readable case metadata, date/time grouping, and reward tiles that always display the item name and rarity below the artwork.
- Dialogs are constrained to the game viewport area between the top and bottom game banners; their content scrolls internally.
- Colors, borders, button surfaces, glow, and corner radii use the active theme variables (`--border-color`, `--bg-*`, `--btn-bg`, `--text-*`, `--glow-color`, `--border-radius`).
- Service Worker cache name bumped to v1.09.

## Verification
- Full test suite and data validation run before packaging.
- CSS bundle rebuilt from the module sources.
- Added regression tests that inspect the final compiled selectors, their precedence over legacy `font` shorthands, active theme tokens, modal bounds, scrolling, item labels, and date formatting.
- A real Android visual pass is still required. The local Chromium runtime in the build environment was blocked, so no screenshot-based claim is made.

## Database
The SQLite database is not included in the release archive and is not modified by this UI update.
