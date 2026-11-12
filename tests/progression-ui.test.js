'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rollQuestCurrencyRewards, repairQuestCurrencyRewards } = require('../lib/quest-rewards');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('daily quest bonus shards are deterministic and always between 1 and 50', () => {
  for (let seed = 0; seed < 200; seed++) {
    const a = rollQuestCurrencyRewards(false, seed, seed * 37 + 19);
    const b = rollQuestCurrencyRewards(false, seed, seed * 37 + 19);
    assert.deepEqual(a, b);
    assert.ok(a.shards >= 1 && a.shards <= 50);
    assert.equal(a.gems, undefined);
  }
});

test('weekly quest bonus gems and shards are always inside requested ranges', () => {
  for (let seed = 0; seed < 200; seed++) {
    const reward = rollQuestCurrencyRewards(true, seed, seed * 101 + 7);
    assert.ok(reward.gems >= 1 && reward.gems <= 3);
    assert.ok(reward.shards >= 25 && reward.shards <= 100);
  }
});

test('legacy quest rewards are repaired without changing unrelated reward fields', () => {
  const daily = repairQuestCurrencyRewards({ coins: 500 }, false, 123, 456);
  assert.equal(daily.coins, 500);
  assert.ok(daily.shards >= 1 && daily.shards <= 50);
  const weekly = repairQuestCurrencyRewards({ coins: 900, gems: 0 }, true, 123, 456);
  assert.equal(weekly.coins, 900);
  assert.ok(weekly.gems >= 1 && weekly.gems <= 3);
  assert.ok(weekly.shards >= 25 && weekly.shards <= 100);
});

test('quest hub exposes achievements above daily and weekly tabs and uses two-column quest cards', () => {
  const html = read('public/index.html');
  const zone = read('public/js/zone.js');
  const css = read('public/css/modules/zz/progression-theme.css');
  assert.match(html, /id="quest-tab-achievements"/);
  assert.match(html, /id="quest-tab-daily"/);
  assert.match(html, /id="quest-tab-weekly"/);
  assert.match(zone, /function switchQuestTab\(tab\).*?achievements/s);
  assert.match(zone, /questRewardHTML/);
  assert.match(css, /\.quest-cards-grid[\s\S]*?repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.quest-claim-button[\s\S]*?width:100%/);
});

test('case list removes name sorting and opening selector is 1, 3, 5, 10', () => {
  const cases = read('public/js/cases.js');
  const html = read('public/index.html');
  assert.doesNotMatch(cases, /caseSortMode === 'name'/);
  assert.match(cases, /const allowed = \[1, 3, 5, 10\]/);
  for (const quantity of [1, 3, 5, 10]) assert.match(html, new RegExp(`data-quantity="${quantity}"`));
});

test('level-up result includes currency totals and one notification path', () => {
  const server = read('server.js');
  const cases = read('public/js/cases.js');
  assert.match(server, /totalLevelCoins,totalLevelGems/);
  assert.match(cases, /function notifyLevelUp\(result\)/);
  assert.match(cases, /notifyLevelUp\(data\.result\)/);
});


test('achievements are reachable from the quest hub, not duplicated in the profile shortcuts', () => {
  const profile = read('public/js/profile.js');
  const html = read('public/index.html');
  assert.match(html, /id="quest-tab-achievements"/);
  assert.doesNotMatch(profile, /profile-progress-open/);
  assert.match(profile, /openQuestsModal\('achievements'\)/);
});

test('history item wells remain square, tier-tinted and five columns wide on small screens', () => {
  const css = read('public/css/modules/cases/history.css');
  assert.match(css, /#case-history-entries \.case-history-drops\{[^}]*repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.case-history-drop\{[^}]*aspect-ratio:1\/1/);
  assert.match(css, /\.case-history-drop\{[^}]*var\(--drop-tier\)/);
});


test('progress tabs are a single three-way segmented control and quest cards omit period/status badges', () => {
  const html = read('public/index.html');
  const zone = read('public/js/zone.js');
  const css = read('public/css/modules/zz/progression-theme.css');
  assert.match(html, /class="quest-tabs"[\s\S]*id="quest-tab-achievements"[\s\S]*id="quest-tab-daily"[\s\S]*id="quest-tab-weekly"/);
  assert.doesNotMatch(html, /class="quest-achievements-tab"/);
  assert.match(zone, /ВЫПОЛНЕНО \$\{completed\}\/\$\{defs\.length\}/);
  assert.match(zone, /\.sort\(\(a,b\)=>Number\(a\.claimed\)-Number\(b\.claimed\)/);
  assert.doesNotMatch(zone, /quest-card-period|achievement-state/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /brightness\(\.62\)/);
});

test('roulette lanes are prepared before opening and winner replaces only the target placeholder', () => {
  const cases = read('public/js/cases.js');
  const audio = read('public/js/audio.js');
  const css = read('public/css/modules/cases/roulette.css');
  assert.match(cases, /renderRouletteLanes\(1\)/);
  assert.match(cases, /renderRouletteLanes\(selectedOpenQuantity\)/);
  assert.match(cases, /applyRouletteRewards\(rewards\)/);
  assert.match(cases, /ROULETTE_TARGET_INDEX = 42/);
  assert.match(cases, /const duration = reducedMotion \? 1 : 4650/);
  assert.match(cases, /if \(currentSlot > lastSlot\)[\s\S]*?passed <= currentSlot/);
  assert.match(audio, /soundKey === 'roulette' \? 55/);
  assert.match(css, /\.reel-target-frame\{/);
  assert.match(css, /#roulette-container\{[^}]*--roulette-target-size:/);
  assert.match(css, /\.reel-card\{[^}]*aspect-ratio:1\/1/);
  assert.match(cases, /function rouletteCardMarkup[\s\S]*?itemSprite\(image, \'reel-item-atlas\'\)/);
  assert.doesNotMatch(cases.slice(cases.indexOf('function rouletteCardMarkup'), cases.indexOf('function renderRouletteLanes')), /item\?\.name|reel-card-copy/);
});

test('daily and weekly quest pools migrate to 8 and 6 without discarding existing quest entries', () => {
  const server = read('server.js');
  assert.match(server, /buildPeriodQuests\('d',8/);
  assert.match(server, /buildPeriodQuests\('w',6/);
  assert.match(server, /expandPeriodQuests\(state\.dailyQuests,'d',8/);
  assert.match(server, /expandPeriodQuests\(state\.weeklyQuests,'w',6/);
});
