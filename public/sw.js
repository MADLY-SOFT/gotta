'use strict';
const CACHE_NAME = 'zombix-v116-atlas-runtime-fix';
// Only public, non-sensitive files belong in the install-time application shell.
// Private promo configuration is deliberately stored outside /public.
const SHELL = [
  "./index.html",
  "./css/app.css",
  "./manifest.json",
  "./js/main.js",
  "./js/ui.js",
  "./js/sdk.js",
  "./js/presence.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/item-atlas.js",
  "./js/cases.js",
  "./js/profile.js",
  "./js/market.js",
  "./js/contracts.js",
  "./js/daily_rewards.js",
  "./js/house.js",
  "./js/plane.js",
  "./js/mail.js",
  "./js/promo.js",
  "./js/zone.js",
  "./js/audio.js",
  "./js/fullscreen.js",
  "./js/cache.js",
  "./js/avatar-atlas.js",
  "./data/cases.json",
  "./data/items.json",
  "./data/items-atlas.json",
  "./png/items-atlas.png",
  "./data/artifacts.json",
  "./data/artifact-atlas.json",
  "./data/avatars.json",
  "./data/avatar-atlas.json",
  "./data/daily_rewards.json",
  "./data/house.json"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('zombix-') && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Images, sounds and fonts are cache-first after their first successful load.
  // HTML and code remain network-first so deployed fixes are picked up promptly.
  const cacheFirst = ['image', 'audio', 'font'].includes(request.destination);
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cacheFirst && cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch {
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
