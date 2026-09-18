import fetch from 'node-fetch';

/**
 * Minimal PayPal Orders v2 REST client — no SDK dependency, matching how
 * other external APIs (Cloudflare purge, IndexNow) are integrated in this
 * codebase via plain fetch rather than a vendor SDK.
 *
 * Credentials are server-only env vars, never exposed to the frontend:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_ENVIRONMENT   'sandbox' | 'live'
 */

function baseUrl() {
  return process.env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal OAuth failed: ${data.error_description || response.status}`);
  }
  return data.access_token;
}

/**
 * Creates a PayPal order for a server-determined amount. The caller must
 * never pass a client-supplied amount through to this function.
 * @param {number} amount - e.g. 10.00
 * @param {string} currency - e.g. 'USD'
 * @returns {Promise<{orderId: string}>}
 */
export async function createOrder(amount, currency) {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        { amount: { currency_code: currency, value: amount.toFixed(2) } },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal create order failed: ${data.message || response.status}`);
  }
  return { orderId: data.id };
}

/**
 * Captures a previously-created order. Throws on any non-COMPLETED result
 * so callers never treat a partial/failed capture as a successful payment.
 * @param {string} orderId
 * @returns {Promise<{status: string, captureId: string, amount: string, currency: string}>}
 */
export async function captureOrder(orderId) {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();

  // The narrow race where two capture calls hit PayPal concurrently before
  // either has reached our DB idempotency check (route handler checks
  // paypal_order_id first) surfaces here as an error response -- fail loudly
  // rather than guess at a captures array that won't be present on it.
  if (!response.ok) {
    throw new Error(`PayPal capture failed: ${data.message || data.name || response.status}`);
  }

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (data.status !== 'COMPLETED' || !capture) {
    throw new Error(`PayPal order not completed (status: ${data.status})`);
  }

  return {
    status: data.status,
    captureId: capture.id,
    amount: capture.amount?.value,
    currency: capture.amount?.currency_code,
  };
}
