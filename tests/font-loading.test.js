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
  assert.equal((css.match(/@font-face/g) || []).length, 1, 'avoid duplicate font-face rules overriding the valid source');
  assert.match(css, /src:\s*url\("\.\.\/fonts\/PressStart2P-Regular\.ttf"\)\s*format\("truetype"\)/);
  assert.match(html, /rel="preload" href="fonts\/PressStart2P-Regular\.ttf" as="font" type="font\/ttf" crossorigin/);
  assert.match(server, /'\.ttf':'font\/ttf'/);
  assert.ok(fs.statSync(fontPath).size > 10_000, 'bundled pixel font file must exist');
});
