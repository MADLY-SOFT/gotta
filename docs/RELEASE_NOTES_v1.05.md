# Zombix Case Simulator v1.05 — UI refinement

## Interface updates

- Main-menu Play and How to Play labels are slightly larger.
- The How to Play guide now uses the in-game Press Start 2P font consistently, including descriptions and modal controls.
- Main-menu item taps use a deliberate fade-out / fade-in transition before the replacement item appears.
- Drag throws have a stronger release impulse, wider drag range, and longer damped travel so a deliberate throw is visibly different from a tap.
- Case-opening history uses the in-game font throughout, with a clearer hierarchy for session, case, date, quantity, and reward details.
- Achievements use consistent in-game typography throughout the modal.
- Daily and weekly quests use a consistent game-font visual system for tabs, status labels, progress, reward chips, action buttons, and reset timer; progress bars animate smoothly.

## Technical notes

- CSS source changes live in `public/css/modules/`; `public/css/app.css` is rebuilt with `npm run build:css`.
- Service worker cache name was bumped to `zombix-v105-ui-security-performance` so installed clients fetch the new UI.
- Server-side economy, reward validation, and persistence behavior were not changed in this UI pass.
- The v1.04 security and maintenance changes remain in effect.

## Verification

Verification passed: 73 automated tests, all data validation checks (16 JSON files, 171 items, 44 cases, 291 referenced assets), and CSS parsing/audit. The market concurrency and rollback integration test also passed. A real Android/browser visual pass is still needed to confirm the pixel font sizes and modal density on the target device. The release archive intentionally omits `server-data/game.sqlite` so it cannot overwrite an existing test or production database.
