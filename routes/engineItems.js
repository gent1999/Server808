import express from 'express';
import pool from '../config/db.js';
import adminAuth from '../middleware/auth.js';
import { engineAuth, bothAuth } from '../middleware/engineAuth.js';

const router = express.Router();
const dualAuth = bothAuth(adminAuth);

// ── Boot migration ─────────────────────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS engine_items (
    id               SERIAL PRIMARY KEY,
    type             VARCHAR(50) NOT NULL DEFAULT 'idea'
                     CHECK (type IN ('idea','event','log','message','memory','recommendation','analytics_observation')),
    agent            VARCHAR(100),
    status           VARCHAR(50) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','approved','rejected','archived','completed','failed','pending')),
    title            TEXT NOT NULL,
    content          TEXT,
    article_id       INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    metadata         JSONB DEFAULT '{}',
    priority         VARCHAR(20) DEFAULT 'medium'
                     CHECK (priority IN ('low','medium','high','critical')),
    confidence_score NUMERIC(5,2),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_engine_items_type       ON engine_items(type);
  CREATE INDEX IF NOT EXISTS idx_engine_items_agent      ON engine_items(agent);
  CREATE INDEX IF NOT EXISTS idx_engine_items_status     ON engine_items(status);
  CREATE INDEX IF NOT EXISTS idx_engine_items_article_id ON engine_items(article_id);
  CREATE INDEX IF NOT EXISTS idx_engine_items_created_at ON engine_items(created_at DESC);
`).catch(err => console.error('engine_items migration error:', err.message));

// ── Helpers ────────────────────────────────────────────────────────────────────
function buildQuery(filters) {
  const conditions = ['1=1'];
  const values = [];
  let p = 1;

  if (filters.type)       { conditions.push(`ei.type = $${p++}`);       values.push(filters.type); }
  if (filters.agent)      { conditions.push(`ei.agent = $${p++}`);      values.push(filters.agent); }
  if (filters.status)     { conditions.push(`ei.status = $${p++}`);     values.push(filters.status); }
  if (filters.priority)   { conditions.push(`ei.priority = $${p++}`);   values.push(filters.priority); }
  if (filters.article_id) { conditions.push(`ei.article_id = $${p++}`); values.push(filters.article_id); }
  if (filters.from)       { conditions.push(`ei.created_at >= $${p++}`); values.push(filters.from); }
  if (filters.to)         { conditions.push(`ei.created_at <= $${p++}`); values.push(filters.to); }

  const limit  = Math.min(parseInt(filters.limit, 10)  || 50, 200);
  const offset = parseInt(filters.offset, 10) || 0;

  const where = conditions.join(' AND ');
  return { where, values, limit, offset, nextP: p };
}

// ── GET /api/engine-items ─────────────────────────────────────────────────────
router.get('/engine-items', dualAuth, async (req, res) => {
  try {
    const { where, values, limit, offset, nextP } = buildQuery(req.query);
    const result = await pool.query(
      `SELECT ei.*, a.title AS article_title
       FROM engine_items ei
       LEFT JOIN articles a ON a.id = ei.article_id
       WHERE ${where}
       ORDER BY ei.created_at DESC
       LIMIT $${nextP} OFFSET $${nextP + 1}`,
      [...values, limit, offset]
    );
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM engine_items ei WHERE ${where}`,
      values
    );
    res.json({ items: result.rows, total: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    console.error('GET engine-items error:', err.message);
    res.status(500).json({ message: 'Failed to fetch engine items' });
  }
});

// ── GET /api/engine-items/:id ─────────────────────────────────────────────────
router.get('/engine-items/:id', dualAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ei.*, a.title AS article_title
       FROM engine_items ei
       LEFT JOIN articles a ON a.id = ei.article_id
       WHERE ei.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch item' });
  }
});

// ── POST /api/engine-items ────────────────────────────────────────────────────
router.post('/engine-items', dualAuth, async (req, res) => {
  try {
    const { type = 'idea', agent, status = 'open', title, content, article_id,
            metadata = {}, priority = 'medium', confidence_score } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });

    const result = await pool.query(
      `INSERT INTO engine_items (type, agent, status, title, content, article_id, metadata, priority, confidence_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [type, agent, status, title.slice(0, 200), content?.slice(0, 1000),
       article_id || null, JSON.stringify(metadata), priority, confidence_score || null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error('POST engine-items error:', err.message);
    res.status(500).json({ message: 'Failed to create item' });
  }
});

// ── PATCH /api/engine-items/:id ───────────────────────────────────────────────
router.patch('/engine-items/:id', dualAuth, async (req, res) => {
  try {
    const allowed = ['status', 'title', 'content', 'metadata', 'priority', 'confidence_score', 'agent'];
    const sets = [];
    const values = [];
    let p = 1;
    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        sets.push(`${field} = $${p++}`);
        values.push(field === 'metadata' ? JSON.stringify(req.body[field]) : req.body[field]);
      }
    });
    if (sets.length === 0) return res.status(400).json({ message: 'No valid fields to update' });
    sets.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE engine_items SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update item' });
  }
});

// ── DELETE /api/engine-items/:id ──────────────────────────────────────────────
router.delete('/engine-items/:id', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM engine_items WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete item' });
  }
});

// ── GET /api/ideas ────────────────────────────────────────────────────────────
router.get('/ideas', dualAuth, async (req, res) => {
  try {
    const { where, values, limit, offset, nextP } = buildQuery({ ...req.query, type: 'idea' });
    const result = await pool.query(
      `SELECT ei.*, a.title AS article_title
       FROM engine_items ei
       LEFT JOIN articles a ON a.id = ei.article_id
       WHERE ${where}
       ORDER BY
         CASE ei.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         ei.confidence_score DESC NULLS LAST,
         ei.created_at DESC
       LIMIT $${nextP} OFFSET $${nextP + 1}`,
      [...values, limit, offset]
    );
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM engine_items ei WHERE ${where}`,
      values
    );
    res.json({ ideas: result.rows, total: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch ideas' });
  }
});

// ── POST /api/ideas ───────────────────────────────────────────────────────────
router.post('/ideas', dualAuth, async (req, res) => {
  try {
    const { agent, title, content, article_id, metadata = {}, priority = 'medium', confidence_score } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });
    const result = await pool.query(
      `INSERT INTO engine_items (type, agent, status, title, content, article_id, metadata, priority, confidence_score)
       VALUES ('idea',$1,'open',$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [agent, title.slice(0, 200), content?.slice(0, 1000), article_id || null,
       JSON.stringify(metadata), priority, confidence_score || null]
    );
    res.status(201).json({ idea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create idea' });
  }
});

// ── PATCH /api/ideas/:id/:action ──────────────────────────────────────────────
['approve', 'reject', 'archive', 'complete'].forEach(action => {
  const statusMap = { approve: 'approved', reject: 'rejected', archive: 'archived', complete: 'completed' };
  router.patch(`/ideas/:id/${action}`, adminAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE engine_items SET status = $1, updated_at = NOW()
         WHERE id = $2 AND type = 'idea' RETURNING *`,
        [statusMap[action], req.params.id]
      );
      if (!result.rows[0]) return res.status(404).json({ message: 'Idea not found' });
      res.json({ idea: result.rows[0] });
    } catch (err) {
      res.status(500).json({ message: `Failed to ${action} idea` });
    }
  });
});

// ── POST /api/agent-events ────────────────────────────────────────────────────
// Agents call this after important actions (indexed, published, scrribed, etc.)
router.post('/agent-events', dualAuth, async (req, res) => {
  try {
    const { agent, title, content, article_id, status = 'completed', priority = 'medium', metadata = {} } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });
    const result = await pool.query(
      `INSERT INTO engine_items (type, agent, status, title, content, article_id, metadata, priority)
       VALUES ('event',$1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [agent, status, title.slice(0, 200), content?.slice(0, 500), article_id || null,
       JSON.stringify(metadata), priority]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST agent-events error:', err.message);
    res.status(500).json({ message: 'Failed to log event' });
  }
});

export default router;
