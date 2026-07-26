const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const http         = require('http');
const https        = require('https');
const { admin, db } = require('../db/firebase');
const validateKey  = require('../middleware/validateKey');

// Reuse sockets — Render's free tier is CPU-bound and TLS handshakes are the
// most expensive part of a proxied call.
const client = axios.create({
  timeout: Number(process.env.UPSTREAM_TIMEOUT_MS) || 30_000,
  httpAgent:  new http.Agent({ keepAlive: true, maxSockets: 50 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
  validateStatus: () => true,       // pass upstream errors through verbatim
  maxRedirects: 3
});

/** Which upstream a key points at, plus the path to hit on it. */
function resolveUpstream(apiTarget) {
  const n = apiTarget === 'api2' ? '2' : '1';
  return {
    key:  process.env[`REAL_API_KEY_${n}`],
    base: (process.env[`REAL_API_BASE_URL_${n}`] || '').replace(/\/+$/, ''),
    // Override per upstream if the real API uses a different path
    path: process.env[`REAL_API_PATH_${n}`] || '/admin/paid/key',
    slot: `api${n}`
  };
}

/**
 * GET /admin/paid/key?key=USER_SUB_KEY&num=PHONE_NUMBER&...
 *
 * 1. validateKey middleware checks the sub-key
 * 2. Strip user's key, inject the real API key
 * 3. Forward all other params (num, etc.) to the real API
 * 4. Increment usage counter + log in Firebase
 * 5. Return the real API's response
 */
router.get('/paid/key', validateKey, async (req, res) => {
  const { keyDoc, keyData } = req;

  // Build forward params — drop the sub-key, the real one is injected below
  const fwdParams = { ...req.query };
  delete fwdParams.key;

  const up = resolveUpstream(keyData.api_target);
  if (!up.key || !up.base) {
    console.error(`[PROXY] ${up.slot} not configured`);
    return res.status(500).json({
      success: false,
      error: `Real API not configured. Set REAL_API_KEY_${up.slot.slice(-1)} and REAL_API_BASE_URL_${up.slot.slice(-1)} in .env`
    });
  }

  const started = Date.now();
  try {
    const upstream = await client.get(`${up.base}${up.path}`, {
      params: { key: up.key, ...fwdParams }
    });

    const ok = upstream.status >= 200 && upstream.status < 400;

    // Only a successful call burns a request from the customer's quota.
    if (ok) {
      const used  = (keyData.requests_used || 0) + 1;
      const limit = keyData.requests_limit;

      res.set('X-Gateway',       'NexAPI');
      res.set('X-Plan',          keyData.plan_name || 'Unknown');
      res.set('X-Requests-Used', String(used));
      if (limit !== null && limit !== undefined)
        res.set('X-Requests-Left', String(Math.max(0, limit - used)));
      else
        res.set('X-Requests-Left', 'unlimited');
      res.set('X-Response-Time', `${Date.now() - started}ms`);

      // Fire-and-forget — never make the customer wait on our bookkeeping
      Promise.all([
        keyDoc.ref.update({
          requests_used: admin.firestore.FieldValue.increment(1),
          last_used:     admin.firestore.FieldValue.serverTimestamp()
        }),
        db.collection('usage_logs').add({
          key_id:     keyDoc.id,
          user_email: keyData.user_email,
          sub_key:    keyData.sub_key,
          plan:       keyData.plan_name,
          params:     fwdParams,
          status:     upstream.status,
          ip:         req.ip,
          ms:         Date.now() - started,
          timestamp:  admin.firestore.FieldValue.serverTimestamp()
        })
      ]).catch(e => console.error('[LOG]', e.message));
    } else {
      res.set('X-Gateway', 'NexAPI');
      res.set('X-Upstream-Error', '1');   // not counted against the quota
    }

    // Mirror the upstream content type so non-JSON APIs pass through intact
    const ctype = upstream.headers?.['content-type'];
    if (ctype) res.type(ctype);
    return res.status(upstream.status).send(upstream.data);

  } catch (err) {
    const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
    console.error('[PROXY]', up.slot, err.code || err.message);
    return res.status(timedOut ? 504 : 502).json({
      success: false,
      error:   timedOut ? 'Upstream timeout' : 'Gateway error',
      message: err.message
    });
  }
});

module.exports = router;
