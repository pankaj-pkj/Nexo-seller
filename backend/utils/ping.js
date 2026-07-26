const https = require('https');
const http  = require('http');

/**
 * Self-ping Render URL every 14 minutes to prevent free-tier sleep.
 * Set RENDER_URL in .env to enable.
 */
function startAutoPing() {
  const url = process.env.RENDER_URL;
  if (!url) {
    console.log('[PING] RENDER_URL not set — auto-ping disabled');
    return;
  }

  const interval = 14 * 60 * 1000; // 14 minutes
  const lib      = url.startsWith('https') ? https : http;

  const ping = () => {
    lib.get(`${url}/health`, res => {
      console.log(`[PING] ✓ ${url}/health → ${res.statusCode}`);
    }).on('error', err => {
      console.warn('[PING] ✗ Error:', err.message);
    });
  };

  // First ping after 30 seconds, then every 14 minutes
  setTimeout(() => {
    ping();
    setInterval(ping, interval);
  }, 30_000);

  console.log(`[PING] Auto-ping enabled for ${url} every 14 min`);
}

module.exports = { startAutoPing };
