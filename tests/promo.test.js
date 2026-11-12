'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPromoExpiryError, getPromoRewardAmounts } = require('../lib/promo');

test('promo expiry accepts legacy codes without expiry and future timestamps', () => {
  assert.equal(getPromoExpiryError({}, 1_800_000_000_000), null);
  assert.equal(getPromoExpiryError({ expiresAt: 1_900_000_000_000 }, 1_800_000_000_000), null);
  assert.equal(getPromoExpiryError({ expiresAt: '2030-01-01T00:00:00.000Z' }, Date.parse('2029-01-01T00:00:00.000Z')), null);
});

test('promo expiry rejects expired and malformed configured dates', () => {
  assert.equal(getPromoExpiryError({ expiresAt: 1_700_000_000_000 }, 1_800_000_000_000), 'Срок действия промокода истёк.');
  assert.equal(getPromoExpiryError({ expiresAt: '2020-01-01T00:00:00.000Z' }, 1_800_000_000_000), 'Срок действия промокода истёк.');
  assert.equal(getPromoExpiryError({ expiresAt: 'not-a-date' }, 1_800_000_000_000), 'У промокода задана некорректная дата окончания.');
});

test('promo reward amounts safely normalize optional shards alongside coins and gems', () => {
  assert.deepEqual(getPromoRewardAmounts({ coins: 12.8, gems: 4, shards: 9 }), { coins: 12, gems: 4, shards: 9 });
  assert.deepEqual(getPromoRewardAmounts({ coins: -5, gems: 'bad', shards: 500000 }), { coins: 0, gems: 0, shards: 100000 });
  assert.deepEqual(getPromoRewardAmounts({}), { coins: 0, gems: 0, shards: 0 });
});
