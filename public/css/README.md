# Zombix CSS architecture

The visual source of truth is `modules/`. Styles are grouped by screen or feature, not by arbitrary fragments of the old monolithic file.

## Folder map

```text
public/css/
├── app.css                         # generated production bundle; do not edit by hand
├── README.md
└── modules/
    ├── base/
    │   ├── layout.css               # app shell, global controls, shared overlays
    │   └── motion-fonts.css          # @font-face and shared keyframe animations
    ├── menu/
    │   └── menu.css                 # main menu, menu background, floating relics
    ├── cases/
    │   ├── cases.css                # case catalogue/cards and case-opening UI
    │   ├── roulette.css             # roulette, reels, spin controls
    │   └── history.css              # opening history and reward slots
    ├── profile/
    │   ├── profile.css              # profile screen and profile summary
    │   ├── inventory.css            # inventory, item details, selling and artifacts
    │   ├── achievements.css         # achievement cards and progress
    │   └── avatars.css              # avatar picker and avatar cards
    ├── quests/
    │   ├── quests.css               # daily/weekly quests and zone mission cards
    │   └── rankings.css             # leaderboard, rating and rank previews
    ├── economy/
    │   ├── contracts.css            # item contracts
    │   ├── promos.css               # promo-code and promo-reward windows
    │   ├── shop.css                 # shop panels and coin packs
    │   └── market/
    │       ├── shell.css             # market window, common header and shared layout
    │       ├── catalog.css           # search, filters, sorting and catalogue
    │       ├── trading.css           # listings, orders, buying, selling and own lots
    │       ├── analytics.css         # prices, charts, statistics and order depth
    │       └── artifacts.css         # market artifact cards and artifact presentation
    ├── account/
    │   ├── account.css              # authorization and account dialogs
    │   └── settings.css             # settings controls and account options
    └── features/
        ├── collection.css           # collection and collection progress
        ├── daily-rewards.css        # daily rewards and ad-reward UI
        ├── guide.css                # how-to-play and welcome guide
        ├── house.css                # house scenes and environment effects
        ├── mail.css                 # inbox, messages and flight rewards
        ├── minigames.css            # small games and their dialogs
        ├── other-actions.css        # buttons in the “Other” section
        └── plane.css                # cargo flight event and ranking panel
```

## How to edit styles

1. Find the screen/feature in `modules/` and edit its CSS file.
2. Do not edit `app.css` directly: it is generated.
3. Run `npm run build:css` to rebuild the production bundle.
4. Run `npm test` and `npm run validate:data` before publishing.

The build step also adjusts relative image/font URLs for the bundle location, so assets continue resolving from the public root. The `@z-order` comments are intentional. They retain the original order of rules across modules, including rules inside media queries. This matters because the old stylesheet accumulated many overrides over time. Keep the markers attached to their rules. New rules may be appended without a marker; the builder places those after the existing rules, so they can act as deliberate overrides.

## Runtime and compatibility

The game loads only `app.css`, so the browser still makes one CSS request. The bundle preserves the original cascade order and does not duplicate all module requests. `public/game.css` and `public/ui-v100.css` remain tiny compatibility entry points for any older page or integration that still requests those paths; the current `index.html` does not load them.

## v1.03 visual updates

The feature modules also contain the v1.03 visual pass:
- `menu/menu.css` — softened tap replacement and damped drag throws for floating items.
- `cases/history.css` — rebuilt history cards, date chips and named reward slots.
- `cases/roulette.css` — longer 43-slot visual reels, rarity-framed item cards and scroll-safe multi-open lanes.
- `profile/achievements.css` — rebuilt achievements modal with readable UI typography.
- `quests/quests.css` — redesigned mission cards, period tabs, progress and reward controls.
- `features/guide.css` — consistent typography in the illustrated guide.
- `economy/promos.css` — theme-consistent promo and reward dialogs.

The server remains authoritative for every case result. The extra reel slots are visual decoys only; the winning card is always populated from the server response.
