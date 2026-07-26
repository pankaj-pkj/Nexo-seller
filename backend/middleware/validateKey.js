const { db } = require('../db/firebase');

const KEY_RE = /^NK-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/i;

/**
 * Middleware: validates ?key=, X-API-Key, or `Authorization: Bearer …`.
 * Attaches req.keyDoc and req.keyData on success.
 */
async function validateKey(req, res, next) {
  const key = String(
    req.query.key ||
    req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  ).trim();

  if (!key) {
    return res.status(401).json({
      success: false,
      error: 'API key required',
      hint: 'Add ?key=YOUR_KEY to your request'
    });
  }

  // Cheap shape check first — a malformed key never costs a Firestore read
  if (!KEY_RE.test(key)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      hint: 'Keys look like NK-XXXXXXXX-XXXXXXXX-XXXXXXXX'
    });
  }

  try {
    const snap = await db.collection('api_keys')
      .where('sub_key', '==', key.toUpperCase())
      .where('is_active', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    const keyDoc  = snap.docs[0];
    const keyData = keyDoc.data();

    // Expiry check (null expires_at = Lifetime plan)
    if (keyData.expires_at) {
      const exp = keyData.expires_at.toDate
        ? keyData.expires_at.toDate()
        : new Date(keyData.expires_at);

      if (exp < new Date()) {
        await keyDoc.ref.update({ is_active: false });
        return res.status(401).json({
          success: false,
          error:   'API key expired',
          plan:    keyData.plan_name,
          expired_at: exp.toISOString()
        });
      }
    }

    // Request limit (null/undefined = unlimited)
    const limit = keyData.requests_limit;
    if (limit !== null && limit !== undefined && (keyData.requests_used || 0) >= limit) {
      res.set('X-Requests-Used', String(keyData.requests_used || 0));
      res.set('X-Requests-Left', '0');
      return res.status(429).json({
        success: false,
        error:   'Request limit reached for this billing period',
        used:    keyData.requests_used || 0,
        limit,
        plan:    keyData.plan_name
      });
    }

    req.keyDoc  = keyDoc;
    req.keyData = keyData;
    next();

  } catch (err) {
    console.error('[validateKey]', err.message);
    res.status(500).json({ success: false, error: 'Key validation error' });
  }
}

module.exports = validateKey;
