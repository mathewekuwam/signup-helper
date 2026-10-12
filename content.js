(async () => {
  if (window.__signupRunning) return;
  window.__signupRunning = true;

  const { email } = window.__signupConfig;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- helpers ----------
  const isVisible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';

  async function waitFor(fn, timeout = 20000, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = fn();
      if (result) return result;
      await sleep(interval);
    }
    throw new Error('Timed out waiting for element');
  }

  // Finds a clickable element by its text. Exact matches win over partial ones,
  // and "Continue with Google/Apple/..." style buttons are skipped.
  function findButton(texts, root = document) {
    const els = [...root.querySelectorAll('button, [role="button"], a, input[type="submit"]')]
      .filter((el) => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const label = (el) => (el.innerText || el.value || '').trim().toLowerCase();
    const bad = /google|apple|facebook|github|microsoft/;
    const ok = els.filter((el) => !bad.test(label(el)));
    for (const t of texts) {
      const exact = ok.find((el) => label(el) === t);
      if (exact) return exact;
    }
    for (const t of texts) {
      const partial = ok.find((el) => label(el).includes(t));
      if (partial) return partial;
    }
    return null;
  }

  // Works with React/Vue inputs (plain `el.value = x` often gets ignored).
  function setValue(el, value) {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- small status box ----------
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:2147483647;background:#111;color:#fff;' +
    'padding:12px 14px;border-radius:10px;font:13px system-ui,sans-serif;max-width:280px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.appendChild(box);
  const status = (t) => { box.textContent = t; };

  function askForCode() {
    return new Promise((resolve) => {
      box.innerHTML = '';
      const label = document.createElement('div');
      label.textContent = 'Paste the code from your email:';
      label.style.marginBottom = '8px';
      const input = document.createElement('input');
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:6px;margin-bottom:8px;font-size:14px;color:#000';
      const btn = document.createElement('button');
      btn.textContent = 'Submit code';
      btn.style.cssText = 'width:100%;padding:7px;cursor:pointer';
      const done = () => { if (input.value.trim()) resolve(input.value.trim()); };
      btn.onclick = done;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      box.append(label, input, btn);
      input.focus();
    });
  }

  // ---------- the flow ----------
  try {
    // Step 1: click "Get started"
    status('Looking for "Get started"…');
    const start = await waitFor(() => findButton(['get started']));
    start.click();

    // Step 2: wait for the email field, type the email
    status('Waiting for the email form…');
    const emailInput = await waitFor(() =>
      [...document.querySelectorAll('input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[autocomplete="email"]')]
        .find(isVisible)
    );
    await sleep(400);
    setValue(emailInput, email);
    await sleep(500);

    // Step 3: click "Continue"
    status('Clicking Continue…');
    const cont = await waitFor(() => findButton(['continue', 'next', 'sign up', 'submit']));
    cont.click();

    // Step 4: wait for the code popup / input
    status('Waiting for the code popup…');
    const findCodeInputs = () => {
      const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], .modal');
      const scope = dialog || document;
      const inputs = [...scope.querySelectorAll('input')].filter(
        (i) => isVisible(i) && i !== emailInput && !['hidden', 'checkbox', 'radio', 'email', 'password'].includes(i.type)
      );
      const otp = inputs.filter((i) => i.autocomplete === 'one-time-code');
      return otp.length ? otp : inputs;
    };
    const codeInputs = await waitFor(() => { const r = findCodeInputs(); return r.length ? r : null; }, 60000);

    // Step 5: ask you for the code, then fill it in
    const code = await askForCode();
    status('Entering the code…');
    if (codeInputs.length > 1 && codeInputs.every((i) => (i.maxLength || 0) === 1)) {
      // split boxes: one digit per input
      for (let i = 0; i < codeInputs.length && i < code.length; i++) {
        setValue(codeInputs[i], code[i]);
        await sleep(60);
      }
    } else {
      setValue(codeInputs[0], code);
    }
    await sleep(500);

    // Step 6: click the button that proceeds
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], .modal') || document;
    const proceed = await waitFor(
      () => findButton(['verify', 'confirm', 'continue', 'submit', 'next', 'proceed'], dialog),
      8000
    ).catch(() => null);
    if (proceed) {
      proceed.click();
      status('Done. Check the page for the next step.');
    } else {
      status('Code entered. No button found, the page may have advanced on its own.');
    }
  } catch (e) {
    status('Stopped: ' + e.message);
  } finally {
    window.__signupRunning = false;
    setTimeout(() => box.remove(), 8000);
  }
})();
