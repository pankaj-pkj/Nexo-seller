require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');

const app = express();

// Render sits behind a proxy — needed for a correct req.ip in logs + rate limits
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Gateway', 'X-Plan', 'X-Requests-Used', 'X-Requests-Left']
}));
app.use(express.json({ limit: '256kb' }));

// ── Baseline security headers ────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  next();
});

// ── Request logging (skips auto-ping so logs stay readable) ──
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/plans',   require('./routes/plans'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/key',     require('./routes/keys'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/admin',       require('./routes/proxy'));   // /admin/paid/key

// ── Health (also used by auto-ping) ──────────────────────────
app.get('/health', (req, res) => res.json({
  status:    'online',
  gateway:   'NexAPI v2',
  uptime_s:  Math.floor(process.uptime()),
  timestamp: new Date().toISOString()
}));

app.get('/', (req, res) => res.json({
  gateway: 'NexAPI v2',
  docs:    process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/docs.html` : undefined,
  health:  '/health'
}));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found', path: req.originalUrl });
});

// ── Error handler (last resort — never leak a stack trace) ────
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error('[ERROR]', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ success: false, error: 'Internal server error' });
});

// ── Startup env check ─────────────────────────────────────────
const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'ADMIN_SECRET']
  .filter(k => !process.env[k]);
if (missing.length) console.warn(`⚠️  Missing env vars: ${missing.join(', ')} — those routes will fail.`);

// ── Cron: expire keys daily at midnight ──────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    const { expireKeys } = require('./utils/expiry');
    const n = await expireKeys();
    console.log(`[CRON] Expired ${n} keys`);
  } catch (e) { console.error('[CRON]', e.message); }
});

// ── Auto-ping Render (prevents free-tier sleep) ───────────────
require('./utils/ping').startAutoPing();

// ── Start ─────────────────────────────────────────────────────
const PORT   = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n⚡ NexAPI Gateway v2 on port ${PORT}`);
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
