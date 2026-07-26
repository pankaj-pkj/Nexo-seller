/* ============================================================
   NexAPI — shared frontend config + helpers
   ------------------------------------------------------------
   👉 THE ONLY LINE YOU NEED TO CHANGE AFTER DEPLOYING:
   ============================================================ */
const BACKEND_URL = 'https://your-backend.onrender.com';
/* ========================================================== */

(function () {
  'use strict';

  // Running from a local file or localhost? Talk to a local backend instead,
  // so you never have to edit this file just to test on your machine.
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const BACKEND = isLocal ? 'http://localhost:3000' : BACKEND_URL.replace(/\/+$/, '');

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
    try { body = await res.json(); }
    catch { throw new Error(`Backend returned ${res.status} (not JSON) — is ${BACKEND} awake?`); }
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

  window.NEXAPI = { BACKEND, esc, copy, copyBtn, toast, api, fmtNum, fmtDate, reducedMotion };
})();
