import pool from "../config/db.js";
import Stripe from "stripe";
import { sendOwnerNotification, sendCustomerConfirmation } from "../utils/email.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── @route POST /api/stripe/webhook ─────────────────────────────────────────────
// Mounted in server.js with express.raw() BEFORE the global express.json()
// parser -- Stripe's signature check needs the exact raw request body, not
// a re-serialized JSON object. This is the ONLY place a submission is ever
// marked "completed"; the client redirect back from Checkout is purely
// cosmetic and never writes payment_status itself.
export default async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const submissionId = session.metadata?.submission_id;

      if (submissionId) {
        const { rows } = await pool.query(
          `UPDATE music_submissions
             SET payment_status = 'completed',
                 payment_amount = $1,
                 payment_id = $2,
                 stripe_session_id = $3,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING *`,
          [session.amount_total, session.payment_intent, session.id, submissionId]
        );

        const sub = rows[0];
        if (sub) {
          // Must be awaited, not fire-and-forget -- on Vercel's serverless
          // runtime the function execution can freeze the instant the
          // response is sent, killing an in-flight Resend call before it
          // ever reaches the network.
          await Promise.all([
            sendOwnerNotification({ ...sub }).catch(err => console.error('Owner email error:', err.message)),
            sendCustomerConfirmation({ ...sub }).catch(err => console.error('Customer email error:', err.message)),
          ]);
        }
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const submissionId = session.metadata?.submission_id;

      if (submissionId) {
        // Only touch it if it's still pending -- never clobber a completed payment.
        await pool.query(
          `UPDATE music_submissions
             SET payment_status = 'abandoned', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND payment_status = 'pending'`,
          [submissionId]
        );
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling Stripe webhook:', error.message);
    res.status(500).json({ message: 'Webhook handler error' });
  }
}
