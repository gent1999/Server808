import pool from "../config/db.js";
import Stripe from "stripe";
import { sendOwnerNotification, sendCustomerConfirmation } from "../utils/email.js";
import { processStripeEvent } from "../utils/stripeWebhookCore.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Conditional UPDATEs: the WHERE clause re-checks the session match and the
// current status inside the database, so concurrent or repeated deliveries of
// the same event can change the row (and send the emails) at most once.
export function createPgWebhookStore(db) {
  return {
    async find(id) {
      const { rows } = await db.query(
        'SELECT id, stripe_session_id, payment_status FROM music_submissions WHERE id = $1',
        [id]
      );
      return rows[0] || null;
    },

    async markCompleted(match, data) {
      const { rows } = await db.query(
        `UPDATE music_submissions
           SET payment_status = 'completed',
               payment_amount = $1,
               payment_id = $2,
               stripe_session_id = $3,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
           AND payment_status IS DISTINCT FROM 'completed'
           AND (stripe_session_id = $3 OR ($5::boolean AND stripe_session_id IS NULL))
         RETURNING *`,
        [data.amountTotal, data.paymentIntentId, match.sessionId, match.id, match.allowMissingStoredSession]
      );
      return rows[0] || null;
    },

    async markAbandoned(match) {
      // Only touch it if it's still pending -- never clobber a completed payment.
      const { rowCount } = await db.query(
        `UPDATE music_submissions
           SET payment_status = 'abandoned', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND payment_status = 'pending'
           AND (stripe_session_id = $2 OR ($3::boolean AND stripe_session_id IS NULL))`,
        [match.id, match.sessionId, match.allowMissingStoredSession]
      );
      return rowCount === 1;
    },
  };
}

async function notifyCompleted(sub) {
  // Must be awaited, not fire-and-forget -- on Vercel's serverless runtime the
  // function execution can freeze the instant the response is sent.
  await Promise.all([
    sendOwnerNotification({ ...sub }).catch(err => console.error('Owner email error:', err.message)),
    sendCustomerConfirmation({ ...sub }).catch(err => console.error('Customer email error:', err.message)),
  ]);
}

// ── @route POST /api/stripe/webhook ─────────────────────────────────────────────
// Mounted in server.js with express.raw() BEFORE the global express.json()
// parser -- Stripe's signature check needs the exact raw request body, not
// a re-serialized JSON object. This is the ONLY place a submission is ever
// marked "completed"; the client redirect back from Checkout is purely
// cosmetic and never writes payment_status itself.
export function createStripeWebhookHandler({ constructEvent, store, notifyCompleted: notify }) {
  return async function stripeWebhookHandler(req, res) {
    let event;
    try {
      event = constructEvent(req.body, req.headers['stripe-signature']);
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      const outcome = await processStripeEvent(event, { store, notifyCompleted: notify });
      if (outcome.startsWith('ignored_') && outcome !== 'ignored_event_type') {
        // IDs only -- no customer data in logs.
        console.warn(`Stripe webhook ${event.id} (${event.type}) acknowledged without changes: ${outcome}`);
      }
      res.json({ received: true });
    } catch (error) {
      // Database errors: 500 so Stripe retries later (the conditional updates
      // make the retry safe).
      console.error('Error handling Stripe webhook:', error.message);
      res.status(500).json({ message: 'Webhook handler error' });
    }
  };
}

const handleStripeWebhook = createStripeWebhookHandler({
  constructEvent: (rawBody, signature) =>
    stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET),
  store: createPgWebhookStore(pool),
  notifyCompleted,
});

export default handleStripeWebhook;
