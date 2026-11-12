'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('game pixel font has one valid production face, preload, and font MIME type', () => {
  const css = read('public/css/app.css');
  const html = read('public/index.html');
  const server = read('server.js');
  const fontPath = path.join(root, 'public/fonts/PressStart2P-Regular.ttf');
  assert.equal((css.match(/@font-face\{font-family:"Press Start 2P"/g) || []).length, 1, 'avoid duplicate pixel font-face rules overriding the valid source');
  assert.equal((css.match(/@font-face\{font-family:"Rubik"/g) || []).length, 2, 'Rubik ships as one Cyrillic and one Latin subset');
  assert.match(css, /src:url\("\.\.\/fonts\/Rubik-Cyrillic\.woff2"\) format\("woff2"\)/);
  assert.match(html, /rel="preload" href="fonts\/Rubik-Cyrillic\.woff2" as="font" type="font\/woff2" crossorigin/);
  assert.match(server, /'\.woff2':'font\/woff2'/);
  assert.ok(fs.statSync(path.join(root, 'public/fonts/Rubik-Cyrillic.woff2')).size > 10_000, 'bundled UI font file must exist');
  assert.match(css, /src:\s*url\("\.\.\/fonts\/PressStart2P-Regular\.ttf"\)\s*format\("truetype"\)/);
  assert.match(html, /rel="preload" href="fonts\/PressStart2P-Regular\.ttf" as="font" type="font\/ttf" crossorigin/);
  assert.match(server, /'\.ttf':'font\/ttf'/);
  assert.ok(fs.statSync(fontPath).size > 10_000, 'bundled pixel font file must exist');
});
