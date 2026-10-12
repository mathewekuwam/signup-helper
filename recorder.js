// Records what YOU do on the page (clicks, typing, Enter key, navigation,
// popups appearing) plus the exact buttons/inputs visible at each stage.
// Typed values are NOT stored, only their kind (email/digits/text) and length.
// Passwords are never stored.
(() => {
  if (window.__recLoaded) return;
  window.__recLoaded = true;

  let active = false;
  let lastSig = '';
  let lastUrl = location.href;
  let snapTimer = null;
  const isTop = window.top === window;

  const send = (step) => {
    try {
      chrome.runtime.sendMessage({
        type: 'rec-step',
        step: { ...step, url: location.href, frame: isTop ? 'top' : 'iframe' }
      });
    } catch (e) { /* extension reloaded; ignore */ }
  };

  // ---------- helpers ----------
  const isVisible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';

  // Never read the value of text fields: that would store what you typed.
  const isTextField = (el) =>
    el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !['submit', 'button', 'reset'].includes((el.type || '').toLowerCase()));
  const txt = (el) =>
    (isTextField(el)
      ? el.getAttribute('aria-label') || ''
      : el.innerText || el.value || el.getAttribute('aria-label') || ''
    ).trim().replace(/\s+/g, ' ').slice(0, 80);

  const DIALOG_SEL = '[role="dialog"], [aria-modal="true"], .modal, [class*="modal" i], [class*="popup" i]';

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const d = {
      tag: el.tagName.toLowerCase(),
      text: txt(el),
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      type: el.getAttribute('type') || undefined,
      role: el.getAttribute('role') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      testid: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || undefined,
      classes: typeof el.className === 'string' && el.className ? el.className.split(/\s+/).slice(0, 5).join(' ') : undefined,
      href: el.tagName === 'A' ? el.getAttribute('href') : undefined,
      selector: cssPath(el),
      inDialog: !!el.closest(DIALOG_SEL) || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined
    };
    Object.keys(d).forEach((k) => (d[k] === undefined || d[k] === '') && delete d[k]);
    return d;
  }

  const kind = (v, type) => {
    if (type === 'password') return 'password (hidden)';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'email';
    if (/^\d+$/.test(v)) return 'digits';
    if (/^[A-Za-z0-9]+$/.test(v)) return 'alphanumeric';
    return 'text';
  };

  // ---------- snapshots: what is on screen right now ----------
  function snapshot(reason, force) {
    const buttons = [...document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]')]
      .filter(isVisible)
      .slice(0, 30)
      .map((b) => ({
        text: txt(b),
        selector: cssPath(b),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' || undefined,
        inDialog: !!b.closest(DIALOG_SEL) || undefined
      }));
    const inputs = [...document.querySelectorAll('input, textarea')]
      .filter((i) => isVisible(i) && i.type !== 'hidden')
      .slice(0, 15)
      .map(describe);
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal')]
      .filter(isVisible)
      .map((d) => txt(d.querySelector('h1,h2,h3,[role="heading"]') || d).slice(0, 100));
    const headings = [...document.querySelectorAll('h1, h2')].filter(isVisible).slice(0, 3).map(txt);

    const sig = JSON.stringify([buttons.map((b) => b.text), inputs.map((i) => i.selector), dialogs]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    send({ type: 'snapshot', reason, title: document.title, headings, dialogs, buttons, inputs });
  }

  function snapshotSoon(reason, delay, force) {
    if (snapTimer) return; // throttle
    snapTimer = setTimeout(() => {
      snapTimer = null;
      if (active) snapshot(reason, force);
    }, delay);
  }

  // ---------- indicator ----------
  function updateIndicator() {
    const old = document.getElementById('__rec_indicator');
    if (old) old.remove();
    if (!active || !isTop) return;
    const dot = document.createElement('div');
    dot.id = '__rec_indicator';
    dot.textContent = '● REC';
    dot.style.cssText =
      'position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#d00000;color:#fff;' +
      'padding:4px 9px;border-radius:12px;font:bold 12px system-ui,sans-serif;pointer-events:none;opacity:.9';
    (document.body || document.documentElement).appendChild(dot);
  }

  function setActive(v, fromLoad) {
    if (v === active) return;
    active = v;
    updateIndicator();
    if (active) {
      lastSig = '';
      lastUrl = location.href;
      if (fromLoad) send({ type: 'page-load', title: document.title });
      snapshotSoon(fromLoad ? 'page-load' : 'start', fromLoad ? 1200 : 0, true);
    }
  }

  // ---------- listeners ----------
  document.addEventListener('click', (e) => {
    if (!active || !(e.target instanceof Element)) return;
    const el = e.target.closest('button, a, [role="button"], input[type="submit"], input[type="button"], label, [onclick], [tabindex]') || e.target;
    send({ type: 'click', target: describe(el) });
    snapshotSoon('after-click', 1500);
  }, true);

  const timers = new WeakMap();
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!active || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => {
      if (!active) return;
      send({ type: 'input', target: describe(el), valueKind: kind(el.value, el.type), length: el.value.length });
      snapshotSoon('after-input', 1000);
    }, 700));
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!active || e.key !== 'Enter' || !(e.target instanceof Element)) return;
    send({ type: 'key', key: 'Enter', target: describe(e.target) });
    snapshotSoon('after-enter', 1500);
  }, true);

  new MutationObserver(() => { if (active) snapshotSoon('dom-change', 1000); })
    .observe(document.documentElement, { childList: true, subtree: true });

  if (isTop) {
    setInterval(() => {
      if (!active || location.href === lastUrl) return;
      lastUrl = location.href;
      send({ type: 'navigate', to: location.href });
      snapshotSoon('url-change', 1200);
    }, 500);
  }

  // ---------- on/off switch (from the popup) ----------
  chrome.storage.local.get('recording', ({ recording }) => setActive(!!recording, true));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recording) setActive(!!changes.recording.newValue, false);
  });
})();
