'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  ensurePlayerProjectionSchema, syncPlayerProjection,
  queryProjectedInventory, verifyPlayerProjections
} = require('../lib/player-projection');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE players(id INTEGER PRIMARY KEY, state_json TEXT NOT NULL);
    INSERT INTO players(id,state_json) VALUES(1,'{}');`);
  ensurePlayerProjectionSchema(db);
  return db;
}

const defs = new Map([
  [1, { id: 1, name: 'Синий ключ' }],
  [2, { id: 2, name: 'Красный ключ' }]
]);

test('normalized wallet, grouped inventory and artifacts mirror a player snapshot', () => {
  const db = fixture();
  try {
    const state = {
      coins: 1250, gems: 14, shards: 8, level: 7, experience: 13,
      rating: 90, totalCasesOpened: 24, houseLevel: 3,
      inventory: [{ id: 1, tier: 1 }, { id: 2, tier: 4 }, { id: 1, tier: 1 }],
      artifacts: [{ id: 3, count: 5 }, { id: 7, count: 2 }]
    };
    db.prepare('UPDATE players SET state_json=? WHERE id=1').run(JSON.stringify(state));
    syncPlayerProjection(db, 1, state, { now: 1000, reason: 'test_open' });
    const wallet = db.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=1').get();
    assert.deepEqual({ coins: wallet.coins, gems: wallet.gems, shards: wallet.shards }, {
      coins: 1250, gems: 14, shards: 8
    });
    assert.equal(db.prepare('SELECT SUM(quantity) n FROM player_inventory_stacks WHERE player_id=1').get().n, 3);
    assert.equal(db.prepare('SELECT SUM(quantity) n FROM player_artifact_stacks WHERE player_id=1').get().n, 7);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_ledger WHERE player_id=1').get().n, 3);
    assert.equal(verifyPlayerProjections(db).ok, true);
  } finally { db.close(); }
});

test('projected inventory pages filter and preserve legacy action positions', () => {
  const db = fixture();
  try {
    syncPlayerProjection(db, 1, {
      coins: 10, gems: 0, shards: 0, level: 1, experience: 0, rating: 0, totalCasesOpened: 0, houseLevel: 1,
      inventory: [{ id: 1, tier: 1 }, { id: 2, tier: 4 }, { id: 1, tier: 1 }, { id: 1, tier: 2 }],
      artifacts: []
    }, { now: 1000 });
    const page = queryProjectedInventory(db, 1, defs, { page: 0, pageSize: 1, query: 'СИНИЙ', sort: 'date' });
    assert.equal(page.totalItems, 3);
    assert.equal(page.totalStacks, 2);
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0].indices, [3]);
    assert.equal(page.items[0].id, 1);
    assert.equal(page.items[0].tier, 2);
  } finally { db.close(); }
});

test('projection writes roll back with their outer transaction', () => {
  const db = fixture();
  try {
    const original = { coins: 100, gems: 5, shards: 0, level: 1, experience: 0, rating: 0, totalCasesOpened: 0, houseLevel: 1, inventory: [{ id: 1, tier: 1 }], artifacts: [] };
    db.prepare('UPDATE players SET state_json=? WHERE id=1').run(JSON.stringify(original));
    syncPlayerProjection(db, 1, original, { now: 1000 });
    const changed = { coins: 0, gems: 0, shards: 0, level: 1, experience: 0, rating: 0, totalCasesOpened: 1, houseLevel: 1, inventory: [], artifacts: [] };
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE players SET state_json=? WHERE id=1').run(JSON.stringify(changed));
    syncPlayerProjection(db, 1, changed, { now: 2000, reason: 'rollback_test' });
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT coins FROM player_wallets WHERE player_id=1').get().coins, 100);
    assert.equal(db.prepare('SELECT SUM(quantity) n FROM player_inventory_stacks WHERE player_id=1').get().n, 1);
    assert.equal(verifyPlayerProjections(db).ok, true);
  } finally { db.close(); }
});

test('projection verifier detects stale rows rather than silently repairing them', () => {
  const db = fixture();
  try {
    const state = { coins: 100, gems: 0, shards: 0, level: 1, experience: 0, rating: 0, totalCasesOpened: 0, houseLevel: 1, inventory: [], artifacts: [] };
    db.prepare('UPDATE players SET state_json=? WHERE id=1').run(JSON.stringify(state));
    syncPlayerProjection(db, 1, state, { now: 1000 });
    db.prepare('UPDATE player_wallets SET coins=99 WHERE player_id=1').run();
    const result = verifyPlayerProjections(db);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.problem === 'wallet_coins'));
  } finally { db.close(); }
});

test('replaying an unchanged snapshot does not create duplicate wallet ledger entries', () => {
  const db = fixture();
  try {
    const state = { coins: 100, gems: 5, shards: 0, level: 1, experience: 0, rating: 0, totalCasesOpened: 0, houseLevel: 1, inventory: [], artifacts: [] };
    db.prepare('UPDATE players SET state_json=? WHERE id=1').run(JSON.stringify(state));
    syncPlayerProjection(db, 1, state, { now: 1000 });
    const before = Number(db.prepare('SELECT COUNT(*) c FROM wallet_ledger WHERE player_id=1').get().c);
    syncPlayerProjection(db, 1, state, { now: 2000 });
    const after = Number(db.prepare('SELECT COUNT(*) c FROM wallet_ledger WHERE player_id=1').get().c);
    assert.equal(after, before);
    assert.equal(verifyPlayerProjections(db).ok, true);
  } finally { db.close(); }
});
