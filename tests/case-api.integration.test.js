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
let child;
let dataDir;
let baseUrl;
let cookie;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, payload };
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited (${child.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server startup timeout: ${lastError?.message || 'unknown error'}`);
}

test('case opening API is atomic, batch-aware, idempotent and recorded in history', async t => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zombix-v86-case-test-'));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', COOKIE_SECURE: 'false', ZOMBIX_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  try {
    await waitForServer();
  } catch (error) {
    throw new Error(`${error.message}\n${logs}`);
  }

  const blockedCrossSite = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ username: 'BlockedCrossSite', password: 'test-password-86' }) });
  assert.equal(blockedCrossSite.status, 403, 'Cross-site state-changing request must be rejected.');

  const authResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'CaseApiTest', password: 'test-password-86' })
  });
  const authPayload = await authResponse.json();
  assert.equal(authResponse.status, 201, JSON.stringify(authPayload));
  cookie = authResponse.headers.get('set-cookie');
  assert.ok(cookie, 'Registration response did not expose the session cookie.');
  cookie = cookie.split(';')[0];

  const publicPromoFile = await fetch(`${baseUrl}/data/promo_codes.json`);
  assert.equal(publicPromoFile.status, 404, 'promo codes must not be served from public data');
  const privatePromoFile = await fetch(`${baseUrl}/private-data/promo_codes.json`);
  assert.equal(privatePromoFile.status, 404, 'private configuration must not be served by static file handler');

  const heartbeat = await request('/api/presence', { method: 'POST', body: { clientKind: 'web' } });
  assert.equal(heartbeat.status, 200, JSON.stringify(heartbeat.payload));
  const metricsBeforeReadDb = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const metricsBeforeRead = metricsBeforeReadDb.prepare('SELECT updated_at FROM server_public_metrics WHERE id=1').get()?.updated_at;
  metricsBeforeReadDb.close();
  const publicStats = await fetch(`${baseUrl}/api/public/stats`).then(r => r.json());
  assert.equal(publicStats.online, 1);
  assert.equal(publicStats.totalPlayers, 1);
  assert.equal(publicStats.playing, 0);
  const metricsAfterReadDb = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const metricsAfterRead = metricsAfterReadDb.prepare('SELECT updated_at FROM server_public_metrics WHERE id=1').get()?.updated_at;
  metricsAfterReadDb.close();
  assert.equal(metricsAfterRead, metricsBeforeRead, 'GET /api/public/stats must not mutate public metrics');

  // Verify that real completed-sale history is returned for an artifact detail.
  const marketFixture = new DatabaseSync(path.join(dataDir, 'game.sqlite'));
  marketFixture.prepare("INSERT INTO market_history(artifact_id,price_gems,quantity,kind,recorded_at,operation_id) VALUES(1,125,1,'sale',1700000000000,'integration-sale-1')").run();
  marketFixture.close();
  const marketHistory = await request('/api/market?artifact=1');
  assert.equal(marketHistory.status, 200, JSON.stringify(marketHistory.payload));
  assert.equal(marketHistory.payload.history['1'][0].price, 125);
  assert.equal(marketHistory.payload.history['1'][0].recordedAt, 1700000000000);

  const beforeResponse = await request('/api/me');
  assert.equal(beforeResponse.status, 200, JSON.stringify(beforeResponse.payload));
  const before = beforeResponse.payload.state;
  assert.equal(before.coins, 1000);
  assert.equal(before.totalCasesOpened, 0);
  const stateVersionBeforeRead = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const caseApiPlayerId = Number(stateVersionBeforeRead.prepare('SELECT id FROM players WHERE username=?').get('CaseApiTest')?.id);
  const versionBeforeRead = Number(stateVersionBeforeRead.prepare('SELECT state_version FROM players WHERE id=?').get(caseApiPlayerId)?.state_version);
  stateVersionBeforeRead.close();
  await request('/api/me');
  const stateVersionAfterRead = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const versionAfterRead = Number(stateVersionAfterRead.prepare('SELECT state_version FROM players WHERE id=?').get(caseApiPlayerId)?.state_version);
  stateVersionAfterRead.close();
  assert.equal(versionAfterRead, versionBeforeRead, 'GET /api/me must not write or increment the player state version');
  const removedReset = await request('/api/reset', { method: 'POST', body: {} });
  assert.equal(removedReset.status, 404, 'partial account reset endpoint must not remain available');

  const leaderboardSmoke = await request('/api/leaderboard?type=rating&limit=10');
  assert.equal(leaderboardSmoke.status, 200, JSON.stringify(leaderboardSmoke.payload));
  assert.equal(leaderboardSmoke.payload.players.length, 1);
  assert.equal(leaderboardSmoke.payload.me.rank, 1);

  const idempotencyKey = 'v86_case_batch_integration_005';
  const opened = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 5 }, idempotencyKey }
  });
  assert.equal(opened.status, 200, JSON.stringify(opened.payload));
  assert.equal(opened.payload.result.quantity, 5);
  assert.equal(opened.payload.result.items.length, 5);
  assert.equal(opened.payload.state.totalCasesOpened, 5);
  assert.ok(opened.payload.state.coins >= before.coins - 300, 'Case purchase deducted more than the listed price.');
  assert.equal(opened.payload.state.inventory.length, before.inventory.length + 5);
  assert.equal(opened.payload.result.totalCost, 300);
  assert.equal(opened.payload.result.totalVendorValue, opened.payload.result.items.reduce((sum, reward) => sum + reward.vendorValue, 0));

  // Projection tables must reflect the same balances and item counts that the
  // client receives; this catches missing dual-writes in any game mutation.
  const projectionDb = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const casePlayerId = Number(projectionDb.prepare('SELECT id FROM players WHERE username=?').get('CaseApiTest')?.id);
  const projectedWallet = projectionDb.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=?').get(casePlayerId);
  assert.equal(Number(projectedWallet.coins), opened.payload.state.coins);
  assert.equal(Number(projectedWallet.gems), opened.payload.state.gems);
  assert.equal(Number(projectedWallet.shards), opened.payload.state.shards);
  assert.equal(Number(projectionDb.prepare('SELECT SUM(quantity) n FROM player_inventory_stacks WHERE player_id=?').get(casePlayerId).n), opened.payload.state.inventory.length);
  projectionDb.close();

  const progression = await request('/api/progression');
  assert.equal(progression.status, 200, JSON.stringify(progression.payload));
  assert.ok(Array.isArray(progression.payload.achievements));
  assert.ok(progression.payload.achievements.find(x => x.id === 'first_case')?.completed);
  assert.ok(Array.isArray(progression.payload.collections));
  assert.equal(progression.payload.totalItems, 171);
  const activeStats = await fetch(`${baseUrl}/api/public/stats`).then(r => r.json());
  assert.equal(activeStats.playing, 1);
  assert.equal(activeStats.dau, 1);
  assert.equal(fs.existsSync(path.join(dataDir, 'market.sqlite')), false, 'New installs must use one active game database.');

  const duplicateRequests = await Promise.all([1, 2].map(() => request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 5 }, idempotencyKey }
  })));
  for (const replay of duplicateRequests) {
    assert.equal(replay.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.replayed, true);
    assert.deepEqual(replay.payload.result, opened.payload.result);
    assert.equal(replay.payload.state.coins, opened.payload.state.coins, 'Replay charged or rewarded the player again.');
    assert.equal(replay.payload.state.totalCasesOpened, 5, 'Replay added extra items.');
  }

  const openedTen = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 10 }, idempotencyKey: 'v86_case_batch_integration_010' }
  });
  assert.equal(openedTen.status, 200, JSON.stringify(openedTen.payload));
  assert.equal(openedTen.payload.result.quantity, 10);
  assert.equal(openedTen.payload.result.items.length, 10);
  assert.equal(openedTen.payload.state.totalCasesOpened, 15);
  assert.equal(openedTen.payload.state.inventory.length, 15);
  assert.equal(openedTen.payload.result.totalCost, 600);
  assert.ok(openedTen.payload.state.coins >= opened.payload.state.coins - 600);
  const specialProgression = await request('/api/progression');
  assert.equal(specialProgression.status, 200, JSON.stringify(specialProgression.payload));
  const specialAchievement = id => specialProgression.payload.achievements.find(item => item.id === id);
  assert.equal(specialAchievement('big_opening_10')?.progress, 1, 'A server-recorded ten-case opening should count for the special achievement.');
  assert.ok(specialAchievement('active_days_7')?.progress >= 1, 'Recorded activity days should back the regular-play achievement.');
  assert.equal(specialAchievement('case_variety_5')?.progress, 1, 'Distinct opened case IDs should back the case-variety achievement.');
  assert.ok(specialAchievement('rare_streak_3'), 'Rare streak achievement should be included in the server progression payload.');

  const inventoryPage = await request('/api/inventory?page=0&limit=1&sort=date');
  assert.equal(inventoryPage.status, 200, JSON.stringify(inventoryPage.payload));
  assert.equal(inventoryPage.payload.totalItems, 15);
  assert.equal(inventoryPage.payload.pageSize, 1);
  assert.equal(inventoryPage.payload.items.length, 1);
  assert.ok(inventoryPage.payload.items[0].count >= 1);
  assert.ok(inventoryPage.payload.items[0].indices.every(index => Number.isInteger(index) && index >= 0 && index < 15));
  const inventoryFiltered = await request(`/api/inventory?tier=${inventoryPage.payload.items[0].tier}&limit=48`);
  assert.equal(inventoryFiltered.status, 200);
  assert.ok(inventoryFiltered.payload.items.every(item => String(item.tier) === String(inventoryPage.payload.items[0].tier)));

  const fastOpen = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 1, fast: true }, idempotencyKey: 'v86_case_fast_integration_001' }
  });
  assert.equal(fastOpen.status, 200, JSON.stringify(fastOpen.payload));
  assert.equal(fastOpen.payload.result.quantity, 1);
  assert.equal(fastOpen.payload.result.fastFeeGems, 1);
  assert.ok(fastOpen.payload.state.gems >= openedTen.payload.state.gems - 1, 'Quick-open fee should not exceed one gem for a single opening.');
  assert.equal(fastOpen.payload.state.totalCasesOpened, 16);
  assert.equal(fastOpen.payload.state.inventory.length, 16);

  const invalidQuantity = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 4 }, idempotencyKey: 'v86_invalid_quantity_001' }
  });
  assert.equal(invalidQuantity.status, 400);
  assert.match(invalidQuantity.payload.error, /quantity/i);

  const missingKey = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 1 } }
  });
  assert.equal(missingKey.status, 400);
  assert.match(missingKey.payload.error, /запрос|открытия/i);

  const history = await request('/api/case-history?limit=1');
  assert.equal(history.status, 200, JSON.stringify(history.payload));
  assert.equal(history.payload.entries.length, 1);
  assert.equal(history.payload.entries[0].quantity, 1);
  assert.deepEqual(Object.keys(history.payload.entries[0]).sort(), ['caseId', 'createdAt', 'id', 'quantity', 'result']);
  assert.deepEqual(Object.keys(history.payload.entries[0].result.items[0]).sort(), ['item', 'tier']);
  assert.deepEqual(Object.keys(history.payload.entries[0].result.items[0].item).sort(), ['id', 'image', 'name']);
  assert.equal(history.payload.nextCursor, null, 'The compact history view no longer offers pagination.');
  const latestSessions = await request('/api/case-history?limit=50');
  assert.equal(latestSessions.payload.entries.length, 3);
  assert.deepEqual(latestSessions.payload.entries.map(entry => entry.quantity), [1, 10, 5]);
  assert.equal(latestSessions.payload.nextCursor, null);
  const beforeCursorIgnored = await request('/api/case-history?limit=50&before=1');
  assert.deepEqual(beforeCursorIgnored.payload.entries.map(entry => entry.id), latestSessions.payload.entries.map(entry => entry.id));
  assert.equal(history.payload.stats.openings, 3);
  assert.equal(history.payload.stats.cases, 16);
  assert.deepEqual(Object.keys(history.payload.stats).sort(), ['cases', 'openings']);

  const historyFixture = new DatabaseSync(path.join(dataDir, 'game.sqlite'));
  const caseOwner = historyFixture.prepare('SELECT id FROM players WHERE username=?').get('CaseApiTest');
  assert.ok(caseOwner?.id);
  const addArchivedOpening = historyFixture.prepare('INSERT INTO case_openings(player_id,request_id,case_id,quantity,currency,total_cost,fast_fee_gems,total_vendor_value,results_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 12; i += 1) {
    addArchivedOpening.run(caseOwner.id, `archived_history_fixture_${i}`, 1, 1, 'coins', 60, 0, 0, JSON.stringify({ item: { id: 1 }, tier: 1 }), 1800000000000 + i);
  }
  const cappedHistory = await request('/api/case-history?limit=50');
  assert.equal(cappedHistory.payload.entries.length, 10, 'History API must return at most ten latest sessions.');
  assert.ok(cappedHistory.payload.entries[0].id > cappedHistory.payload.entries[9].id);
  historyFixture.close();

  const openedTwo = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 2 }, idempotencyKey: 'v86_case_batch_integration_002' }
  });
  assert.equal(openedTwo.status, 200, JSON.stringify(openedTwo.payload));
  assert.equal(openedTwo.payload.result.quantity, 2);
  assert.equal(openedTwo.payload.result.items.length, 2);

  const achievementClaim = await request('/api/progression/claim', { method: 'POST', body: { achievementId: 'first_case', idempotencyKey: 'achievement_first_case_001' } });
  assert.equal(achievementClaim.status, 200, JSON.stringify(achievementClaim.payload));
  assert.equal(achievementClaim.payload.reward.coins, 150);
  const achievementAfterClaim = await request('/api/progression');
  assert.equal(achievementAfterClaim.payload.achievements.find(x => x.id === 'first_case')?.claimed, true);
  assert.equal(achievementAfterClaim.payload.achievements.find(x => x.id === 'first_case')?.claimable, false);
  const achievementReplay = await request('/api/progression/claim', { method: 'POST', body: { achievementId: 'first_case', idempotencyKey: 'achievement_first_case_001' } });
  assert.equal(achievementReplay.status, 200);
  assert.equal(achievementReplay.payload.replayed, true);
  const achievementDuplicate = await request('/api/progression/claim', { method: 'POST', body: { achievementId: 'first_case', idempotencyKey: 'achievement_first_case_newkey_002' } });
  assert.equal(achievementDuplicate.status, 400);
  const questInfo = await request('/api/action', { method: 'POST', body: { action: 'questInfo', payload: {}, idempotencyKey: 'quest_info_test_001' } });
  assert.equal(questInfo.status, 200, JSON.stringify(questInfo.payload));
  assert.ok(Array.isArray(questInfo.payload.result.quests.daily));
  assert.ok(Array.isArray(questInfo.payload.result.quests.weekly));
  assert.deepEqual(Object.keys(questInfo.payload.result.quests).sort(), ['daily', 'weekly']);

  // A fresh account has no quest-completion gem rewards, so the exact quick fee
  // balance change can be asserted without unrelated rewards masking it.
  const quickAuth = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'QuickFeeTest', password: 'test-password-86' })
  });
  assert.equal(quickAuth.status, 201);
  cookie = quickAuth.headers.get('set-cookie').split(';')[0];
  const quickBefore = await request('/api/me');
  assert.equal(quickBefore.payload.state.gems, 10);
  const quickFee = await request('/api/action', {
    method: 'POST',
    body: { action: 'openCase', payload: { caseId: 1, quantity: 1, fast: true }, idempotencyKey: 'v86_quick_fee_exact_test_001' }
  });
  assert.equal(quickFee.status, 200, JSON.stringify(quickFee.payload));
  assert.equal(quickFee.payload.result.fastFeeGems, 1);
  assert.equal(quickFee.payload.state.gems, 9);

  // Selling after a case opening must credit the wallet and remove the exact
  // same inventory instances from the normalized projection.
  const sellBefore = quickFee.payload.state;
  const saleRequest = { action: 'sell', payload: { indices: [0] }, idempotencyKey: 'sell_retry_test_0001' };
  const sold = await request('/api/action', { method: 'POST', body: saleRequest });
  assert.equal(sold.status, 200, JSON.stringify(sold.payload));
  assert.equal(sold.payload.state.inventory.length, sellBefore.inventory.length - 1);
  const soldReplay = await request('/api/action', { method: 'POST', body: saleRequest });
  assert.equal(soldReplay.status, 200, JSON.stringify(soldReplay.payload));
  assert.equal(soldReplay.payload.replayed, true);
  assert.equal(soldReplay.payload.state.coins, sold.payload.state.coins);
  assert.equal(soldReplay.payload.state.inventory.length, sold.payload.state.inventory.length);
  const conflictingReplay = await request('/api/action', { method: 'POST', body: { action: 'sellAll', payload: {}, idempotencyKey: 'sell_retry_test_0001' } });
  assert.equal(conflictingReplay.status, 400);

  const invalidPromo = await request('/api/action', { method: 'POST', body: { action: 'promo', payload: { code: 'NOT_A_REAL_CODE' }, idempotencyKey: 'promo_invalid_test_001' } });
  assert.equal(invalidPromo.status, 400);
  const promoClaim = await request('/api/action', { method: 'POST', body: { action: 'promo', payload: { code: 'TEST100' }, idempotencyKey: 'promo_test100_claim_001' } });
  assert.equal(promoClaim.status, 200, JSON.stringify(promoClaim.payload));
  assert.equal(promoClaim.payload.result.coins, 1000000);
  assert.equal(promoClaim.payload.result.gems, 10000);
  // A separate idempotency key must not bypass the one-use promo ledger.
  const promoDuplicate = await request('/api/action', { method: 'POST', body: { action: 'promo', payload: { code: 'TEST100' }, idempotencyKey: 'promo_test100_repeat_002' } });
  assert.equal(promoDuplicate.status, 400);
  const promoReplay = await request('/api/action', { method: 'POST', body: { action: 'promo', payload: { code: 'TEST100' }, idempotencyKey: 'promo_test100_claim_001' } });
  assert.equal(promoReplay.status, 200);
  assert.equal(promoReplay.payload.replayed, true);
  assert.equal(promoReplay.payload.state.coins, promoClaim.payload.state.coins);
  assert.equal(promoReplay.payload.state.gems, promoClaim.payload.state.gems);
  const finalProjection = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const quickPlayerId = Number(finalProjection.prepare('SELECT id FROM players WHERE username=?').get('QuickFeeTest')?.id);
  const finalWallet = finalProjection.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=?').get(quickPlayerId);
  assert.equal(Number(finalWallet.coins), promoClaim.payload.state.coins);
  assert.equal(Number(finalWallet.gems), promoClaim.payload.state.gems);
  assert.equal(Number(finalWallet.shards), promoClaim.payload.state.shards);
  assert.equal(Number(finalProjection.prepare('SELECT COALESCE(SUM(quantity),0) n FROM player_inventory_stacks WHERE player_id=?').get(quickPlayerId).n), promoClaim.payload.state.inventory.length);
  const ledgerRows = finalProjection.prepare('SELECT currency,delta,reason,operation_id FROM wallet_ledger WHERE player_id=? ORDER BY id').all(quickPlayerId);
  assert.ok(ledgerRows.some(row => row.currency === 'coins' && Number(row.delta) > 0), JSON.stringify(ledgerRows));
  finalProjection.close();
  const walletHistory = await request('/api/wallet/history?limit=20');
  assert.equal(walletHistory.status, 200, JSON.stringify(walletHistory.payload));
  assert.ok(walletHistory.payload.entries.some(row => row.reason === 'inventory_sale' && row.currency === 'coins' && row.delta > 0), JSON.stringify(walletHistory.payload));
  assert.ok(Number(sold.payload.result.coins) > 0, JSON.stringify(sold.payload));
  assert.ok(walletHistory.payload.entries.some(row => row.delta > 0), JSON.stringify(walletHistory.payload));
});
