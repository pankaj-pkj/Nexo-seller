/**
 * Long-lived Node server (Render, or local dev).
 *
 * Everything HTTP lives in app.js. This file adds the parts that only make
 * sense in a process that stays alive: the expiry cron, the self-ping, and the
 * payment-sync poller. On Vercel, api/index.js loads app.js without any of it.
 */
const app  = require('./app');
const cron = require('node-cron');

// ── Cron: expire keys daily at midnight ──────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    const { expireKeys } = require('./utils/expiry');
    const n = await expireKeys();
    console.log(`[CRON] Expired ${n} keys`);
  } catch (e) { console.error('[CRON]', e.message); }
});

// ── Auto-ping (prevents Render free-tier sleep) ──────────────
require('./utils/ping').startAutoPing();

// ── Payment fallback: catch orders whose webhook never arrived ─
require('./utils/paymentSync').startPaymentSync();

// ── Start ─────────────────────────────────────────────────────
const PORT   = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n⚡ NexAPI Gateway v2 on port ${PORT}`);
  console.log(`   Site    → http://localhost:${PORT}`);
  console.log(`   Health  → http://localhost:${PORT}/health`);
  console.log(`   Gateway → http://localhost:${PORT}/admin/paid/key?key=NK-XXX&num=91XXXXXXXXXX\n`);
});

// ── Graceful shutdown (Render sends SIGTERM on redeploy) ─────
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`\n${sig} received — shutting down…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

process.on('unhandledRejection', err => console.error('[UNHANDLED]', err?.message || err));

module.exports = app;
