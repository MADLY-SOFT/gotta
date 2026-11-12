'use strict';

// Normalized, transactionally maintained projections for the legacy player JSON.
// The JSON snapshot remains the compatibility source until all legacy actions
// have migrated; every save updates these tables in the same SQLite transaction.
let savepointSequence = 0;

function ensurePlayerProjectionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_wallets (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
      gems INTEGER NOT NULL DEFAULT 0 CHECK(gems >= 0),
      shards INTEGER NOT NULL DEFAULT 0 CHECK(shards >= 0),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      currency TEXT NOT NULL CHECK(currency IN ('coins','gems','shards')),
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
      reason TEXT NOT NULL,
      operation_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_ledger_player_page
      ON wallet_ledger(player_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_wallet_ledger_operation
      ON wallet_ledger(operation_id) WHERE operation_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS player_inventory_stacks (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL,
      tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 6),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      positions_json TEXT NOT NULL,
      last_position INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(player_id, item_id, tier)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_stacks_player_recent
      ON player_inventory_stacks(player_id, last_position DESC);
    CREATE INDEX IF NOT EXISTS idx_inventory_stacks_player_tier
      ON player_inventory_stacks(player_id, tier, item_id);

    CREATE TABLE IF NOT EXISTS player_artifact_stacks (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      artifact_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(player_id, artifact_id)
    );
    CREATE TABLE IF NOT EXISTS player_progression_snapshot (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      level INTEGER NOT NULL,
      experience INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      total_cases_opened INTEGER NOT NULL,
      house_level INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function syncPlayerProjection(db, playerId, state, options = {}) {
  const id = Number(playerId);
  const ts = Math.max(0, Math.floor(Number(options.now) || Date.now()));
  const reason = String(options.reason || 'state_sync').slice(0, 64);
  const operationId = options.operationId == null ? null : String(options.operationId).slice(0, 128);
  const savepoint = `player_projection_${++savepointSequence}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const previous = db.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=?').get(id);
    const wallet = {
      coins: Math.max(0, Math.floor(Number(state.coins) || 0)),
      gems: Math.max(0, Math.floor(Number(state.gems) || 0)),
      shards: Math.max(0, Math.floor(Number(state.shards) || 0))
    };
    const ledger = db.prepare(`INSERT INTO wallet_ledger
      (player_id,currency,delta,balance_after,reason,operation_id,created_at)
      VALUES(?,?,?,?,?,?,?)`);
    let walletChanged = !previous;
    for (const currency of ['coins', 'gems', 'shards']) {
      const before = previous ? Number(previous[currency]) : 0;
      const delta = wallet[currency] - before;
      if (delta !== 0) {
        walletChanged = true;
        ledger.run(id, currency, delta, wallet[currency], previous ? reason : 'migration_opening_balance', operationId, ts);
      }
    }
    if (walletChanged) {
      db.prepare(`INSERT INTO player_wallets(player_id,coins,gems,shards,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET
        coins=excluded.coins,gems=excluded.gems,shards=excluded.shards,updated_at=excluded.updated_at`)
        .run(id, wallet.coins, wallet.gems, wallet.shards, ts);
    }

    const groups = new Map();
    const inventory = Array.isArray(state.inventory) ? state.inventory : [];
    for (let position = 0; position < inventory.length; position++) {
      const item = inventory[position];
      const itemId = Math.floor(Number(item?.id));
      const tier = Math.floor(Number(item?.tier));
      if (!Number.isInteger(itemId) || itemId <= 0 || tier < 1 || tier > 6) continue;
      const key = `${itemId}:${tier}`;
      let stack = groups.get(key);
      if (!stack) {
        stack = { itemId, tier, positions: [], lastPosition: position };
        groups.set(key, stack);
      }
      stack.positions.push(position);
      stack.lastPosition = position;
    }
    const oldStacks = new Map(db.prepare(`SELECT item_id,tier,quantity,positions_json,last_position
      FROM player_inventory_stacks WHERE player_id=?`).all(id)
      .map(row => [`${Number(row.item_id)}:${Number(row.tier)}`, row]));
    const upsertInventory = db.prepare(`INSERT INTO player_inventory_stacks
      (player_id,item_id,tier,quantity,positions_json,last_position,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_id,item_id,tier) DO UPDATE SET
      quantity=excluded.quantity,positions_json=excluded.positions_json,
      last_position=excluded.last_position,updated_at=excluded.updated_at`);
    for (const [key, stack] of groups) {
      const positionsJson = JSON.stringify(stack.positions);
      const old = oldStacks.get(key);
      if (old && Number(old.quantity) === stack.positions.length &&
          old.positions_json === positionsJson && Number(old.last_position) === stack.lastPosition) {
        oldStacks.delete(key);
        continue;
      }
      upsertInventory.run(id, stack.itemId, stack.tier, stack.positions.length,
        positionsJson, stack.lastPosition, ts);
      oldStacks.delete(key);
    }
    const deleteStack = db.prepare('DELETE FROM player_inventory_stacks WHERE player_id=? AND item_id=? AND tier=?');
    for (const key of oldStacks.keys()) {
      const [itemId, tier] = key.split(':').map(Number);
      deleteStack.run(id, itemId, tier);
    }

    const artifacts = new Map();
    for (const artifact of Array.isArray(state.artifacts) ? state.artifacts : []) {
      const artifactId = Math.floor(Number(artifact?.id));
      const quantity = Math.floor(Number(artifact?.count));
      if (artifactId > 0 && quantity > 0) artifacts.set(artifactId, quantity);
    }
    const oldArtifacts = new Map(db.prepare('SELECT artifact_id,quantity FROM player_artifact_stacks WHERE player_id=?').all(id)
      .map(row => [Number(row.artifact_id), Number(row.quantity)]));
    const upsertArtifact = db.prepare(`INSERT INTO player_artifact_stacks
      (player_id,artifact_id,quantity,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(player_id,artifact_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`);
    for (const [artifactId, quantity] of artifacts) {
      if (oldArtifacts.get(artifactId) === quantity) { oldArtifacts.delete(artifactId); continue; }
      upsertArtifact.run(id, artifactId, quantity, ts);
      oldArtifacts.delete(artifactId);
    }
    const deleteArtifact = db.prepare('DELETE FROM player_artifact_stacks WHERE player_id=? AND artifact_id=?');
    for (const artifactId of oldArtifacts.keys()) deleteArtifact.run(id, artifactId);

    const progression = {
      level: Math.max(1, Math.floor(Number(state.level) || 1)),
      experience: Math.max(0, Math.floor(Number(state.experience) || 0)),
      rating: Math.max(0, Math.floor(Number(state.rating) || 0)),
      totalCasesOpened: Math.max(0, Math.floor(Number(state.totalCasesOpened) || 0)),
      houseLevel: Math.max(1, Math.floor(Number(state.houseLevel) || 1))
    };
    const oldProgression = db.prepare(`SELECT level,experience,rating,total_cases_opened,house_level
      FROM player_progression_snapshot WHERE player_id=?`).get(id);
    if (!oldProgression || Number(oldProgression.level) !== progression.level ||
        Number(oldProgression.experience) !== progression.experience ||
        Number(oldProgression.rating) !== progression.rating ||
        Number(oldProgression.total_cases_opened) !== progression.totalCasesOpened ||
        Number(oldProgression.house_level) !== progression.houseLevel) {
      db.prepare(`INSERT INTO player_progression_snapshot
        (player_id,level,experience,rating,total_cases_opened,house_level,updated_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET
        level=excluded.level,experience=excluded.experience,rating=excluded.rating,
        total_cases_opened=excluded.total_cases_opened,house_level=excluded.house_level,
        updated_at=excluded.updated_at`)
        .run(id, progression.level, progression.experience, progression.rating,
          progression.totalCasesOpened, progression.houseLevel, ts);
    }

    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return { wallet, inventoryStacks: groups.size };
  } catch (error) {
    try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch (_) {}
    try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch (_) {}
    throw error;
  }
}

function queryProjectedInventory(db, playerId, itemById, options = {}) {
  const pageSize = Math.max(1, Math.min(48, Math.floor(Number(options.pageSize) || 24)));
  const requestedPage = Math.max(0, Math.floor(Number(options.page) || 0));
  const tier = options.tier == null || options.tier === '' || options.tier === 'all'
    ? null : Number(options.tier);
  const query = String(options.query || '').trim().toLocaleLowerCase('ru-RU').slice(0, 48);
  const sort = ['date', 'rarityDown', 'rarityUp'].includes(options.sort) ? options.sort : 'date';
  const sourceRows = db.prepare(`SELECT item_id,tier,quantity,positions_json,last_position
    FROM player_inventory_stacks WHERE player_id=?`).all(Number(playerId));
  const rows = [];
  for (const row of sourceRows) {
    const id = Number(row.item_id), itemTier = Number(row.tier);
    if (tier && itemTier !== tier) continue;
    const definition = itemById.get(id);
    if (!definition) continue;
    const name = String(definition.name || '');
    if (query && !name.toLocaleLowerCase('ru-RU').includes(query) && !String(id).includes(query)) continue;
    let indices = [];
    try { indices = JSON.parse(row.positions_json || '[]'); } catch (_) {}
    rows.push({ id, tier: itemTier, count: Number(row.quantity), indices, lastIndex: Number(row.last_position), name });
  }
  rows.sort((a, b) => {
    if (sort === 'rarityDown') return b.tier - a.tier || a.name.localeCompare(b.name, 'ru') || a.id - b.id;
    if (sort === 'rarityUp') return a.tier - b.tier || a.name.localeCompare(b.name, 'ru') || a.id - b.id;
    return b.lastIndex - a.lastIndex || b.id - a.id || b.tier - a.tier;
  });
  const totalStacks = rows.length;
  const totalItems = rows.reduce((sum, row) => sum + row.count, 0);
  const totalPages = Math.max(1, Math.ceil(totalStacks / pageSize));
  const page = Math.min(requestedPage, totalPages - 1);
  return {
    items: rows.slice(page * pageSize, (page + 1) * pageSize).map(({ name, lastIndex, ...row }) => row),
    page, pageSize, totalPages, totalStacks, totalItems
  };
}

function verifyPlayerProjections(db) {
  const players = db.prepare('SELECT id,state_json FROM players ORDER BY id').all();
  const errors = [];
  for (const player of players) {
    let state;
    try { state = JSON.parse(player.state_json); }
    catch (_) { errors.push({ playerId: Number(player.id), problem: 'invalid_state_json' }); continue; }
    const wallet = db.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=?').get(player.id);
    for (const currency of ['coins','gems','shards']) {
      const expectedBalance=Math.max(0,Math.floor(Number(state[currency])||0));
      if (!wallet || Number(wallet[currency]) !== expectedBalance) {
        errors.push({ playerId: Number(player.id), problem: `wallet_${currency}` });
      }
      const ledgerRows=db.prepare('SELECT delta,balance_after FROM wallet_ledger WHERE player_id=? AND currency=? ORDER BY id').all(player.id,currency);
      let ledgerBalance=0,ledgerSequenceOk=true;
      for(const entry of ledgerRows){ledgerBalance+=Number(entry.delta);if(ledgerBalance!==Number(entry.balance_after))ledgerSequenceOk=false;}
      if(ledgerBalance!==expectedBalance||!ledgerSequenceOk)errors.push({playerId:Number(player.id),problem:`ledger_${currency}`});
    }
    const expectedProgress={
      level:Math.max(1,Math.floor(Number(state.level)||1)),
      experience:Math.max(0,Math.floor(Number(state.experience)||0)),
      rating:Math.max(0,Math.floor(Number(state.rating)||0)),
      total_cases_opened:Math.max(0,Math.floor(Number(state.totalCasesOpened)||0)),
      house_level:Math.max(1,Math.floor(Number(state.houseLevel)||1))
    };
    const actualProgress=db.prepare('SELECT level,experience,rating,total_cases_opened,house_level FROM player_progression_snapshot WHERE player_id=?').get(player.id);
    if(!actualProgress||Object.entries(expectedProgress).some(([key,value])=>Number(actualProgress[key])!==value))errors.push({playerId:Number(player.id),problem:'progression'});
    const expectedStacks = new Map();
    for (let position = 0; position < (Array.isArray(state.inventory) ? state.inventory.length : 0); position++) {
      const item = state.inventory[position];
      const key = `${Number(item?.id)}:${Number(item?.tier)}`;
      if (!expectedStacks.has(key)) expectedStacks.set(key, []);
      expectedStacks.get(key).push(position);
    }
    const actualStacks = db.prepare('SELECT item_id,tier,quantity,positions_json FROM player_inventory_stacks WHERE player_id=?').all(player.id);
    const actual = new Map(actualStacks.map(row => [`${row.item_id}:${row.tier}`, row]));
    if (actual.size !== expectedStacks.size) errors.push({ playerId: Number(player.id), problem: 'inventory_stack_count' });
    for (const [key, positions] of expectedStacks) {
      const row = actual.get(key);
      let actualPositions = [];
      try { actualPositions = JSON.parse(row?.positions_json || '[]'); } catch (_) {}
      if (!row || Number(row.quantity) !== positions.length || JSON.stringify(actualPositions) !== JSON.stringify(positions)) {
        errors.push({ playerId: Number(player.id), problem: `inventory_${key}` });
      }
    }
    const expectedArtifacts = new Map((Array.isArray(state.artifacts) ? state.artifacts : []).map(a => [Number(a.id), Number(a.count)]));
    const actualArtifacts = new Map(db.prepare('SELECT artifact_id,quantity FROM player_artifact_stacks WHERE player_id=?').all(player.id).map(a => [Number(a.artifact_id), Number(a.quantity)]));
    if (expectedArtifacts.size !== actualArtifacts.size || [...expectedArtifacts].some(([id,qty]) => actualArtifacts.get(id) !== qty)) {
      errors.push({ playerId: Number(player.id), problem: 'artifacts' });
    }
  }
  return { players: players.length, ok: errors.length === 0, errors };
}

module.exports = {
  ensurePlayerProjectionSchema,
  syncPlayerProjection,
  queryProjectedInventory,
  verifyPlayerProjections
};
