const axios  = require('axios');
const { db } = require('../db/firebase');
const { fulfillOrder } = require('./fulfillOrder');
const { buildRequest } = require('./heleket');
const { sendKeyEmail } = require('./keyEmail');

/**
 * Safety net for the Heleket webhook.
 *
 * Webhooks get missed: the callback URL can be wrong, Render's free tier may be
 * asleep when Heleket fires, or the request just gets lost. When that happens a
 * customer has paid and has no key — the worst failure this system can have.
 *
 * So every couple of minutes we ask Heleket directly about orders still marked
 * pending, and mint keys for any that have since been paid. fulfillOrder() is
 * transactional, so this racing the webhook is harmless.
 */

const isPaid = s => s === 1 || ['paid', 'paid_over', 'complete', 'completed'].includes(s);

/** Asks Heleket for one order's current status. Returns null if unknown. */
async function fetchStatus(orderId) {
  // Same signing rule as creating a payment: sign and send the identical string.
  const { body: raw, headers } = buildRequest(
    { order_id: orderId },
    process.env.HELEKET_MERCHANT,
    process.env.HELEKET_API_KEY
  );
  const res = await axios.post(
    `${(process.env.HELEKET_BASE_URL || 'https://api.heleket.com').replace(/\/+$/, '')}/v1/payment/info`,
    raw,
    { headers, timeout: 12_000, validateStatus: () => true }
  );
  return res.data?.result?.payment_status ?? res.data?.result?.status ?? null;
}

/**
 * Checks one order against Heleket and fulfils it if it has been paid.
 * Used by the payment page's polling, so a customer gets their key the moment
 * the payment lands — no waiting on a webhook or a background sweep.
 *
 * @returns {{paid: boolean, issued: boolean}}
 */
async function checkAndFulfil(orderId) {
  if (!process.env.HELEKET_MERCHANT || !process.env.HELEKET_API_KEY)
    return { paid: false, issued: false };

  let status;
  try {
    status = await fetchStatus(orderId);
  } catch (err) {
    console.warn(`[SYNC] ${orderId}: ${err.message}`);
    return { paid: false, issued: false };
  }

  if (!isPaid(status)) return { paid: false, issued: false };

  const result = await fulfillOrder(orderId);
  if (!result.duplicate) {
    console.log(`[SYNC] ✅ ${orderId} paid — issued ${result.subKey} to ${result.email}`);
    await sendKeyEmail(result);
  }

  return { paid: true, issued: !result.duplicate };
}

/**
 * One sweep over recent pending orders.
 * @returns number of orders fulfilled
 */
async function syncPendingPayments() {
  if (!process.env.HELEKET_MERCHANT || !process.env.HELEKET_API_KEY) return 0;

  // Only look at the last 24h — older pending orders were abandoned carts
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const snap = await db.collection('payments')
    .where('status', '==', 'pending')
    .get();

  const recent = snap.docs.filter(d => {
    const at = d.data().created_at?.toDate?.();
    return !at || at > cutoff;
  });

  if (!recent.length) return 0;

  let fulfilled = 0;
  for (const doc of recent) {
    const orderId = doc.id;
    try {
      const status = await fetchStatus(orderId);
      if (!isPaid(status)) continue;

      const result = await fulfillOrder(orderId);
      if (!result.duplicate) {
        fulfilled++;
        console.log(`[SYNC] 🔁 Webhook missed ${orderId} — issued ${result.subKey} to ${result.email}`);
        await sendKeyEmail(result);
      }
    } catch (err) {
      console.warn(`[SYNC] ${orderId}: ${err.message}`);
    }
  }

  return fulfilled;
}

/** Runs a sweep every SYNC_INTERVAL_MIN minutes (default 2). */
function startPaymentSync() {
  if (!process.env.HELEKET_MERCHANT || !process.env.HELEKET_API_KEY) {
    console.log('[SYNC] Heleket not configured — payment sync disabled');
    return;
  }

  const minutes = Math.max(1, Number(process.env.SYNC_INTERVAL_MIN) || 2);
  const run = () => syncPendingPayments()
    .then(n => { if (n) console.log(`[SYNC] Recovered ${n} payment(s)`); })
    .catch(e => console.error('[SYNC]', e.message));

  setTimeout(run, 45_000);                       // let the app finish booting
  setInterval(run, minutes * 60 * 1000).unref();
  console.log(`[SYNC] Payment fallback active — checking pending orders every ${minutes} min`);
}

module.exports = { startPaymentSync, syncPendingPayments, checkAndFulfil };
