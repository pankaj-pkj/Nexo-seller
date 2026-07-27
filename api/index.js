/**
 * Vercel serverless entry point.
 *
 * vercel.json rewrites every request here, so this one function serves the API,
 * the gateway and the static pages alike. It loads the Express app only — no
 * cron, no pollers, no listen() — because a serverless process is frozen
 * between requests and any timer would simply never fire. The scheduled work
 * lives behind /api/cron/* instead, driven by Vercel Cron.
 */
module.exports = require('../backend/app');
