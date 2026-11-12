'use strict';

/** Returns a user-facing validation error when a configured promo expiry is invalid or has passed. */
function getPromoExpiryError(promo, timestamp = Date.now()) {
  const raw = promo?.expiresAt;
  if (raw === undefined || raw === null || raw === '') return null;
  const expiry = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(expiry)) return 'У промокода задана некорректная дата окончания.';
  if (Number(timestamp) >= expiry) return 'Срок действия промокода истёк.';
  return null;
}

function getPromoRewardAmounts(promo) {
  const amount = (value, max) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
  return {
    coins: amount(promo?.coins, 100000000),
    gems: amount(promo?.gems, 100000),
    shards: amount(promo?.shards, 100000)
  };
}

module.exports = { getPromoExpiryError, getPromoRewardAmounts };
