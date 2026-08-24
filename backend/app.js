/**
 * The Express app, with no server and no background timers.
 *
 * Kept separate from server.js so it can run in both worlds:
 *   • server.js  — long-lived Node process (Render), adds cron + polling
 *   • api/index.js — Vercel serverless function, which must not start timers
 *     because the process is frozen between requests
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app = express();

// Both hosts sit behind a proxy — needed for a correct req.ip
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Gateway', 'X-Plan', 'X-Requests-Used', 'X-Requests-Left', 'X-Sources', 'X-Sources-Failed']
}));
app.use(express.json({ limit: '256kb' }));

// ── Baseline security headers ────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  next();
});

// ── Request logging (skips health so logs stay readable) ─────
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
app.use('/api/cron',    require('./routes/cron'));    // for Vercel Cron
app.use('/admin',       require('./routes/proxy'));   // /admin/paid/key

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status:    'online',
  gateway:   'NexAPI v2',
  platform:  process.env.VERCEL ? 'vercel' : 'node',
  uptime_s:  Math.floor(process.uptime()),
  timestamp: new Date().toISOString()
}));

// ── Frontend ──────────────────────────────────────────────────
// The app serves frontend/ itself, so backend and frontend deploy as one unit
// on both Render and Vercel — no separate static host, no cross-origin config.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend  = fs.existsSync(path.join(FRONTEND_DIR, 'index.html'));

if (hasFrontend) {
  app.use(express.static(FRONTEND_DIR, {
    extensions: ['html'],           // /docs → docs.html
    setHeaders: (res, filePath) => {
      // The HTML pages and the shared config/theme all change on every redeploy.
      // Left cacheable, a browser keeps serving the old admin panel after a
      // deploy — which is how a fixed bug looks unfixed. Force a revalidate.
      if (/\.html$|config\.js$|theme\.css$/.test(filePath)) res.set('Cache-Control', 'no-cache');
    }
  }));
} else {
  app.get('/', (req, res) => res.json({
    gateway: 'NexAPI v2',
    docs:    process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/docs.html` : undefined,
    health:  '/health'
  }));
}

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  // Browsers asking for a page get a page; API clients get JSON
  if (hasFrontend && req.method === 'GET' && (req.headers.accept || '').includes('text/html'))
    return res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html'));

  res.status(404).json({ success: false, error: 'Not found', path: req.originalUrl });
});

// ── Error handler (last resort — never leak a stack trace) ────
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error('[ERROR]', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ success: false, error: 'Internal server error' });
});

// ── Startup env check ─────────────────────────────────────────
const hasFirebase = process.env.FIREBASE_SERVICE_ACCOUNT ||
  (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
if (!hasFirebase) console.warn('⚠️  No Firebase credentials set — database routes will fail.');
if (!process.env.ADMIN_SECRET) console.warn('⚠️  ADMIN_SECRET not set — the admin panel will refuse to log in.');

module.exports = app;
