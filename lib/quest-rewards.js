'use strict';

function seededUnit(seed) {
  let x = (Math.abs(Math.floor(Number(seed) || 1)) % 2147483646) + 1;
  x = (x * 48271) % 2147483647;
  return x / 2147483647;
}

function randBetweenSeed(min, max, seed) {
  const low = Math.ceil(Math.min(Number(min), Number(max)));
  const high = Math.floor(Math.max(Number(min), Number(max)));
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || high < low) {
    throw new TypeError('Invalid seeded reward range.');
  }
  return low + Math.floor(seededUnit(seed) * (high - low + 1));
}

function rollQuestCurrencyRewards(weekly, seed, salt) {
  if (weekly) {
    return {
      gems: randBetweenSeed(1, 3, Number(seed) + Number(salt) + 907),
      shards: randBetweenSeed(25, 100, Number(seed) + Number(salt) + 1907)
    };
  }
  return { shards: randBetweenSeed(1, 50, Number(seed) + Number(salt) + 1907) };
}

function repairQuestCurrencyRewards(reward, weekly, seed, salt) {
  const result = reward && typeof reward === 'object' ? { ...reward } : {};
  const generated = rollQuestCurrencyRewards(weekly, seed, salt);
  if (weekly && !(Number(result.gems) >= 1 && Number(result.gems) <= 3)) result.gems = generated.gems;
  const minShards = weekly ? 25 : 1;
  const maxShards = weekly ? 100 : 50;
  if (!(Number(result.shards) >= minShards && Number(result.shards) <= maxShards)) result.shards = generated.shards;
  return result;
}

module.exports = { randBetweenSeed, rollQuestCurrencyRewards, repairQuestCurrencyRewards };
