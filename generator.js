// Turns a recording (array of steps from recorder.js) into a brand-new Chrome
// extension (as a .zip) that replays the same flow, reads values from a JSON
// file, supports conditions/rules, and can save results to a JSON file.
window.Generator = (() => {

  // =====================================================================
  // Small pure helpers. They are copied as TEXT into the generated
  // extension AND are unit-testable here.
  // =====================================================================
  function resolveTemplate(str, ctx) {
    return String(str).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key) => {
      if (key === 'now') return new Date().toISOString();
      if (key === 'url') return ctx.url || '';
      if (key === 'title') return ctx.title || '';
      if (key.indexOf('text:') === 0) return (ctx.texts && ctx.texts[key.slice(5)]) || '';
      const v = ctx.values && ctx.values[key];
      return v == null ? '' : String(v);
    });
  }

  function findRules(config, stepNo, event) {
    return (config.rules || [])
      .map((r, idx) => ({ r, idx }))
      .filter((x) => x.r.when && x.r.when.step === stepNo && x.r.when.event === event);
  }

  function toFileUrl(p) {
    p = String(p).trim().replace(/^"|"$/g, '');
    if (/^file:\/\//i.test(p)) return p;
    p = p.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(p)) return 'file:///' + encodeURI(p);
    if (p.charAt(0) === '/') return 'file://' + encodeURI(p);
    return 'file:///' + encodeURI(p);
  }

  function safeDownloadPath(p) {
    const clean = String(p || 'AutoSignup/results.json')
      .replace(/\\/g, '/')
      .split('/')
      .filter((x) => x && x !== '.' && x !== '..')
      .join('/');
    return clean || 'AutoSignup/results.json';
  }

  // =====================================================================
  // Generated runner.js (content script, runs in every frame)
  // =====================================================================
  function runnerMain(ACTIONS, DEFAULT_CONFIG) {
    if (window.__autoRunnerLoaded) return;
    window.__autoRunnerLoaded = true;

    const isTop = window.top === window;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const DIALOG_SEL = '[role="dialog"], [aria-modal="true"], .modal, [class*="modal" i], [class*="popup" i]';
    const SOCIAL = /google|apple|facebook|github|microsoft/;
    let stopped = false;
    let checkedTab = false;

    // ---------- finding & touching elements ----------
    const isVisible = (el) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
      getComputedStyle(el).visibility !== 'hidden';
    const isEnabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const labelOf = (el) =>
      (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const q = (sel) => {
      try { return [...document.querySelectorAll(sel)].filter(isVisible); } catch (e) { return []; }
    };

    function pick(els, d) {
      if (!els.length) return null;
      if (els.length === 1) return els[0];
      const inDlg = els.filter((e) => !!e.closest(DIALOG_SEL));
      const pool = d.inDialog && inDlg.length ? inDlg : els;
      return pool[0];
    }

    function findEl(d) {
      const isField = d.tag === 'input' || d.tag === 'textarea';
      const unstableId = !d.id || /\d{3,}|^:|^[a-f0-9-]{12,}$|^radix|^headlessui|^react/i.test(d.id);
      const tries = [];
      if (d.testid) tries.push(`[data-testid="${esc(d.testid)}"], [data-test="${esc(d.testid)}"], [data-cy="${esc(d.testid)}"]`);
      if (!unstableId) tries.push('#' + CSS.escape(d.id));
      if (isField) {
        if (d.name) tries.push(`${d.tag}[name="${esc(d.name)}"]`);
        if (d.placeholder) tries.push(`${d.tag}[placeholder="${esc(d.placeholder)}"]`);
        if (d.ariaLabel) tries.push(`${d.tag}[aria-label="${esc(d.ariaLabel)}"]`);
        if (d.autocomplete && d.autocomplete !== 'off') tries.push(`${d.tag}[autocomplete="${esc(d.autocomplete)}"]`);
      }
      for (const sel of tries) {
        const el = pick(q(sel), d);
        if (el) return el;
      }
      if (!isField && d.text) {
        const want = d.text.toLowerCase();
        const pool = q('button, a, [role="button"], input[type="submit"], input[type="button"], label, [tabindex]');
        const exact = pick(pool.filter((e) => labelOf(e).slice(0, 80) === want), d);
        if (exact) return exact;
        if (want.length > 2) {
          const part = pick(pool.filter((e) => labelOf(e).includes(want) && (SOCIAL.test(want) || !SOCIAL.test(labelOf(e)))), d);
          if (part) return part;
        }
      }
      if (d.selector) {
        const el = pick(q(d.selector), d);
        if (el) return el;
      }
      if (isField && d.type && d.type !== 'text') {
        const el = pick(q(`${d.tag}[type="${esc(d.type)}"]`), d);
        if (el) return el;
      }
      return null;
    }

    function setValue(el, value) {
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function fillSplit(first, code) {
      const all = [...document.querySelectorAll('input')].filter((i) => isVisible(i) && i.maxLength === 1);
      const idx = all.indexOf(first);
      const boxes = idx >= 0 ? all.slice(idx, idx + code.length) : [first];
      if (boxes.length < 2) { setValue(first, code); return; }
      for (let k = 0; k < boxes.length; k++) {
        setValue(boxes[k], code[k]);
        await sleep(60);
      }
    }

    function clickEl(el) {
      el.scrollIntoView({ block: 'center' });
      for (const t of ['mousedown', 'mouseup']) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
      el.click();
    }

    function pressEnter(el) {
      el.focus();
      const mk = (t) => new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const notPrevented = el.dispatchEvent(mk('keydown'));
      el.dispatchEvent(mk('keypress'));
      el.dispatchEvent(mk('keyup'));
      if (notPrevented && el.form && el.form.requestSubmit) el.form.requestSubmit();
    }

    async function waitFor(fn, timeout) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (stopped) throw new Error('stopped');
        const r = fn();
        if (r) return r;
        await sleep(250);
      }
      return null;
    }

    // Which frame/page is responsible for an action?
    function owns(a) {
      const w = a.where || {};
      if (w.frame === 'top') return isTop && location.origin === w.origin;
      return !isTop && location.origin === w.origin && location.pathname === w.path;
    }

    // ---------- on-page status box and prompt (top frame only) ----------
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;background:#111;color:#fff;' +
      'padding:12px 14px;border-radius:10px;font:13px system-ui,sans-serif;max-width:280px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.3)';
    function status(t) {
      if (!isTop) return;
      box.textContent = t;
      if (!box.isConnected) (document.body || document.documentElement).appendChild(box);
    }
    function askUi(labelText, secret) {
      return new Promise((resolve) => {
        box.innerHTML = '';
        if (!box.isConnected) (document.body || document.documentElement).appendChild(box);
        const lab = document.createElement('div');
        lab.textContent = labelText + ':';
        lab.style.marginBottom = '8px';
        const input = document.createElement('input');
        input.type = secret ? 'password' : 'text';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:6px;margin-bottom:8px;font-size:14px;color:#000';
        const btn = document.createElement('button');
        btn.textContent = 'OK';
        btn.style.cssText = 'width:100%;padding:7px;cursor:pointer';
        const done = () => { if (input.value.trim()) resolve(input.value.trim()); };
        btn.onclick = done;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
        box.append(lab, input, btn);
        input.focus();
      });
    }

    // Iframes cannot show a usable prompt, so they ask the top frame (via storage).
    async function askValue(labelText, secret) {
      if (isTop) return askUi(labelText, secret);
      const id = Math.random().toString(36).slice(2);
      await chrome.storage.local.set({ __ask: { id, label: labelText, secret: !!secret } });
      return new Promise((resolve) => {
        const h = (changes, area) => {
          const a = changes.__answer && changes.__answer.newValue;
          if (area === 'local' && a && a.id === id) {
            chrome.storage.onChanged.removeListener(h);
            chrome.storage.local.remove(['__ask', '__answer']);
            resolve(a.value);
          }
        };
        chrome.storage.onChanged.addListener(h);
      });
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      const req = changes.__ask && changes.__ask.newValue;
      if (!isTop || area !== 'local' || !req) return;
      askUi(req.label, req.secret).then((v) => chrome.storage.local.set({ __answer: { id: req.id, value: v } }));
    });

    // ---------- shared run state ----------
    const getRun = async () => (await chrome.storage.local.get('__run')).__run;
    async function updateRun(fn) {
      const run = await getRun();
      if (!run) return false;
      if (fn(run) === false) return false;
      await chrome.storage.local.set({ __run: run });
      return true;
    }
    const bg = (msg) =>
      new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r); });
        } catch (e) { resolve(undefined); }
      });
    async function allowedTab(retries) {
      for (let k = 0; k <= retries; k++) {
        const r = await bg({ type: 'allowed' });
        if (r && r.ok) return true;
        if (k < retries) await sleep(500);
      }
      return false;
    }
    async function getConfig() {
      const { __config } = await chrome.storage.local.get('__config');
      return Object.assign({ output: {}, steps: {}, rules: [] }, DEFAULT_CONFIG, __config || {});
    }
    async function claim(key) {
      let got = false;
      await updateRun((r) => {
        r.fired = r.fired || [];
        if (r.fired.includes(key)) return false;
        r.fired.push(key);
        got = true;
      });
      return got;
    }
    async function finishRun(msg) {
      await updateRun((r) => { r.active = false; r.error = msg || null; r.values = {}; r.busyUntil = 0; });
    }

    // ---------- rules ----------
    async function doSave(cfg, act) {
      const run = await getRun();
      const values = (run && run.values) || {};
      const fields = act.save || {};
      const texts = {};
      for (const v of Object.values(fields)) {
        if (typeof v !== 'string') continue;
        for (const m of v.matchAll(/\{\{\s*text:([^}]+?)\s*\}\}/g)) {
          const sel = m[1];
          if (sel in texts) continue;
          const el = await waitFor(() => q(sel)[0], 8000).catch(() => null);
          texts[sel] = el ? (el.innerText || el.value || '').trim() : '';
        }
      }
      const ctx = { values, url: location.href, title: document.title, texts };
      const record = {};
      for (const [k, v] of Object.entries(fields)) record[k] = typeof v === 'string' ? resolveTemplate(v, ctx) : v;
      await bg({ type: 'save', file: act.file || (cfg.output && cfg.output.file) || 'AutoSignup/results.json', record });
    }

    async function execRules(cfg, matches, label) {
      const ctl = {};
      for (const m of matches) {
        if (m.r.disabled) continue;
        if (!(await claim(`${label}#${m.idx}`))) continue;
        for (const act of m.r.do || []) {
          if (act.save) await doSave(cfg, act);
          else if (typeof act.wait === 'number') await sleep(act.wait);
          else if (typeof act.goto === 'number') ctl.goto = act.goto;
          else if ('continue' in act) ctl.cont = true;
          else if ('stop' in act) ctl.stop = act.stop || 'stopped by rule';
        }
      }
      return ctl;
    }

    // returns true if the rule changed the flow (so the caller should not carry on)
    async function apply(ctl, i, allowCont) {
      if (ctl.stop) { await finishRun(ctl.stop); return true; }
      if (typeof ctl.goto === 'number') {
        const n = Math.min(Math.max(ctl.goto, 1), ACTIONS.length + 1);
        await updateRun((r) => { r.step = n - 1; r.since = Date.now(); });
        return true;
      }
      if (ctl.cont && allowCont) {
        await updateRun((r) => { r.step = i + 1; r.since = Date.now(); });
        return true;
      }
      return false;
    }

    function pageCond(w) {
      if (w.pageHasText) return !!document.body && document.body.innerText.toLowerCase().includes(String(w.pageHasText).toLowerCase());
      if (w.elementExists) return !!q(w.elementExists)[0];
      if (w.urlContains) return isTop && location.href.includes(w.urlContains);
      return false;
    }
    async function checkPageRules(cfg) {
      for (let idx = 0; idx < (cfg.rules || []).length; idx++) {
        const r = cfg.rules[idx];
        const w = r.when || {};
        if (r.disabled || !(w.pageHasText || w.elementExists || w.urlContains)) continue;
        if (!pageCond(w)) continue;
        const ctl = await execRules(cfg, [{ r, idx }], 'page');
        if (await apply(ctl, -1, false)) return true;
      }
      return false;
    }

    // ---------- doing one step ----------
    async function performStep(cfg, run, i, a) {
      if (i > 0) { // the previous step is now finished
        const c = await execRules(cfg, findRules(cfg, i, 'done'), `s${i}:done`);
        if (await apply(c, i - 1, false)) return;
      }
      const c2 = await execRules(cfg, findRules(cfg, i + 1, 'reached'), `s${i + 1}:reached`);
      if (await apply(c2, i, false)) return;

      let value;
      if (a.type === 'type') {
        value = (run.values || {})[a.key];
        if (value == null || value === '') {
          await updateRun((r) => { r.busyUntil = Date.now() + 10 * 60 * 1000; });
          status(`Step ${i + 1}/${ACTIONS.length}: waiting for ${a.ask || a.key}…`);
          value = await askValue(a.ask || a.key, a.secret);
          await updateRun((r) => { r.busyUntil = 0; r.values = r.values || {}; r.values[a.key] = value; });
        }
      }
      const el = findEl(a.target);
      if (!el || !isEnabled(el)) return; // it vanished meanwhile: loop again
      status(`Step ${i + 1}/${ACTIONS.length}: ${a.label}`);

      // save progress BEFORE acting so a page navigation can resume at the next step
      await updateRun((r) => { r.step = i + 1; r.since = Date.now(); });
      if (a.type === 'click') clickEl(el);
      else if (a.type === 'key') pressEnter(el);
      else if (a.split) await fillSplit(el, value);
      else setValue(el, value);
      await sleep(700);
    }

    async function handleTimeout(cfg, i, since, optional) {
      const claimed = await updateRun((r) => {
        if (r.step !== i || r.since !== since) return false;
        r.since = Date.now();
      });
      if (!claimed) return;
      const a = ACTIONS[i];
      if (i > 0) {
        const c = await execRules(cfg, findRules(cfg, i, 'done'), `s${i}:done`);
        if (await apply(c, i - 1, false)) return;
      }
      if (optional) {
        const c = await execRules(cfg, findRules(cfg, i + 1, 'skipped'), `s${i + 1}:skipped`);
        if (await apply(c, i, true)) return;
        await updateRun((r) => { r.step = i + 1; r.since = Date.now(); });
        return;
      }
      const c = await execRules(cfg, findRules(cfg, i + 1, 'failed'), `s${i + 1}:failed`);
      if (await apply(c, i, true)) return;
      await finishRun(`could not find: ${a.label} (step ${i + 1})`);
    }

    // ---------- the loop every frame runs ----------
    async function main() {
      if (window.__autoRunning) return;
      const run0 = await getRun();
      if (!run0 || !run0.active || Date.now() - run0.since > 15 * 60 * 1000) return;
      window.__autoRunning = true;
      stopped = false;
      try {
        const ok = await allowedTab(checkedTab ? 0 : 6);
        checkedTab = true;
        if (!ok) return;
        const cfg = await getConfig();

        while (!stopped) {
          const run = await getRun();
          if (!run || !run.active) break;
          if (await checkPageRules(cfg)) continue;

          const i = run.step;
          if (i >= ACTIONS.length) {
            if (await claim('end')) {
              const c = await execRules(cfg, findRules(cfg, ACTIONS.length, 'done'), `s${ACTIONS.length}:done`);
              if (await apply(c, ACTIONS.length - 1, false)) {
                await updateRun((r) => { r.fired = (r.fired || []).filter((k) => k !== 'end'); });
              } else {
                await finishRun(null);
              }
            }
            await sleep(200);
            continue;
          }

          const a = ACTIONS[i];
          const stepCfg = (cfg.steps || {})[String(i + 1)] || {};
          const timeout = stepCfg.timeout || a.timeout || 30000;
          const mine = owns(a);

          if (mine) {
            const el = findEl(a.target);
            if (el && isEnabled(el)) { await performStep(cfg, run, i, a); continue; }
          }
          if ((mine || isTop) && !(run.busyUntil > Date.now()) && Date.now() - run.since > timeout) {
            await handleTimeout(cfg, i, run.since, !!(stepCfg.optional || a.optional));
            continue;
          }
          status(`Step ${i + 1}/${ACTIONS.length}: waiting for ${a.label}…`);
          await sleep(250);
        }
      } catch (e) {
        if (e.message !== 'stopped') await finishRun('error: ' + e.message);
      } finally {
        window.__autoRunning = false;
        const fin = await getRun().catch(() => null);
        if (isTop && fin && !fin.active) {
          status(fin.error ? 'Stopped: ' + fin.error : fin.step >= ACTIONS.length ? 'Done ✔ all steps finished.' : 'Stopped.');
          setTimeout(() => box.remove(), 10000);
        }
      }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.__run) return;
      const nv = changes.__run.newValue;
      if (nv && nv.active) main();
      else stopped = true;
    });
    main(); // resumes automatically after a page navigation
  }

  // =====================================================================
  // Generated background.js
  // =====================================================================
  function genBackground() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'allowed') {
        chrome.storage.local.get('__run').then(({ __run }) => {
          const ok = !!(__run && __run.active && sender.tab && (__run.tabs || []).includes(sender.tab.id));
          sendResponse({ ok });
        });
        return true;
      }
      if (msg.type === 'save') {
        saveRecord(msg.file, msg.record).then(
          () => sendResponse({ ok: true }),
          (e) => sendResponse({ ok: false, error: String(e) })
        );
        return true;
      }
      if (msg.type === 'flush') {
        flushAll().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
        return true;
      }
    });

    // windows/tabs opened by the site while running (e.g. a popup window) take part too
    chrome.tabs.onCreated.addListener(async (tab) => {
      const { __run } = await chrome.storage.local.get('__run');
      if (__run && __run.active && tab.openerTabId && (__run.tabs || []).includes(tab.openerTabId)) {
        __run.tabs.push(tab.id);
        await chrome.storage.local.set({ __run });
      }
    });

    let writing = Promise.resolve();
    function writeFile(file, list) {
      const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(list, null, 2));
      return chrome.downloads.download({ url, filename: safeDownloadPath(file), conflictAction: 'overwrite', saveAs: false });
    }
    function saveRecord(file, record) {
      writing = writing.then(async () => {
        const { __results = {} } = await chrome.storage.local.get('__results');
        const key = safeDownloadPath(file);
        (__results[key] = __results[key] || []).push(record);
        await chrome.storage.local.set({ __results });
        await writeFile(key, __results[key]);
      });
      return writing;
    }
    async function flushAll() {
      const { __results = {} } = await chrome.storage.local.get('__results');
      for (const [file, list] of Object.entries(__results)) await writeFile(file, list);
    }
  }

  // =====================================================================
  // Generated popup.js
  // =====================================================================
  function genPopup() {
    const $ = (id) => document.getElementById(id);

    async function loadValues() {
      const s = await chrome.storage.local.get(['__valuesPath', '__valuesStored']);
      if (s.__valuesPath) {
        try {
          const res = await fetch(toFileUrl(s.__valuesPath));
          const json = await res.json();
          return { values: Array.isArray(json) ? json[0] || {} : json, from: 'file path' };
        } catch (e) {
          if (!s.__valuesStored) {
            throw new Error('Could not read the values file (' + e.message + '). Check the path, and that "Allow access to file URLs" is on for this extension.');
          }
        }
      }
      if (s.__valuesStored) return { values: s.__valuesStored, from: 'picked file' };
      return { values: {}, from: 'none' };
    }

    chrome.storage.local.get(['__valuesPath', '__valuesStored']).then((s) => {
      $('src').textContent = s.__valuesPath
        ? 'Values from path: ' + s.__valuesPath
        : s.__valuesStored ? 'Values from the file you picked in Settings' : 'No values file set (you will be asked on the page)';
    });

    $('run').addEventListener('click', async () => {
      let loaded;
      try { loaded = await loadValues(); } catch (e) { $('msg').textContent = e.message; return; }
      const values = Object.assign({}, loaded.values);
      const email = $('email').value.trim();
      if (email) values.email = email;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.storage.local.set({
        __run: { active: true, step: 0, values, tabs: [tab.id], since: Date.now(), busyUntil: 0, fired: [], error: null }
      });
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['runner.js'] });
      } catch (e) {
        $('msg').textContent = 'Could not run on this page: ' + e.message;
        return;
      }
      $('msg').textContent = 'Running (values: ' + loaded.from + '). Watch the page.';
      setTimeout(() => window.close(), 700);
    });

    $('stop').addEventListener('click', async () => {
      const { __run } = await chrome.storage.local.get('__run');
      if (__run) { __run.active = false; __run.values = {}; await chrome.storage.local.set({ __run }); }
      $('msg').textContent = 'Stopped.';
    });

    $('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  }

  // =====================================================================
  // Generated options.js (values file, rules editor, results)
  // =====================================================================
  function genOptions() {
    const $ = (id) => document.getElementById(id);
    const say = (id, text, ok) => {
      const e = $(id);
      e.textContent = text;
      e.style.color = ok === false ? '#b00020' : '#2e7d32';
    };

    $('steps').textContent = STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n');
    $('needed').textContent = NEEDED_KEYS.join(', ');

    // ----- values file -----
    function describeKeys(obj) {
      const have = Object.keys(obj || {});
      const missing = NEEDED_KEYS.filter((k) => !have.includes(k) && k !== 'code');
      return `Found keys: ${have.join(', ') || '(none)'}` + (missing.length ? `\nNot in the file (you will be asked on the page): ${missing.join(', ')}` : '');
    }
    chrome.storage.local.get(['__valuesPath', '__valuesStored', '__config', '__results']).then((s) => {
      $('path').value = s.__valuesPath || '';
      if (s.__valuesStored) say('valuesMsg', 'A picked file is stored.\n' + describeKeys(s.__valuesStored));
      $('config').value = JSON.stringify(s.__config || DEFAULT_CONFIG, null, 2);
      showResults(s.__results || {});
    });
    chrome.extension.isAllowedFileSchemeAccess((ok) => {
      $('fileAccess').textContent = ok
        ? '✔ "Allow access to file URLs" is ON, so the path option can work.'
        : '✖ "Allow access to file URLs" is OFF. Turn it on in chrome://extensions → this extension → Details, or use "Pick a file" below.';
      $('fileAccess').style.color = ok ? '#2e7d32' : '#b00020';
    });

    $('savePath').addEventListener('click', async () => {
      const p = $('path').value.trim();
      await chrome.storage.local.set({ __valuesPath: p });
      if (!p) { say('valuesMsg', 'Path cleared.'); return; }
      try {
        const res = await fetch(toFileUrl(p));
        const json = await res.json();
        say('valuesMsg', 'Saved, and the file was read OK.\n' + describeKeys(Array.isArray(json) ? json[0] : json));
      } catch (e) {
        say('valuesMsg', 'Saved, but reading failed: ' + e.message + '\nCheck the path and the file-URL setting above.', false);
      }
    });

    $('pick').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        const obj = Array.isArray(json) ? json[0] : json;
        await chrome.storage.local.set({ __valuesStored: obj });
        say('valuesMsg', 'File stored inside the extension.\n' + describeKeys(obj));
      } catch (err) {
        say('valuesMsg', 'Not valid JSON: ' + err.message, false);
      }
    });
    $('clearPicked').addEventListener('click', async () => {
      await chrome.storage.local.remove('__valuesStored');
      say('valuesMsg', 'Picked file removed.');
    });

    // ----- rules -----
    function validate(cfg) {
      if (!cfg || typeof cfg !== 'object') throw new Error('The config must be a JSON object');
      const events = ['reached', 'done', 'skipped', 'failed'];
      (cfg.rules || []).forEach((r, i) => {
        const w = r.when || {};
        const isStep = typeof w.step === 'number';
        const isPage = w.pageHasText || w.elementExists || w.urlContains;
        if (!isStep && !isPage) throw new Error(`Rule ${i + 1}: "when" needs step + event, or pageHasText / elementExists / urlContains`);
        if (isStep && !events.includes(w.event)) throw new Error(`Rule ${i + 1}: event must be one of ${events.join(', ')}`);
        if (isStep && (w.step < 1 || w.step > STEPS.length)) throw new Error(`Rule ${i + 1}: step must be between 1 and ${STEPS.length}`);
        if (!Array.isArray(r.do)) throw new Error(`Rule ${i + 1}: "do" must be a list`);
      });
      Object.keys(cfg.steps || {}).forEach((k) => {
        if (!(Number(k) >= 1 && Number(k) <= STEPS.length)) throw new Error(`"steps" key ${k} is out of range`);
      });
    }
    $('saveConfig').addEventListener('click', async () => {
      try {
        const cfg = JSON.parse($('config').value);
        validate(cfg);
        await chrome.storage.local.set({ __config: cfg });
        say('configMsg', 'Saved. It applies from the next run.');
      } catch (e) {
        say('configMsg', e.message, false);
      }
    });
    $('resetConfig').addEventListener('click', async () => {
      await chrome.storage.local.remove('__config');
      $('config').value = JSON.stringify(DEFAULT_CONFIG, null, 2);
      say('configMsg', 'Reset to the default.');
    });

    // ----- results -----
    function showResults(res) {
      const lines = Object.entries(res).map(([f, l]) => `Downloads/${f}: ${l.length} record(s)`);
      $('results').textContent = lines.join('\n') || 'Nothing saved yet.';
    }
    $('flush').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'flush' }, () => say('resMsg', 'Files written to your Downloads folder.'));
    });
    $('clearResults').addEventListener('click', async () => {
      await chrome.storage.local.remove('__results');
      showResults({});
      say('resMsg', 'Cleared (files already in Downloads are not deleted).');
    });
  }

  const POPUP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 270px; padding: 14px; font-family: system-ui, sans-serif; font-size: 13px; }
    h3 { margin: 0 0 8px; font-size: 14px; }
    input { width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 8px; font-size: 13px; }
    button { padding: 8px; font-size: 13px; cursor: pointer; width: 100%; margin-bottom: 6px; }
    #src { font-size: 12px; color: #555; margin-bottom: 8px; word-break: break-all; }
    #msg { font-size: 12px; color: #555; }
  </style>
</head>
<body>
  <h3>__TITLE__</h3>
  <div id="src"></div>
  <input id="email" type="email" placeholder="Email override (optional)">
  <button id="run">Run on this tab</button>
  <button id="stop">Stop</button>
  <button id="opts">Settings: values file, rules, results</button>
  <div id="msg"></div>
  <script src="popup.js"></script>
</body>
</html>
`;

  const OPTIONS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>__TITLE__ settings</title>
  <style>
    body { max-width: 760px; margin: 24px auto; padding: 0 16px; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.45; }
    h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px; }
    input[type=text], textarea { width: 100%; box-sizing: border-box; padding: 8px; font: 13px ui-monospace, monospace; }
    button { padding: 7px 12px; cursor: pointer; margin: 6px 6px 0 0; }
    pre, .msg { white-space: pre-wrap; font: 12px ui-monospace, monospace; background: #f5f5f5; padding: 8px; border-radius: 6px; }
    .msg { background: none; padding: 4px 0; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>__TITLE__ settings</h1>

  <h2>Steps in this automation</h2>
  <pre id="steps"></pre>
  <p>Values used by these steps: <code id="needed"></code></p>

  <h2>1. Values file (JSON)</h2>
  <p>A JSON file like <code>{"email": "me@example.com", "password": "..."}</code> (see <code>values.example.json</code> in the extension folder). Anything missing from it is asked for on the page, which is normal for the emailed code.</p>
  <div id="fileAccess" class="msg"></div>
  <p><b>Option A, read from a path</b> (re-read every run, so you can edit the file any time):</p>
  <input type="text" id="path" placeholder="C:\\Users\\me\\signup-values.json   or   /Users/me/signup-values.json">
  <button id="savePath">Save path &amp; test</button>
  <p><b>Option B, pick a file</b> (a copy is kept inside the extension):</p>
  <input type="file" id="pick" accept=".json,application/json">
  <button id="clearPicked">Remove picked file</button>
  <div id="valuesMsg" class="msg"></div>

  <h2>2. Conditions (rules)</h2>
  <p>Step numbers are the ones listed above. Events: <code>reached</code> (the step's button/field is ready, before it is used), <code>done</code> (the step has been carried out), <code>skipped</code> (an optional step never appeared), <code>failed</code> (a required step never appeared).<br>
  Actions: <code>{"save": {...}}</code>, <code>{"goto": 6}</code>, <code>{"continue": true}</code>, <code>{"stop": "message"}</code>, <code>{"wait": 2000}</code>.<br>
  Page conditions: <code>pageHasText</code>, <code>elementExists</code> (CSS selector), <code>urlContains</code>. Each rule fires once per run; add <code>"disabled": true</code> to switch one off.</p>
  <textarea id="config" rows="22" spellcheck="false"></textarea>
  <button id="saveConfig">Save conditions</button>
  <button id="resetConfig">Reset to default</button>
  <div id="configMsg" class="msg"></div>
  <details>
    <summary>Examples</summary>
    <pre>{
  "output": { "file": "AutoSignup/results.json" },
  "steps": { "4": { "optional": true, "timeout": 15000 } },
  "rules": [
    { "name": "log that the code was requested",
      "when": { "step": 4, "event": "reached" },
      "do": [ { "save": { "email": "{{email}}", "status": "code requested", "time": "{{now}}" } } ] },

    { "name": "no code step this time: jump to step 6 and keep going",
      "when": { "step": 4, "event": "skipped" },
      "do": [ { "goto": 6 } ] },

    { "name": "email is already used: record it and stop",
      "when": { "pageHasText": "already registered" },
      "do": [ { "save": { "email": "{{email}}", "status": "already registered" } },
              { "stop": "Email already registered" } ] },

    { "name": "save something shown on the final page",
      "when": { "step": 5, "event": "done" },
      "do": [ { "save": { "email": "{{email}}", "welcome": "{{text:h1}}", "url": "{{url}}" } } ] }
  ]
}</pre>
  </details>

  <h2>3. Saved results</h2>
  <p>Chrome extensions cannot write to an arbitrary folder. Saved records are written as JSON into your <b>Downloads</b> folder (under the path in <code>output.file</code>), and the file is rewritten each time with all records.</p>
  <pre id="results"></pre>
  <button id="flush">Write files now</button>
  <button id="clearResults">Clear saved records</button>
  <div id="resMsg" class="msg"></div>

  <script src="options.js"></script>
</body>
</html>
`;

  // =====================================================================
  // Recording -> list of actions
  // =====================================================================
  function slugKey(label) {
    const words = String(label).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return 'value';
    return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('');
  }

  function whereOf(s) {
    let origin = '';
    let path = '';
    try { const u = new URL(s.url); origin = u.origin; path = u.pathname; } catch (e) { /* ignore */ }
    return { frame: s.frame === 'iframe' ? 'iframe' : 'top', origin, path };
  }

  function distill(steps) {
    const warnings = [];
    const list = steps.filter((s) => ['click', 'input', 'key'].includes(s.type));

    // Pressing Enter in a form also fires a click on the submit button: keep only the click.
    const cleaned = list.filter(
      (s, i) => !(s.type === 'key' && list[i + 1] && list[i + 1].type === 'click' && list[i + 1].ms - s.ms < 400)
    );

    const FIELDS = ['tag', 'text', 'id', 'name', 'type', 'role', 'ariaLabel', 'placeholder', 'autocomplete', 'testid', 'selector', 'inDialog', 'maxLength'];
    const keep = (t) => {
      const o = {};
      FIELDS.forEach((k) => { if (t[k] !== undefined) o[k] = t[k]; });
      return o;
    };

    const actions = [];
    cleaned.forEach((s, i) => {
      const t = s.target || {};
      const where = whereOf(s);

      if (s.type === 'click') {
        const isTextField =
          ['input', 'textarea', 'select'].includes(t.tag) && !['submit', 'button', 'checkbox', 'radio'].includes(t.type);
        if (isTextField) return; // just focusing a field before typing
        const nxt = cleaned[i + 1];
        if (!t.text && !['button', 'a'].includes(t.tag) && nxt && nxt.type === 'input' && nxt.ms - s.ms < 3000) return;
        actions.push({ type: 'click', label: `click “${t.text || t.selector}”`, target: keep(t), where });
        return;
      }

      if (s.type === 'key') {
        actions.push({ type: 'key', key: 'Enter', label: 'press Enter', target: keep(t), where });
        return;
      }

      // typing
      const prev = actions[actions.length - 1];
      if (t.maxLength === 1) {
        if (prev && prev.split) return; // another box of the same split code
        actions.push({ type: 'type', key: 'code', ask: 'Verification code', split: true, label: 'enter verification code', target: keep(t), where });
        return;
      }
      let key;
      let askLabel;
      let secret;
      const hints = [t.name, t.placeholder, t.ariaLabel, t.autocomplete, t.id].join(' ');
      if (s.valueKind === 'email') {
        key = 'email';
        askLabel = 'Email';
      } else if (s.valueKind === 'password (hidden)') {
        key = 'password';
        askLabel = 'Password';
        secret = true;
      } else if (
        t.autocomplete === 'one-time-code' ||
        /code|otp|verif|pin|token/i.test(hints) ||
        (s.valueKind === 'digits' && s.length >= 4 && s.length <= 8)
      ) {
        key = 'code';
        askLabel = 'Verification code';
      } else {
        askLabel = t.placeholder || t.ariaLabel || t.name || 'Value';
        key = slugKey(askLabel);
      }
      const act = {
        type: 'type',
        key,
        ask: askLabel,
        secret,
        label: key === 'email' ? 'type your email' : `enter ${String(askLabel).toLowerCase()}`,
        target: keep(t),
        where
      };
      if (prev && prev.type === 'type' && !prev.split && prev.target.selector === t.selector && prev.where.origin === where.origin) {
        actions[actions.length - 1] = act; // typed twice in the same box: keep the last
      } else {
        actions.push(act);
      }
    });

    const iframeCount = actions.filter((a) => a.where.frame === 'iframe').length;
    if (iframeCount) warnings.push(`${iframeCount} step(s) happen inside an iframe. These are supported, but if one does not work, tell Claude which.`);
    return { actions, warnings };
  }

  // =====================================================================
  // Minimal ZIP writer (no compression), so no libraries are needed
  // =====================================================================
  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      let c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.data);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // =====================================================================
  // Public: build the extension
  // =====================================================================
  function build(steps) {
    const { actions, warnings } = distill(steps);
    if (!actions.length) return { ok: false, message: 'No usable clicks or typing found in the recording.' };

    const origins = new Set();
    let host = '';
    steps.forEach((s) => {
      if (!s.url) return;
      try {
        const u = new URL(s.url);
        if (/^https?:$/.test(u.protocol)) {
          origins.add(`${u.protocol}//${u.hostname}/*`);
          if (!host && s.frame !== 'iframe') host = u.hostname;
        }
      } catch (e) { /* ignore */ }
    });
    if (!origins.size) return { ok: false, message: 'Could not work out the website from the recording.' };
    if (!host) host = origins.values().next().value.replace(/^https?:\/\/|\/\*$/g, '');

    const title = `Auto Signup (${host})`;
    const folder = 'auto-signup-' + host.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

    const stepLabels = actions.map((a) => a.label + (a.where.frame === 'iframe' ? ' (inside an iframe)' : ''));
    const keys = [...new Set(actions.filter((a) => a.type === 'type').map((a) => a.key))];

    // default conditions: save a record once the last step is done
    const defaultConfig = {
      output: { file: 'AutoSignup/results.json' },
      steps: {},
      rules: [
        {
          name: 'Save a record when the last step is done',
          when: { step: actions.length, event: 'done' },
          do: [{ save: { email: '{{email}}', status: 'signed up', url: '{{url}}', time: '{{now}}' } }]
        }
      ]
    };

    const valuesExample = {};
    keys.filter((k) => k !== 'code').forEach((k) => { valuesExample[k] = k === 'email' ? 'you@example.com' : ''; });

    const manifest = {
      manifest_version: 3,
      name: title,
      version: '2.0',
      description: `Replays the signup flow you recorded on ${host}.`,
      permissions: ['storage', 'activeTab', 'scripting', 'downloads'],
      host_permissions: ['file:///*'],
      background: { service_worker: 'background.js' },
      options_page: 'options.html',
      content_scripts: [{ matches: [...origins], js: ['runner.js'], all_frames: true, match_about_blank: true, run_at: 'document_idle' }],
      action: { default_popup: 'popup.html', default_title: title }
    };

    const helperText = [resolveTemplate, findRules, toFileUrl, safeDownloadPath].map((f) => f.toString()).join('\n\n');

    const runnerJs =
      `// Generated from your recording.\n` +
      `${helperText}\n\n` +
      `(${runnerMain.toString()})(${JSON.stringify(actions, null, 1)}, ${JSON.stringify(defaultConfig, null, 1)});\n`;

    const backgroundJs = `${safeDownloadPath.toString()}\n\n(${genBackground.toString()})();\n`;
    const popupJs = `${toFileUrl.toString()}\n\n(${genPopup.toString()})();\n`;
    const optionsJs =
      `const DEFAULT_CONFIG = ${JSON.stringify(defaultConfig, null, 2)};\n` +
      `const STEPS = ${JSON.stringify(stepLabels)};\n` +
      `const NEEDED_KEYS = ${JSON.stringify(keys)};\n\n` +
      `${toFileUrl.toString()}\n\n(${genOptions.toString()})();\n`;

    const files = [
      { name: `${folder}/manifest.json`, data: JSON.stringify(manifest, null, 2) },
      { name: `${folder}/runner.js`, data: runnerJs },
      { name: `${folder}/background.js`, data: backgroundJs },
      { name: `${folder}/popup.html`, data: POPUP_HTML.replace('__TITLE__', title) },
      { name: `${folder}/popup.js`, data: popupJs },
      { name: `${folder}/options.html`, data: OPTIONS_HTML.replace(/__TITLE__/g, title) },
      { name: `${folder}/options.js`, data: optionsJs },
      { name: `${folder}/values.example.json`, data: JSON.stringify(valuesExample, null, 2) + '\n' }
    ];

    return {
      ok: true,
      blob: makeZip(files),
      zipName: folder + '.zip',
      summary: actions.map((a, i) => `${i + 1}. ${stepLabels[i]}${a.type === 'type' ? `  [value: ${a.key}]` : ''}`),
      warnings,
      files
    };
  }

  return { build, _test: { resolveTemplate, findRules, toFileUrl, safeDownloadPath, distill, slugKey } };
})();
