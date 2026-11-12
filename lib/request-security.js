'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reject browser-originated cross-site state changes while allowing non-browser clients. */
function isAllowedMutationRequest(req) {
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return true;
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return fetchSite === '' || fetchSite === 'same-origin' || fetchSite === 'none';
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers?.host || '').toLowerCase();
    return Boolean(host) && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

module.exports = { isAllowedMutationRequest };
