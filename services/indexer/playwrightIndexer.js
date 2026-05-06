import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Persistent Chrome profile dir — stores cookies, localStorage, etc.
const USER_DATA_DIR = join(__dirname, '../../playwright/.auth');
const GSC_ORIGIN = 'https://search.google.com';
const GSC_URL = 'https://search.google.com/search-console/';

if (!existsSync(USER_DATA_DIR)) {
  mkdirSync(USER_DATA_DIR, { recursive: true });
}

function slugify(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

async function launchContext(headless = true) {
  return chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    viewport: headless ? { width: 1280, height: 800 } : null,
    args: headless ? [] : ['--start-maximized'],
    ignoreHTTPSErrors: true,
  });
}

// ─── Save Session ─────────────────────────────────────────────────────────────
// Opens a visible browser. User logs in manually. Session persists in USER_DATA_DIR.
export async function saveGoogleSession() {
  const context = await launchContext(false);
  const page = context.pages()[0] || await context.newPage();

  await page.goto(GSC_URL);
  console.log('[Indexer] Visible browser opened → please log in to Google Search Console.');

  // Poll until we land on GSC (not accounts.google.com), up to 5 min
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    if (!url.includes('accounts.google.com') && url.includes('search.google.com')) {
      break;
    }
  }

  const finalUrl = page.url();
  if (finalUrl.includes('accounts.google.com')) {
    await context.close();
    throw new Error('Login timed out after 5 minutes');
  }

  console.log('[Indexer] Login detected — session saved to playwright/.auth');
  await context.close();

  return { success: true, message: 'Google session saved. You can now run indexing.' };
}

// ─── Test Session ─────────────────────────────────────────────────────────────
export async function testGoogleSession() {
  let context;
  try {
    context = await launchContext(true);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(GSC_URL, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    const url = page.url();
    const loggedIn = !url.includes('accounts.google.com');

    await context.close();
    return {
      success: loggedIn,
      needsLogin: !loggedIn,
      message: loggedIn
        ? 'Session is valid — Google Search Console is accessible.'
        : 'Not logged in — click "Save Session" to authenticate.',
    };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    return { success: false, needsLogin: true, message: err.message };
  }
}

// ─── Request Indexing for a single URL ────────────────────────────────────────
export async function requestIndexing(url) {
  let context;
  try {
    context = await launchContext(true);
    const page = context.pages()[0] || await context.newPage();

    // Go to GSC
    await page.goto(GSC_URL, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    if (page.url().includes('accounts.google.com')) {
      throw new Error('needs_login');
    }

    // GSC has a URL inspection search bar — try several known selectors
    const inputSelectors = [
      'input[placeholder*="nspect"]',
      'input[aria-label*="URL"]',
      'input[aria-label*="nspect"]',
      '[data-query-input] input',
      'form input[type="text"]',
    ];

    let searchInput = null;
    for (const sel of inputSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        searchInput = el;
        break;
      }
    }

    if (!searchInput) {
      throw new Error('Could not find URL Inspection search bar — GSC UI may have changed');
    }

    await searchInput.fill(url);
    await searchInput.press('Enter');

    // Wait for inspection results
    await page.waitForLoadState('networkidle', { timeout: 45_000 });
    await page.waitForTimeout(2000);

    // Click "REQUEST INDEXING" — try multiple text variants
    const btnSelectors = [
      'text=REQUEST INDEXING',
      'text=Request indexing',
      'text=Request Indexing',
      '[data-label="Request indexing"]',
    ];

    let requestBtn = null;
    for (const sel of btnSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        requestBtn = el;
        break;
      }
    }

    if (!requestBtn) {
      throw new Error('Could not find "Request Indexing" button — URL may already be indexed or GSC UI changed');
    }

    await requestBtn.click();
    await page.waitForTimeout(4000);

    // Dismiss any confirmation modal
    for (const label of ['GOT IT', 'Got it', 'OK', 'Close']) {
      const btn = page.locator(`text=${label}`).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        break;
      }
    }

    await context.close();
    return { success: true, message: `Indexing requested for ${url}` };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    throw err;
  }
}

// ─── Process queue (called by /run endpoint) ──────────────────────────────────
export async function processIndexQueue(pool, agentState) {
  const { rows } = await pool.query(
    `SELECT * FROM indexing_queue
     WHERE status = 'pending' AND attempts < 3
     ORDER BY created_at ASC
     LIMIT 10`
  );

  if (rows.length === 0) {
    agentState.status = 'idle';
    agentState.lastMessage = 'Queue empty';
    return;
  }

  for (const item of rows) {
    await pool.query(
      `UPDATE indexing_queue
       SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [item.id]
    );

    try {
      await requestIndexing(item.url);

      await pool.query(
        `UPDATE indexing_queue
         SET status = 'indexed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [item.id]
      );

      agentState.lastUrl = item.url;
      agentState.lastMessage = 'Indexed successfully';
    } catch (err) {
      const status = err.message === 'needs_login' ? 'needs_login' : 'failed';

      await pool.query(
        `UPDATE indexing_queue
         SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [status, err.message, item.id]
      );

      if (err.message === 'needs_login') {
        agentState.status = 'needs_login';
        agentState.lastMessage = 'Not logged in — run Save Session';
        return;
      }

      agentState.lastMessage = `Failed: ${err.message}`;
    }
  }

  agentState.status = 'success';
  agentState.lastRun = new Date().toISOString();
}
