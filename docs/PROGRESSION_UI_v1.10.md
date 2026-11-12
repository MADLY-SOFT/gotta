# Zombix Case Simulator v1.10 — progression UI update

## Case opening history
- Removed the visible session index, opened-item quantity, and time of day from each entry.
- Each entry now shows the case name and date (`DD.MM.YYYY`) only.
- Reward tiles are image-only; item names and rarity labels are not printed in the card. Accessible labels and hover titles retain item identity.
- A maximum of ten rewards is rendered per opening, in a fixed five-column grid (two rows when ten items are present).
- Reward tile frames use a thicker border tinted by the item's tier.

## Achievements
Added long-term milestones without changing existing achievement IDs or claim records:
- 2,500 / 5,000 / 10,000 opened cases.
- 100 / 150 unique collected items.
- Level 50 / 75 / 100.
- 10 / 20 different case types.
- 30 / 90 active days.
- Five / ten consecutive drops of tier IV or higher.

All milestones use progression counters already calculated by the server. No new database columns or migration are required.

## Daily and weekly quests
- Rebuilt each quest card into a stable vertical layout: category/status, title/description, numeric progress, progress bar, rewards, then a dedicated full-width action button.
- The claim button is no longer placed beside reward chips or inside a narrow grid column, so it cannot be pushed outside the card on small screens.
- Added a clear completed-count summary and reset countdown block.
- The modal shell and cards use the selected game colors and corner-radius setting.

## Verification
- Added focused regression tests for date-only history entries, image-only rewards, five-column layout, quest action placement, and unique high-difficulty achievement IDs.
- Existing database schema and player data are unchanged.
