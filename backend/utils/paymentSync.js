const axios  = require('axios');
const crypto = require('crypto');
const { db } = require('../db/firebase');
const { fulfillOrder } = require('./fulfillOrder');

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

function sign(params, apiKey) {
  const sorted = Object.keys(params).sort()
    .reduce((a, k) => { a[k] = params[k]; return a; }, {});
  const b64 = Buffer.from(JSON.stringify(sorted)).toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey).digest('hex');
}

/** Asks Heleket for one order's current status. Returns null if unknown. */
async function fetchStatus(orderId) {
  const body = { order_id: orderId };
  const res  = await axios.post(
    `${(process.env.HELEKET_BASE_URL || 'https://api.heleket.com').replace(/\/+$/, '')}/v1/payment/info`,
    body,
    {
      headers: {
        merchant: process.env.HELEKET_MERCHANT,
        sign:     sign(body, process.env.HELEKET_API_KEY),
        'Content-Type': 'application/json'
      },
      timeout: 12_000,
      validateStatus: () => true
    }
  );
  return res.data?.result?.payment_status ?? res.data?.result?.status ?? null;
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

module.exports = { startPaymentSync, syncPendingPayments };
