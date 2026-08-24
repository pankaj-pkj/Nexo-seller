const express  = require('express');
const router   = express.Router();
const { db }   = require('../db/firebase');
const rateLimit = require('../middleware/rateLimit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE   = /^NK-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/i;

// These are public (the dashboard calls them with no login), so throttle them.
const publicLimit = rateLimit({ windowMs: 60_000, max: 60, message: 'Slow down' });

/** Public, safe view of one key document. Never echoes internal fields. */
function shapeKey(id, data) {
  const exp = data.expires_at
    ? (data.expires_at.toDate ? data.expires_at.toDate() : new Date(data.expires_at))
    : null;
  const now = new Date();
  return {
    id,
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
}

// GET /api/key/check/:subkey — status of ONE key. Safe by design: you have to
// know the key itself, so there is nothing to enumerate.
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

/**
 * POST /api/key/lookup  { email, key }
 *
 * Retrieves every key on an account — but only for someone who can prove they
 * own it, by supplying one working key that belongs to that email. Without this
 * proof anyone could enter any email and walk away with that customer's live
 * keys, so the old GET /:email (email only) was removed.
 *
 * The mismatch and not-found cases return the SAME generic message so this
 * can't be used to test which emails or keys exist.
 */
router.post('/lookup', publicLimit, async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const key   = String(req.body?.key || '').toUpperCase().trim();

  if (!EMAIL_RE.test(email) || !KEY_RE.test(key))
    return res.status(400).json({ success: false, error: 'Enter a valid email and a valid key (NK-…).' });

  const MISMATCH = { success: false, error: 'That email and key do not match. Check both, or use the key from your purchase email.' };

  try {
    const snap = await db.collection('api_keys')
      .where('sub_key', '==', key)
      .limit(1).get();

    // Key unknown, or it belongs to a different email → same answer either way.
    if (snap.empty || (snap.docs[0].data().user_email || '').toLowerCase() !== email)
      return res.status(401).json(MISMATCH);

    // Ownership proven — return the whole account's keys.
    const all = await db.collection('api_keys').where('user_email', '==', email).get();
    const keys = all.docs.map(d => shapeKey(d.id, d.data()))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.json({ success: true, count: keys.length, keys });
  } catch (err) {
    console.error('[KEYS/lookup]', err.message);
    res.status(500).json({ success: false, error: 'Could not load keys' });
  }
});

module.exports = router;
