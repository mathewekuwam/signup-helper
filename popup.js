const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- recorder controls ----------
async function refresh() {
  const { recording, steps = [] } = await chrome.storage.local.get(['recording', 'steps']);
  $('recStatus').textContent = recording
    ? `● Recording… ${steps.length} steps`
    : `Not recording (${steps.length} steps saved)`;
  $('recStart').disabled = !!recording;
  $('recStop').disabled = !recording;
}
setInterval(refresh, 1000);
refresh();

function buildFrom(steps) {
  if (!steps || !steps.length) { $('recMsg').textContent = 'Nothing recorded yet.'; return; }
  let res;
  try { res = Generator.build(steps); } catch (e) { $('recMsg').textContent = 'Build failed: ' + e.message; return; }
  if (!res.ok) { $('recMsg').textContent = res.message; return; }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.blob);
  a.download = res.zipName;
  a.click();

  $('recMsg').textContent =
    `Built ${res.zipName}\n` +
    `Unzip it, then chrome://extensions → Load unpacked.\n\n` +
    `Actions detected:\n${res.summary.join('\n')}` +
    (res.warnings.length ? '\n\n⚠ ' + res.warnings.join('\n⚠ ') : '');
}

$('recStart').addEventListener('click', async () => {
  await chrome.storage.local.set({ recording: true, steps: [], startedAt: Date.now() });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['recorder.js'] });
  } catch (e) { /* page may block injection; reload it instead */ }
  $('recMsg').textContent = 'Recording. Do the signup yourself, then press "Stop & build extension".';
  refresh();
});

$('recStop').addEventListener('click', async () => {
  $('recMsg').textContent = 'Finishing…';
  await wait(1000); // let the last typed value be captured
  await chrome.storage.local.set({ recording: false });
  await wait(300);
  const { steps = [] } = await chrome.storage.local.get('steps');
  buildFrom(steps);
  refresh();
});

$('recBuild').addEventListener('click', async () => {
  const { steps = [] } = await chrome.storage.local.get('steps');
  buildFrom(steps);
});

$('pasteBuild').addEventListener('click', () => {
  try {
    const json = JSON.parse($('pasteJson').value);
    buildFrom(Array.isArray(json) ? json : json.steps);
  } catch (e) {
    $('recMsg').textContent = 'That is not valid JSON: ' + e.message;
  }
});

async function getRecordingJson() {
  const { steps = [], startedAt } = await chrome.storage.local.get(['steps', 'startedAt']);
  return { count: steps.length, text: JSON.stringify({ recordedAt: startedAt ? new Date(startedAt).toISOString() : null, steps }, null, 1) };
}

$('recCopy').addEventListener('click', async () => {
  const { count, text } = await getRecordingJson();
  try {
    await navigator.clipboard.writeText(text);
    $('recMsg').textContent = `Copied ${count} steps to clipboard.`;
  } catch (e) {
    $('recMsg').textContent = 'Copy failed, use Download JSON instead.';
  }
});

$('recDownload').addEventListener('click', async () => {
  const { count, text } = await getRecordingJson();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'signup-recording.json';
  a.click();
  $('recMsg').textContent = `Downloaded ${count} steps.`;
});

$('recClear').addEventListener('click', async () => {
  await chrome.storage.local.set({ steps: [] });
  $('recMsg').textContent = 'Cleared.';
  refresh();
});

// ---------- built-in test automation (original version) ----------
chrome.storage.local.get('email', ({ email }) => { if (email) $('email').value = email; });

$('start').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) { $('msg').textContent = 'Enter an email first.'; return; }
  chrome.storage.local.set({ email });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (cfg) => { window.__signupConfig = cfg; },
      args: [{ email }]
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    $('msg').textContent = 'Started. Watch the page for progress.';
    setTimeout(() => window.close(), 800);
  } catch (e) {
    $('msg').textContent = 'Could not run on this page: ' + e.message;
  }
});
