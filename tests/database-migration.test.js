'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');

test('v86 migration snapshots a data-bearing legacy database and preserves its player data', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zombix-v86-migration-test-'));
  const dbPath = path.join(dataDir, 'game.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE players(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`);
  const legacyState = JSON.stringify({ coins: 4321, gems: 17, shards: 6, level: 9, experience: 123, rating: 456, totalCasesOpened: 81, houseLevel: 4, nickname: 'LegacyKeep', inventory: [{ id: 1, tier: 2 }, { id: 1, tier: 2 }, { id: 2, tier: 6 }], artifacts: [{ id: 1, count: 3 }] });
  legacy.prepare('INSERT INTO players(id,username,password_hash,password_salt,state_json,created_at,updated_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(1001, 'LegacyKeep', 'legacy-hash', 'legacy-salt', legacyState, 100, 200, 190);
  legacy.close();

  const legacyMarket = new DatabaseSync(path.join(dataDir, 'market.sqlite'));
  legacyMarket.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT,seller_id INTEGER NOT NULL,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',buyer_id INTEGER,sold_at INTEGER,cancelled_at INTEGER,operation_id TEXT,currency TEXT NOT NULL DEFAULT 'gems');
    CREATE TABLE market_history(id INTEGER PRIMARY KEY AUTOINCREMENT,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,quantity INTEGER NOT NULL,kind TEXT NOT NULL,recorded_at INTEGER NOT NULL,operation_id TEXT);
    CREATE TABLE market_stats(artifact_id INTEGER PRIMARY KEY,sales INTEGER NOT NULL DEFAULT 0,total_price INTEGER NOT NULL DEFAULT 0,min_price INTEGER,max_price INTEGER);
    CREATE TABLE market_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  legacyMarket.prepare("INSERT INTO orders(id,seller_id,artifact_id,price_gems,created_at,status,operation_id,currency) VALUES(7,1001,3,55,300,'active','old-listing-op','shards')").run();
  legacyMarket.prepare("INSERT INTO market_history(id,artifact_id,price_gems,quantity,kind,recorded_at,operation_id) VALUES(9,3,50,1,'sale',250,'old-sale-op')").run();
  legacyMarket.close();

  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', COOKIE_SECURE: 'false', ZOMBIX_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) { ready = true; break; }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, `Server failed to start with the legacy database.\n${logs}`);

  const upgraded = new DatabaseSync(dbPath, { readOnly: true });
  const player = upgraded.prepare('SELECT id,username,state_json,state_version FROM players WHERE id=1001').get();
  assert.ok(player, 'Legacy player row disappeared.');
  assert.equal(player.username, 'LegacyKeep');
  assert.equal(JSON.parse(player.state_json).coins, 4321);
  assert.equal(JSON.parse(player.state_json).gems, 17);
  assert.equal(Number(player.state_version), 0);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=1').get()?.version, 1);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=2').get()?.version, 2);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=3').get()?.version, 3);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=4').get()?.version, 4);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=5').get()?.version, 5);
  assert.equal(upgraded.prepare('SELECT version FROM schema_migrations WHERE version=6').get()?.version, 6);
  assert.equal(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_achievement_claims'").get()?.name, 'player_achievement_claims');
  assert.equal(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_action_requests'").get()?.name, 'player_action_requests');
  assert.equal(upgraded.prepare('SELECT coins,gems FROM player_wallets WHERE player_id=1001').get()?.coins, 4321);
  assert.equal(upgraded.prepare('SELECT coins,gems FROM player_wallets WHERE player_id=1001').get()?.gems, 17);
  assert.equal(upgraded.prepare('SELECT SUM(quantity) n FROM player_inventory_stacks WHERE player_id=1001').get()?.n, 3);
  assert.equal(upgraded.prepare('SELECT quantity FROM player_inventory_stacks WHERE player_id=1001 AND item_id=1 AND tier=2').get()?.quantity, 2);
  assert.equal(upgraded.prepare('SELECT quantity FROM player_artifact_stacks WHERE player_id=1001 AND artifact_id=1').get()?.quantity, 3);
  assert.equal(upgraded.prepare('SELECT level FROM player_progression_snapshot WHERE player_id=1001').get()?.level, 9);
  assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='case_openings'").get());
  assert.equal(upgraded.prepare('SELECT currency FROM orders WHERE id=7').get()?.currency, 'shards');
  assert.equal(upgraded.prepare('SELECT operation_id FROM market_history WHERE id=9').get()?.operation_id, 'old-sale-op');
  upgraded.close();

  const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter(name => name.endsWith('.sqlite'));
  assert.equal(backups.length, 2, `Expected v86 and v0.91 migration backups, got ${backups.length}.`);
  const preV86 = backups.find(name => name.includes('before-v86-migration'));
  assert.ok(preV86, 'The original pre-v86 snapshot must be retained.');
  const snapshot = new DatabaseSync(path.join(dataDir, 'backups', preV86), { readOnly: true });
  const backupPlayer = snapshot.prepare('SELECT username,state_json FROM players WHERE id=1001').get();
  assert.equal(backupPlayer.username, 'LegacyKeep');
  assert.deepEqual(JSON.parse(backupPlayer.state_json), JSON.parse(legacyState));
  assert.equal(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='case_openings'").get(), undefined);
  snapshot.close();
});
