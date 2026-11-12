# Zombix Case Simulator v1.07 — game font loading fix

## Root cause

The game already contained the intended `Press Start 2P` typeface and its glyph map includes Russian Cyrillic. The browser was not guaranteed to receive it as a recognized font resource: the HTTP static-file MIME map did not define `.ttf`, so the font could be served as generic `application/octet-stream`. The CSS also relied on discovering the font only when a styled element was rendered, with no preload hint.

## Changes

- Serve `.ttf`, `.otf`, `.woff`, and `.woff2` with their correct font MIME types.
- Preload `PressStart2P-Regular.ttf` from the document head to make font loading start immediately.
- Keep a single production `@font-face` definition and make its module URL explicit for the generated `public/css/app.css` bundle.
- Add a regression test checking the font file, CSS URL, preload, and server MIME map.
- Bump the service-worker cache key to `zombix-v107-font-fix`, so clients replace the previous cached application shell and styles.

## Validation

- `npm test`: 76 tests passed.
- `npm run check`: includes tests and static game-data validation.
- The bundled TTF was inspected and includes Russian Cyrillic letters, including Ё/ё.

No player database was modified or included in the release archive.
