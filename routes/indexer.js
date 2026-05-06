import express from 'express';
import pool from '../config/db.js';
import auth from '../middleware/auth.js';
import {
  saveGoogleSession,
  testGoogleSession,
  requestIndexing,
  processIndexQueue,
} from '../services/indexer/playwrightIndexer.js';

const router = express.Router();

// In-memory agent state (resets on server restart — that's fine)
export const agentState = {
  status: 'idle',      // idle | running | success | failed | needs_login
  lastUrl: null,
  lastRun: null,
  lastMessage: null,
};

// Create table if it doesn't exist yet
pool.query(`
  CREATE TABLE IF NOT EXISTS indexing_queue (
    id          SERIAL PRIMARY KEY,
    article_id  INTEGER,
    url         TEXT NOT NULL,
    status      VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','running','indexed','failed','needs_login')),
    attempts    INTEGER DEFAULT 0,
    error_message TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
  )
`).catch(err => console.error('[Indexer] Table init error:', err.message));

// ── GET /api/indexer/status ───────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) FROM indexing_queue WHERE status = 'pending'"
    );
    res.json({ ...agentState, queueCount: parseInt(rows[0].count) });
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

// ── POST /api/indexer/run ─────────────────────────────────────────────────────
// Process all pending queue items (background, non-blocking)
router.post('/run', auth, async (req, res) => {
  if (agentState.status === 'running') {
    return res.status(409).json({ message: 'Indexer is already running' });
  }
  agentState.status = 'running';
  agentState.lastRun = new Date().toISOString();

  // Fire and forget — client polls /status
  processIndexQueue(pool, agentState)
    .catch(err => {
      agentState.status = 'failed';
      agentState.lastMessage = err.message;
    });

  res.json({ message: 'Indexer started — check /status for progress' });
});

// ── POST /api/indexer/run-url ─────────────────────────────────────────────────
// Immediately index one URL (blocking — client waits)
router.post('/run-url', auth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });

  agentState.status = 'running';
  agentState.lastRun = new Date().toISOString();

  try {
    const result = await requestIndexing(url);
    agentState.status = 'success';
    agentState.lastUrl = url;
    agentState.lastMessage = result.message;
    res.json(result);
  } catch (err) {
    agentState.status = err.message === 'needs_login' ? 'needs_login' : 'failed';
    agentState.lastMessage = err.message;
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/indexer/test-session ───────────────────────────────────────────
router.post('/test-session', auth, async (req, res) => {
  try {
    const result = await testGoogleSession();
    if (result.needsLogin) agentState.status = 'needs_login';
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/indexer/save-session ───────────────────────────────────────────
// Opens a visible browser — user logs in — session persists on disk.
// This is a long-running request (up to 5 min). Frontend should show a spinner.
router.post('/save-session', auth, async (req, res) => {
  try {
    agentState.status = 'running';
    agentState.lastMessage = 'Browser open — waiting for login...';
    const result = await saveGoogleSession();
    agentState.status = 'idle';
    agentState.lastMessage = result.message;
    res.json(result);
  } catch (err) {
    agentState.status = 'needs_login';
    agentState.lastMessage = err.message;
    res.status(500).json({ message: err.message });
  }
});

export default router;
