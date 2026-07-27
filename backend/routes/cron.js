const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

/**
 * Endpoints for scheduled work on hosts that can't keep timers running.
 *
 * On Render, server.js handles all of this in-process and these routes go
 * unused. On Vercel the process is frozen between requests, so Vercel Cron
 * calls these instead (see the `crons` block in vercel.json).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The admin
 * token is also accepted so you can trigger a run by hand while debugging.
 */
function cronAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const admin  = req.headers['x-admin-token'] || req.query.admin_token || '';

  const allowed = [process.env.CRON_SECRET, process.env.ADMIN_SECRET].filter(Boolean);
  const supplied = [bearer, admin].filter(Boolean);

  const ok = allowed.some(a => supplied.some(s => {
    const A = Buffer.from(String(a)), S = Buffer.from(String(s));
    return A.length === S.length && crypto.timingSafeEqual(A, S);
  }));

  if (!ok) return res.status(403).json({ success: false, error: 'Unauthorized' });
  next();
}

// GET /api/cron/expire — deactivate keys whose expiry has passed
router.get('/expire', cronAuth, async (req, res) => {
  try {
    const { expireKeys } = require('../utils/expiry');
    const expired = await expireKeys();
    console.log(`[CRON] Expired ${expired} keys`);
    res.json({ success: true, expired });
  } catch (err) {
    console.error('[CRON/expire]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cron/sync-payments — fulfil orders whose webhook never arrived
router.get('/sync-payments', cronAuth, async (req, res) => {
  try {
    const { syncPendingPayments } = require('../utils/paymentSync');
    const fulfilled = await syncPendingPayments();
    res.json({ success: true, fulfilled });
  } catch (err) {
    console.error('[CRON/sync]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
