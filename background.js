const countsPrefix = "a11y-frame:";

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlays") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "a11y-toggle-overlay-visibility" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message?.tabId;
  if (!tabId) return;
  const key = `${countsPrefix}${tabId}:${sender.frameId ?? 0}`;

  if (message?.type === "a11y-counts") {
    chrome.storage.session.set({
      [key]: { tabId, frameId: sender.frameId ?? 0, ...message.counts }
    });
    return;
  }

  if (message?.type === "a11y-get-counts") {
    chrome.storage.session.get(null).then(async (storedCounts) => {
      const totals = {
        headings: 0,
        "image.informative": 0,
        "image.decorative": 0,
        "image.missing": 0,
        "list.unordered": 0,
        "list.ordered": 0
      };
      const staleKeys = [];
      for (const [storedKey, counts] of Object.entries(storedCounts)) {
        if (!storedKey.startsWith(countsPrefix) || counts.tabId !== tabId) continue;
        try {
          const current = await chrome.tabs.sendMessage(tabId, {
            type: "a11y-get-frame-counts"
          }, { frameId: counts.frameId });
          for (const category of Object.keys(totals)) totals[category] += current[category] || 0;
        } catch {
          staleKeys.push(storedKey);
        }
      }
      if (staleKeys.length) await chrome.storage.session.remove(staleKeys);
      sendResponse(totals);
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const storedCounts = await chrome.storage.session.get(null);
  const keys = Object.entries(storedCounts)
    .filter(([key, counts]) => key.startsWith(countsPrefix) && counts.tabId === tabId)
    .map(([key]) => key);
  if (keys.length) {
    await chrome.storage.session.remove(keys);
  }
});
