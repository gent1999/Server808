import express from 'express';
import pool from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Create table + add new tracking columns if not already present
pool.query(`
  CREATE TABLE IF NOT EXISTS indexing_queue (
    id            SERIAL PRIMARY KEY,
    article_id    INTEGER,
    url           TEXT NOT NULL,
    status        VARCHAR(30) DEFAULT 'pending',
    attempts      INTEGER DEFAULT 0,
    error_message TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at  TIMESTAMP
  )
`).then(() => pool.query(`
  ALTER TABLE indexing_queue
    ADD COLUMN IF NOT EXISTS source                   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS article_title            TEXT,
    ADD COLUMN IF NOT EXISTS current_step             VARCHAR(30),
    ADD COLUMN IF NOT EXISTS sitemap_status           VARCHAR(40),
    ADD COLUMN IF NOT EXISTS inspection_status        VARCHAR(40),
    ADD COLUMN IF NOT EXISTS request_indexing_status  VARCHAR(40),
    ADD COLUMN IF NOT EXISTS screenshot_path          TEXT
`)).catch(err => console.error('[Indexer] Schema init error:', err.message));

// ── GET /api/indexer/status ───────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const [pending, recent] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM indexing_queue WHERE status = 'pending'"),
      pool.query(`SELECT url, status, completed_at, error_message
                  FROM indexing_queue ORDER BY updated_at DESC LIMIT 1`),
    ]);
    const last = recent.rows[0] || null;
    res.json({
      queueCount:  parseInt(pending.rows[0].count),
      lastUrl:     last?.url || null,
      lastStatus:  last?.status || null,
      lastMessage: last?.error_message || null,
      completedAt: last?.completed_at || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/indexer/queue ────────────────────────────────────────────────────
router.get('/queue', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM indexing_queue ORDER BY created_at DESC LIMIT 50'
    );
    res.json({ queue: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/indexer/enqueue ─────────────────────────────────────────────────
router.post('/enqueue', auth, async (req, res) => {
  const { url, articleId, title, source } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO indexing_queue (url, article_id, article_title, source)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM indexing_queue
         WHERE url = $1 AND status IN ('pending', 'running', 'indexed')
       )
       RETURNING *`,
      [url, articleId || null, title || null, source || 'manual']
    );
    if (rows.length === 0) {
      return res.json({ message: 'Already queued or indexed', skipped: true });
    }
    res.json({ message: 'Enqueued', item: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/indexer/recent ───────────────────────────────────────────────────
router.get('/recent', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, url, article_title, source, status, current_step,
              sitemap_status, inspection_status, request_indexing_status,
              error_message, screenshot_path, attempts,
              created_at, updated_at, completed_at
       FROM indexing_queue
       ORDER BY updated_at DESC
       LIMIT 20`
    );
    res.json({ jobs: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/indexer/test-enqueue ───────────────────────────────────────────
// Dev helper — enqueues a dummy URL to test the full auto-indexing flow
router.post('/test-enqueue', auth, async (req, res) => {
  const url = req.body.url || `https://cry808.com/article/test-${Date.now()}`;
  try {
    const { rows } = await pool.query(
      'INSERT INTO indexing_queue (url, article_id) VALUES ($1, NULL) RETURNING *',
      [url]
    );
    console.log('[Indexer] Test enqueue:', url);
    res.json({ message: 'Test item enqueued', item: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/indexer/queue/:id ─────────────────────────────────────────────
router.patch('/queue/:id', auth, async (req, res) => {
  const { id } = req.params;
  const {
    status, errorMessage, attempts,
    current_step, sitemap_status, inspection_status,
    request_indexing_status, screenshot_path,
  } = req.body;
  try {
    const completedAt = ['indexed', 'failed', 'needs_login'].includes(status)
      ? 'CURRENT_TIMESTAMP' : 'NULL';
    await pool.query(
      `UPDATE indexing_queue
       SET status                   = COALESCE($1,  status),
           error_message            = COALESCE($2,  error_message),
           attempts                 = COALESCE($3,  attempts),
           current_step             = COALESCE($4,  current_step),
           sitemap_status           = COALESCE($5,  sitemap_status),
           inspection_status        = COALESCE($6,  inspection_status),
           request_indexing_status  = COALESCE($7,  request_indexing_status),
           screenshot_path          = COALESCE($8,  screenshot_path),
           completed_at             = ${completedAt},
           updated_at               = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [
        status || null, errorMessage || null, attempts || null,
        current_step || null, sitemap_status || null,
        inspection_status || null, request_indexing_status || null,
        screenshot_path || null, id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
