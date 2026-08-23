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

const DEFAULT_HTML = `<div style="background:#f4f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:#6366F1;padding:26px 32px;">
      <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-.3px;">NexAPI</span>
    </td></tr>
    <tr><td style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:21px;color:#111827;">Your API key is ready 🎉</h1>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#4b5563;">
        Thanks for purchasing the <strong>{{plan}}</strong> plan. Your key is active now.
      </p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin-bottom:22px;">
        <div style="font-size:11px;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Your API Key</div>
        <div style="font-family:'Courier New',monospace;font-size:15px;color:#111827;word-break:break-all;">{{key}}</div>
      </div>
      <table role="presentation" width="100%" style="margin-bottom:26px;font-size:13px;color:#4b5563;border-collapse:collapse;">
        <tr><td style="padding:7px 0;">Plan</td><td style="padding:7px 0;text-align:right;font-weight:600;color:#111827;">{{plan}}</td></tr>
        <tr><td style="padding:7px 0;border-top:1px solid #f1f5f9;">Expires</td><td style="padding:7px 0;text-align:right;font-weight:600;color:#111827;border-top:1px solid #f1f5f9;">{{expires}}</td></tr>
        <tr><td style="padding:7px 0;border-top:1px solid #f1f5f9;">Order ID</td><td style="padding:7px 0;text-align:right;font-weight:600;color:#111827;border-top:1px solid #f1f5f9;">{{order_id}}</td></tr>
      </table>
      <a href="{{dashboard_url}}" style="display:inline-block;background:#6366F1;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;margin:0 8px 10px 0;">View My Keys</a>
      <a href="{{docs_url}}" style="display:inline-block;background:#ffffff;color:#6366F1;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;border:1px solid #e5e7eb;margin:0 0 10px 0;">API Docs</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.7;">
        Keep this key private — anyone who has it can spend your plan's requests.
        Need help? Message us on <a href="{{support_url}}" style="color:#6366F1;">Telegram</a>.
      </p>
    </td></tr>
  </table>
</div>`;

/**
 * Reads the admin-editable template from Firestore, falling back to the
 * built-in default so the very first sale — before anyone has opened the
 * admin panel — still sends a working email.
 */
async function getTemplate() {
  try {
    const doc = await db.collection('settings').doc('email_template').get();
    if (doc.exists) {
      const d = doc.data();
      return {
        enabled:   d.enabled !== false,
        subject:   d.subject || DEFAULT_SUBJECT,
        body_html: d.body_html || DEFAULT_HTML
      };
    }
  } catch (err) {
    console.error('[MAIL/template]', err.message);
  }
  return { enabled: true, subject: DEFAULT_SUBJECT, body_html: DEFAULT_HTML };
}

/** Fills {{placeholders}}; anything not in `vars` is dropped rather than left visible. */
function render(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

module.exports = { getTemplate, render, PLACEHOLDERS, DEFAULT_SUBJECT, DEFAULT_HTML };
