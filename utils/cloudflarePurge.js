import fetch from 'node-fetch';

/**
 * Cloudflare edge cache purge — server-only.
 *
 * Called after an admin mutation (create/edit/delete/publish/feature-toggle)
 * so real edits don't have to wait out the Cache-Control ceiling set on the
 * cached pages/API responses. A Cloudflare outage must never fail the
 * database write that triggered it, so every function here always resolves
 * — it never throws or rejects, even on total failure.
 *
 * Credentials are read from env vars only:
 *   CLOUDFLARE_API_TOKEN — zone-scoped "Cache Purge" API token
 *   CLOUDFLARE_ZONE_ID   — cry808.com zone ID
 * Never NEXT_PUBLIC_/VITE_-prefixed, never hardcoded. This module is
 * server-only and must never be imported from client code.
 */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const BATCH_SIZE = 30; // Cloudflare's purge_cache limit per request
const TIMEOUT_MS = 8000;

async function purgeBatch(urls) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!token || !zoneId) {
    console.warn('[cloudflarePurge] Skipped — CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID not set', { urls });
    return { ok: false, skipped: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${CLOUDFLARE_API}/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      console.error('[cloudflarePurge] FAILED', {
        status: response.status,
        errors: data?.errors,
        urls,
      });
      return { ok: false, status: response.status, errors: data?.errors };
    }

    console.log('[cloudflarePurge] OK', { count: urls.length, urls });
    return { ok: true };
  } catch (error) {
    console.error('[cloudflarePurge] FAILED (network/timeout)', { message: error.message, urls });
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Purges a list of fully-qualified URLs from Cloudflare's edge cache,
 * batched at Cloudflare's 30-URL-per-request limit. Never throws.
 * @param {string[]} urls
 */
export async function purgeUrls(urls) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (unique.length === 0) return;

  const batches = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  try {
    await Promise.all(batches.map(purgeBatch));
  } catch (error) {
    // purgeBatch already catches everything internally; this is a last-resort
    // safety net so purgeUrls itself can never throw into a caller.
    console.error('[cloudflarePurge] Unexpected error', error.message);
  }
}
