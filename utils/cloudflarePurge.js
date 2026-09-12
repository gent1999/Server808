import fetch from 'node-fetch';

/**
 * Cloudflare edge cache purge — server-only, multi-site.
 *
 * Server808 serves more than one publication (Cry808 today, 2KOveralls
 * next), and each one lives in its own Cloudflare zone. Deliberately NOT
 * one shared token/zone for "the domain" — a token scoped to Cry808's zone
 * can purge Cry808 and nothing else, so a bug in one site's purge call can
 * never affect another site's cache. Adding a new publication later means
 * adding one entry to SITES below, not touching this file's logic.
 *
 * Called after an admin mutation (create/edit/delete/publish/feature-toggle)
 * so real edits don't have to wait out the Cache-Control ceiling set on the
 * cached pages/API responses. A Cloudflare outage must never fail the
 * database write that triggered it, so every function here always resolves
 * — it never throws or rejects, even on total failure.
 *
 * Credentials are read from env vars only, one pair per site:
 *   CLOUDFLARE_CRY808_API_TOKEN / CLOUDFLARE_CRY808_ZONE_ID
 *   CLOUDFLARE_2KOVERALLS_API_TOKEN / CLOUDFLARE_2KOVERALLS_ZONE_ID
 * Never NEXT_PUBLIC_/VITE_-prefixed, never hardcoded. This module is
 * server-only and must never be imported from client code.
 */

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const BATCH_SIZE = 30; // Cloudflare's purge_cache limit per request
const TIMEOUT_MS = 8000;

// Add a new site here (and its two env vars) when Server808 starts serving
// another publication. Everything else in this file is site-agnostic.
const SITES = {
  cry808: {
    tokenEnv: 'CLOUDFLARE_CRY808_API_TOKEN',
    zoneIdEnv: 'CLOUDFLARE_CRY808_ZONE_ID',
  },
  '2koveralls': {
    tokenEnv: 'CLOUDFLARE_2KOVERALLS_API_TOKEN',
    zoneIdEnv: 'CLOUDFLARE_2KOVERALLS_ZONE_ID',
  },
};

async function purgeBatch(site, token, zoneId, urls) {
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
      console.error(`[cloudflarePurge:${site}] FAILED`, {
        status: response.status,
        errors: data?.errors,
        urls,
      });
      return { ok: false, status: response.status, errors: data?.errors };
    }

    console.log(`[cloudflarePurge:${site}] OK`, { count: urls.length, urls });
    return { ok: true };
  } catch (error) {
    console.error(`[cloudflarePurge:${site}] FAILED (network/timeout)`, { message: error.message, urls });
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Purges a list of fully-qualified URLs from one site's Cloudflare zone,
 * batched at Cloudflare's 30-URL-per-request limit. Never throws.
 * @param {keyof typeof SITES} site - which publication's zone to purge
 * @param {string[]} urls
 */
export async function purgeUrls(site, urls) {
  const config = SITES[site];
  if (!config) {
    console.error(`[cloudflarePurge] Unknown site "${site}" — no zone configured for it`, { urls });
    return;
  }

  const unique = [...new Set((urls || []).filter(Boolean))];
  if (unique.length === 0) return;

  const token = process.env[config.tokenEnv];
  const zoneId = process.env[config.zoneIdEnv];

  if (!token || !zoneId) {
    console.warn(`[cloudflarePurge:${site}] Skipped — ${config.tokenEnv}/${config.zoneIdEnv} not set`, { urls: unique });
    return;
  }

  const batches = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  try {
    await Promise.all(batches.map((batch) => purgeBatch(site, token, zoneId, batch)));
  } catch (error) {
    // purgeBatch already catches everything internally; this is a last-resort
    // safety net so purgeUrls itself can never throw into a caller.
    console.error(`[cloudflarePurge:${site}] Unexpected error`, error.message);
  }
}
