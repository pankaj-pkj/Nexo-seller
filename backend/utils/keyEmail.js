const { sendMail } = require('./mailer');
const { getTemplate, render } = require('./emailTemplate');

/** Escape values that land inside the HTML template — the key and plan name
 *  are generated/admin-set, but the email address is customer input. */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * Sends the "your key is ready" email for one fulfilled order.
 *
 * Called from three places that can mint a key — the Heleket webhook and both
 * paths in paymentSync.js — so it lives here once. Never throws: a broken
 * mail setup must never stop a key from being issued, only stop the email.
 *
 * @param {{duplicate:boolean, email?:string, subKey?:string, planName?:string,
 *          expiresAt?:Date|null, orderId?:string}} result  fulfillOrder()'s return value
 * @returns {Promise<{sent:boolean, reason?:string, skipped?:boolean}>}
 */
async function sendKeyEmail(result) {
  if (!result || result.duplicate || !result.email) return { sent: false, skipped: true };

  try {
    const tpl = await getTemplate();
    if (!tpl.enabled) return { sent: false, skipped: true };

    const base = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
    const vars = {
      email:         esc(result.email),
      key:           esc(result.subKey),
      plan:          esc(result.planName),
      expires:       result.expiresAt ? new Date(result.expiresAt).toDateString() : 'Never (Lifetime)',
      order_id:      esc(result.orderId || ''),
      dashboard_url: `${base}/dashboard.html`,
      docs_url:      `${base}/docs.html`,
      support_url:   process.env.SUPPORT_TELEGRAM_URL || 'https://t.me/WhiteHatCeo'
    };

    const outcome = await sendMail({
      to:      result.email,
      subject: render(tpl.subject, vars),
      html:    render(tpl.body_html, vars)
    });

    if (outcome.sent) console.log(`[MAIL] Key email sent to ${result.email}`);
    else if (!outcome.reason?.includes('not configured'))
      console.warn(`[MAIL] Could not email ${result.email}: ${outcome.reason}`);

    return outcome;
  } catch (err) {
    console.error('[MAIL/send]', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendKeyEmail };
