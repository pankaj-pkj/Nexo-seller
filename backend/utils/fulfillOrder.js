const { db, admin } = require('../db/firebase');
const { generateKey } = require('./keygen');

/**
 * Marks an order paid and mints its API key — the single place that turns
 * money into access.
 *
 * Two things call this: the Heleket webhook, and the polling fallback in
 * paymentSync.js. Both can fire for the same order, and Heleket itself retries
 * webhooks, so the whole thing runs in one transaction keyed on the order
 * document. Whoever gets there second sees status === 'paid' and no-ops.
 *
 * @returns {{duplicate: boolean, subKey?: string, planName?: string,
 *            expiresAt?: Date|null, email?: string}}
 */
async function fulfillOrder(orderId) {
  const payRef = db.collection('payments').doc(orderId);
  const keyRef = db.collection('api_keys').doc();

  return db.runTransaction(async tx => {
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

    return {
      duplicate: false,
      subKey,
      planName: plan.name,
      expiresAt,
      email: order.user_email
    };
  });
}

module.exports = { fulfillOrder };
