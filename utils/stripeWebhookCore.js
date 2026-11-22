// Server808 shares one Stripe account with ServerHeat (ArtistHeat; also used
// by PluggPress's /submit-artistheat page). Stripe delivers every subscribed
// event in the account to EVERY webhook endpoint, and both backends number
// their submissions 1, 2, 3... in separate databases -- so an event is only
// allowed to touch a submission when it provably belongs to it:
//   1. metadata.source, when present, must be ours (sessions created before
//      the tag existed have none and fall through to rule 2);
//   2. the event's Checkout Session ID must equal the stripe_session_id we
//      stored when we created that session.
// Anything else is acknowledged with 200 (so Stripe stops retrying) and
// changes nothing. Mirrors ServerHeat's src/lib/stripeWebhookCore.ts.
export const STRIPE_SOURCE = 'server808';

const PAID_STATUSES = new Set(['paid', 'no_payment_required']);

/**
 * @param {object} event  verified Stripe event
 * @param {{ store: { find(id: string): Promise<{id: string, stripe_session_id: string|null, payment_status: string|null}|null>,
 *                    markCompleted(match: {id: string, sessionId: string, allowMissingStoredSession: boolean},
 *                                  data: {amountTotal: number, paymentIntentId: string|null}): Promise<object|null>,
 *                    markAbandoned(match: object): Promise<boolean> },
 *           notifyCompleted(row: object): Promise<void> }} deps
 * @returns {Promise<string>} outcome
 */
export async function processStripeEvent(event, deps) {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.expired') {
    return 'ignored_event_type';
  }
  const session = event.data.object;
  const source = session.metadata?.source;
  if (source && source !== STRIPE_SOURCE) return 'ignored_other_source';

  const rawId = session.metadata?.submission_id;
  if (!rawId || !/^\d{1,15}$/.test(String(rawId))) return 'ignored_no_submission_id';
  const id = String(rawId);

  const stored = await deps.store.find(id);
  if (!stored) return 'ignored_unknown_submission';

  const allowMissingStoredSession = stored.stripe_session_id == null && source === STRIPE_SOURCE;
  if (stored.stripe_session_id !== session.id && !allowMissingStoredSession) return 'ignored_session_mismatch';
  const match = { id, sessionId: session.id, allowMissingStoredSession };

  if (event.type === 'checkout.session.expired') {
    return (await deps.store.markAbandoned(match)) ? 'abandoned' : 'not_pending';
  }

  // checkout.session.completed
  if (!PAID_STATUSES.has(session.payment_status)) return 'ignored_unpaid';
  if (stored.payment_status === 'completed') return 'duplicate';
  const row = await deps.store.markCompleted(match, {
    amountTotal: session.amount_total ?? 0,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
  });
  // null = another delivery of the same event got there first (concurrent retry).
  if (!row) return 'duplicate';
  await deps.notifyCompleted(row);
  return 'completed';
}
