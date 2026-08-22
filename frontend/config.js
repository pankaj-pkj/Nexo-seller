/* ============================================================
   NexAPI — shared frontend config + helpers
   ------------------------------------------------------------
   LEAVE THIS ALONE if the backend also serves these pages
   (single-deploy mode) — same-origin requests just work.

   ONLY fill it in when the frontend is hosted separately, e.g.
   on Vercel while the backend runs on Render:
   ============================================================ */
const BACKEND_URL = '';
/* ========================================================== */

(function () {
  'use strict';

  const configured = (BACKEND_URL || '').trim().replace(/\/+$/, '');
  const isLocal    = ['localhost', '127.0.0.1', ''].includes(location.hostname);

  // Resolution order:
  //   1. BACKEND_URL filled in      → split deploy, use it
  //   2. local dev on another port  → backend is on :3000
  //   3. otherwise                  → same origin ('' = relative URLs)
  const BACKEND = configured
    ? configured
    : (isLocal && location.port !== '3000' ? 'http://localhost:3000' : '');

  // Absolute base — for anything a user copies out of the page (curl samples,
  // call URLs), where a relative path would be useless.
  const ORIGIN = BACKEND || location.origin;

  /** Escape anything that came from the API before putting it in innerHTML. */
  const esc = v => String(v ?? '').replace(/[&<>"'`]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
  }[c]));

  /** Clipboard with a fallback for non-HTTPS origins where the API is blocked. */
  async function copy(text) {
    try {
      if (navigator.clipboard && isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }

  /** Copy + flip a button's label to a confirmation for a moment. */
  async function copyBtn(text, btn, okLabel = '✓ Copied!') {
    const original = btn.innerHTML;
    const ok = await copy(text);
    btn.innerHTML = ok ? okLabel : '✕ Copy failed';
    btn.classList.add(ok ? 'is-copied' : 'is-failed');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('is-copied', 'is-failed');
    }, 2200);
    return ok;
  }

  /** Bottom-right toast. Creates its own host element on first use. */
  function toast(msg, type = '') {
    let el = document.getElementById('nx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nx-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = `nx-toast ${type} show`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3400);
  }

  /** fetch + JSON with a readable error instead of "Unexpected token <". */
  async function api(path, opts = {}) {
    const res = await fetch(`${BACKEND}${path}`, opts);
    let body;
    try {
      body = await res.json();
    } catch {
      // A 404 with a non-JSON body almost always means these pages are being
      // served as plain static files by a host that never started the backend.
      // Say that outright — "not JSON" alone sends people hunting the wrong bug.
      if (res.status === 404)
        throw new Error(
          `No API at ${ORIGIN}${path}. The pages are being served, but the backend ` +
          `is not running on this host — check that it deploys the Node app, not just the frontend folder.`
        );
      throw new Error(`Backend returned ${res.status} (not JSON) — is ${ORIGIN} awake?`);
    }
    if (!res.ok && body?.error) throw new Error(body.error);
    return body;
  }

  const fmtNum  = n => Number(n || 0).toLocaleString('en-US');
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  /** Users who ask their OS for less motion get a static page. */
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) document.documentElement.classList.add('reduce-motion');

  // Shared favicon so every page shows the brand mark
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#8B5CF6"/>
      </linearGradient></defs>
      <rect width="64" height="64" rx="16" fill="url(#g)"/>
      <text x="32" y="45" font-family="system-ui,sans-serif" font-size="36"
            font-weight="800" fill="#fff" text-anchor="middle">N</text>
    </svg>`
  );
  document.head.appendChild(favicon);

  // ── Support contact ─────────────────────────────────────────
  // One place to change the handle; every page reads it from here.
  const TELEGRAM      = '@WhiteHatCeo';
  const TELEGRAM_URL  = 'https://t.me/' + TELEGRAM.replace(/^@/, '');

  const TG_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.04 15.47 8.7 20a.6.6 0 0 0 .96.2l2.3-2.2 4.77 3.5c.87.48 1.5.23 1.72-.81l3.11-14.6c.32-1.28-.46-1.86-1.3-1.55L1.9 10.2c-1.26.5-1.24 1.22-.22 1.53l4.86 1.52L17.8 6.6c.53-.33 1.02-.15.62.21z"/></svg>';

  /**
   * Fills every <footer data-nx-footer> with the shared links.
   *
   * Injected rather than copied into each page so the support handle and the
   * legal links can never drift apart between pages.
   */
  function mountFooter() {
    const here = location.pathname.split('/').pop() || 'index.html';
    const links = [
      ['index.html',     'Home'],
      ['docs.html',      'API Docs'],
      ['dashboard.html', 'My Keys'],
      ['privacy.html',   'Privacy Policy'],
      ['terms.html',     'Terms & Conditions']
    ].filter(([href]) => href !== here);

    const html =
      `<div class="nx-foot-links">${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</div>` +
      `<div class="nx-foot-contact">` +
        `<a class="nx-tg" href="${TELEGRAM_URL}" target="_blank" rel="noopener">` +
          `${TG_ICON} Support on Telegram · ${esc(TELEGRAM)}` +
        `</a>` +
      `</div>` +
      `\u00a9 ${new Date().getFullYear()} NexAPI · Powered by Heleket · All payments in USDT`;

    document.querySelectorAll('[data-nx-footer]').forEach(el => {
      el.classList.add('nx-footer');
      el.innerHTML = html;
    });
  }

  /**
   * Turns an <a> into the Telegram chip — icon, label, and the handle.
   * Pages call this instead of setting textContent, which would wipe the icon.
   */
  function tgChip(el, label = 'Contact on Telegram') {
    if (!el) return;
    el.classList.add('nx-tg');
    el.href = TELEGRAM_URL;
    el.target = '_blank';
    el.rel = 'noopener';
    el.innerHTML = `${TG_ICON} ${esc(label)} · ${esc(TELEGRAM)}`;
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mountFooter);
  else mountFooter();

  window.NEXAPI = { BACKEND, ORIGIN, esc, copy, copyBtn, toast, api, fmtNum, fmtDate, reducedMotion, TELEGRAM, TELEGRAM_URL, tgChip };
})();
