'use strict';

const crypto = require('node:crypto');

// Case weights are stored to six decimal places in cases.json. Scaling them to
// integer micro-percent units avoids floating-point boundary bias while keeping
// crypto.randomInt's range comfortably below its 2^48 limit.
const WEIGHT_SCALE = 1_000_000;

function toIntegerWeight(value) {
  const chance = Number(value);
  if (!Number.isFinite(chance) || chance <= 0) return 0;
  const weight = Math.round(chance * WEIGHT_SCALE);
  return Number.isSafeInteger(weight) && weight > 0 ? weight : 0;
}

function weightedPick(entries, randomInt = crypto.randomInt, getWeight = entry => entry?.chance) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Drop table is empty.');
  }

  const weights = entries.map(entry => toIntegerWeight(getWeight(entry)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total >= 2 ** 48) {
    throw new Error('Drop table has invalid total weight.');
  }

  const roll = randomInt(total);
  if (!Number.isInteger(roll) || roll < 0 || roll >= total) {
    throw new Error('Random source returned an invalid value.');
  }

  let cursor = roll;
  for (let index = 0; index < entries.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return entries[index];
  }

  // This is unreachable when the weight sum and random source are valid.
  throw new Error('Unable to select a drop.');
}

function validateQuantity(value, allowed = [1, 2, 3, 5, 10]) {
  const quantity = Number(value ?? 1);
  if (!Number.isInteger(quantity) || !allowed.includes(quantity)) {
    throw new Error(`Quantity must be one of: ${allowed.join(', ')}.`);
  }
  return quantity;
}

module.exports = { WEIGHT_SCALE, toIntegerWeight, weightedPick, validateQuantity };
