'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { syncPlayerProjection, verifyPlayerProjections } = require('../lib/player-projection');

const ROOT = path.resolve(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited (${child.exitCode}).`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error('Server startup timeout.');
}

async function register(baseUrl, username) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'market-test-pass-2026' })
  });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  return response.headers.get('set-cookie').split(';')[0];
}

async function marketAction(baseUrl, cookie, action, payload, idempotencyKey) {
  const response = await fetch(`${baseUrl}/api/market/action`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, ...(idempotencyKey ? { idempotencyKey } : {}) })
  });
  return { status: response.status, payload: await response.json() };
}

test('market crash rollback and concurrent purchase keep one item and one charge', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zombix-market-test-'));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  try { await waitForServer(child, baseUrl); }
  catch (error) { throw new Error(`${error.message}\n${logs}`); }

  const sellerCookie = await register(baseUrl, 'MarketSeller');
  const buyerOneCookie = await register(baseUrl, 'MarketBuyerOne');
  const buyerTwoCookie = await register(baseUrl, 'MarketBuyerTwo');
  const dbPath = path.join(dataDir, 'game.sqlite');
  const db = new DatabaseSync(dbPath);
  const sellerId = Number(db.prepare("SELECT id FROM players WHERE username='MarketSeller'").get().id);
  const buyerOneId = Number(db.prepare("SELECT id FROM players WHERE username='MarketBuyerOne'").get().id);
  const buyerTwoId = Number(db.prepare("SELECT id FROM players WHERE username='MarketBuyerTwo'").get().id);
  const seed = db.prepare('SELECT state_json FROM players WHERE id=?');
  for (const [playerId, changes] of [
    [sellerId, { artifacts: [{ id: 1, count: 1 }] }],
    [buyerOneId, { shards: 2000 }],
    [buyerTwoId, { shards: 2000 }]
  ]) {
    const state = JSON.parse(seed.get(playerId).state_json);
    Object.assign(state, changes);
    db.prepare('UPDATE players SET state_json=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(state), playerId);
    syncPlayerProjection(db, playerId, state, { reason: 'test_seed' });
  }

  const listRequestId = 'market_list_request_001';
  const listed = await marketAction(baseUrl, sellerCookie, 'list', { artifactId: 1, price: 100 }, listRequestId);
  assert.equal(listed.status, 200, JSON.stringify(listed.payload));
  const listingId = Number(listed.payload.result.listingId);
  const listedReplay = await marketAction(baseUrl, sellerCookie, 'list', { artifactId: 1, price: 100 }, listRequestId);
  assert.equal(listedReplay.status, 200);
  assert.equal(listedReplay.payload.replayed, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders WHERE seller_id=? AND status='active'").get(sellerId).n, 1);
  assert.ok(listingId > 0);
  assert.equal(db.prepare('SELECT quantity FROM player_artifact_stacks WHERE player_id=? AND artifact_id=1').get(sellerId), undefined);

  // Failpoint before COMMIT: the order must remain active and the buyer balance
  // and seller mailbox must not receive a partial trade.
  db.exec(`CREATE TRIGGER fail_market_mail BEFORE INSERT ON player_mail
    WHEN NEW.kind='market_shards' BEGIN SELECT RAISE(ABORT,'market mail failpoint'); END;`);
  const buyerOneKey = 'market_buy_request_001';
  const buyerTwoKey = 'market_buy_request_002';
  const failedPurchase = await marketAction(baseUrl, buyerOneCookie, 'buy', { listingId }, buyerOneKey);
  assert.equal(failedPurchase.status, 400);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(listingId).status, 'active');
  assert.equal(JSON.parse(db.prepare('SELECT state_json FROM players WHERE id=?').get(buyerOneId).state_json).shards, 2000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM player_mail WHERE kind=' + "'market_shards'" + ' AND player_id=?').get(sellerId).n, 0);
  db.exec('DROP TRIGGER fail_market_mail');

  const outcomes = await Promise.all([
    marketAction(baseUrl, buyerOneCookie, 'buy', { listingId }, buyerOneKey),
    marketAction(baseUrl, buyerTwoCookie, 'buy', { listingId }, buyerTwoKey)
  ]);
  assert.equal(outcomes.filter(x => x.status === 200).length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.filter(x => x.status === 400).length, 1, JSON.stringify(outcomes));
  const order = db.prepare('SELECT status,buyer_id,price_gems FROM orders WHERE id=?').get(listingId);
  assert.equal(order.status, 'sold');
  const winnerId = Number(order.buyer_id);
  const winnerCookie = winnerId === buyerOneId ? buyerOneCookie : buyerTwoCookie;
  const winnerKey = winnerId === buyerOneId ? buyerOneKey : buyerTwoKey;
  const purchaseReplay = await marketAction(baseUrl, winnerCookie, 'buy', { listingId }, winnerKey);
  assert.equal(purchaseReplay.status, 200, JSON.stringify(purchaseReplay.payload));
  assert.equal(purchaseReplay.payload.replayed, true);
  const winnerState = JSON.parse(db.prepare('SELECT state_json FROM players WHERE id=?').get(winnerId).state_json);
  const loserId = winnerId === buyerOneId ? buyerTwoId : buyerOneId;
  const loserState = JSON.parse(db.prepare('SELECT state_json FROM players WHERE id=?').get(loserId).state_json);
  assert.equal(winnerState.shards, 1900);
  assert.equal(winnerState.artifacts.find(x => x.id === 1)?.count, 1);
  assert.equal(loserState.shards, 2000);
  assert.equal(loserState.artifacts.some(x => x.id === 1), false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM player_mail WHERE kind='market_shards' AND player_id=?").get(sellerId).n, 1);
  assert.equal(db.prepare('SELECT sales FROM market_stats WHERE artifact_id=1').get().sales, 1);

  // Cancelling a listing restores exactly one artifact and is replay-safe too.
  const sellerCurrent = JSON.parse(db.prepare('SELECT state_json FROM players WHERE id=?').get(sellerId).state_json);
  sellerCurrent.artifacts.push({ id: 2, count: 1 });
  db.prepare('UPDATE players SET state_json=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(sellerCurrent), sellerId);
  syncPlayerProjection(db, sellerId, sellerCurrent, { reason: 'test_seed_cancel' });
  const cancelListing = await marketAction(baseUrl, sellerCookie, 'list', { artifactId: 2, price: 150 }, 'market_list_request_002');
  assert.equal(cancelListing.status, 200, JSON.stringify(cancelListing.payload));
  const cancelListingId = Number(cancelListing.payload.result.listingId);
  const cancelled = await marketAction(baseUrl, sellerCookie, 'cancel', { listingId: cancelListingId }, 'market_cancel_request_001');
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.state.artifacts.find(item => item.id === 2)?.count, 1);
  const cancelledReplay = await marketAction(baseUrl, sellerCookie, 'cancel', { listingId: cancelListingId }, 'market_cancel_request_001');
  assert.equal(cancelledReplay.status, 200);
  assert.equal(cancelledReplay.payload.replayed, true);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(cancelListingId).status, 'cancelled');

  assert.equal(verifyPlayerProjections(db).ok, true, JSON.stringify(verifyPlayerProjections(db)));
  db.close();
});
