// Isolated tests for the Stripe webhook hardening (Server808). No network,
// no real Stripe keys, no real database: events are built locally, signed with
// a throwaway test secret via Stripe's own generateTestHeaderString, and
// applied to an in-memory store. The optional DB suite at the bottom runs the
// real SQL against a THROWAWAY PostgreSQL only when TEST_DATABASE_URL is set.
// Run: npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import Stripe from 'stripe';

// routes/stripeWebhook.js constructs a Stripe client and a pg Pool at import
// time; give them inert values (never used for API calls or connections here).
process.env.STRIPE_SECRET_KEY ||= 'sk_test_unit_tests_only';
const TEST_DB = process.env.TEST_DATABASE_URL;

const { processStripeEvent, STRIPE_SOURCE } = await import('../utils/stripeWebhookCore.js');
const { createStripeWebhookHandler, createPgWebhookStore } = await import('../routes/stripeWebhook.js');

function memoryStore(rows, { failFind = false } = {}) {
  const db = new Map(rows.map((r) => [String(r.id), { ...r }]));
  const sessionOk = (r, m) => r.stripe_session_id === m.sessionId || (m.allowMissingStoredSession && r.stripe_session_id == null);
  return {
    db,
    store: {
      async find(id) {
        if (failFind) throw new Error('database unavailable');
        const r = db.get(String(id));
        return r ? { id: r.id, stripe_session_id: r.stripe_session_id, payment_status: r.payment_status } : null;
      },
      async markCompleted(m, d) {
        const r = db.get(String(m.id));
        if (!r || r.payment_status === 'completed' || !sessionOk(r, m)) return null;
        Object.assign(r, { payment_status: 'completed', payment_amount: d.amountTotal, payment_id: d.paymentIntentId, stripe_session_id: m.sessionId });
        return { ...r };
      },
      async markAbandoned(m) {
        const r = db.get(String(m.id));
        if (!r || r.payment_status !== 'pending' || !sessionOk(r, m)) return false;
        r.payment_status = 'abandoned';
        return true;
      },
    },
  };
}

let seq = 0;
function checkoutEvent(type, s) {
  return {
    id: `evt_test_${++seq}`,
    object: 'event',
    type,
    data: {
      object: {
        id: s.id,
        object: 'checkout.session',
        metadata: s.metadata ?? {},
        payment_status: s.payment_status ?? (type === 'checkout.session.completed' ? 'paid' : 'unpaid'),
        amount_total: s.amount_total ?? 500,
        payment_intent: s.payment_intent === undefined ? 'pi_test_1' : s.payment_intent,
      },
    },
  };
}
const pending = (id, session) => ({ id, stripe_session_id: session, payment_status: 'pending', payment_amount: 500, payment_id: null });

async function run(rows, events) {
  const m = memoryStore(rows);
  const notified = [];
  const deps = { store: m.store, notifyCompleted: async (r) => { notified.push(r); } };
  const outcomes = [];
  for (const e of events) outcomes.push(await processStripeEvent(e, deps));
  return { outcomes, db: m.db, notified };
}

describe('processStripeEvent (Server808)', () => {
  test('source tag is server808', () => assert.equal(STRIPE_SOURCE, 'server808'));

  test('legitimate completed payment (tagged) completes and notifies once', async () => {
    const r = await run([pending(7, 'cs_live_a')], [checkoutEvent('checkout.session.completed', { id: 'cs_live_a', metadata: { submission_id: '7', submission_type: 'priority', source: 'server808' }, payment_intent: 'pi_a' })]);
    assert.deepEqual(r.outcomes, ['completed']);
    assert.equal(r.db.get('7').payment_status, 'completed');
    assert.equal(r.db.get('7').payment_id, 'pi_a');
    assert.equal(r.notified.length, 1);
  });

  test('legacy session (no source) completes when the stored session ID matches', async () => {
    const r = await run([pending(3, 'cs_legacy')], [checkoutEvent('checkout.session.completed', { id: 'cs_legacy', metadata: { submission_id: '3', submission_type: 'genius' } })]);
    assert.deepEqual(r.outcomes, ['completed']);
  });

  test('duplicate delivery: no second update or email', async () => {
    const e = checkoutEvent('checkout.session.completed', { id: 'cs_dup', metadata: { submission_id: '5', source: 'server808' } });
    const r = await run([pending(5, 'cs_dup')], [e, e, e]);
    assert.deepEqual(r.outcomes, ['completed', 'duplicate', 'duplicate']);
    assert.equal(r.notified.length, 1);
  });

  test('concurrent duplicates complete exactly once', async () => {
    const m = memoryStore([pending(6, 'cs_conc')]);
    const notified = [];
    const deps = { store: m.store, notifyCompleted: async (x) => { notified.push(x); } };
    const e = checkoutEvent('checkout.session.completed', { id: 'cs_conc', metadata: { submission_id: '6' } });
    const outcomes = await Promise.all([1, 2, 3].map(() => processStripeEvent(e, deps)));
    assert.equal(outcomes.filter((o) => o === 'completed').length, 1);
    assert.equal(notified.length, 1);
  });

  test('cross-backend event (source serverheat) with a colliding ID changes nothing', async () => {
    const r = await run([pending(2, 'cs_ours')], [checkoutEvent('checkout.session.completed', { id: 'cs_theirs', metadata: { submission_id: '2', source: 'serverheat' } })]);
    assert.deepEqual(r.outcomes, ['ignored_other_source']);
    assert.equal(r.db.get('2').payment_status, 'pending');
    assert.equal(r.notified.length, 0);
  });

  test('cross-backend LEGACY event (no source) with a colliding ID is rejected by the session check', async () => {
    const r = await run([pending(2, 'cs_ours')], [checkoutEvent('checkout.session.completed', { id: 'cs_theirs', metadata: { submission_id: '2' } })]);
    assert.deepEqual(r.outcomes, ['ignored_session_mismatch']);
    assert.equal(r.db.get('2').payment_status, 'pending');
  });

  test('incorrect session ID (even with our tag) changes nothing', async () => {
    const r = await run([pending(4, 'cs_real')], [checkoutEvent('checkout.session.completed', { id: 'cs_forged', metadata: { submission_id: '4', source: 'server808' } })]);
    assert.deepEqual(r.outcomes, ['ignored_session_mismatch']);
    assert.equal(r.db.get('4').payment_status, 'pending');
  });

  test('NULL stored session: legacy event rejected, our tagged session accepted', async () => {
    const r = await run([pending(8, null), pending(9, null)], [
      checkoutEvent('checkout.session.completed', { id: 'cs_x', metadata: { submission_id: '8' } }),
      checkoutEvent('checkout.session.completed', { id: 'cs_new', metadata: { submission_id: '9', source: 'server808' } }),
    ]);
    assert.deepEqual(r.outcomes, ['ignored_session_mismatch', 'completed']);
    assert.equal(r.db.get('8').payment_status, 'pending');
    assert.equal(r.db.get('9').stripe_session_id, 'cs_new');
  });

  test('unknown / missing / malformed submission IDs change nothing', async () => {
    const r = await run([pending(1, 'cs_1')], [
      checkoutEvent('checkout.session.completed', { id: 'cs_1', metadata: { submission_id: '999' } }),
      checkoutEvent('checkout.session.completed', { id: 'cs_1', metadata: {} }),
      checkoutEvent('checkout.session.completed', { id: 'cs_1', metadata: { submission_id: "1 OR 1=1" } }),
    ]);
    assert.deepEqual(r.outcomes, ['ignored_unknown_submission', 'ignored_no_submission_id', 'ignored_no_submission_id']);
    assert.equal(r.db.get('1').payment_status, 'pending');
  });

  test('completed-but-unpaid session leaves the submission pending', async () => {
    const r = await run([pending(10, 'cs_async')], [checkoutEvent('checkout.session.completed', { id: 'cs_async', metadata: { submission_id: '10' }, payment_status: 'unpaid' })]);
    assert.deepEqual(r.outcomes, ['ignored_unpaid']);
    assert.equal(r.db.get('10').payment_status, 'pending');
  });

  test('expired: pending -> abandoned; completed never clobbered; foreign/wrong session ignored', async () => {
    const done = { ...pending(12, 'cs_paid'), payment_status: 'completed' };
    const r = await run([pending(11, 'cs_exp'), done, pending(13, 'cs_ours13')], [
      checkoutEvent('checkout.session.expired', { id: 'cs_exp', metadata: { submission_id: '11', source: 'server808' } }),
      checkoutEvent('checkout.session.expired', { id: 'cs_paid', metadata: { submission_id: '12' } }),
      checkoutEvent('checkout.session.expired', { id: 'cs_theirs', metadata: { submission_id: '13', source: 'serverheat' } }),
      checkoutEvent('checkout.session.expired', { id: 'cs_theirs', metadata: { submission_id: '13' } }),
    ]);
    assert.deepEqual(r.outcomes, ['abandoned', 'not_pending', 'ignored_other_source', 'ignored_session_mismatch']);
    assert.equal(r.db.get('11').payment_status, 'abandoned');
    assert.equal(r.db.get('12').payment_status, 'completed');
    assert.equal(r.db.get('13').payment_status, 'pending');
  });

  test('unrelated event types (e.g. the PaymentIntent flow) are ignored', async () => {
    const r = await run([pending(14, 'cs_14')], [checkoutEvent('payment_intent.succeeded', { id: 'pi_x', metadata: { submission_id: '14' } })]);
    assert.deepEqual(r.outcomes, ['ignored_event_type']);
  });
});

describe('HTTP webhook endpoint with real Stripe signature verification (Server808)', () => {
  const secret = 'whsec_unit_test_' + 'y'.repeat(24);
  const stripe = new Stripe('sk_test_unit_tests_only');
  let server; let base = ''; let mem; const notified = [];

  before(async () => {
    mem = memoryStore([pending(21, 'cs_http_ok'), pending(22, 'cs_http_ours')]);
    const failing = memoryStore([], { failFind: true });
    const constructEvent = (body, sig) => stripe.webhooks.constructEvent(body, sig, secret);
    const app = express();
    app.post('/hook', express.raw({ type: 'application/json' }), createStripeWebhookHandler({ constructEvent, store: mem.store, notifyCompleted: async (r) => { notified.push(r); } }));
    app.post('/hook-dberror', express.raw({ type: 'application/json' }), createStripeWebhookHandler({ constructEvent, store: failing.store, notifyCompleted: async () => {} }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(() => r())));

  const post = (path, payload, signature) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'Stripe-Signature': signature } : {}) }, body: payload });
  const signed = (payload) => stripe.webhooks.generateTestHeaderString({ payload, secret });

  test('valid signature + legitimate event -> 200 and completed', async () => {
    const payload = JSON.stringify(checkoutEvent('checkout.session.completed', { id: 'cs_http_ok', metadata: { submission_id: '21', source: 'server808' } }));
    const r = await post('/hook', payload, signed(payload));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { received: true });
    assert.equal(mem.db.get('21').payment_status, 'completed');
    assert.equal(notified.length, 1);
  });

  test("valid signature + ServerHeat's event -> 200 acknowledged, nothing changed", async () => {
    const payload = JSON.stringify(checkoutEvent('checkout.session.completed', { id: 'cs_other', metadata: { submission_id: '22', source: 'serverheat' } }));
    assert.equal((await post('/hook', payload, signed(payload))).status, 200);
    assert.equal(mem.db.get('22').payment_status, 'pending');
  });

  test('tampered body / missing signature / wrong secret -> 400', async () => {
    const good = JSON.stringify(checkoutEvent('checkout.session.completed', { id: 'cs_http_ours', metadata: { submission_id: '22' } }));
    assert.equal((await post('/hook', good.replace('cs_http_ours', 'cs_http_ours '), signed(good))).status, 400);
    assert.equal((await post('/hook', good)).status, 400);
    assert.equal((await post('/hook', good, stripe.webhooks.generateTestHeaderString({ payload: good, secret: 'whsec_other_endpoint_secret_000000' }))).status, 400);
    assert.equal(mem.db.get('22').payment_status, 'pending');
  });

  test('database error -> 500 so Stripe retries later', async () => {
    const payload = JSON.stringify(checkoutEvent('checkout.session.completed', { id: 'cs_z', metadata: { submission_id: '1' } }));
    assert.equal((await post('/hook-dberror', payload, signed(payload))).status, 500);
  });
});

describe('pg webhook store against a throwaway database', { skip: !TEST_DB && 'TEST_DATABASE_URL not set' }, () => {
  let pool; let store; const ids = {}; const notified = [];
  before(async () => {
    if (!/@(localhost|127\.0\.0\.1|ah-webhook-testdb)[:/]/.test(TEST_DB)) throw new Error('TEST_DATABASE_URL must point at a local throwaway database');
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: TEST_DB, max: 6 });
    // Real schema: the music_submissions table from db.sql + its migrations.
    const dbsql = fs.readFileSync(new URL('../db.sql', import.meta.url), 'utf8');
    const create = dbsql.match(/CREATE TABLE IF NOT EXISTS music_submissions \([\s\S]*?\n\);/)[0];
    await pool.query(create);
    for (const f of ['add_soundcloud_to_submissions.sql', 'add-submission-fields.sql', 'add-stripe-checkout-session.sql']) {
      await pool.query(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    }
    store = createPgWebhookStore(pool);
    const mk = async (key, session, status = 'pending') => {
      const { rows } = await pool.query(
        `INSERT INTO music_submissions (artist_name, email, content, submission_type, payment_amount, payment_status, stripe_session_id)
         VALUES ('Test', 'test@example.invalid', 'x', 'priority', 500, $1, $2) RETURNING id`, [status, session]);
      ids[key] = String(rows[0].id);
    };
    await mk('ok', 'cs_db_ok'); await mk('conc', 'cs_db_conc'); await mk('other', 'cs_db_ours');
    await mk('nullstored', null); await mk('paid', 'cs_db_paid', 'completed'); await mk('exp', 'cs_db_exp');
  });
  after(async () => { await pool?.query("DELETE FROM music_submissions WHERE email = 'test@example.invalid'"); await pool?.end(); });

  const deps = () => ({ store, notifyCompleted: async (r) => { notified.push(r); } });
  const status = async (k) => (await pool.query('SELECT payment_status FROM music_submissions WHERE id = $1', [ids[k]])).rows[0].payment_status;
  const ev = (type, id, metadata, payment_status = 'paid') => checkoutEvent(type, { id, metadata, payment_status });

  test('legitimate completion updates once; duplicate is a no-op', async () => {
    const e = ev('checkout.session.completed', 'cs_db_ok', { submission_id: ids.ok, source: 'server808' });
    assert.equal(await processStripeEvent(e, deps()), 'completed');
    assert.equal(await processStripeEvent(e, deps()), 'duplicate');
    assert.equal(await status('ok'), 'completed');
  });

  test('concurrent deliveries: conditional UPDATE lets exactly one through', async () => {
    const e = ev('checkout.session.completed', 'cs_db_conc', { submission_id: ids.conc });
    const n0 = notified.length;
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => processStripeEvent(e, deps())));
    assert.equal(outcomes.filter((o) => o === 'completed').length, 1);
    assert.equal(notified.length - n0, 1);
  });

  test('SQL WHERE rejects a wrong session ID even when called directly', async () => {
    assert.equal(await store.markCompleted({ id: ids.other, sessionId: 'cs_else', allowMissingStoredSession: false }, { amountTotal: 500, paymentIntentId: 'pi' }), null);
    assert.equal(await store.markAbandoned({ id: ids.other, sessionId: 'cs_else', allowMissingStoredSession: false }), false);
    assert.equal(await status('other'), 'pending');
  });

  test('cross-backend events and NULL-session rules', async () => {
    assert.equal(await processStripeEvent(ev('checkout.session.completed', 'cs_x', { submission_id: ids.other, source: 'serverheat' }), deps()), 'ignored_other_source');
    assert.equal(await processStripeEvent(ev('checkout.session.completed', 'cs_x', { submission_id: ids.other }), deps()), 'ignored_session_mismatch');
    assert.equal(await processStripeEvent(ev('checkout.session.completed', 'cs_n', { submission_id: ids.nullstored }), deps()), 'ignored_session_mismatch');
    assert.equal(await processStripeEvent(ev('checkout.session.completed', 'cs_n', { submission_id: ids.nullstored, source: 'server808' }), deps()), 'completed');
    assert.equal(await status('other'), 'pending');
  });

  test('expiry: pending -> abandoned; completed never clobbered', async () => {
    assert.equal(await processStripeEvent(ev('checkout.session.expired', 'cs_db_exp', { submission_id: ids.exp }, 'unpaid'), deps()), 'abandoned');
    assert.equal(await processStripeEvent(ev('checkout.session.expired', 'cs_db_paid', { submission_id: ids.paid }, 'unpaid'), deps()), 'not_pending');
    assert.equal(await status('exp'), 'abandoned');
    assert.equal(await status('paid'), 'completed');
  });
});
