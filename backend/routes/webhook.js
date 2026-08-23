const express  = require('express');
const router   = express.Router();
const { fulfillOrder } = require('../utils/fulfillOrder');
const { verifyWebhook } = require('../utils/heleket');
const { sendKeyEmail } = require('../utils/keyEmail');

// Heleket reports an overpayment as `paid_over` — that is still a paid order.
const isPaid = s => s === 1 || ['paid', 'paid_over', 'complete', 'completed'].includes(s);

router.post('/', async (req, res) => {
  const data = req.body || {};
  console.log(`[WEBHOOK] order=${data.order_id} status=${data.status}`);

  if (!verifyWebhook(data, process.env.HELEKET_API_KEY)) {
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

    // Awaited, not fire-and-forget: on Vercel the function's execution can be
    // frozen the instant the response is sent, so anything not awaited before
    // res.json() risks never actually completing. sendKeyEmail() never throws,
    // so this can't turn a mail failure into a webhook failure.
    await sendKeyEmail(result);
    res.json({ success: true });

  } catch (err) {
    console.error('[WEBHOOK]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
