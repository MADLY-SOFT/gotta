'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthRateLimiter } = require('../lib/auth-rate-limit');
const { randomFloat, randomBetween } = require('../lib/secure-random');
const { loadPromoCodes } = require('../lib/promo-store');

const ROOT = path.resolve(__dirname, '..');

test('authentication limiter caps both one identity and the whole IP address', () => {
  let timestamp = 1000;
  const limiter = createAuthRateLimiter({ now: () => timestamp, perIdentityLimit: 2, perIpLimit: 4, windowMs: 1000 });
  assert.equal(limiter.allow('127.0.0.1', 'alice'), true);
  assert.equal(limiter.allow('127.0.0.1', 'alice'), true);
  assert.equal(limiter.allow('127.0.0.1', 'alice'), false);
  assert.equal(limiter.allow('127.0.0.1', 'bob'), true);
  assert.equal(limiter.allow('127.0.0.1', 'charlie'), false, 'changing usernames must not bypass the IP limit');
  timestamp += 1001;
  limiter.cleanup();
  assert.equal(limiter.allow('127.0.0.1', 'alice'), true);
});

test('server-side random helpers stay within their requested ranges', () => {
  for (let index = 0; index < 500; index += 1) {
    const value = randomFloat();
    assert.ok(value >= 0 && value < 1);
    const ranged = randomBetween(0.55, 0.85);
    assert.ok(ranged >= 0.55 && ranged < 0.85);
  }
  assert.throws(() => randomBetween(2, 1), RangeError);
});

test('promo configuration is loaded from a private path and never from public assets', () => {
  const publicDir = path.join(ROOT, 'public');
  const privatePath = path.join(ROOT, 'private-data', 'promo_codes.json');
  assert.equal(fs.existsSync(path.join(publicDir, 'data', 'promo_codes.json')), false);
  assert.equal(fs.existsSync(privatePath), true);
  const loaded = loadPromoCodes({ root: ROOT, publicDir });
  assert.ok(Array.isArray(loaded.data.codes));
  assert.equal(loaded.filePath, privatePath);
  const shell = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
  assert.doesNotMatch(shell, /promo_codes\.json/);
});

test('private promo config is not reachable through the static public directory', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /loadPromoCodes\(/);
  assert.match(server, /const file=path\.resolve\(PUBLIC,rel\)/);
  assert.doesNotMatch(server, /url\.pathname==='\/api\/reset'/);
  assert.doesNotMatch(server, /const r=Math\.random\(\)/);
});

test('legacy public promo configuration migrates into private storage and is removed from public', () => {
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'zombix-promo-migration-'));
  const publicDir = path.join(temp, 'public');
  const legacyDir = path.join(publicDir, 'data');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'promo_codes.json'), JSON.stringify({ codes: [{ code: 'MIGRATED' }] }));
  try {
    const loaded = loadPromoCodes({ root: temp, publicDir });
    assert.equal(loaded.data.codes[0].code, 'MIGRATED');
    assert.equal(fs.existsSync(path.join(legacyDir, 'promo_codes.json')), false);
    assert.equal(fs.existsSync(loaded.filePath), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
