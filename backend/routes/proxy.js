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

/** Env config for one upstream slot. */
function upstream(n) {
  return {
    slot: `api${n}`,
    // Optional: an upstream you own may not need a key at all
    key:  process.env[`REAL_API_KEY_${n}`] || '',
    // The query param the upstream expects the key in (key / apikey / token …)
    keyParam: process.env[`REAL_API_KEY_PARAM_${n}`] || 'key',
    base: (process.env[`REAL_API_BASE_URL_${n}`] || '').replace(/\/+$/, ''),
    // Override per upstream if the real API uses a different path
    path: process.env[`REAL_API_PATH_${n}`] || '/admin/paid/key'
  };
}

/**
 * Which upstreams a key hits.
 *   'api1' | 'api2' → one upstream, response passed through untouched
 *   'both'          → both upstreams in parallel, responses merged
 */
function targetsFor(apiTarget) {
  if (apiTarget === 'both' || apiTarget === 'combined') return [upstream(1), upstream(2)];
  return [upstream(apiTarget === 'api2' ? 2 : 1)];
}

/** Calls one upstream and normalises the outcome — never throws. */
async function callUpstream(up, params) {
  const started = Date.now();
  try {
    // Only inject a key when one is configured — some upstreams are open
    const outgoing = up.key ? { [up.keyParam]: up.key, ...params } : { ...params };
    const r = await client.get(`${up.base}${up.path}`, { params: outgoing });
    return {
      slot: up.slot,
      ok: r.status >= 200 && r.status < 400,
      status: r.status,
      data: r.data,
      headers: r.headers,
      ms: Date.now() - started
    };
  } catch (err) {
    const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
    return {
      slot: up.slot,
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut ? 'Upstream timeout' : err.message,
      ms: Date.now() - started
    };
  }
}

/**
 * Combines several upstream responses into one payload.
 *
 * `data` is a shallow merge of every successful JSON object — that is what a
 * customer calling one endpoint expects to get back. The untouched per-API
 * responses stay under `sources`, so nothing is lost when the two APIs return
 * the same field name and one overwrites the other.
 */
function combine(results) {
  const sources = {};
  const failed  = [];
  let merged = {};

  for (const r of results) {
    if (r.ok) {
      sources[r.slot] = r.data;
      if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
        merged = { ...merged, ...r.data };
      }
    } else {
      sources[r.slot] = { error: r.error || `Upstream returned ${r.status}`, status: r.status };
      failed.push(r.slot);
    }
  }

  return { merged, sources, failed };
}

/**
 * GET /admin/paid/key?key=USER_SUB_KEY&num=PHONE_NUMBER&...
 *
 * 1. validateKey middleware checks the sub-key
 * 2. Strip user's key, inject the real API key(s)
 * 3. Forward all other params (num, etc.) to the real API
 * 4. Increment usage counter + log in Firebase
 * 5. Return the real API's response (merged, for 'both' plans)
 */
router.get('/paid/key', validateKey, async (req, res) => {
  const { keyDoc, keyData } = req;

  // Build forward params — drop the sub-key, the real one is injected below
  const fwdParams = { ...req.query };
  delete fwdParams.key;

  const targets = targetsFor(keyData.api_target);

  // Only the base URL is mandatory — the key is optional
  const unconfigured = targets.filter(t => !t.base);
  if (unconfigured.length) {
    const slots = unconfigured.map(t => t.slot.slice(-1));
    console.error(`[PROXY] not configured: ${unconfigured.map(t => t.slot).join(', ')}`);
    return res.status(500).json({
      success: false,
      error: `Real API not configured. Set ${slots.map(n => `REAL_API_BASE_URL_${n}`).join(' and ')} in the environment`
    });
  }

  const started = Date.now();
  const results = await Promise.all(targets.map(t => callUpstream(t, fwdParams)));
  const anyOk   = results.some(r => r.ok);

  // A call only burns quota if at least one upstream actually answered.
  if (anyOk) {
    const used  = (keyData.requests_used || 0) + 1;
    const limit = keyData.requests_limit;

    res.set('X-Gateway',       'NexAPI');
    res.set('X-Plan',          keyData.plan_name || 'Unknown');
    res.set('X-Requests-Used', String(used));
    res.set('X-Requests-Left', limit != null ? String(Math.max(0, limit - used)) : 'unlimited');
    res.set('X-Response-Time', `${Date.now() - started}ms`);
    res.set('X-Sources',       results.filter(r => r.ok).map(r => r.slot).join(',') || 'none');

    const failedSlots = results.filter(r => !r.ok).map(r => r.slot);
    if (failedSlots.length) res.set('X-Sources-Failed', failedSlots.join(','));

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
        status:     Math.max(...results.map(r => r.status)),
        sources:    results.map(r => `${r.slot}:${r.status}`).join(','),
        ip:         req.ip,
        ms:         Date.now() - started,
        timestamp:  admin.firestore.FieldValue.serverTimestamp()
      })
    ]).catch(e => console.error('[LOG]', e.message));
  } else {
    res.set('X-Gateway', 'NexAPI');
    res.set('X-Upstream-Error', '1');   // not counted against the quota
  }

  // ── Single upstream: pass the response through untouched ────
  if (results.length === 1) {
    const r = results[0];
    if (!r.ok && r.error) {
      return res.status(r.status).json({
        success: false,
        error:   r.status === 504 ? 'Upstream timeout' : 'Gateway error',
        message: r.error
      });
    }
    const ctype = r.headers?.['content-type'];
    if (ctype) res.type(ctype);
    return res.status(r.status).send(r.data);
  }

  // ── Combined plan: merge both upstreams into one payload ────
  const { merged, sources, failed } = combine(results);

  if (!anyOk) {
    console.error('[PROXY] all upstreams failed:', failed.join(', '));
    return res.status(502).json({ success: false, error: 'All upstream APIs failed', sources });
  }

  return res.status(200).json({
    success: true,
    partial: failed.length > 0,        // true = one API answered, the other didn't
    data:    merged,
    sources
  });
});

module.exports = router;
