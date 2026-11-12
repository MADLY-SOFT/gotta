'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadPromoCodes({ root, publicDir, filePath }) {
  const target = path.resolve(filePath || path.join(root, 'private-data', 'promo_codes.json'));
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // One-time migration for older installations: move the former public file
  // into the private configuration directory before the HTTP server starts.
  const legacy = path.join(publicDir, 'data', 'promo_codes.json');
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(target, 0o600); } catch {}
  }
  // If both copies exist, the private copy is authoritative; never leave a
  // second publicly readable copy behind after migration.
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  if (!fs.existsSync(target)) throw new Error(`Promo configuration not found: ${target}`);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!parsed || !Array.isArray(parsed.codes)) throw new Error('Invalid private promo configuration: expected { codes: [] }.');
  return { data: parsed, filePath: target };
}

module.exports = { loadPromoCodes };
