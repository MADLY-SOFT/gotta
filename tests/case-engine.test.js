'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toIntegerWeight, weightedPick, validateQuantity } = require('../lib/case-engine');

test('chance percentages are converted to stable integer weights', () => {
  assert.equal(toIntegerWeight(12.345678), 12_345_678);
  assert.equal(toIntegerWeight(0), 0);
  assert.equal(toIntegerWeight(-1), 0);
  assert.equal(toIntegerWeight('not-a-number'), 0);
});

test('weightedPick respects exclusive boundaries and ignores zero-weight entries', () => {
  const rows = [
    { id: 'zero', chance: 0 },
    { id: 'a', chance: 25 },
    { id: 'b', chance: 75 }
  ];
  assert.equal(weightedPick(rows, total => 0).id, 'a');
  assert.equal(weightedPick(rows, total => Math.round(total * 0.25)).id, 'b');
  assert.equal(weightedPick(rows, total => total - 1).id, 'b');
});

test('weightedPick rejects empty and invalid tables or random values', () => {
  assert.throws(() => weightedPick([]), /empty/i);
  assert.throws(() => weightedPick([{ chance: 0 }]), /invalid total/i);
  assert.throws(() => weightedPick([{ chance: 100 }], () => 100_000_000), /invalid value/i);
});

test('case quantity is restricted to the supported batch sizes', () => {
  for (const quantity of [1, 2, 3, 5, 10]) assert.equal(validateQuantity(quantity), quantity);
  for (const quantity of [0, 4, 11, 1.5, 'many']) {
    assert.throws(() => validateQuantity(quantity), /quantity/i);
  }
});
