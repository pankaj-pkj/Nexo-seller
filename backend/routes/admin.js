const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const { db }       = require('../db/firebase');
const rateLimit    = require('../middleware/rateLimit');

/** Constant-time string compare — no early exit to time-probe the secret against. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ── Admin auth middleware ─────────────────────────────────────
function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ success: false, error: 'ADMIN_SECRET not configured' });

  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!safeEqual(String(token || ''), secret))
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  next();
}

// POST /api/admin/login — verify password (throttled: 8 tries / 5 min / IP)
router.post('/login', rateLimit({ windowMs: 5 * 60_000, max: 8, message: 'Too many login attempts' }), (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ success: false, error: 'ADMIN_SECRET not configured' });

  const { password } = req.body || {};
  if (safeEqual(String(password || ''), secret))
    return res.json({ success: true, token: secret });

  console.warn(`[ADMIN] Failed login from ${req.ip}`);
  res.status(403).json({ success: false, error: 'Wrong password' });
});

// GET /api/admin/stats
// Reads every key + payment doc, so results are cached for 60s to stay
// well inside Firebase's 50K reads/day free tier when the panel is open.
const STATS_TTL = 60_000;
let statsCache = { at: 0, data: null };

router.get('/stats', adminAuth, async (req, res) => {
  try {
    if (statsCache.data && Date.now() - statsCache.at < STATS_TTL && req.query.fresh !== '1')
      return res.json({ ...statsCache.data, cached: true });

    const [keysSnap, paymentsSnap] = await Promise.all([
      db.collection('api_keys').get(),
      db.collection('payments').get()
    ]);

    const now      = new Date();
    const keys     = keysSnap.docs.map(d => d.data());
    const pays     = paymentsSnap.docs.map(d => d.data());
    const paidPays = pays.filter(p => p.status === 'paid');

    const totalRevenue = paidPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const activeKeys   = keys.filter(k => {
      if (!k.is_active) return false;
      if (!k.expires_at) return true;
      const exp = k.expires_at.toDate?.() || new Date(k.expires_at);
      return exp > now;
    }).length;
    const totalRequests = keys.reduce((s, k) => s + (k.requests_used || 0), 0);

    // Revenue in the trailing 30 days, for the panel's "this month" tile
    const cutoff = new Date(now.getTime() - 30 * 86400000);
    const revenue30d = paidPays.reduce((s, p) => {
      const at = p.paid_at?.toDate?.() || (p.paid_at ? new Date(p.paid_at) : null);
      return at && at > cutoff ? s + (Number(p.amount) || 0) : s;
    }, 0);

    const planBreakdown = {};
    keys.forEach(k => {
      const name = k.plan_name || 'Unknown';
      planBreakdown[name] = (planBreakdown[name] || 0) + 1;
    });

    const data = {
      success:        true,
      total_revenue:  totalRevenue,
      revenue_30d:    revenue30d,
      total_payments: paymentsSnap.size,
      paid_payments:  paidPays.length,
      total_keys:     keysSnap.size,
      active_keys:    activeKeys,
      total_requests: totalRequests,
      plan_breakdown: planBreakdown,
      generated_at:   now.toISOString()
    };

    statsCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error('[ADMIN/stats]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/keys?limit=50
router.get('/keys', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const snap  = await db.collection('api_keys')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();

    const now  = new Date();
    const keys = snap.docs.map(d => {
      const data = d.data();
      const exp  = data.expires_at?.toDate?.() || null;
      return {
        id:            d.id,
        user_email:    data.user_email,
        sub_key:       data.sub_key,
        plan_name:     data.plan_name,
        plan_color:    data.plan_color,
        expires_at:    exp?.toISOString() || null,
        is_lifetime:   !exp,
        is_active:     data.is_active,
        is_expired:    exp ? exp < now : false,
        requests_used: data.requests_used || 0,
        requests_limit:data.requests_limit,
        payment_id:    data.payment_id,
        created_at:    data.created_at?.toDate?.()?.toISOString() || null
      };
    });

    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/payments?limit=50
router.get('/payments', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const snap  = await db.collection('payments')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();

    const pays = snap.docs.map(d => {
      const data = d.data();
      return {
        order_id:   data.order_id,
        user_email: data.user_email,
        plan_name:  data.plan_name,
        amount:     data.amount,
        currency:   data.currency,
        status:     data.status,
        created_at: data.created_at?.toDate?.()?.toISOString() || null,
        paid_at:    data.paid_at?.toDate?.()?.toISOString() || null
      };
    });

    res.json({ success: true, payments: pays });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/keys/:id/deactivate  |  /activate
async function setKeyActive(req, res, isActive) {
  try {
    const ref  = db.collection('api_keys').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Key not found' });

    await ref.update({ is_active: isActive });
    statsCache = { at: 0, data: null };   // stats are stale now
    console.log(`[ADMIN] ${snap.data().sub_key} → ${isActive ? 'active' : 'inactive'}`);
    res.json({ success: true, message: `Key ${isActive ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

router.post('/keys/:id/deactivate', adminAuth, (req, res) => setKeyActive(req, res, false));
router.post('/keys/:id/activate',   adminAuth, (req, res) => setKeyActive(req, res, true));

// POST /api/admin/seed — writes the 4 default plans to Firestore.
// Exists so the project can be set up from a phone, without a terminal to run
// `npm run seed` in. Existing plans are skipped unless ?force=1.
router.post('/seed', adminAuth, async (req, res) => {
  try {
    const { seedPlans } = require('../utils/seedPlans');
    const { created, skipped } = await seedPlans({ force: req.query.force === '1' });

    statsCache = { at: 0, data: null };
    console.log(`[ADMIN] Seed → created: ${created.join(', ') || 'none'} | skipped: ${skipped.join(', ') || 'none'}`);
    res.json({
      success: true,
      created,
      skipped,
      message: created.length
        ? `Seeded ${created.length} plan(s)`
        : 'All plans already exist — nothing changed'
    });
  } catch (err) {
    console.error('[ADMIN/seed]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/keys/create — issue a key by hand, with no payment.
// Lets you test the gateway before Heleket is wired up, and hand out comp keys.
router.post('/keys/create', adminAuth, async (req, res) => {
  const email   = String(req.body?.email || '').trim().toLowerCase();
  const planId  = String(req.body?.plan_id || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success: false, error: 'Valid email required' });
  if (!planId)
    return res.status(400).json({ success: false, error: 'plan_id required' });

  try {
    const planDoc = await db.collection('plans').doc(planId).get();
    if (!planDoc.exists)
      return res.status(404).json({ success: false, error: `Plan "${planId}" not found — seed the plans first` });

    const plan = planDoc.data();
    const { generateKey } = require('../utils/keygen');
    const admin = require('../db/firebase').admin;

    let expiresAt = null;
    if (plan.duration_days !== null && plan.duration_days !== undefined) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + Number(plan.duration_days));
    }

    const subKey = generateKey();
    await db.collection('api_keys').add({
      user_email:     email,
      sub_key:        subKey,
      plan_id:        planId,
      plan_name:      plan.name,
      plan_color:     plan.color || '#6366F1',
      api_target:     plan.api_target || 'api1',
      expires_at:     expiresAt,
      requests_used:  0,
      requests_limit: plan.requests_limit ?? null,
      is_active:      true,
      payment_id:     `MANUAL-${Date.now()}`,   // marks it as issued by hand
      last_used:      null,
      created_at:     admin.firestore.FieldValue.serverTimestamp()
    });

    statsCache = { at: 0, data: null };
    console.log(`[ADMIN] Manual key ${subKey} → ${email} (${plan.name})`);
    res.json({ success: true, sub_key: subKey, plan: plan.name, email });
  } catch (err) {
    console.error('[ADMIN/keys/create]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/logs?limit=50 — recent gateway calls
router.get('/logs', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const snap  = await db.collection('usage_logs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    res.json({
      success: true,
      logs: snap.docs.map(d => {
        const l = d.data();
        return {
          id:         d.id,
          user_email: l.user_email,
          sub_key:    l.sub_key,
          plan:       l.plan,
          status:     l.status,
          params:     l.params,
          ip:         l.ip,
          timestamp:  l.timestamp?.toDate?.()?.toISOString() || null
        };
      })
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
