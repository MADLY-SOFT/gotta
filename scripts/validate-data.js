'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateItemAtlas } = require('../lib/item-atlas');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const failures = [];
let checkedJson = 0;
let checkedAssets = 0;

function readJson(relativePath) {
  const file = path.join(PUBLIC, relativePath);
  try {
    checkedJson += 1;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function requireAsset(relativePath, context) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    failures.push(`${context}: missing asset path`);
    return;
  }
  const normalized = relativePath.replace(/^\.\//, '').replace(/^\//, '');
  const absolute = path.resolve(PUBLIC, normalized);
  if (absolute !== PUBLIC && !absolute.startsWith(PUBLIC + path.sep)) {
    failures.push(`${context}: asset escapes public directory (${relativePath})`);
    return;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    failures.push(`${context}: missing ${relativePath}`);
    return;
  }
  checkedAssets += 1;
}

const dataDir = path.join(PUBLIC, 'data');
for (const name of fs.readdirSync(dataDir).filter(name => name.endsWith('.json')).sort()) {
  readJson(`data/${name}`);
}
const manifest = readJson('manifest.json');
const itemsData = readJson('data/items.json');
const casesData = readJson('data/cases.json');
const avatarsData = readJson('data/avatars.json');
const artifactsData = readJson('data/artifacts.json');
const houseData = readJson('data/house.json');
const avatarAtlas = readJson('data/avatar-atlas.json');
const artifactAtlas = readJson('data/artifact-atlas.json');
try {
  const privatePromos = JSON.parse(fs.readFileSync(path.join(ROOT, 'private-data', 'promo_codes.json'), 'utf8'));
  if (!Array.isArray(privatePromos?.codes)) failures.push('private-data/promo_codes.json: expected codes array.');
} catch (error) { failures.push(`private-data/promo_codes.json: ${error.message}`); }

if (!Array.isArray(itemsData?.items) || itemsData.items.length < 1) {
  failures.push(`items.json: expected a non-empty items array, got ${itemsData?.items?.length ?? 'invalid'}`);
}
const itemById = new Map();
for (const item of itemsData?.items || []) {
  const id = Number(item.id);
  if (!Number.isInteger(id) || id <= 0 || itemById.has(id)) failures.push(`items.json: invalid or duplicate item id ${item.id}`);
  else itemById.set(id, item);
  for (let tier = 1; tier <= 6; tier += 1) {
    const price = Number(item?.tiers?.[String(tier)]?.price);
    if (!Number.isFinite(price) || price <= 0) failures.push(`Item ${item.id}: tier ${tier} has invalid price.`);
    if (tier > 1 && price <= Number(item?.tiers?.[String(tier - 1)]?.price)) failures.push(`Item ${item.id}: tier prices must increase.`);
  }
  // item.image is a stable logical legacy ID; packed item art is checked below.
}

try { validateItemAtlas(ROOT, itemsData?.items || []); checkedAssets += 1; }
catch (error) { failures.push(`items atlas: ${error.message}`); }

const caseIds = new Set();
const cases = casesData?.cases || [];
if (!Array.isArray(cases) || cases.length < 1) failures.push(`cases.json: expected a non-empty cases array, got ${cases.length}`);
for (const caseDef of cases) {
  const id = Number(caseDef.id);
  if (!Number.isInteger(id) || caseIds.has(id)) failures.push(`cases.json: invalid or duplicate case id ${caseDef.id}`);
  caseIds.add(id);
  requireAsset(caseDef.image, `Case ${caseDef.id}`);
  const rows = Array.isArray(caseDef.dropTable) ? caseDef.dropTable : [];
  if (!rows.length) failures.push(`Case ${caseDef.id}: empty drop table.`);
  const seen = new Set();
  let total = 0;
  for (const row of rows) {
    const itemId = Number(row.itemId);
    const tier = Number(row.tier);
    const chance = Number(row.chance);
    const key = `${itemId}:${tier}`;
    if (!itemById.has(itemId)) failures.push(`Case ${caseDef.id}: unknown item ${itemId}.`);
    if (!Number.isInteger(tier) || tier < 1 || tier > 6) failures.push(`Case ${caseDef.id}: invalid tier ${row.tier}.`);
    if (!Number.isFinite(chance) || chance < 0) failures.push(`Case ${caseDef.id}: invalid chance ${row.chance}.`);
    if (seen.has(key)) failures.push(`Case ${caseDef.id}: duplicate drop ${key}.`);
    seen.add(key);
    total += Number.isFinite(chance) ? chance : 0;
  }
  if (Math.abs(total - 100) > 0.02) failures.push(`Case ${caseDef.id}: chance sum ${total} is outside 100 ± 0.02.`);
  if (caseDef.currency && !['coins', 'gems'].includes(caseDef.currency) && !(caseDef.isAd && caseDef.currency === 'ad')) failures.push(`Case ${caseDef.id}: unsupported currency ${caseDef.currency}.`);
}

for (const avatar of avatarsData?.avatars || []) {
  // The project deliberately packs these legacy per-avatar paths into one atlas.
  if (!new RegExp(`^png/avatars/avatar_${Number(avatar.id)}\\.png$`).test(String(avatar.image || ''))) {
    failures.push(`Avatar ${avatar.id}: unexpected atlas source ${avatar.image}.`);
  }
}
if ((avatarsData?.avatars || []).length && !avatarAtlas?.image) failures.push('Avatar atlas metadata missing.');
for (const artifact of artifactsData?.artifacts || []) requireAsset(artifact.image, `Artifact ${artifact.id}`);
for (const background of houseData?.backgrounds || []) {
  if (background.image) requireAsset(background.image, `House background ${background.id}`);
}
if (avatarAtlas?.image) requireAsset(avatarAtlas.image, 'Avatar atlas');
if (artifactAtlas?.image) requireAsset(artifactAtlas.image, 'Artifact atlas');
for (const icon of manifest?.icons || []) requireAsset(icon.src, 'PWA manifest icon');

// The service worker shell is an offline-critical asset list: every entry must exist.
const swText = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
const shellMatch = swText.match(/const SHELL\s*=\s*(\[[\s\S]*?\]);/);
if (!shellMatch) {
  failures.push('sw.js: could not locate SHELL asset manifest.');
} else {
  try {
    const shell = JSON.parse(shellMatch[1]);
    for (const asset of shell) requireAsset(asset, 'Service worker shell');
  } catch (error) {
    failures.push(`sw.js: invalid SHELL manifest (${error.message}).`);
  }
}

if (failures.length) {
  console.error(`Data validation failed: ${failures.length} issue(s).`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Data validation passed: ${checkedJson} JSON files, ${itemById.size} items, ${cases.length} cases and ${checkedAssets} referenced assets checked.`);
}
