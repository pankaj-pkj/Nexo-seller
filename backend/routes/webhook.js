const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { fulfillOrder } = require('../utils/fulfillOrder');

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
    const result = await fulfillOrder(orderId);

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
