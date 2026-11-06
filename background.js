const countsPrefix = "a11y-frame:";
const axMarkerAttribute = "data-qac-ax-marker";
const debuggerStates = new Map();
let nextAxMarker = 0;

function sendCdpCommand(session, method, params = {}) {
  return chrome.debugger.sendCommand(session, method, params);
}

async function enableAxSession(session) {
  await Promise.all([
    sendCdpCommand(session, "DOM.enable"),
    sendCdpCommand(session, "Accessibility.enable"),
    sendCdpCommand(session, "Page.enable")
  ]);
  await sendCdpCommand(session, "DOM.getDocument", { depth: 0, pierce: true });
  await sendCdpCommand(session, "Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [{ type: "iframe", exclude: false }]
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId || method !== "Target.attachedToTarget") return;
  const state = debuggerStates.get(source.tabId);
  if (!state) return;

  const session = { tabId: source.tabId, sessionId: params.sessionId };
  state.sessions.set(params.sessionId, session);
  enableAxSession(session).catch((error) => {
    console.warn("Could not enable accessibility inspection for an iframe", error);
  });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) debuggerStates.delete(source.tabId);
});

function collectFrameIds(frameTree, frameIds = []) {
  if (frameTree?.frame?.id) frameIds.push(frameTree.frame.id);
  for (const child of frameTree?.childFrames || []) collectFrameIds(child, frameIds);
  return frameIds;
}

function axValue(node, name) {
  return node.properties?.find((property) => property.name === name)?.value?.value;
}

function hasActiveAxChecks(checks = {}) {
  return checks.extensionActive === true && checks.overlaysVisible === true && (
    checks.headings === true || checks.image?.informative === true ||
    checks.image?.decorative === true || checks.image?.missing === true ||
    checks.list?.unordered === true || checks.list?.ordered === true
  );
}

async function ensureAxDebugger(tabId) {
  let state = debuggerStates.get(tabId);
  if (state?.closePromise) {
    await state.closePromise;
    if (debuggerStates.get(tabId) === state) debuggerStates.delete(tabId);
    return ensureAxDebugger(tabId);
  }
  if (state) return state;

  state = { sessions: new Map(), latestChecks: null, latestScanId: 0, scanPromise: null };
  debuggerStates.set(tabId, state);
  const rootSession = { tabId };
  state.sessions.set("root", rootSession);
  try {
    await chrome.debugger.attach(rootSession, "1.3");
    await enableAxSession(rootSession);
  } catch (error) {
    debuggerStates.delete(tabId);
    throw error;
  }
  return state;
}

async function detachAxDebugger(tabId, state) {
  if (debuggerStates.get(tabId) !== state) return;
  state.closePromise = chrome.debugger.detach({ tabId }).catch(() => {});
  await state.closePromise;
  if (debuggerStates.get(tabId) === state) debuggerStates.delete(tabId);
}

async function collectAxSemantics(tabId, state, scanId) {
  const markedItems = new Map();
  const markedNodes = [];
  for (const session of state.sessions.values()) {
    let frameIds;
    let rootFrameId;
    try {
      const { frameTree } = await sendCdpCommand(session, "Page.getFrameTree");
      rootFrameId = frameTree?.frame?.id;
      frameIds = collectFrameIds(frameTree);
    } catch {
      frameIds = [undefined];
    }

    for (const frameId of frameIds) {
      try {
        const tree = await sendCdpCommand(session, "Accessibility.getFullAXTree", frameId ? { frameId } : {});
        const candidates = (tree.nodes || []).filter((node) => {
          const role = node.role?.value;
          return !node.ignored && node.backendDOMNodeId &&
            ["heading", "img", "image", "list", "listitem"].includes(role);
        });
        if (!candidates.length) continue;

        const backendNodeIds = candidates.map((node) => node.backendDOMNodeId);
        const { nodeIds } = await sendCdpCommand(session, "DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds });
        for (let index = 0; index < candidates.length; index += 1) {
          const nodeId = nodeIds?.[index];
          if (!nodeId) continue;
          const { node } = await sendCdpCommand(session, "DOM.describeNode", { nodeId, depth: 0 });
          const attributes = node.attributes || [];
          const localName = node.localName || node.nodeName?.toLowerCase() || "";
          const axNode = candidates[index];
          const isHeading = axNode.role.value === "heading";
          let customizedBuiltIn = false;
          for (let index = 0; index < attributes.length; index += 2) {
            if (attributes[index] === "is") customizedBuiltIn = true;
          }
          if (!isHeading && !localName.includes("-") && !customizedBuiltIn) continue;

          const role = axNode.role.value === "image" ? "img" : axNode.role.value;
          const marker = `ax-${++nextAxMarker}`;
          await sendCdpCommand(session, "DOM.setAttributeValue", {
            nodeId,
            name: axMarkerAttribute,
            value: marker
          });
          let bounds;
          if (isHeading && rootFrameId && frameId === rootFrameId) {
            try {
              const { model } = await sendCdpCommand(session, "DOM.getBoxModel", { nodeId });
              const border = model?.border || [];
              if (border.length >= 8) {
                const horizontal = border.filter((_coordinate, coordinateIndex) => coordinateIndex % 2 === 0);
                const vertical = border.filter((_coordinate, coordinateIndex) => coordinateIndex % 2 === 1);
                const left = Math.min(...horizontal);
                const top = Math.min(...vertical);
                bounds = {
                  left,
                  top,
                  width: Math.max(...horizontal) - left,
                  height: Math.max(...vertical) - top
                };
              }
            } catch {
              // Some accessibility nodes do not expose a box model.
            }
          }
          markedNodes.push({ session, nodeId });
          markedItems.set(marker, {
            role,
            name: axNode.name?.value || "",
            level: axValue(axNode, "level") || 2,
            localName,
            frameId,
            bounds
          });
        }
      } catch (error) {
        console.warn("Could not read an accessibility frame", error);
      }
    }
  }

  if (!markedItems.size) return;

  let frameResults;
  try {
    frameResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (attribute) => {
        const results = [];
        const visit = (root) => {
          for (const element of root.querySelectorAll(`[${attribute}]`)) {
            results.push({ marker: element.getAttribute(attribute) });
          }
          for (const host of root.querySelectorAll("*")) {
            if (host.shadowRoot) visit(host.shadowRoot);
          }
        };
        visit(document);
        return results;
      },
      args: [axMarkerAttribute]
    });
  } catch (error) {
    await Promise.all(markedNodes.map(({ session, nodeId }) =>
      sendCdpCommand(session, "DOM.removeAttribute", { nodeId, name: axMarkerAttribute }).catch(() => {})
    ));
    throw error;
  }

  const itemsByFrame = new Map();
  const foundMarkers = new Set();
  const availableFrameIds = new Set(frameResults.map(({ frameId }) => frameId));
  for (const frameResult of frameResults) {
    const items = (frameResult.result || [])
      .filter(({ marker }) => markedItems.has(marker))
      .map(({ marker }) => {
        foundMarkers.add(marker);
          const { frameId: _frameId, bounds: _bounds, ...item } = markedItems.get(marker);
          return { marker, ...item };
      });
    if (items.length) itemsByFrame.set(frameResult.frameId, items);
  }
  for (const [marker, item] of markedItems) {
    if (foundMarkers.has(marker) || !item.bounds || !availableFrameIds.has(item.frameId)) continue;
    const frameItems = itemsByFrame.get(item.frameId) || [];
    frameItems.push({ ...item, marker: undefined });
    itemsByFrame.set(item.frameId, frameItems);
  }

  if (state.latestScanId === scanId) {
    for (const [frameId, items] of itemsByFrame) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "a11y-ax-semantics", items }, { frameId });
      } catch {
        // The frame may have navigated after its accessibility tree was read.
      }
    }
  }

  await Promise.all(markedNodes.map(({ session, nodeId }) =>
    sendCdpCommand(session, "DOM.removeAttribute", { nodeId, name: axMarkerAttribute }).catch(() => {})
  ));
}

async function requestAxScan(tabId, checks, scanId) {
  const active = hasActiveAxChecks(checks);
  const state = active ? await ensureAxDebugger(tabId) : debuggerStates.get(tabId);
  if (!active) {
    if (state) {
      state.latestScanId = scanId;
      state.latestChecks = null;
      if (state.scanPromise) {
        await state.scanPromise;
      } else {
        await detachAxDebugger(tabId, state);
      }
    }
    return;
  }

  state.latestChecks = checks;
  state.latestScanId = scanId;
  if (state.scanPromise) return;
  state.scanPromise = (async () => {
    while (state.latestChecks && hasActiveAxChecks(state.latestChecks)) {
      const checksToUse = state.latestChecks;
      const scanIdToUse = state.latestScanId;
      state.latestChecks = null;
      await collectAxSemantics(tabId, state, scanIdToUse);
      if (state.latestChecks === checksToUse) state.latestChecks = null;
    }
  })().catch((error) => {
    console.warn("Accessibility tree inspection is unavailable", error);
  }).finally(() => {
    state.scanPromise = null;
    if (!state.latestChecks || !hasActiveAxChecks(state.latestChecks)) {
      return detachAxDebugger(tabId, state);
    }
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlays") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "a11y-toggle-overlay-visibility" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message?.tabId;
  if (!tabId) return;
  const key = `${countsPrefix}${tabId}:${sender.frameId ?? 0}`;

  if (message?.type === "a11y-ax-scan") {
    requestAxScan(tabId, message.checks, message.scanId).catch((error) => {
      console.warn("Could not inspect the page accessibility tree", error);
      chrome.runtime.sendMessage({ type: "a11y-ax-unavailable", tabId }).catch(() => {});
    });
    return;
  }

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
  if (debuggerStates.has(tabId)) {
    debuggerStates.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  const storedCounts = await chrome.storage.session.get(null);
  const keys = Object.entries(storedCounts)
    .filter(([key, counts]) => key.startsWith(countsPrefix) && counts.tabId === tabId)
    .map(([key]) => key);
  if (keys.length) {
    await chrome.storage.session.remove(keys);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading" || !debuggerStates.has(tabId)) return;
  debuggerStates.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
});
