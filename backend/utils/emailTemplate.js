const { db } = require('../db/firebase');

// Placeholders the admin panel's editor can use — kept in one place so the
// admin UI and the renderer never fall out of sync on what is available.
const PLACEHOLDERS = [
  { tag: 'email',          desc: 'Customer email' },
  { tag: 'key',            desc: 'The issued API key' },
  { tag: 'plan',           desc: 'Plan name' },
  { tag: 'expires',        desc: 'Expiry date, or "Never (Lifetime)"' },
  { tag: 'order_id',       desc: 'Heleket order ID' },
  { tag: 'dashboard_url',  desc: 'Link to the customer\'s key dashboard' },
  { tag: 'docs_url',       desc: 'Link to the API docs' },
  { tag: 'support_url',    desc: 'Telegram support link' }
];

const DEFAULT_SUBJECT = '🔑 Your NexAPI key is ready — {{plan}} plan';

// The default is plain text on purpose: most people editing this just want to
// change the wording, not touch HTML. The renderer wraps it in a branded card,
// turns the {{key}} into a highlighted box, and makes the {{..._url}} links
// clickable — so a non-technical edit still produces a good-looking email.
const DEFAULT_TEXT =
`Hi,

Thank you for your purchase! Your NexAPI key is active right now.

Your API key:
{{key}}

Plan: {{plan}}
Expires: {{expires}}
Order ID: {{order_id}}

View your keys anytime:
{{dashboard_url}}

Read the API docs:
{{docs_url}}

Keep your key private — anyone who has it can spend your plan's requests.

Need help? Message us on Telegram:
{{support_url}}

— NexAPI`;

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Fills {{placeholders}} in a plain string (subject line, or HTML-mode body). */
function render(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

/**
 * Renders a placeholder as rich HTML for text-mode bodies: the key becomes a
 * monospace pill, any *_url becomes a clickable link, everything else is just
 * escaped text. Values are escaped so a customer email can't inject markup.
 */
function richValue(key, vars) {
  const raw = vars[key];
  if (raw == null) return '';
  const safe = escapeHtml(raw);

  if (key === 'key')
    return `<span style="font-family:'Courier New',monospace;font-size:15px;background:#f1f5f9;border:1px solid #e5e7eb;border-radius:6px;padding:2px 8px;color:#111827;word-break:break-all;">${safe}</span>`;
  if (key.endsWith('_url'))
    return `<a href="${safe}" style="color:#6366F1;text-decoration:none;">${safe}</a>`;
  return `<strong style="color:#111827;">${safe}</strong>`;
}

/** Wraps a body fragment in the branded email shell (header bar + card). */
function wrapShell(bodyHtml) {
  return `<div style="background:#f4f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:#6366F1;padding:22px 32px;">
      <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-.3px;">NexAPI</span>
    </td></tr>
    <tr><td style="padding:30px 32px;font-size:14px;line-height:1.8;color:#374151;">
${bodyHtml}
    </td></tr>
  </table>
</div>`;
}

/** Turns the admin's plain-text body into a branded HTML email. */
function renderTextBody(text, vars) {
  let html = escapeHtml(text).replace(/\r?\n/g, '<br>');
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => richValue(k, vars));
  return wrapShell(html);
}

/**
 * Produces the final { subject, html } for one set of values, honouring the
 * template's mode. Used by both the real send and the admin "send test".
 */
function renderEmail(tpl, vars) {
  const subject = render(tpl.subject, vars);
  const html = tpl.mode === 'html'
    ? render(tpl.body, vars)          // advanced: author's raw HTML, filled as-is
    : renderTextBody(tpl.body, vars); // simple: plain text wrapped in the shell
  return { subject, html };
}

/**
 * Reads the admin-editable template from Firestore, falling back to the
 * built-in default so the very first sale — before anyone has opened the
 * admin panel — still sends a working email. Normalises old documents that
 * only had `body_html` (HTML-only, pre-text-mode) so they keep working.
 */
async function getTemplate() {
  try {
    const doc = await db.collection('settings').doc('email_template').get();
    if (doc.exists) {
      const d = doc.data();
      // Back-compat: earlier versions stored body_html with no mode.
      if (d.body == null && d.body_html != null) {
        return { enabled: d.enabled !== false, mode: 'html', subject: d.subject || DEFAULT_SUBJECT, body: d.body_html };
      }
      return {
        enabled: d.enabled !== false,
        mode:    d.mode === 'html' ? 'html' : 'text',
        subject: d.subject || DEFAULT_SUBJECT,
        body:    d.body || DEFAULT_TEXT
      };
    }
  } catch (err) {
    console.error('[MAIL/template]', err.message);
  }
  return { enabled: true, mode: 'text', subject: DEFAULT_SUBJECT, body: DEFAULT_TEXT };
}

module.exports = { getTemplate, render, renderEmail, PLACEHOLDERS, DEFAULT_SUBJECT, DEFAULT_TEXT };
