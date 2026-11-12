'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { weightedPick } = require('../lib/case-engine');

const ROOT = path.resolve(__dirname, '..');
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/cases.json'), 'utf8')).cases;
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/items.json'), 'utf8')).items;
const itemById = new Map(items.map(item => [Number(item.id), item]));
const GEM_COIN_VALUE = 15_000;
const SAMPLE_SIZE = Math.max(100_000, Number(process.env.SIMULATIONS) || 100_000);
const OUTPUT = path.join(ROOT, 'docs');

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return max => {
    // xorshift32 with rejection sampling to avoid modulo bias for this range.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    let value;
    do {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      value = state >>> 0;
    } while (value >= limit);
    return value % max;
  };
}

function money(caseDef, drop) {
  const item = itemById.get(Number(drop.itemId));
  const value = Number(item?.tiers?.[String(drop.tier)]?.price);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Bad value in case ${caseDef.id}`);
  return value;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function summarize(caseDef) {
  const price = Number(caseDef.price || 0);
  const currency = caseDef.currency || 'coins';
  const normalizedCost = currency === 'gems' ? price * GEM_COIN_VALUE : price;
  const theoreticalEv = caseDef.dropTable.reduce((sum, drop) => sum + Number(drop.chance) / 100 * money(caseDef, drop), 0);
  const rarity = {};
  let theoreticalBelow = 0, theoreticalEqual = 0, theoreticalAbove = 0;
  const outcomeValues = [];
  for (const drop of caseDef.dropTable) {
    const chance = Number(drop.chance);
    const value = money(caseDef, drop);
    rarity[drop.tier] = (rarity[drop.tier] || 0) + chance;
    outcomeValues.push(value);
    if (normalizedCost > 0 && value < normalizedCost) theoreticalBelow += chance;
    else if (normalizedCost > 0 && value === normalizedCost) theoreticalEqual += chance;
    else if (normalizedCost > 0 && value > normalizedCost) theoreticalAbove += chance;
  }
  const chanceTotal = caseDef.dropTable.reduce((sum, drop) => sum + Number(drop.chance), 0);

  const rng = makeRng(0x5eed + Number(caseDef.id) * 7919);
  const results = new Array(SAMPLE_SIZE);
  let sum = 0;
  let sumSquares = 0;
  let belowCost = 0, equalCost = 0, aboveCost = 0;
  const table = caseDef.dropTable;
  for (let i = 0; i < SAMPLE_SIZE; i += 1) {
    const reward = money(caseDef, weightedPick(table, rng));
    results[i] = reward;
    sum += reward;
    sumSquares += reward * reward;
    if (normalizedCost > 0 && reward < normalizedCost) belowCost += 1;
    else if (normalizedCost > 0 && reward === normalizedCost) equalCost += 1;
    else if (normalizedCost > 0 && reward > normalizedCost) aboveCost += 1;
  }
  results.sort((a, b) => a - b);
  const mean = sum / SAMPLE_SIZE;
  const variance = Math.max(0, sumSquares / SAMPLE_SIZE - mean * mean);
  return {
    id: caseDef.id,
    name: caseDef.name,
    currency,
    price,
    normalizedCost,
    theoreticalEv,
    simulatedEv: mean,
    returnPct: normalizedCost > 0 ? mean / normalizedCost * 100 : null,
    evMarginPct: normalizedCost > 0 ? (mean / normalizedCost - 1) * 100 : null,
    theoreticalBelowCostPct: normalizedCost > 0 ? theoreticalBelow : null,
    theoreticalBreakEvenPct: normalizedCost > 0 ? theoreticalEqual : null,
    theoreticalAboveCostPct: normalizedCost > 0 ? theoreticalAbove : null,
    simulatedBelowCostPct: normalizedCost > 0 ? belowCost / SAMPLE_SIZE * 100 : null,
    simulatedBreakEvenPct: normalizedCost > 0 ? equalCost / SAMPLE_SIZE * 100 : null,
    simulatedAboveCostPct: normalizedCost > 0 ? aboveCost / SAMPLE_SIZE * 100 : null,
    chanceTotalPct: chanceTotal,
    minimumOutcome: Math.min(...outcomeValues),
    maximumOutcome: Math.max(...outcomeValues),
    theoreticalNetPerOpen: theoreticalEv - normalizedCost,
    standardDeviation: Math.sqrt(variance),
    p5: percentile(results, 0.05),
    p25: percentile(results, 0.25),
    median: percentile(results, 0.5),
    p75: percentile(results, 0.75),
    p95: percentile(results, 0.95),
    p99: percentile(results, 0.99),
    rarity,
    sampleSize: SAMPLE_SIZE
  };
}

fs.mkdirSync(OUTPUT, { recursive: true });
const summaries = cases.map(summarize);
const markdown = [
  '# v86 Case Economy Simulation',
  '',
  `Generated from the authoritative v85 item and case data. Deterministic Monte Carlo sample: **${SAMPLE_SIZE.toLocaleString('en-US')} openings per case** (${(SAMPLE_SIZE * cases.length).toLocaleString('en-US')} simulated openings total).`,
  '',
  `Item values use the configured vendor sell value. Gem-priced cases are normalized at **${GEM_COIN_VALUE.toLocaleString('en-US')} coins per gem**, matching the server and client configuration. Ad cases have no purchase-cost return ratio.`,
  '',
  '| # | Case | Cost | Chance total | EV | Return | Loss | Break-even | Profit | Min–max | Median | P95 |',
  '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
];
for (const s of summaries) {
  const cost = s.normalizedCost ? `${Math.round(s.normalizedCost).toLocaleString('en-US')} coins eq.` : 'Free';
  const pct = n => n == null ? '—' : `${n.toFixed(2)}%`;
  markdown.push(`| ${s.id} | ${s.name.replaceAll('|', '\\|')} | ${cost} | ${s.chanceTotalPct.toFixed(4)}% | ${Math.round(s.theoreticalEv).toLocaleString('en-US')} | ${pct(s.returnPct)} | ${pct(s.theoreticalBelowCostPct)} | ${pct(s.theoreticalBreakEvenPct)} | ${pct(s.theoreticalAboveCostPct)} | ${Math.round(s.minimumOutcome).toLocaleString('en-US')}–${Math.round(s.maximumOutcome).toLocaleString('en-US')} | ${Math.round(s.median).toLocaleString('en-US')} | ${Math.round(s.p95).toLocaleString('en-US')} |`);
}
markdown.push('', '## Interpretation', '', '- Theoretical expected value is computed directly from configured chance × vendor value; Monte Carlo figures are an independent reproducibility check, not the source of truth.', '- Loss, break-even, and profit probabilities are exact sums of the configured drop chances, comparing each vendor value with the normalized purchase cost. Simulated frequencies are also stored in JSON as an independent check.', '- Market prices are excluded because the market supports player-to-player trading and may be sparse or volatile.', '- This report is a baseline rather than an automatic repricing instruction. A price change should also account for rewards from contracts, daily quests, house income, cargo, promo codes, and existing player-held inventories.', '');
fs.writeFileSync(path.join(OUTPUT, 'ECONOMY_SIMULATION.md'), markdown.join('\n'));
fs.writeFileSync(path.join(OUTPUT, 'ECONOMY_SIMULATION.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sampleSize: SAMPLE_SIZE, gemCoinValue: GEM_COIN_VALUE, cases: summaries }, null, 2) + '\n');
console.log(`Wrote ${summaries.length} case reports (${(SAMPLE_SIZE * cases.length).toLocaleString('en-US')} simulated openings).`);
