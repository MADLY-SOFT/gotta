'use strict';

/**
 * In-memory authentication limiter with both per-IP and per-IP+identity buckets.
 * Keep the global IP bucket so changing usernames cannot bypass throttling.
 */
function createAuthRateLimiter({ now = Date.now, perIdentityLimit = 8, perIpLimit = 30, windowMs = 10 * 60 * 1000 } = {}) {
  const identities = new Map();
  const addresses = new Map();

  function hit(map, key, limit, timestamp) {
    let bucket = map.get(key);
    if (!bucket || timestamp - bucket.startedAt >= windowMs) {
      bucket = { startedAt: timestamp, count: 0 };
      map.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  return {
    allow(ip, identity = '') {
      const timestamp = now();
      const address = String(ip || 'unknown');
      const name = String(identity || '').trim().toLowerCase();
      if (!hit(addresses, address, perIpLimit, timestamp)) return false;
      return hit(identities, `${address}|${name}`, perIdentityLimit, timestamp);
    },
    cleanup(timestamp = now()) {
      for (const [key, bucket] of addresses) if (timestamp - bucket.startedAt >= windowMs) addresses.delete(key);
      for (const [key, bucket] of identities) if (timestamp - bucket.startedAt >= windowMs) identities.delete(key);
    }
  };
}

module.exports = { createAuthRateLimiter };
