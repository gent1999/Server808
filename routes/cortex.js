import express from 'express';
import pool from '../config/db.js';
import adminAuth from '../middleware/auth.js';
import { bothAuth } from '../middleware/engineAuth.js';

const router = express.Router();
const dualAuth = bothAuth(adminAuth);

// ── GET /api/cortex/status ────────────────────────────────────────────────────
// Last cortex run event + whether a pending run request is queued.
router.get('/status', dualAuth, async (req, res) => {
  try {
    const [lastRunResult, pendingResult] = await Promise.all([
      pool.query(
        `SELECT * FROM engine_items
         WHERE type = 'event' AND agent = 'cortex' AND status IN ('completed','failed')
         ORDER BY created_at DESC LIMIT 1`
      ),
      pool.query(
        `SELECT id FROM engine_items
         WHERE type = 'event' AND agent = 'cortex' AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`
      ),
    ]);

    const last = lastRunResult.rows[0] || null;
    res.json({
      lastRun:        last?.created_at  || null,
      lastStatus:     last?.status      || null,
      lastResult:     last?.metadata    || null,
      hasPendingRun:  pendingResult.rows.length > 0,
      pendingRunId:   pendingResult.rows[0]?.id || null,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch cortex status' });
  }
});

// ── GET /api/cortex/summary ───────────────────────────────────────────────────
// High-priority and recent ideas/warnings for dashboard widgets.
router.get('/summary', dualAuth, async (req, res) => {
  try {
    const [ideasResult, eventsResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT ei.*, a.title AS article_title
         FROM engine_items ei
         LEFT JOIN articles a ON a.id = ei.article_id
         WHERE ei.type = 'idea' AND ei.status = 'open'
         ORDER BY
           CASE ei.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
           ei.confidence_score DESC NULLS LAST,
           ei.created_at DESC
         LIMIT 5`
      ),
      pool.query(
        `SELECT * FROM engine_items
         WHERE type = 'event' AND agent = 'cortex' AND status IN ('completed','failed')
         ORDER BY created_at DESC LIMIT 1`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE type='idea' AND status='open')            AS open_ideas,
           COUNT(*) FILTER (WHERE type='idea' AND status='approved')        AS approved_ideas,
           COUNT(*) FILTER (WHERE type='idea' AND status='open' AND priority IN ('high','critical')) AS high_priority,
           COUNT(*) FILTER (WHERE type='event' AND created_at > NOW() - INTERVAL '24 hours') AS events_24h
         FROM engine_items`
      ),
    ]);

    res.json({
      topIdeas:    ideasResult.rows,
      lastRun:     eventsResult.rows[0] || null,
      stats:       statsResult.rows[0],
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch cortex summary' });
  }
});

// ── POST /api/cortex/run ──────────────────────────────────────────────────────
// Creates a pending run request that the local 808-engine will pick up.
// If ENGINE_LOCAL_URL is set, also tries to trigger immediately.
router.post('/run', adminAuth, async (req, res) => {
  try {
    // Check if a pending request already exists (avoid double-queueing)
    const existing = await pool.query(
      `SELECT id FROM engine_items
       WHERE type = 'event' AND agent = 'cortex' AND status = 'pending'
       LIMIT 1`
    );
    if (existing.rows.length > 0) {
      return res.json({ ok: true, queued: true, message: 'Cortex run already pending — local engine will pick it up shortly.' });
    }

    await pool.query(
      `INSERT INTO engine_items (type, agent, status, title, priority)
       VALUES ('event','cortex','pending','Cortex run requested by admin','medium')`
    );

    // Optionally ping local engine for immediate triggering
    const localUrl = process.env.ENGINE_LOCAL_URL;
    if (localUrl) {
      try {
        const { default: https } = await import('https');
        const { default: http  } = await import('http');
        const protocol = localUrl.startsWith('https') ? https : http;
        await new Promise((resolve) => {
          const req = protocol.request(`${localUrl}/api/cortex/run`, { method: 'POST', timeout: 3000 });
          req.on('response', resolve);
          req.on('error', resolve); // fail silently
          req.end();
        });
      } catch {}
    }

    res.json({ ok: true, queued: true, message: 'Cortex run queued. Local engine will pick it up within 2 minutes.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to queue cortex run' });
  }
});

// ── GET /api/cortex/pending ───────────────────────────────────────────────────
// Called by local 808-engine to check for pending run requests.
router.get('/pending', dualAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id FROM engine_items
       WHERE type = 'event' AND agent = 'cortex' AND status = 'pending'
       ORDER BY created_at ASC LIMIT 1`
    );
    res.json({ pending: result.rows.length > 0, id: result.rows[0]?.id || null });
  } catch (err) {
    res.json({ pending: false });
  }
});

// ── PATCH /api/cortex/pending/:id/claim ──────────────────────────────────────
// Local engine calls this to mark a pending request as picked up.
router.patch('/pending/:id/claim', dualAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE engine_items SET status = 'completed', title = 'Cortex run request claimed', updated_at = NOW()
       WHERE id = $1 AND agent = 'cortex' AND status = 'pending'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

export default router;
