# Progression and case UI browser fixture

This fixture renders the redesigned progression hub, history, roulette and bulk-result screens against the production `public/css/app.css` bundle. It uses the ice skin and square corners so theme inheritance is easy to inspect.

Serve the project root with a local static server, then open:

- `/tests/fixtures/progression-ui.html?view=quests`
- `/tests/fixtures/progression-ui.html?view=achievements`
- `/tests/fixtures/progression-ui.html?view=history`
- `/tests/fixtures/progression-ui.html?view=roulette`
- `/tests/fixtures/progression-ui.html?view=result`

The page writes a `data-browser-check` JSON attribute on `<body>` after the web font is ready. It reports computed font family, color, size, panel radius and border color for representative elements. Quest view reports the two-column card grid and visible claim action; history reports the five-column square item grid; roulette and result views report the pixel typeface, theme frame and square reward tiles.
