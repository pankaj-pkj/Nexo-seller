const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const { db, identity } = require('../db/firebase');
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

// GET /api/admin/diagnostics — why can't we reach Firestore?
//
// A Firestore failure arrives as a bare code (PERMISSION_DENIED, NOT_FOUND)
// with no hint about which project the credentials point at or what to fix.
// This does one real read and one real write, then maps the code to the thing
// that actually needs changing.
router.get('/diagnostics', adminAuth, async (req, res) => {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  record('credentials_loaded', Boolean(identity.projectId),
    identity.projectId ? `project: ${identity.projectId}` : 'no credentials resolved');
  record('credentials_source', true, identity.source);
  record('service_account', Boolean(identity.clientEmail),
    identity.clientEmail || 'missing client_email');

  let firestoreError = null;

  try {
    await db.collection('plans').limit(1).get();
    record('firestore_read', true, 'read succeeded');
  } catch (err) {
    firestoreError = err;
    record('firestore_read', false, `${err.code ?? '?'} ${err.message}`);
  }

  if (!firestoreError) {
    try {
      const ref = db.collection('_diagnostics').doc('probe');
      await ref.set({ at: new Date() });
      await ref.delete();
      record('firestore_write', true, 'write + delete succeeded');
    } catch (err) {
      firestoreError = err;
      record('firestore_write', false, `${err.code ?? '?'} ${err.message}`);
    }
  }

  // gRPC status codes: 7 = PERMISSION_DENIED, 5 = NOT_FOUND, 16 = UNAUTHENTICATED
  let diagnosis = null;
  let fixes = [];

  if (firestoreError) {
    const code = firestoreError.code;
    const msg  = String(firestoreError.message || '');

    if (/has not been used in project|is disabled/i.test(msg)) {
      // Google is explicit about this one, so handle it before the generic case
      diagnosis = `The Cloud Firestore API is not enabled for project "${identity.projectId}".`;
      fixes = [
        `Enable it here, then wait a minute and retry: https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=${identity.projectId}`
      ];
    } else if (code === 7 || /PERMISSION_DENIED/i.test(msg)) {
      // Code 7 means the key authenticated fine but the identity lacks rights.
      // A wrong project would fail earlier as UNAUTHENTICATED or NOT_FOUND, so
      // the IAM role is the overwhelmingly likely cause — lead with it.
      diagnosis = `The key for project "${identity.projectId}" is valid, but this service account has no permission to use Firestore.`;
      fixes = [
        `Grant the role: open https://console.cloud.google.com/iam-admin/iam?project=${identity.projectId} → click "Grant access" → paste ${identity.clientEmail} as the principal → choose the role "Cloud Datastore User" → Save. Wait ~1 minute, then retry.`,
        `If that account is not listed on the IAM page at all, its role was removed. Adding it back with "Cloud Datastore User" fixes it.`,
        `Also confirm the Firestore API is on: https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=${identity.projectId}`,
        'Security Rules are NOT the cause — the Admin SDK bypasses them, so allow/deny in Rules makes no difference here.',
        'Quickest escape hatch: create a brand-new Firebase project, enable Firestore, generate a fresh service-account key, and replace FIREBASE_SERVICE_ACCOUNT. New projects get the correct IAM automatically.'
      ];
    } else if (code === 5 || /NOT_FOUND/i.test(msg)) {
      diagnosis = `No Firestore database found in project "${identity.projectId}".`;
      fixes = [
        'Firebase console → Build → Firestore Database → Create database.',
        'It must be the "(default)" database; a named database is not used here.'
      ];
    } else if (code === 16 || /UNAUTHENTICATED/i.test(msg)) {
      diagnosis = 'The private key was rejected.';
      fixes = [
        'The pasted JSON is truncated or its private_key newlines were mangled. Re-copy the whole file and paste it again.'
      ];
    } else {
      diagnosis = 'Firestore returned an error we do not have a specific hint for.';
      fixes = ['See the raw detail on the failing check above.'];
    }
  }

  res.json({
    success: !firestoreError,
    project: identity.projectId,
    service_account: identity.clientEmail,
    checks,
    diagnosis,
    fixes
  });
});

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

// ── Plan management ───────────────────────────────────────────

/** Turns a plan name into a Firestore doc id: "Pro Plan 3" → "pro-plan-3" */
const slugify = s => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

/** Duration in days from a {value, unit} pair. Lifetime → null. */
function toDays(value, unit) {
  if (unit === 'lifetime') return null;
  const n = Math.max(1, Math.floor(Number(value) || 1));
  return unit === 'year' ? n * 365 : unit === 'month' ? n * 30 : unit === 'week' ? n * 7 : n;
}

// GET /api/admin/plans — every plan, including inactive ones
router.get('/plans', adminAuth, async (req, res) => {
  try {
    const snap = await db.collection('plans').get();
    const plans = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/plans — create or update a plan
router.post('/plans', adminAuth, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();

  if (!name)
    return res.status(400).json({ success: false, error: 'Plan name is required' });

  const price = Number(b.price_usd);
  if (!(price > 0))
    return res.status(400).json({ success: false, error: 'Price must be greater than 0' });

  const unit = ['day', 'week', 'month', 'year', 'lifetime'].includes(b.duration_unit)
    ? b.duration_unit : 'day';

  // Blank / 0 / "unlimited" all mean no request cap
  const rawLimit = b.requests_limit;
  const requestsLimit = (rawLimit === '' || rawLimit === null || rawLimit === undefined || Number(rawLimit) <= 0)
    ? null
    : Math.floor(Number(rawLimit));

  const id = String(b.id || '').trim() || slugify(name);
  if (!id) return res.status(400).json({ success: false, error: 'Could not derive an id from that name' });

  try {
    const ref      = db.collection('plans').doc(id);
    const existing = await ref.get();

    // Keep a stable position: existing plans hold their slot, new ones go last
    let order = Number(b.order);
    if (!Number.isFinite(order)) {
      if (existing.exists) order = existing.data().order ?? 99;
      else {
        const all = await db.collection('plans').get();
        order = all.size + 1;
      }
    }

    const durationDays = toDays(b.duration_value, unit);
    const features = Array.isArray(b.features)
      ? b.features.map(f => String(f).trim()).filter(Boolean)
      : String(b.features || '').split('\n').map(f => f.trim()).filter(Boolean);

    const data = {
      name,
      price_usd:      price,
      duration_days:  durationDays,                 // null = lifetime
      duration_unit:  unit,                         // kept for the edit form
      duration_value: unit === 'lifetime' ? null : Math.max(1, Math.floor(Number(b.duration_value) || 1)),
      requests_limit: requestsLimit,                // null = unlimited
      description:    String(b.description || '').trim(),
      features:       features.length ? features : [
        requestsLimit ? `${requestsLimit.toLocaleString('en-US')} API Requests` : 'Unlimited API Requests',
        durationDays ? `${durationDays} Day Access` : 'Never Expires'
      ],
      api_target:     ['api1', 'api2', 'both'].includes(b.api_target) ? b.api_target : (process.env.DEFAULT_API_TARGET || 'api1'),
      color:          /^#[0-9A-Fa-f]{6}$/.test(b.color || '') ? b.color : '#6366F1',
      is_active:      b.is_active !== false,
      order
    };

    if (existing.exists) {
      await ref.update(data);
    } else {
      await ref.set({ ...data, created_at: new Date() });
    }

    statsCache = { at: 0, data: null };
    console.log(`[ADMIN] Plan ${existing.exists ? 'updated' : 'created'}: ${id} ($${price})`);
    res.json({ success: true, id, plan: data, created: !existing.exists });
  } catch (err) {
    console.error('[ADMIN/plans]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/plans/:id
// Existing keys keep working — they carry their own limits and expiry, so
// removing a plan only stops new purchases of it.
router.delete('/plans/:id', adminAuth, async (req, res) => {
  try {
    const ref  = db.collection('plans').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Plan not found' });

    await ref.delete();
    statsCache = { at: 0, data: null };
    console.log(`[ADMIN] Plan deleted: ${req.params.id}`);
    res.json({ success: true, message: `Plan "${snap.data().name}" deleted. Existing keys are unaffected.` });
  } catch (err) {
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
