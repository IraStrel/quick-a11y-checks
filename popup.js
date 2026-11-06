const checks = [...document.querySelectorAll("[data-check]")];
const imageMain = document.querySelector("[data-image-main]");
const imageChecks = checks.filter((input) => input.dataset.check.startsWith("image."));
const listMain = document.querySelector("[data-list-main]");
const listChecks = checks.filter((input) => input.dataset.check.startsWith("list."));
const status = document.querySelector("#status");
const activityToggle = document.querySelector("#activity-toggle");
const activityLabel = document.querySelector("#activity-label");
const overlayToggle = document.querySelector("#overlay-toggle");
const hoverLabelsSwitch = document.querySelector("#show-labels-on-hover");
const knownCounts = new Set();
let extensionActive = true;
let overlaysVisible = true;
let showLabelsOnHover = false;
let unsupported = false;

function isUnsupportedUrl(url = "") {
  return !url ||
    /^(chrome|edge):\/\//.test(url) ||
    url === "about:blank" ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com");
}

function selectedFilters() {
  return checks
    .filter((input) => input.checked && !input.dataset.imageMain && !input.dataset.listMain)
    .map((input) => input.dataset.check);
}

async function saveState() {
  await chrome.storage.local.set({
    extensionActive,
    overlaysVisible,
    showLabelsOnHover,
    selectedFilters: selectedFilters()
  });
}

function updateOperationalUi() {
  const hasFilters = checks.some((input) => input.checked);
  const overlaysActive = extensionActive && overlaysVisible && hasFilters && !unsupported;
  document.querySelector(".popup-card").classList.toggle("paused", !extensionActive && !unsupported);
  document.querySelector(".popup-card").classList.toggle("unsupported", unsupported);
  activityToggle.classList.toggle("paused", !extensionActive && !unsupported);
  activityToggle.classList.toggle("unsupported", unsupported);
  activityToggle.setAttribute("aria-pressed", String(extensionActive));
  activityLabel.textContent = unsupported ? "Unsupported" : extensionActive ? "Active" : "Paused";
  checks.forEach((input) => {
    input.disabled = unsupported || !extensionActive;
  });
  overlayToggle.classList.toggle("active", overlaysActive);
  overlayToggle.classList.toggle("paused", !overlaysActive);
  status.textContent = unsupported
    ? "Unsupported page"
    : !extensionActive
      ? "Audit paused"
      : overlaysActive
        ? "Highlight overlays enabled"
        : "No overlays active";
}

function setStatus(message) {
  status.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab");
  }
  return tab;
}

async function sendTabMessage(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!error?.message?.includes("Receiving end does not exist")) throw error;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function sendCheck(check, enabled) {
  const tab = await getActiveTab();
  await sendTabMessage(tab, {
    type: "a11y-check-toggle",
    check,
    enabled
  });
}

async function sendOperationalState() {
  const tab = await getActiveTab();
  await sendTabMessage(tab, {
    type: "a11y-operational-state",
    extensionActive,
    overlaysVisible,
    showLabelsOnHover
  });
}

async function syncSelectedFilters() {
  for (const input of checks) {
    if (input.checked && !input.dataset.imageMain && !input.dataset.listMain) {
      await sendCheck(input.dataset.check, true);
    }
  }
}

function updateImageMain() {
  const selected = imageChecks.filter((input) => input.checked).length;
  imageMain.checked = selected === imageChecks.length;
  imageMain.indeterminate = selected > 0 && selected < imageChecks.length;
}

function updateListMain() {
  const selected = listChecks.filter((input) => input.checked).length;
  listMain.checked = selected === listChecks.length;
  listMain.indeterminate = selected > 0 && selected < listChecks.length;
}

function updateCounts(counts) {
  const totals = {
    ...counts,
    "image.total": (counts?.["image.informative"] || 0) +
      (counts?.["image.decorative"] || 0) + (counts?.["image.missing"] || 0),
    "list.total": (counts?.["list.unordered"] || 0) +
      (counts?.["list.ordered"] || 0)
  };
  document.querySelectorAll("[data-count]").forEach((element) => {
    const category = element.dataset.count;
    const isEnabled = category === "headings"
      ? document.querySelector("[data-check='headings']")?.checked
      : category === "image.total"
        ? imageChecks.some((input) => input.checked)
      : category.startsWith("image.")
        ? document.querySelector(`[data-check='${category}']`)?.checked
          : category === "list.total"
            ? listChecks.some((input) => input.checked)
        : category.startsWith("list.")
            ? document.querySelector(`[data-check='${category}']`)?.checked
          : false;
    if (isEnabled) knownCounts.add(category);
    element.textContent = knownCounts.has(category) ? String(totals[category] ?? 0) : "";
  });
}

function clearCounts() {
  document.querySelectorAll("[data-count]").forEach((element) => {
    if (!knownCounts.has(element.dataset.count)) element.textContent = "";
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "a11y-ax-unavailable") {
    setStatus("Computed accessibility semantics unavailable on this page.");
  }
});

async function refreshCounts() {
  const tab = await getActiveTab();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const counts = await chrome.runtime.sendMessage({
    type: "a11y-get-counts",
    tabId: tab.id
  });
  updateCounts(counts);
}

async function loadState() {
  try {
    const tab = await getActiveTab();
    unsupported = isUnsupportedUrl(tab.url);
    if (unsupported) {
      updateOperationalUi();
      return;
    }
    const stored = await chrome.storage.local.get({
      extensionActive: true,
      overlaysVisible: true,
      showLabelsOnHover: false,
      selectedFilters: []
    });
    extensionActive = stored.extensionActive !== false;
    overlaysVisible = stored.overlaysVisible !== false;
    showLabelsOnHover = stored.showLabelsOnHover === true;
    const currentState = await sendTabMessage(tab, { type: "a11y-check-state" });
    const savedFilters = stored.selectedFilters.filter((filter) =>
      filter !== "images" && filter !== "lists"
    );
    const filtersNeedRestore = savedFilters.some((filter) => currentState?.[filter] !== true);
    for (const input of checks) {
      input.checked = savedFilters.length
        ? savedFilters.includes(input.dataset.check)
        : currentState?.[input.dataset.check] === true;
    }
    if (filtersNeedRestore) extensionActive = false;
    if (filtersNeedRestore) await saveState();
    updateImageMain();
    updateListMain();
    if (hoverLabelsSwitch) {
      hoverLabelsSwitch.checked = showLabelsOnHover;
    }
    await sendOperationalState();
    updateOperationalUi();
    if (!unsupported && checks.some((input) => input.checked)) {
      await refreshCounts();
    } else {
      clearCounts();
    }
  } catch (error) {
    setStatus("Open a webpage to start checking.");
    console.error(error);
  }
}

activityToggle.addEventListener("click", async () => {
  if (unsupported) return;
  extensionActive = !extensionActive;
  await saveState();
  await sendOperationalState();
  if (extensionActive) await syncSelectedFilters();
  updateOperationalUi();
});

overlayToggle.addEventListener("click", async () => {
  if (unsupported) return;
  overlaysVisible = !overlaysVisible;
  await saveState();
  await sendOperationalState();
  updateOperationalUi();
});

hoverLabelsSwitch?.addEventListener("change", async () => {
  if (unsupported) return;
  showLabelsOnHover = hoverLabelsSwitch.checked;
  await saveState();
  await sendOperationalState();
  updateOperationalUi();
});

for (const input of checks) {
  input.addEventListener("change", async () => {
    if (input === imageMain) {
      const enabled = input.checked;
      for (const imageCheck of imageChecks) imageCheck.checked = enabled;
      input.indeterminate = false;
      for (const imageCheck of imageChecks) {
        await sendCheck(imageCheck.dataset.check, enabled);
      }
      await refreshCounts();
      await saveState();
      updateOperationalUi();
      return;
    }
    if (input === listMain) {
      const enabled = input.checked;
      for (const listCheck of listChecks) listCheck.checked = enabled;
      input.indeterminate = false;
      for (const listCheck of listChecks) {
        await sendCheck(listCheck.dataset.check, enabled);
      }
      await refreshCounts();
      await saveState();
      updateOperationalUi();
      return;
    }
    input.disabled = true;
    try {
      await sendCheck(input.dataset.check, input.checked);
      if (imageChecks.includes(input)) updateImageMain();
      if (listChecks.includes(input)) updateListMain();
      await refreshCounts();
      await saveState();
      updateOperationalUi();
    } catch (error) {
      input.checked = !input.checked;
      setStatus("This page cannot be checked.");
      console.error(error);
    } finally {
      input.disabled = false;
    }
  });
}

loadState().catch((error) => {
  setStatus("Open a webpage to start checking.");
  console.error(error);
});
