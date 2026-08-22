const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const crypto   = require('crypto');
const { v4: uuid } = require('uuid');
const { db, admin } = require('../db/firebase');

function heleket_sign(params, apiKey) {
  const sorted = Object.keys(params).sort()
    .reduce((a, k) => { a[k] = params[k]; return a; }, {});
  const b64 = Buffer.from(JSON.stringify(sorted)).toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey).digest('hex');
}

// POST /api/payment/create — 10 invoices per IP per 10 min is plenty
const createLimit = require('../middleware/rateLimit')({
  windowMs: 10 * 60_000, max: 10, message: 'Too many payment attempts, try again shortly'
});

router.post('/create', createLimit, async (req, res) => {
  const plan_id = String(req.body?.plan_id || '').trim();
  const email   = String(req.body?.email || '').trim().toLowerCase();

  if (!plan_id || !email)
    return res.status(400).json({ success: false, error: 'plan_id and email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return res.status(400).json({ success: false, error: 'Invalid email' });

  for (const v of ['HELEKET_MERCHANT', 'HELEKET_API_KEY', 'HELEKET_BASE_URL', 'BACKEND_URL']) {
    if (!process.env[v])
      return res.status(500).json({ success: false, error: `Payments not configured (${v} missing)` });
  }

  // In single-deploy mode pay.html sits on the backend itself, so the return
  // URL can be derived — one less env var to get wrong.
  const returnBase = process.env.HELEKET_RETURN
    || `${(process.env.FRONTEND_URL || process.env.BACKEND_URL).replace(/\/+$/, '')}/pay.html`;

  try {
    const planDoc = await db.collection('plans').doc(plan_id).get();
    if (!planDoc.exists)
      return res.status(404).json({ success: false, error: 'Plan not found' });

    const plan = planDoc.data();
    if (plan.is_active === false)
      return res.status(410).json({ success: false, error: 'This plan is no longer available' });
    if (!(Number(plan.price_usd) > 0))
      return res.status(500).json({ success: false, error: 'Plan has no valid price' });

    const orderId = `NX${uuid().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
    const payRef  = db.collection('payments').doc(orderId);

    const returnUrl = new URL(returnBase);
    returnUrl.searchParams.set('order_id', orderId);
    returnUrl.searchParams.set('email', email);

    // Write the pending order *before* calling Heleket. If we did it the other
    // way round and the write failed, the customer could pay against an order
    // the webhook can't find — and never get a key.
    await payRef.set({
      order_id:   orderId,
      user_email: email,
      plan_id:    plan_id,
      plan_name:  plan.name,
      amount:     Number(plan.price_usd),
      currency:   'USDT',
      status:     'pending',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    const body = {
      amount:       Number(plan.price_usd).toString(),
      currency:     'USDT',
      order_id:     orderId,
      url_return:   returnUrl.toString(),
      url_callback: `${process.env.BACKEND_URL.replace(/\/+$/, '')}/api/webhook`,
      comment:      `NexAPI ${plan.name} Plan`
    };

    const sign = heleket_sign(body, process.env.HELEKET_API_KEY);

    let hRes;
    try {
      hRes = await axios.post(
        `${process.env.HELEKET_BASE_URL.replace(/\/+$/, '')}/v1/payment`,
        body,
        { headers: { merchant: process.env.HELEKET_MERCHANT, sign, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
    } catch (e) {
      await payRef.update({ status: 'failed' }).catch(() => {});
      throw e;
    }

    if (hRes.data?.state !== 0 || !hRes.data?.result?.url) {
      await payRef.update({ status: 'failed' }).catch(() => {});
      throw new Error(hRes.data?.message || 'Heleket did not return a payment URL');
    }

    await payRef.update({ heleket_payment_id: hRes.data.result.uuid || null });

    console.log(`[PAYMENT] ${orderId} | ${email} | ${plan.name} | $${plan.price_usd}`);
    res.json({ success: true, payment_url: hRes.data.result.url, order_id: orderId });

  } catch (err) {
    // Label the source. An unattributed message like "Api not active." reads as
    // a fault in this app or in the upstream API being resold, when it is
    // actually the payment provider rejecting the merchant credentials.
    const fromHeleket = Boolean(err.response?.data?.message);
    const raw = err.response?.data?.message || err.message;
    const msg = fromHeleket
      ? `Heleket rejected the request: "${raw}". Check HELEKET_MERCHANT / HELEKET_API_KEY, and that API access is switched on in your Heleket dashboard.`
      : raw;

    console.error('[PAYMENT]', fromHeleket ? `heleket: ${raw}` : raw);
    res.status(502).json({ success: false, error: msg, source: fromHeleket ? 'heleket' : 'gateway' });
  }
});

/**
 * GET /api/payment/status/:orderId
 *
 * The payment page polls this while it waits. It asks Heleket directly about
 * the order and mints the key the moment Heleket says paid — so the customer
 * gets their key even if the webhook never fires and even on a serverless host
 * where no background poller can run.
 *
 * Throttled because it is public and each call hits Heleket.
 */
const statusLimit = require('../middleware/rateLimit')({
  windowMs: 60_000, max: 40, message: 'Slow down'
});

router.get('/status/:orderId', statusLimit, async (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  if (!/^NX[0-9A-F]{1,20}$/i.test(orderId))
    return res.status(400).json({ success: false, error: 'Invalid order id' });

  try {
    const payDoc = await db.collection('payments').doc(orderId).get();
    if (!payDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });

    const order = payDoc.data();
    if (order.status === 'paid')
      return res.json({ success: true, status: 'paid', already: true });

    // Still pending locally — ask Heleket whether that is still true
    const { checkAndFulfil } = require('../utils/paymentSync');
    const result = await checkAndFulfil(orderId);

    res.json({
      success: true,
      status:  result.paid ? 'paid' : (order.status || 'pending'),
      issued:  Boolean(result.issued)
    });
  } catch (err) {
    console.error('[PAYMENT/status]', err.message);
    res.status(500).json({ success: false, error: 'Could not check payment status' });
  }
});

module.exports = router;
