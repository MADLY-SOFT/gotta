# Zombix v2.0 — "Nightfall" visual redesign

A complete rework of the game's look, the case-opening experience and the stylesheet pipeline. Game logic, server API, saves and test-covered behaviour are unchanged.

## Design system
- One token file (`public/css/modules/base/tokens.css`) defines colours, type scale, radii, depth and motion. All nine skins (gold, ice, fire, toxic, violet, ocean, sand, neon, cyber) now only swap an accent ramp, and derived tokens follow the active skin on every overlay. Square-corner mode shrinks the whole radius scale.
- Readable typography: bundled Rubik (variable, Cyrillic + Latin, 50 KB woff2, OFL) for all text; the Press Start 2P pixel font is kept for the logo and accents. No text is smaller than 9px (was 4.5px).
- Shared building blocks: the generic modal shell, item/artifact atlases, rarity tiers (`.tier-1…6` → `--tier`), primary/secondary buttons, CSS pixel icons.
- Shell: new top bar with balance pills, bottom navigation with active indicator, notifications, confirm dialog, loading screen. The top ad strip appears only in fullscreen.

## Every screen redesigned
Main menu (relic orbs, animated logo, title-screen atmosphere), login/registration, settings (skin swatches in a 3×3 grid), account, guide, case list, case page, case opening, result, history, profile, inventory, item dialog, avatars, achievements, quests (single three-way tab control), rating hub with podiums, market, contracts (offering-altar ritual), promo codes, currency shop, ПРОЧЕЕ tile grid, shelter diorama with modals, daily rewards, ad gate, mail, cargo flight.

## Case opening — more intrigue
- Case page: floating case with rotating rays, rarity odds bar with per-tier percentages, drops sorted rarest-first, XP/rating/item-count strip.
- Opening is staged: **charging** (the sealed case shakes harder and glows while the server answers, so latency is hidden), **spinning** (the marker and the ambient light take the colour of the card currently under it), **near miss** (sometimes the reel overshoots into the neighbouring card and rolls back), **reveal** (winners pop, the rest fade; epic+ drops flash the screen, legendary+ shake it).
- Result screen: rotating rarity rays, item pop-in, rarity chip, item value, XP/rating; multi-open shows staggered card flips, the best drop marked "ЛУЧШЕЕ" and the total value. New "ЕЩЁ РАЗ" button reopens the same case with the same quantity.
- Fast open keeps a short charge and the rare-drop flash.
- Server results remain authoritative; reduced-motion users get instant reels.

## CSS optimisation
- `zz/progression-theme.css` (2,200-line override layer) and the unused `collection.css` / `minigames.css` were removed; every module was rewritten from scratch.
- Sources: 17,099 → ~2,800 lines. Bundle: 612 KB → 231 KB (gzip 86 KB → 38 KB). `!important`: 4,630 → 6 (only where JS writes inline styles).
- `scripts/build-css.js` now concatenates modules in a fixed layer order and minifies with PostCSS; `@z-order` markers are gone.

## Tests
Assertions that pinned old CSS text (pixel sizes, `!important`, the deleted override layer) were rewritten to check the equivalent invariants of the new design (bounded dialogs, scrolling bodies, two-column quests, three-way tabs, 5-column history wells, reel geometry, no sub-9px text, token coverage for all skins, compact bundle). All JS/HTML/server assertions are unchanged. 92/92 pass.
