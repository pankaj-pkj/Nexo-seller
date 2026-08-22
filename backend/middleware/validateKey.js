const { db } = require('../db/firebase');

const KEY_RE = /^NK-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/i;

/**
 * Says which part of a key is wrong.
 *
 * A key copied by hand off a phone screen usually loses its last character, and
 * "Malformed API key" alone gives no way to tell that from a wholly wrong value.
 * Naming the short group turns it into an obvious re-copy.
 */
function describeKeyProblem(key) {
  if (!/^NK-/i.test(key)) return 'Does not start with "NK-".';

  const groups = key.slice(3).split('-');
  if (groups.length !== 3)
    return `Expected 3 groups separated by "-", found ${groups.length}.`;

  const wrongLength = groups
    .map((g, i) => ({ i: i + 1, g }))
    .filter(({ g }) => g.length !== 8);

  if (wrongLength.length) {
    return wrongLength
      .map(({ i, g }) => `Group ${i} ("${g}") has ${g.length} characters, expected 8` +
        (g.length < 8 ? ` — looks like ${8 - g.length} character(s) got cut off while copying.` : '.'))
      .join(' ');
  }

  const badChars = groups
    .map((g, i) => ({ i: i + 1, bad: [...new Set(g.split('').filter(c => !/[0-9A-F]/i.test(c)))] }))
    .filter(({ bad }) => bad.length);

  if (badChars.length)
    return badChars
      .map(({ i, bad }) => `Group ${i} contains non-hex character(s): ${bad.join(', ')} (only 0-9 and A-F are valid).`)
      .join(' ');

  return 'Does not match the expected format.';
}

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
      gateway: 'NexAPI',
      error: 'API key required',
      hint: 'Add ?key=YOUR_KEY to the request, or send it as an X-API-Key header.'
    });
  }

  // Cheap shape check first — a malformed key never costs a Firestore read.
  // The example below is deliberately real hex: an XXXX-style placeholder gets
  // pasted verbatim and then fails this very check, which reads as the upstream
  // API rejecting the caller rather than the gateway never forwarding at all.
  if (!KEY_RE.test(key)) {
    return res.status(401).json({
      success: false,
      gateway: 'NexAPI',
      error: 'Malformed API key — rejected by the NexAPI gateway, the request never reached the upstream API',
      hint: 'A key is NK- followed by three 8-character hex groups, e.g. NK-4F2A8C1D-9E7B3A2F-D6C5E4B1. Copy yours from the dashboard; do not use a placeholder.',
      received: key.length > 60 ? `${key.slice(0, 60)}… (${key.length} chars)` : key,
      problem: describeKeyProblem(key)
    });
  }

  try {
    // Single equality filter — served by Firestore's automatic single-field
    // index, so no composite index has to be created before the gateway works.
    // is_active is checked below instead of in the query.
    const snap = await db.collection('api_keys')
      .where('sub_key', '==', key.toUpperCase())
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(401).json({
        success: false,
        gateway: 'NexAPI',
        error: 'Unknown API key',
        hint: 'The key is correctly formed but is not in this gateway. Check you copied it in full, and that it belongs to this deployment.'
      });
    }

    const keyDoc  = snap.docs[0];
    const keyData = keyDoc.data();

    if (!keyData.is_active) {
      return res.status(401).json({
        success: false,
        gateway: 'NexAPI',
        error: 'API key is inactive',
        hint: 'This key was deactivated in the admin panel, or it expired. Reactivate it there or buy a new plan.'
      });
    }

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
