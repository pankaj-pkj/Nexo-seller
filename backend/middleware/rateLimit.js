/**
 * Tiny in-memory sliding-window rate limiter.
 * No Redis / no extra deps — good enough for a single Render instance.
 */
function rateLimit({ windowMs = 60_000, max = 10, message = 'Too many requests' } = {}) {
  const hits = new Map();   // ip → number[] (timestamps)

  // Drop stale buckets every window so the map cannot grow forever
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, stamps] of hits) {
      const live = stamps.filter(t => t > cutoff);
      if (live.length) hits.set(ip, live);
      else hits.delete(ip);
    }
  }, windowMs);
  sweeper.unref?.();

  return (req, res, next) => {
    const ip     = req.ip || req.connection?.remoteAddress || 'unknown';
    const cutoff = Date.now() - windowMs;
    const stamps = (hits.get(ip) || []).filter(t => t > cutoff);

    if (stamps.length >= max) {
      const retryAfter = Math.ceil((stamps[0] + windowMs - Date.now()) / 1000);
      res.set('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({ success: false, error: message, retry_after: retryAfter });
    }

    stamps.push(Date.now());
    hits.set(ip, stamps);
    next();
  };
}

module.exports = rateLimit;
