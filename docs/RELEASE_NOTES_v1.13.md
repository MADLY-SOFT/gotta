# Zombix Case Simulator v1.13 — progression and reward overhaul

## Progression hub
- Moved the achievements entry into the quest window. The top control opens achievements; daily and weekly quest tabs sit directly beneath it.
- Rebuilt daily and weekly quest cards on the achievement-card component system: two cards per row, clear period/status chips, a progress bar with the current/target values inside it, framed reward chips, and a full-width action at the bottom.
- Removed quest descriptions to keep the cards compact and stop text from pushing actions out of view.
- Achievement titles are larger. The redundant `НАГРАДА` label was removed; reward amounts are shown as compact framed currency chips beside the status.
- Quest and achievement surfaces inherit the active skin and corner radius.

## Quest currency rewards
- Each daily quest now grants a deterministic random bonus of 1–50 shards.
- Each weekly quest now grants 1–3 gems and 25–100 shards.
- Rewards are generated deterministically from the period seed and quest identifier so reloading or retrying does not reroll them.
- Existing saved quest progress and claimed flags are preserved. Old quest records are repaired in place to add the new reward amounts without resetting the period.
- Claiming a quest now credits shards to the player's server-side wallet and returns the exact reward in the action response.

## Case history and case browser
- Reduced the history item artwork slightly and added a neutral gray item well behind each image.
- History keeps a five-column square-slot grid, so ten drops form two balanced rows even on narrow screens.
- Case-history, search and sorting controls now inherit the selected corner radius and skin colors.
- Removed the case-name sorting option; progression and ascending/descending price sorting remain.

## Case opening and result
- Quantity choices are now 1, 3, 5 and 10.
- Three and five openings use one horizontal reel per row; ten openings use a compact two-column reel board; single opening remains centered.
- Normal roulette duration is reduced to about 5.2 seconds per lane, with small stagger for multi-open.
- Tick sounds are less frequent and have a longer cooldown to reduce audio chatter.
- Multi-open results use square item tiles with visible names. XP and rating are shown once, not duplicated in the title and stats rows.
- The result frame follows the active theme rather than being overwritten by the highest item rarity.
- A level-up notification now reports the new level and the total coins/gems awarded by level-ups during the opening.

## Inventory polish
- Search and rarity filter labels are more compact while retaining the game's pixel font.

## Validation
- Added unit tests for deterministic daily/weekly shard and gem ranges and migration of old quest rewards.
- Added an integration check that claims daily and weekly quests, verifies the shard/gem balances, and checks player projections.
- Added UI regression tests for the progression hub, quantity selector, result notification and theme-aware controls.
- Production CSS bundle rebuilt from source modules.
- No production SQLite database is included in this release archive.
- Chromium is installed in the execution environment but did not complete a headless screenshot run; the visual fixture is included for local browser/device review.
