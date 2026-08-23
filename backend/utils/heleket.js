const crypto = require('crypto');

/**
 * Heleket request signing.
 *
 * The rule is: sign the *exact bytes* you POST. Heleket recomputes the
 * signature over the raw body it receives, so the string you sign and the
 * string you send have to be byte-for-byte identical.
 *
 * Two things trip up a naive implementation, and both are reproduced here to
 * match Heleket's PHP backend (and a known-good reference bot):
 *   1. Do NOT reorder the keys. PHP's json_encode keeps insertion order; sorting
 *      them produces a different string and therefore a different signature.
 *   2. Escape forward slashes as `\/`. PHP's json_encode does this by default,
 *      and the URLs in the body (url_return, url_callback) are full of slashes.
 *
 *   sign = md5( base64( bodyString ) + API_KEY )
 */

/** Serialises a body object the way Heleket's PHP side does. */
function encodeBody(bodyObj) {
  // Compact separators (no spaces) + PHP-style forward-slash escaping.
  return JSON.stringify(bodyObj).replace(/\//g, '\\/');
}

/** md5(base64(bodyString) + apiKey) over the exact string being sent. */
function signString(bodyString, apiKey) {
  const b64 = Buffer.from(bodyString, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64 + apiKey).digest('hex');
}

/**
 * Builds everything an axios POST to Heleket needs.
 * Returns the raw body STRING (send this verbatim — do not hand axios the
 * object, or it will re-serialise it and break the signature) and the headers.
 */
function buildRequest(bodyObj, merchant, apiKey) {
  const body = encodeBody(bodyObj);
  return {
    body,
    headers: {
      merchant,
      sign: signString(body, apiKey),
      'Content-Type': 'application/json'
    }
  };
}

/**
 * Verifies an incoming webhook signature.
 *
 * Heleket signs the callback the same way: md5(base64(json(payload w/o sign)))
 * over its own PHP json_encode output — insertion order, slashes escaped. We
 * rebuild the candidate string the same way and compare in constant time.
 */
function verifyWebhook(payload, apiKey) {
  const { sign, ...rest } = payload || {};
  if (!sign || !apiKey) return false;

  const expected = signString(encodeBody(rest), apiKey);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sign));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { encodeBody, signString, buildRequest, verifyWebhook };
