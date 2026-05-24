/**
 * Minimal in-memory TTL cache.
 * Keeps Neon's compute from being woken on every page load.
 *
 * Usage:
 *   import { getCached, setCached, bustCache } from '../utils/cache.js';
 *
 *   const data = getCached('my-key');
 *   if (data) return res.json(data);
 *   // … fetch from DB …
 *   setCached('my-key', result, 60); // 60-second TTL
 */

const store = new Map(); // key → { value, expiresAt }

/**
 * Returns the cached value for `key`, or null if missing/expired.
 * @param {string} key
 * @returns {any|null}
 */
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Stores `value` under `key` for `ttlSeconds` seconds.
 * @param {string} key
 * @param {any}    value
 * @param {number} ttlSeconds
 */
export function setCached(key, value, ttlSeconds = 60) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Deletes one or more cache keys (call after writes/deletes).
 * @param {...string} keys
 */
export function bustCache(...keys) {
  keys.forEach(k => store.delete(k));
}
