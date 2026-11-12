'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const modulesRoot = path.join(root, 'public/css/modules');
const appCssPath = path.join(root, 'public/css/app.css');

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? cssFiles(full) : (entry.isFile() && entry.name.endsWith('.css') ? [full] : []);
  });
}

test('CSS modules parse and production bundle is generated from them', () => {
  const files = cssFiles(modulesRoot);
  assert.ok(files.length >= 25, `expected a useful set of feature modules, got ${files.length}`);
  for (const file of files) postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  postcss.parse(fs.readFileSync(appCssPath, 'utf8'), { from: appCssPath });

  const result = spawnSync(process.execPath, ['scripts/build-css.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  postcss.parse(fs.readFileSync(appCssPath, 'utf8'), { from: appCssPath });
});

test('feature selectors live in their matching CSS modules', () => {
  const expectations = [
    ['menu/menu.css', '#main-menu'],
    ['cases/cases.css', '#cases-grid'],
    ['cases/roulette.css', '#roulette-overlay'],
    ['cases/history.css', '#case-history-overlay'],
    ['profile/profile.css', '#profile-section.profile-hub'],
    ['profile/inventory.css', '#inventory-grid'],
    ['profile/achievements.css', '.achievement-card-heading'],
    ['profile/avatars.css', '#avatars-modal'],
    ['quests/quests.css', '#quests-body'],
    ['quests/rankings.css', '#leaderboard-modal'],
    ['economy/market/shell.css', '#market-modal'],
    ['economy/market/catalog.css', '.market-search'],
    ['economy/market/trading.css', '.market-v4-listing'],
    ['economy/market/analytics.css', '.market-v4-chart'],
    ['economy/market/artifacts.css', '.market-v4-artifact'],
    ['economy/contracts.css', '#contract-modal'],
    ['economy/promos.css', '#promo-modal'],
    ['features/daily-rewards.css', '#daily-rewards-modal'],
    ['features/house.css', '.house-scene'],
    ['features/plane.css', '#plane-modal.plane-overlay'],
    ['features/mail.css', '#mail-modal .mail-panel']
  ];

  for (const [relative, selector] of expectations) {
    const file = path.join(modulesRoot, relative);
    assert.ok(fs.existsSync(file), `missing module ${relative}`);
    const rootNode = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
    let found = false;
    rootNode.walkRules(rule => { if (rule.selectors.includes(selector)) found = true; });
    assert.ok(found, `${selector} should be in ${relative}`);
  }
});

test('runtime loads one generated stylesheet and service worker caches it', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(html, /href="css\/app\.css"/);
  assert.match(html, /rel="preload" href="fonts\/PressStart2P-Regular\.ttf" as="font" type="font\/ttf" crossorigin/);
  assert.doesNotMatch(html, /href="(?:game|ui-v100)\.css"/);
  assert.match(sw, /\.\/css\/app\.css/);
  assert.match(sw, /zombix-v116-atlas-runtime-fix/);
  assert.doesNotMatch(sw, /promo_codes\.json/);
  const bundle = fs.readFileSync(appCssPath, 'utf8');
  assert.match(bundle, /url\(\"\.\.\/fonts\/PressStart2P-Regular\.ttf\"\)/);
  assert.ok(fs.existsSync(path.join(root, 'public/fonts/PressStart2P-Regular.ttf')));
});

test('legacy stylesheet paths remain lightweight compatibility imports', () => {
  for (const name of ['game.css', 'ui-v100.css']) {
    const content = fs.readFileSync(path.join(root, 'public', name), 'utf8');
    assert.match(content, /@import url\("\.\/css\/app\.css"\)/);
    assert.ok(Buffer.byteLength(content) < 250);
  }
});
