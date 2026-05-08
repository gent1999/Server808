import express from 'express';
import pool from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// ── Schema init ───────────────────────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS revenue_sources (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    type             VARCHAR(30)  DEFAULT 'manual',
    default_gross    NUMERIC(10,2) DEFAULT 0,
    fee_type         VARCHAR(20)  DEFAULT 'none',
    fee_value        NUMERIC(10,2) DEFAULT 0,
    payout_threshold NUMERIC(10,2) DEFAULT 0,
    status           VARCHAR(20)  DEFAULT 'active',
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS revenue_entries (
    id             SERIAL PRIMARY KEY,
    date           DATE NOT NULL DEFAULT CURRENT_DATE,
    source_id      INTEGER REFERENCES revenue_sources(id) ON DELETE SET NULL,
    article_title  TEXT,
    article_url    TEXT,
    client_name    TEXT,
    gross_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
    fee_amount     NUMERIC(10,2) DEFAULT 0,
    net_amount     NUMERIC(10,2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'pending',
    payout_status  VARCHAR(30) DEFAULT 'not_ready',
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS payouts (
    id         SERIAL PRIMARY KEY,
    source_id  INTEGER REFERENCES revenue_sources(id) ON DELETE SET NULL,
    amount     NUMERIC(10,2) NOT NULL,
    date       DATE NOT NULL DEFAULT CURRENT_DATE,
    notes      TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS expenses (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(200) NOT NULL,
    category       VARCHAR(30) DEFAULT 'other',
    amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
    billing_cycle  VARCHAR(20) DEFAULT 'one_time',
    vendor         TEXT,
    renewal_date   DATE,
    payment_status VARCHAR(20) DEFAULT 'paid',
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)).then(() =>
  // Seed default revenue sources if table is empty
  pool.query('SELECT COUNT(*) FROM revenue_sources').then(r => {
    if (parseInt(r.rows[0].count) === 0) {
      return pool.query(`
        INSERT INTO revenue_sources (name, type, default_gross, fee_type, fee_value, payout_threshold, status, notes) VALUES
        ('Fiverr',          'article_sale', 5.00, 'percentage', 20,   0,     'active',  'Fiverr gig — $5 gross, 20% fee = $4 net'),
        ('OneSubmit',       'article_sale', 3.00, 'none',       0,    50.00, 'active',  '$3 per article, payout threshold $50'),
        ('Adsterra',        'ad_network',   0,    'none',       0,    5.00,  'active',  'Display/pop ads'),
        ('Hilltop Ads',     'ad_network',   0,    'none',       0,    5.00,  'active',  'Pop/display ad network'),
        ('Google Ads',      'ad_network',   0,    'none',       0,    100.00,'pending', 'Pending approval'),
        ('Direct / Manual', 'manual',       0,    'none',       0,    0,     'active',  'Manual or direct payments')
      `);
    }
  })
).catch(err => console.error('[Finance] Schema init error:', err.message));

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = v => parseFloat(v || 0);

// ── GET /api/finance/summary ──────────────────────────────────────────────────
router.get('/summary', auth, async (req, res) => {
  try {
    const now   = new Date();
    const bom   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const bomlY = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const eomlY = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

    const [revRow, expRow, payoutProg, renewals] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(gross_amount),0)                                               AS total_gross,
          COALESCE(SUM(net_amount),0)                                                 AS total_net,
          COALESCE(SUM(CASE WHEN payment_status='paid'    THEN net_amount ELSE 0 END),0) AS paid_rev,
          COALESCE(SUM(CASE WHEN payment_status='pending' THEN net_amount ELSE 0 END),0) AS pending_rev,
          COALESCE(SUM(CASE WHEN date >= $1 THEN net_amount ELSE 0 END),0)            AS month_rev,
          COALESCE(SUM(CASE WHEN date >= $2 AND date <= $3 THEN net_amount ELSE 0 END),0) AS last_month_rev
        FROM revenue_entries WHERE payment_status != 'cancelled'
      `, [bom, bomlY, eomlY]),

      pool.query(`
        SELECT
          COALESCE(SUM(amount),0) AS total,
          COALESCE(SUM(CASE WHEN billing_cycle='monthly' THEN amount ELSE 0 END),0) AS monthly,
          COALESCE(SUM(CASE WHEN billing_cycle='yearly'  THEN amount/12.0 ELSE 0 END),0) AS yearly_monthly
        FROM expenses
      `),

      pool.query(`
        SELECT rs.id, rs.name, rs.payout_threshold,
          COALESCE(SUM(re.net_amount),0) AS pending_balance
        FROM revenue_sources rs
        LEFT JOIN revenue_entries re
          ON re.source_id = rs.id AND re.payout_status = 'not_ready' AND re.payment_status != 'cancelled'
        WHERE rs.payout_threshold > 0
        GROUP BY rs.id, rs.name, rs.payout_threshold
        ORDER BY rs.name
      `),

      pool.query(`
        SELECT id, name, amount, renewal_date
        FROM expenses
        WHERE renewal_date IS NOT NULL
        ORDER BY renewal_date ASC
        LIMIT 10
      `),
    ]);

    const r          = revRow.rows[0];
    const e          = expRow.rows[0];
    const totalNet   = fmt(r.total_net);
    const totalExp   = fmt(e.total);
    const monthRev   = fmt(r.month_rev);
    const monthlyExp = fmt(e.monthly) + fmt(e.yearly_monthly);

    res.json({
      totalGrossRevenue:  fmt(r.total_gross),
      totalNetRevenue:    totalNet,
      paidRevenue:        fmt(r.paid_rev),
      pendingRevenue:     fmt(r.pending_rev),
      totalExpenses:      totalExp,
      lifetimeProfit:     totalNet - totalExp,
      currentMonthRevenue: monthRev,
      lastMonthRevenue:   fmt(r.last_month_rev),
      currentMonthProfit: monthRev - monthlyExp,
      monthlyExpenses:    monthlyExp,

      payoutProgressBySource: payoutProg.rows.map(p => {
        const bal  = fmt(p.pending_balance);
        const thr  = fmt(p.payout_threshold);
        return {
          sourceId:       p.id,
          sourceName:     p.name,
          pendingBalance: bal,
          threshold:      thr,
          remaining:      Math.max(0, thr - bal),
          progress:       thr > 0 ? Math.min(100, Math.round((bal / thr) * 100)) : 100,
          ready:          bal >= thr,
        };
      }),

      upcomingRenewals: renewals.rows.map(e => ({
        id:          e.id,
        name:        e.name,
        amount:      fmt(e.amount),
        renewalDate: e.renewal_date,
        daysUntil:   Math.ceil((new Date(e.renewal_date) - new Date()) / 86_400_000),
      })).filter(e => e.daysUntil <= 90).sort((a, b) => a.daysUntil - b.daysUntil),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Revenue Sources CRUD ──────────────────────────────────────────────────────
router.get('/sources', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rs.*,
        COALESCE((SELECT SUM(re.net_amount) FROM revenue_entries re
                  WHERE re.source_id = rs.id AND re.payout_status = 'not_ready'
                    AND re.payment_status != 'cancelled'), 0)          AS current_balance,
        COALESCE((SELECT SUM(re.net_amount) FROM revenue_entries re
                  WHERE re.source_id = rs.id
                    AND re.payment_status != 'cancelled'), 0)           AS lifetime_net,
        (SELECT COUNT(*) FROM revenue_entries re
         WHERE re.source_id = rs.id)                                    AS entry_count,
        (SELECT MAX(re.date) FROM revenue_entries re
         WHERE re.source_id = rs.id)                                    AS last_entry_date
       FROM revenue_sources rs ORDER BY rs.id`
    );
    res.json({ sources: rows });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/finance/activity ─────────────────────────────────────────────────
// Combined recent activity feed across entries, payouts, and expenses
router.get('/activity', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT 'revenue' AS kind,
          re.id, re.created_at,
          CONCAT(COALESCE(rs.name,'Unknown'), ' — +', re.net_amount::text, ' net') AS label,
          re.net_amount::float AS amount,
          COALESCE(re.article_title, re.client_name, '') AS detail,
          re.payment_status AS status
        FROM revenue_entries re
        LEFT JOIN revenue_sources rs ON re.source_id = rs.id
        UNION ALL
        SELECT 'payout' AS kind,
          p.id, p.created_at,
          CONCAT(COALESCE(rs.name,'Unknown'), ' — payout ', p.amount::text) AS label,
          p.amount::float AS amount, '' AS detail, 'paid' AS status
        FROM payouts p
        LEFT JOIN revenue_sources rs ON p.source_id = rs.id
        UNION ALL
        SELECT 'expense' AS kind,
          e.id, e.created_at,
          CONCAT(e.name, ' — -', e.amount::text) AS label,
          e.amount::float AS amount,
          COALESCE(e.vendor,'') AS detail, e.payment_status AS status
        FROM expenses e
      ) combined
      ORDER BY created_at DESC
      LIMIT 15
    `);
    res.json({ activity: rows });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/sources', auth, async (req, res) => {
  const { name, type, default_gross, fee_type, fee_value, payout_threshold, status, notes } = req.body;
  if (!name) return res.status(400).json({ message: 'name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO revenue_sources (name, type, default_gross, fee_type, fee_value, payout_threshold, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, type||'manual', default_gross||0, fee_type||'none', fee_value||0, payout_threshold||0, status||'active', notes||null]
    );
    res.status(201).json({ source: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/sources/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { name, type, default_gross, fee_type, fee_value, payout_threshold, status, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE revenue_sources SET name=$1, type=$2, default_gross=$3, fee_type=$4, fee_value=$5,
         payout_threshold=$6, status=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
      [name, type, default_gross||0, fee_type, fee_value||0, payout_threshold||0, status, notes||null, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'not found' });
    res.json({ source: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/sources/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM revenue_sources WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Revenue Entries CRUD ──────────────────────────────────────────────────────
router.get('/entries', auth, async (req, res) => {
  const { source_id, payment_status, payout_status, from, to } = req.query;
  const where = ['1=1'];
  const vals  = [];
  let n = 1;
  if (source_id)      { where.push(`re.source_id=$${n++}`);      vals.push(source_id); }
  if (payment_status) { where.push(`re.payment_status=$${n++}`); vals.push(payment_status); }
  if (payout_status)  { where.push(`re.payout_status=$${n++}`);  vals.push(payout_status); }
  if (from)           { where.push(`re.date>=$${n++}`);           vals.push(from); }
  if (to)             { where.push(`re.date<=$${n++}`);           vals.push(to); }

  try {
    const { rows } = await pool.query(
      `SELECT re.*, rs.name AS source_name
       FROM revenue_entries re
       LEFT JOIN revenue_sources rs ON re.source_id = rs.id
       WHERE ${where.join(' AND ')}
       ORDER BY re.date DESC, re.created_at DESC`,
      vals
    );
    const totals = rows.reduce((acc, r) => {
      acc.gross += fmt(r.gross_amount);
      acc.fee   += fmt(r.fee_amount);
      acc.net   += fmt(r.net_amount);
      return acc;
    }, { gross: 0, fee: 0, net: 0 });
    res.json({ entries: rows, totals });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/entries', auth, async (req, res) => {
  const { date, source_id, article_title, article_url, client_name,
          gross_amount, fee_amount, net_amount, payment_status, payout_status, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO revenue_entries
        (date, source_id, article_title, article_url, client_name,
         gross_amount, fee_amount, net_amount, payment_status, payout_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [date||new Date().toISOString().split('T')[0], source_id||null,
       article_title||null, article_url||null, client_name||null,
       gross_amount||0, fee_amount||0, net_amount||0,
       payment_status||'pending', payout_status||'not_ready', notes||null]
    );
    res.status(201).json({ entry: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/entries/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { date, source_id, article_title, article_url, client_name,
          gross_amount, fee_amount, net_amount, payment_status, payout_status, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE revenue_entries SET
        date=$1, source_id=$2, article_title=$3, article_url=$4, client_name=$5,
        gross_amount=$6, fee_amount=$7, net_amount=$8, payment_status=$9,
        payout_status=$10, notes=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [date, source_id||null, article_title||null, article_url||null, client_name||null,
       gross_amount||0, fee_amount||0, net_amount||0,
       payment_status, payout_status, notes||null, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'not found' });
    res.json({ entry: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/entries/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM revenue_entries WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Payouts CRUD ──────────────────────────────────────────────────────────────
router.get('/payouts', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, rs.name AS source_name
       FROM payouts p LEFT JOIN revenue_sources rs ON p.source_id = rs.id
       ORDER BY p.date DESC, p.created_at DESC`
    );
    res.json({ payouts: rows });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/payouts', auth, async (req, res) => {
  const { source_id, amount, date, notes, mark_entries_paid } = req.body;
  if (!amount || !source_id) return res.status(400).json({ message: 'source_id and amount required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO payouts (source_id, amount, date, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [source_id, amount, date||new Date().toISOString().split('T')[0], notes||null]
    );
    // Optionally mark related not_ready entries as paid_out
    if (mark_entries_paid) {
      await pool.query(
        `UPDATE revenue_entries SET payout_status='paid_out', updated_at=NOW()
         WHERE source_id=$1 AND payout_status='not_ready'`,
        [source_id]
      );
    }
    res.status(201).json({ payout: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/payouts/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM payouts WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Expenses CRUD ─────────────────────────────────────────────────────────────
router.get('/expenses', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *, CASE WHEN renewal_date IS NOT NULL
         THEN (renewal_date - CURRENT_DATE)
         ELSE NULL END AS days_until_renewal
       FROM expenses ORDER BY renewal_date ASC NULLS LAST, created_at DESC`
    );
    const totals = rows.reduce((acc, e) => {
      acc.total += fmt(e.amount);
      if (e.billing_cycle === 'monthly') acc.monthly += fmt(e.amount);
      if (e.billing_cycle === 'yearly')  acc.yearly  += fmt(e.amount);
      return acc;
    }, { total: 0, monthly: 0, yearly: 0 });
    res.json({ expenses: rows, totals });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/expenses', auth, async (req, res) => {
  const { name, category, amount, billing_cycle, vendor, renewal_date, payment_status, notes } = req.body;
  if (!name) return res.status(400).json({ message: 'name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (name, category, amount, billing_cycle, vendor, renewal_date, payment_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, category||'other', amount||0, billing_cycle||'one_time',
       vendor||null, renewal_date||null, payment_status||'paid', notes||null]
    );
    res.status(201).json({ expense: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/expenses/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { name, category, amount, billing_cycle, vendor, renewal_date, payment_status, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET name=$1, category=$2, amount=$3, billing_cycle=$4, vendor=$5,
         renewal_date=$6, payment_status=$7, notes=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name, category||'other', amount||0, billing_cycle||'one_time',
       vendor||null, renewal_date||null, payment_status||'paid', notes||null, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'not found' });
    res.json({ expense: rows[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/expenses/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

export default router;
