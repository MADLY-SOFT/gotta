'use strict';
const crypto = require('node:crypto');

function randomFloat() {
  // 48 random bits are exactly representable as a JS Number and map to [0, 1).
  return crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000;
}

function randomBetween(min, max) {
  const low = Number(min), high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) throw new RangeError('Invalid random range.');
  return low + randomFloat() * (high - low);
}

module.exports = { randomFloat, randomBetween };
