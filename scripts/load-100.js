'use strict';
// Synthetic 100-player mixed API smoke/load test. Uses an isolated temporary DB.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { verifyPlayerProjections } = require('../lib/player-projection');

const ROOT = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zombix-load100-'));
let child;
const timings = [];
const failures = [];

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function wait(url) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server startup timeout');
}
async function call(url, cookie, route, options = {}) {
  const start = performance.now();
  const response = await fetch(`${url}${route}`, {
    method: options.method || 'GET',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const elapsed = performance.now() - start;
  timings.push(elapsed);
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || (payload && payload.ok === false)) failures.push({ route, status: response.status, error: payload?.error || 'request failed' });
  return { response, payload };
}

(async () => {
  const p = await port();
  const url = `http://127.0.0.1:${p}`;
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(p), HOST: '127.0.0.1', NODE_ENV: 'test', COOKIE_SECURE: 'false', ZOMBIX_DATA_DIR: dataDir, ZOMBIX_AUTH_IP_LIMIT: '120' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await wait(url);
  const users = [];
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${url}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `LoadUser${String(i).padStart(3, '0')}`, password: 'load-test-pass-2026' })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`register ${i}: ${response.status} ${JSON.stringify(payload)}`);
    users.push(response.headers.get('set-cookie').split(';')[0]);
  }
  await Promise.all(users.map(async (cookie, i) => {
    await Promise.all([
      call(url, cookie, '/api/presence', { method: 'POST', body: { clientKind: 'load-test' } }),
      call(url, cookie, '/api/inventory?page=0&limit=24'),
      call(url, cookie, '/api/progression'),
      call(url, cookie, '/api/market?limit=20'),
      call(url, cookie, '/api/mail'),
      call(url, cookie, '/api/leaderboard?type=rating&limit=10'),
      call(url, cookie, '/api/action', { method: 'POST', body: { action: 'openCase', payload: { caseId: 1, quantity: 1 }, idempotencyKey: `load100_player_${String(i).padStart(3, '0')}_case01` } })
    ]);
  }));
  const stats = await fetch(`${url}/api/public/stats`).then(r => r.json());
  const auditDb = new DatabaseSync(path.join(dataDir, 'game.sqlite'), { readOnly: true });
  const projectionCheck = verifyPlayerProjections(auditDb);
  const integrityCheck = auditDb.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  auditDb.close();
  const sorted = [...timings].sort((a,b)=>a-b);
  const percentile = q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] || 0;
  const report = {
    generatedAt: new Date().toISOString(), players: users.length,
    operations: timings.length, failures: failures.length,
    latencyMs: { p50: +percentile(.50).toFixed(2), p95: +percentile(.95).toFixed(2), p99: +percentile(.99).toFixed(2), max: +Math.max(...timings).toFixed(2) },
    publicStats: { online: stats.online, playing: stats.playing, totalPlayers: stats.totalPlayers, dau: stats.dau, peakOnline: stats.peakOnline },
    database: { integrity: integrityCheck.length === 1 && integrityCheck[0] === 'ok' ? 'ok' : integrityCheck, projections: projectionCheck },
    failureSamples: failures.slice(0, 20)
  };
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/LOAD_TEST_100_REPORT.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length || !projectionCheck.ok || integrityCheck.length !== 1 || integrityCheck[0] !== 'ok') process.exitCode = 1;
  if (child && child.exitCode === null) child.kill('SIGTERM');
})().catch(error => {
  console.error(error.stack || error);
  if (child && child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = 1;
}).finally(() => {
  setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 500);
});
