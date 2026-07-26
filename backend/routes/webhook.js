const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { db, admin } = require('../db/firebase');
const { generateKey } = require('../utils/keygen');

/**
 * Heleket signature:  md5( base64( json(sorted params without `sign`) ) + API_KEY )
 * Compared in constant time so a wrong signature can't be probed byte by byte.
 */
function verifySign(body, apiKey) {
  const { sign, ...rest } = body;
  if (!sign || !apiKey) return false;

  const sorted = Object.keys(rest).sort()
    .reduce((a, k) => { a[k] = rest[k]; return a; }, {});
  const b64      = Buffer.from(JSON.stringify(sorted)).toString('base64');
  const expected = crypto.createHash('md5').update(b64 + apiKey).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(sign));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Heleket reports an overpayment as `paid_over` — that is still a paid order.
const isPaid = s => s === 1 || ['paid', 'paid_over', 'complete', 'completed'].includes(s);

router.post('/', async (req, res) => {
  const data = req.body || {};
  console.log(`[WEBHOOK] order=${data.order_id} status=${data.status}`);

  if (!verifySign(data, process.env.HELEKET_API_KEY)) {
    console.warn('[WEBHOOK] Bad signature — ignored');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (!isPaid(data.status))
    return res.json({ message: `Status "${data.status}" is not paid, ignored` });

  const orderId = data.order_id;
  if (!orderId) return res.status(400).json({ error: 'No order_id' });

  try {
    const payRef = db.collection('payments').doc(orderId);
    const keyRef = db.collection('api_keys').doc();

    // One transaction for the whole thing: a webhook Heleket retries (or fires
    // twice) can never mint a second key for the same order.
    const result = await db.runTransaction(async tx => {
      const payDoc = await tx.get(payRef);
      if (!payDoc.exists) throw Object.assign(new Error('Order not found'), { status: 404 });

      const order = payDoc.data();
      if (order.status === 'paid') return { duplicate: true };

      const planDoc = await tx.get(db.collection('plans').doc(order.plan_id));
      if (!planDoc.exists) throw Object.assign(new Error(`Plan "${order.plan_id}" not found`), { status: 404 });
      const plan = planDoc.data();

      // duration_days null/undefined = lifetime, never expires
      let expiresAt = null;
      if (plan.duration_days !== null && plan.duration_days !== undefined) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + Number(plan.duration_days));
      }

      const subKey = generateKey();
      tx.set(keyRef, {
        user_email:     order.user_email,
        sub_key:        subKey,
        plan_id:        order.plan_id,
        plan_name:      plan.name,
        plan_color:     plan.color || '#6366F1',
        api_target:     plan.api_target || 'api1',
        expires_at:     expiresAt,                          // null = lifetime
        requests_used:  0,
        requests_limit: plan.requests_limit ?? null,        // null = unlimited
        is_active:      true,
        payment_id:     orderId,
        last_used:      null,
        created_at:     admin.firestore.FieldValue.serverTimestamp()
      });
      tx.update(payRef, {
        status:  'paid',
        paid_at: admin.firestore.FieldValue.serverTimestamp()
      });

      return { duplicate: false, subKey, planName: plan.name, expiresAt, email: order.user_email };
    });

    if (result.duplicate) {
      console.log(`[WEBHOOK] ${orderId} already processed — no-op`);
      return res.json({ success: true, message: 'Already processed' });
    }

    const exp = result.expiresAt ? result.expiresAt.toDateString() : 'Never (Lifetime)';
    console.log(`[WEBHOOK] ✅ ${result.subKey} → ${result.email} | ${result.planName} | Expires: ${exp}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[WEBHOOK]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
