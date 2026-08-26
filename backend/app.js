/**
 * The Express app, with no server and no background timers.
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app = express();

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
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  next();
});

// ── Request logging ──────────────────────────────────────────
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
app.use('/api/cron',    require('./routes/cron'));
app.use('/admin',       require('./routes/proxy'));
app.use('/api',         require('./routes/proxy'));

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status:    'online',
  gateway:   'NexAPI v2',
  platform:  process.env.VERCEL ? 'vercel' : 'node',
  uptime_s:  Math.floor(process.uptime()),
  timestamp: new Date().toISOString()
}));

// ── Frontend ──────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend  = fs.existsSync(path.join(FRONTEND_DIR, 'index.html'));

if (hasFrontend) {
  app.use(express.static(FRONTEND_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
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
  if (hasFrontend && req.method === 'GET' && (req.headers.accept || '').includes('text/html'))
    return res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html'));

  res.status(404).json({ success: false, error: 'Not found', path: req.originalUrl });
});

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
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
