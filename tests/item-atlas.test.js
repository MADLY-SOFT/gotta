'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { validateItemAtlas } = require('../lib/item-atlas');
const root = path.resolve(__dirname, '..');

test('item atlas renderer resolves numeric IDs and legacy item paths to stable sprite cells', () => {
  const source = fs.readFileSync(path.join(root, 'public/js/item-atlas.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.match(context.itemSprite('png/items/items_1.png'), /--item-x:0%;--item-y:0%/);
  assert.match(context.itemSprite('png/items/items_171.png'), /--item-x:66\.66666666666667%;--item-y:100%/);
  assert.match(context.itemSprite(151), /item-atlas/);
  assert.match(context.itemSprite('invalid'), /item-atlas-missing/);
});

test('runtime item views use the shared atlas helper and offline shell includes its assets', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(html, /js\/item-atlas\.js/);
  assert.match(sw, /\.\/js\/item-atlas\.js/);
  assert.match(sw, /\.\/png\/items-atlas\.png/);
  for (const file of ['cases.js','profile.js','contracts.js','house.js','promo.js','daily_rewards.js','main.js','ui.js']) {
    const js = fs.readFileSync(path.join(root, 'public/js', file), 'utf8');
    assert.match(js, /itemSprite|itemAtlasPosition|setItemAtlasElement/, `${file} should render item art from atlas`);
  }
});


test('server validates the shared atlas instead of requiring the legacy png/items folder', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zombix-atlas-only-'));
  try {
    const publicDir = path.join(temp, 'public');
    fs.mkdirSync(path.join(publicDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(publicDir, 'png'), { recursive: true });
    fs.copyFileSync(path.join(root, 'public/data/items-atlas.json'), path.join(publicDir, 'data/items-atlas.json'));
    fs.copyFileSync(path.join(root, 'public/png/items-atlas.png'), path.join(publicDir, 'png/items-atlas.png'));
    const items = JSON.parse(fs.readFileSync(path.join(root, 'public/data/items.json'), 'utf8')).items;
    assert.doesNotThrow(() => validateItemAtlas(temp, items));
    assert.equal(fs.existsSync(path.join(publicDir, 'png/items')), false, 'individual item PNG directory is intentionally absent');
    const broken = items.map((item, index) => index === 0 ? { ...item, image: 'png/items/items_2.png' } : item);
    assert.throws(() => validateItemAtlas(temp, broken), /должен указывать на ячейку 1/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('result, contract and roulette winners update atlas spans rather than IMG src attributes', () => {
  const cases = fs.readFileSync(path.join(root, 'public/js/cases.js'), 'utf8');
  const contracts = fs.readFileSync(path.join(root, 'public/js/contracts.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(cases, /target\.querySelector\('\.item-atlas'\)/);
  assert.match(cases, /setItemAtlasElement\(resultImage, item\.image \|\| item\.id\)/);
  assert.match(cases, /await preloadItemAtlas\(\)/);
  assert.match(contracts, /setItemAtlasElement\(resultImg, match\.item\.image \|\| match\.item\.id\)/);
  assert.match(index, /<span id="result-image" class="item-atlas/);
  assert.match(index, /<span id="contract-result-img" class="item-atlas/);
});

test('admin editor renders item catalogue thumbnails and drop previews from the atlas', () => {
  const editor = fs.readFileSync(path.join(root, 'public/editor.html'), 'utf8');
  assert.match(editor, /src="js\/item-atlas\.js"/);
  assert.match(editor, /itemSprite\(it\.image\|\|it\.id,'preview'\)/);
  assert.match(editor, /itemSprite\(itemById\(d\.itemId\)\?\.image\|\|d\.itemId,'drop-row-item'\)/);
  assert.match(editor, /setItemAtlasElement\(img,itemById/);
  assert.doesNotMatch(editor, /<img src="\$\{esc\(itemById\(d\.itemId\)/);
});
