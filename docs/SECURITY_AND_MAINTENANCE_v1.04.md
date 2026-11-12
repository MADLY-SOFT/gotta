# Zombix Case Simulator v1.04 — security and maintenance notes

## Changes in this release

- Promo codes are stored in `private-data/promo_codes.json`, outside the static `public/` directory. The server reads the private file at startup. The old `public/data/promo_codes.json` is migrated once into the private location and removed; if both copies exist, the private copy wins and the public copy is removed.
- The public promo editor no longer fetches promo codes from the web root. Import the private JSON into the editor manually, then export it and replace the private server-side file during deployment.
- Service Worker install-time shell contains only public assets. Images, audio and fonts use cache-first after their first successful fetch; app code and navigation remain network-first. API responses are not cached.
- `/api/me` now reads the normalized public projection without committing an unchanged player snapshot.
- `/api/public/stats` is read-only. Peak-online metrics are updated from authenticated presence heartbeats instead of a GET request.
- The incomplete `/api/reset` endpoint was removed. A future account reset must be designed as one transaction covering all related tables and projections.
- Contract multipliers and daily/weekly quest seeds now use cryptographically secure random helpers.
- Authentication attempts are limited per IP and per IP+username. Production default: 30 auth attempts per IP per 10 minutes and 8 attempts per identity per 10 minutes. The synthetic 100-player load test explicitly raises the IP limit in its isolated test process only.
- Static-data validation no longer requires exactly 171 items or 44 cases. It validates non-empty catalogs, unique IDs, references, tier prices, drop chances and asset paths.
- Small server concerns were extracted into `lib/auth-rate-limit.js`, `lib/promo-store.js` and `lib/secure-random.js`.

## Promo code operations

1. Edit `private-data/promo_codes.json` directly, or import it into `public/editor.html` using the promo import control.
2. Export `promo_codes.json` from the editor.
3. Replace `private-data/promo_codes.json` on the server (or set `ZOMBIX_PROMO_FILE` to a private external file path).
4. Restart the server to load the new codes.

Do not place the private file under `public/` or a web-served directory.

## Remaining engineering debt (not silently rewritten)

- `server.js` remains the central HTTP/API composition file. The most isolated concerns were extracted, but moving every route into independent modules would be a larger behavior-preserving refactor and should be done route group by route group with integration tests.
- CSS modules still contain intentional cascade overrides and a significant number of `!important` declarations. They were not mass-deleted because selector order and specificity affect the existing UI. A safe cleanup needs visual regression coverage across all screens and viewport sizes.
- Several frontend feature files still contain dense/long lines. Mechanical formatting alone would create a very large diff without improving runtime behavior; refactor those files incrementally alongside feature tests.
- The static editor page remains a client-side tool, not an authenticated admin console. It only edits local browser drafts and exports JSON; it does not write to server files. Do not treat it as a secure remote admin interface.
- Browser/Android visual regression was not completed in this environment. Test the game on the target phone before production deployment.

## Validation

Run `npm run check`, `npm run db:verify-projections` and `npm run load:100` before release. The load test uses a disposable SQLite directory and does not modify the packaged player database.
