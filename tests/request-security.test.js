'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedMutationRequest } = require('../lib/request-security');

test('request security allows safe methods and same-origin browser mutations', () => {
  assert.equal(isAllowedMutationRequest({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), true);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', origin: 'https://game.example', 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', 'sec-fetch-site': 'none' } }), true);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: {} }), true); // CLI/bot compatibility
});

test('request security rejects cross-origin, same-site sibling and opaque origins', () => {
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', origin: 'https://sub.game.example', 'sec-fetch-site': 'same-site' } }), false);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', origin: 'null' } }), false);
  assert.equal(isAllowedMutationRequest({ method: 'POST', headers: { host: 'game.example', origin: 'not-a-url' } }), false);
});

test('auth limiter is tested separately for per-IP and per-identity throttling', () => {
  const { createAuthRateLimiter } = require('../lib/auth-rate-limit');
  let t = 0;
  const limiter = createAuthRateLimiter({ now: () => t, perIdentityLimit: 1, perIpLimit: 3, windowMs: 1000 });
  assert.equal(limiter.allow('ip-a', 'user-a'), true);
  assert.equal(limiter.allow('ip-a', 'user-a'), false);
  assert.equal(limiter.allow('ip-a', 'user-b'), true);
  assert.equal(limiter.allow('ip-a', 'user-c'), false);
  t = 1001;
  assert.equal(limiter.allow('ip-a', 'user-a'), true);
});
