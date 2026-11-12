# Zombix Case Simulator v1.06 — modal UI polish

## Interface changes

- The “How to play” guide dialog is narrower and shorter, keeps its content in a scrollable body, and uses the in-game Press Start 2P typeface consistently. The explanatory copy is larger than in v1.05.
- Case history is now a compact session list with a predictable hierarchy: case/session, quantity, `DD.MM.YYYY` date, time, then the reward cards. Item names are always rendered; when an image is missing, a visible fallback glyph is shown. When the saved opening record contains only an item ID, the client resolves the name and image from the local item catalog.
- Achievement cards have a clearer vertical order: title and state, description, progress, reward, then a full-width claim action. The window is smaller and scroll-safe.
- Daily and weekly quests use a consistent game font, clearer period/reset header, larger progress labels, and a full-width action button below the reward chips. Cards no longer squeeze reward and action controls side-by-side on narrow phones.
- The four dialogs are constrained to the viewport with safe-area-aware spacing and internal scrolling, avoiding overflow beyond the game frame on mobile.
- The service-worker cache key was bumped to `zombix-v106-ui-polish`.

## Technical notes

- The case-history API contract and database records were not changed.
- Existing player databases are not included in the release archive and are not migrated by these UI-only changes.
- CSS source modules remain the source of truth; `public/css/app.css` is rebuilt with `npm run build:css`.
