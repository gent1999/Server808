import express from 'express';
import pool from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Create table if not exists (runs on server boot)
pool.query(`
  CREATE TABLE IF NOT EXISTS indexing_queue (
    id            SERIAL PRIMARY KEY,
    article_id    INTEGER,
    url           TEXT NOT NULL,
    status        VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','running','indexed','failed','needs_login')),
    attempts      INTEGER DEFAULT 0,
    error_message TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at  TIMESTAMP
  )
`).catch(err => console.error('[Indexer] Table init error:', err.message));

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
  const { url, articleId } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO indexing_queue (url, article_id) VALUES ($1, $2) RETURNING *',
      [url, articleId || null]
    );
    res.json({ message: 'Enqueued', item: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/indexer/queue/:id ─────────────────────────────────────────────
// Called by 808engine to update item status after processing
router.patch('/queue/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { status, errorMessage, attempts } = req.body;
  try {
    const completedAt = ['indexed', 'failed', 'needs_login'].includes(status)
      ? 'CURRENT_TIMESTAMP'
      : 'NULL';
    await pool.query(
      `UPDATE indexing_queue
       SET status        = COALESCE($1, status),
           error_message = $2,
           attempts      = COALESCE($3, attempts),
           completed_at  = ${completedAt},
           updated_at    = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status || null, errorMessage || null, attempts || null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
