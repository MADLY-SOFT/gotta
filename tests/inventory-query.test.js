'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { queryInventory } = require('../lib/inventory-query');
const defs = new Map([
  [1, { id: 1, name: 'Полевой нож' }],
  [2, { id: 2, name: 'Старая монета' }],
  [3, { id: 3, name: 'Радиомодуль' }]
]);
const inv = [
  {id:1,tier:2},{id:2,tier:1},{id:1,tier:2},{id:3,tier:5},
  {id:2,tier:1},{id:3,tier:5},{id:1,tier:3}
];

test('inventory query groups duplicate instances and keeps source indices', () => {
  const result = queryInventory(inv, defs, { page: 0, pageSize: 2 });
  assert.equal(result.totalStacks, 4);
  assert.equal(result.totalItems, 7);
  assert.deepEqual(result.items.map(x => x.lastIndex), [6, 5]);
  assert.deepEqual(result.items[1].indices, [3, 5]);
});

test('inventory query filters by tier and localized item name', () => {
  const result = queryInventory(inv, defs, { tier: '2', query: 'нож' });
  assert.equal(result.totalStacks, 1);
  assert.equal(result.items[0].count, 2);
  assert.deepEqual(result.items[0].indices, [0, 2]);
});

test('inventory query clamps page size and page boundaries', () => {
  const result = queryInventory(inv, defs, { page: 999, pageSize: 500 });
  assert.equal(result.pageSize, 48);
  assert.equal(result.page, 0);
  assert.equal(result.totalPages, 1);
});
