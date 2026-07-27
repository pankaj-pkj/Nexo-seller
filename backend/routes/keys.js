const express  = require('express');
const router   = express.Router();
const { db }   = require('../db/firebase');
const rateLimit = require('../middleware/rateLimit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// These are public (the dashboard calls them with no auth), so throttle them.
const publicLimit = rateLimit({ windowMs: 60_000, max: 60, message: 'Slow down' });

// GET /api/key/check/:subkey — declared before /:email so it always wins
router.get('/check/:subkey', publicLimit, async (req, res) => {
  try {
    const snap = await db.collection('api_keys')
      .where('sub_key', '==', req.params.subkey)
      .limit(1).get();

    if (snap.empty) return res.status(404).json({ valid: false, error: 'Key not found' });

    const d   = snap.docs[0].data();
    const exp = d.expires_at?.toDate?.() || (d.expires_at ? new Date(d.expires_at) : null);
    const limitHit = d.requests_limit != null && (d.requests_used || 0) >= d.requests_limit;

    res.json({
      valid:          Boolean(d.is_active) && (exp ? exp > new Date() : true) && !limitHit,
      plan:           d.plan_name,
      expires_at:     exp?.toISOString() || null,
      is_lifetime:    !exp,
      requests_used:  d.requests_used || 0,
      requests_limit: d.requests_limit ?? null
    });
  } catch (err) {
    console.error('[KEYS/check]', err.message);
    res.status(500).json({ valid: false, error: 'Lookup failed' });
  }
});

// GET /api/key/:email — every key bought with that email
router.get('/:email', publicLimit, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ success: false, error: 'Invalid email' });

  try {
    // Equality filter only, then sort in JS. Adding .orderBy('created_at') here
    // would require a hand-built composite index; one customer has a handful of
    // keys, so sorting them in memory costs nothing and keeps setup index-free.
    const snap = await db.collection('api_keys')
      .where('user_email', '==', email)
      .get();

    const now  = new Date();
    const keys = snap.docs.map(d => {
      const data = d.data();
      const exp  = data.expires_at
        ? (data.expires_at.toDate ? data.expires_at.toDate() : new Date(data.expires_at))
        : null;
      // Explicit allow-list — never echo back internal fields we add later
      return {
        id:             d.id,
        sub_key:        data.sub_key,
        user_email:     data.user_email,
        plan_id:        data.plan_id,
        plan_name:      data.plan_name,
        plan_color:     data.plan_color,
        is_active:      Boolean(data.is_active),
        requests_used:  data.requests_used || 0,
        requests_limit: data.requests_limit ?? null,
        payment_id:     data.payment_id,
        expires_at:     exp ? exp.toISOString() : null,
        created_at:     data.created_at?.toDate?.()?.toISOString() || null,
        last_used:      data.last_used?.toDate?.()?.toISOString() || null,
        is_expired:     exp ? exp < now : false,
        days_left:      exp ? Math.max(0, Math.ceil((exp - now) / 86400000)) : null,
        is_lifetime:    !exp
      };
    });

    keys.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.json({ success: true, count: keys.length, keys });
  } catch (err) {
    console.error('[KEYS]', err.message);
    res.status(500).json({ success: false, error: 'Could not load keys' });
  }
});

module.exports = router;
