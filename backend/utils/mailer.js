const axios = require('axios');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Sends over Brevo's HTTPS API rather than SMTP.
 *
 * Vercel's serverless functions cannot hold an SMTP connection reliably, and
 * many hosts block outbound port 25/587 anyway. A single HTTPS POST has none
 * of that — it works the same on Vercel, Render, or a phone-configured host,
 * and needs no extra dependency (axios is already used for the upstream API
 * and Heleket).
 */
function configured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

/**
 * @param {{to: string, subject: string, html: string}} msg
 * @returns {Promise<{sent: boolean, reason?: string}>} never throws
 */
async function sendMail({ to, subject, html }) {
  if (!configured()) {
    console.warn('[MAIL] BREVO_API_KEY / MAIL_FROM not set — email skipped');
    return { sent: false, reason: 'Email not configured (BREVO_API_KEY / MAIL_FROM missing)' };
  }

  try {
    await axios.post(BREVO_URL, {
      sender:  { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'NexAPI' },
      to:      [{ email: to }],
      subject,
      htmlContent: html
    }, {
      headers: {
        'api-key':     process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept:        'application/json'
      },
      timeout: 15_000
    });
    return { sent: true };
  } catch (err) {
    // Brevo's error body names the real problem (bad key, unverified sender
    // domain, daily cap) — surface that instead of a bare "Request failed".
    const raw = err.response?.data?.message || err.message;

    // Brevo blocks API calls from an IP it hasn't seen before ("Authorized
    // IPs" security). On a serverless host the IP changes on every cold start,
    // so this can never be whitelisted — it has to be turned off in Brevo.
    // Give that instruction rather than the raw "unrecognised IP" text, which
    // reads as something the app should fix. Match on the IP wording only —
    // a wrong API key is also a 401/unauthorized, and that is NOT this.
    const looksLikeIpBlock = /unrecognis\w*\s+ip|ip address|authoriz\w*\s+ip|\bnew IP\b/i.test(raw);

    const reason = looksLikeIpBlock
      ? 'Brevo is blocking this send because the server IP is not on its authorised-IP list. ' +
        'A serverless host uses a new IP each time, so this must be turned OFF: in Brevo open ' +
        'Settings → Security → Authorized IPs and disable IP authorisation (allow all IPs). ' +
        `(Brevo said: "${raw}")`
      : raw;

    console.error('[MAIL]', raw);
    return { sent: false, reason };
  }
}

module.exports = { sendMail, configured };
