// Collects recorded steps from all tabs/frames in order, and shows a REC badge.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'rec-step') {
    queue = queue.then(async () => {
      const { recording, steps = [], startedAt } = await chrome.storage.local.get(['recording', 'steps', 'startedAt']);
      if (!recording || steps.length >= 1000) return;
      steps.push({
        n: steps.length + 1,
        ms: Date.now() - startedAt,
        tab: sender.tab ? sender.tab.id : null,
        frameId: sender.frameId,
        ...msg.step
      });
      await chrome.storage.local.set({ steps });
    });
  }
});

function badge(on) {
  chrome.action.setBadgeText({ text: on ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d00000' });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recording) badge(!!changes.recording.newValue);
});
chrome.storage.local.get('recording', ({ recording }) => badge(!!recording));
