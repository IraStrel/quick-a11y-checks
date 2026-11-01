(() => {
  const overlayAttribute = "data-a11y-extension-overlay";
  const state = {
    extensionActive: true,
    overlaysVisible: true,
    showLabelsOnHover: false,
    headings: false,
    image: {
      informative: false,
      decorative: false,
      missing: false
    },
    list: {
      unordered: false,
      ordered: false
    }
  };

  const styles = {
    heading: {
      levels: {
        1: { color: "#167a3d", background: "#dff5e7", outline: "2px solid #167a3d" },
        2: { color: "#1557a6", background: "#e0f0ff", outline: "2px solid #1557a6" },
        3: { color: "#9a5b00", background: "#fff0d9", outline: "2px solid #9a5b00" },
        4: { color: "#713f9e", background: "#f0e0ff", outline: "2px solid #713f9e" },
        5: { color: "#006b73", background: "#dff7f7", outline: "2px solid #006b73" },
        6: { color: "#795548", background: "#efebe9", outline: "2px solid #795548" }
      },
      fallback: { color: "#4b5563", background: "#f3f4f6", outline: "2px solid #4b5563" }
    },
    image: {
      filled: { background: "#fff4d6", outline: "3px solid #C9813F" },
      empty: { background: "#e0ffe0", outline: "3px solid green" },
      missing: { background: "#ffe0e0", outline: "3px solid red" },
      role: { background: "#f0e0ff", outline: "3px solid purple" }
    },
    list: {
      unordered: { background: "#dceeff", outline: "3px solid blue" },
      ordered: { background: "#fff0d9", outline: "3px solid orange" },
      item: { background: "#e0ffe0", outline: "3px solid green" }
    }
  };

  function composedParent(node) {
    if (!node) return null;
    if (node.parentNode) return node.parentNode;
    return node instanceof ShadowRoot ? node.host : null;
  }

  function isHidden(node) {
    for (let current = node; current; current = composedParent(current)) {
      if (current.nodeType !== Node.ELEMENT_NODE) continue;
      if (current.hasAttribute("hidden")) return true;
      const computed = getComputedStyle(current);
      if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") return true;
    }
    return false;
  }

  function isAriaHidden(node) {
    for (let current = node; current; current = composedParent(current)) {
      if (current.nodeType === Node.ELEMENT_NODE && current.getAttribute("aria-hidden") === "true") {
        return true;
      }
    }
    return false;
  }

  function isVisible(element) {
    if (isHidden(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const overlayTargets = new WeakMap();
  const overlayTargetsByHoverTarget = new WeakMap();
  let overlayPositionUpdateScheduled = false;

  function getVisibleRect(element) {
    const rect = element.getBoundingClientRect();
    const visibleRect = {
      top: Math.max(0, rect.top),
      right: Math.min(document.documentElement.clientWidth, rect.right),
      bottom: Math.min(document.documentElement.clientHeight, rect.bottom),
      left: Math.max(0, rect.left)
    };

    for (let ancestor = composedParent(element); ancestor; ancestor = composedParent(ancestor)) {
      if (ancestor.nodeType !== Node.ELEMENT_NODE) continue;

      const style = getComputedStyle(ancestor);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;

      const ancestorRect = ancestor.getBoundingClientRect();
      const clipLeft = ancestorRect.left + ancestor.clientLeft;
      const clipTop = ancestorRect.top + ancestor.clientTop;
      if (style.overflowX !== "visible") {
        visibleRect.left = Math.max(visibleRect.left, clipLeft);
        visibleRect.right = Math.min(visibleRect.right, clipLeft + ancestor.clientWidth);
      }
      if (style.overflowY !== "visible") {
        visibleRect.top = Math.max(visibleRect.top, clipTop);
        visibleRect.bottom = Math.min(visibleRect.bottom, clipTop + ancestor.clientHeight);
      }
    }

    if (visibleRect.right <= visibleRect.left || visibleRect.bottom <= visibleRect.top) return null;
    return visibleRect;
  }

  function positionOverlay(highlight, target, rect) {
    const visibleRect = getVisibleRect(target.element);
    target.inViewport = target.intersectionKnown
      && target.isIntersecting
      && visibleRect !== null
      && !isHidden(target.element);
    target.visibleRect = target.inViewport ? visibleRect : null;
    if (!target.inViewport) {
      highlight.style.visibility = "hidden";
      target.label.style.visibility = "hidden";
      return;
    }

    Object.assign(highlight.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      clipPath: `inset(${visibleRect.top - rect.top}px ${rect.right - visibleRect.right}px ${rect.bottom - visibleRect.bottom}px ${visibleRect.left - rect.left}px)`,
      visibility: "visible"
    });
    if (target.labelPlacement === "inside-top-right") {
      target.label.style.maxWidth = `${Math.min(300, visibleRect.width)}px`;
      target.label.style.top = `${visibleRect.top}px`;
      target.label.style.left = `${visibleRect.right - target.label.getBoundingClientRect().width}px`;
    } else {
      const labelHeight = target.label.getBoundingClientRect().height;
      const labelTop = visibleRect.top >= labelHeight
        ? visibleRect.top - labelHeight
        : visibleRect.bottom;
      target.label.style.top = `${labelTop}px`;
      target.label.style.left = `${visibleRect.left}px`;
    }
    target.label.style.visibility = target.labelVisible ? "visible" : "hidden";
  }

  function updateOverlayPositions() {
    document.querySelectorAll("[data-a11y-extension-highlight-overlay]").forEach((highlight) => {
      const target = overlayTargets.get(highlight);
      if (!target || !target.element.isConnected) return;

      const rect = target.element.getBoundingClientRect();
      positionOverlay(highlight, target, rect);
    });
  }

  function scheduleOverlayPositionUpdate() {
    if (overlayPositionUpdateScheduled) return;
    overlayPositionUpdateScheduled = true;
    window.requestAnimationFrame(() => {
      overlayPositionUpdateScheduled = false;
      updateOverlayPositions();
    });
  }

  document.addEventListener("scroll", scheduleOverlayPositionUpdate, true);
  window.addEventListener("resize", scheduleOverlayPositionUpdate);

  function targetsForHoverEvent(event) {
    const targets = new Set();
    for (const node of event.composedPath()) {
      if (node instanceof Element) {
        overlayTargetsByHoverTarget.get(node)?.forEach((target) => targets.add(target));
      }
    }
    return targets;
  }

  function isWithinHoverTarget(node, hoverTarget) {
    for (let current = node; current; current = composedParent(current)) {
      if (current === hoverTarget) return true;
    }
    return false;
  }

  document.addEventListener("pointerover", (event) => {
    if (!state.showLabelsOnHover) return;
    targetsForHoverEvent(event).forEach((target) => target.showLabel());
  }, true);

  document.addEventListener("pointerout", (event) => {
    if (!state.showLabelsOnHover) return;
    targetsForHoverEvent(event).forEach((target) => {
      if (isWithinHoverTarget(event.relatedTarget, target.hoverTarget)) return;
      target.hideLabel();
    });
  }, true);

  function addOverlay(element, text, style, labelPlacement = "outside-top-left") {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const highlight = document.createElement("div");
    highlight.setAttribute("data-a11y-extension-highlight-overlay", "true");
    Object.assign(highlight.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      boxSizing: "border-box",
      border: style.outline,
      borderRadius: "0px",
      background: "transparent",
      zIndex: "2147483646",
      pointerEvents: "none",
      visibility: "hidden"
    });
    document.documentElement.appendChild(highlight);

    const label = document.createElement("div");
    label.setAttribute(overlayAttribute, "true");
    label.textContent = text;
    Object.assign(label.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      background: style.background,
      color: style.color || "black",
      font: "bold 12px Arial, sans-serif",
      lineHeight: "16px",
      padding: "2px 5px",
      border: "1px solid #000",
      borderRadius: "4px",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxSizing: "border-box",
      maxWidth: "300px",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      opacity: state.showLabelsOnHover ? "0" : "1",
      visibility: "hidden",
      transition: "opacity 0.12s ease, visibility 0.12s ease"
    });
    document.documentElement.appendChild(label);
    const target = {
      element,
      label,
      hoverTarget: hoverTargetFor(element),
      labelPlacement,
      intersectionKnown: false,
      isIntersecting: false,
      inViewport: false,
      labelVisible: !state.showLabelsOnHover
    };
    let hoverTargets = overlayTargetsByHoverTarget.get(target.hoverTarget);
    if (!hoverTargets) {
      hoverTargets = new Set();
      overlayTargetsByHoverTarget.set(target.hoverTarget, hoverTargets);
    }
    hoverTargets.add(target);
    overlayTargets.set(highlight, target);
    target.visibilityObserver = new IntersectionObserver(([entry]) => {
      if (!element.isConnected) return;
      target.intersectionKnown = true;
      target.isIntersecting = entry.isIntersecting
        && entry.intersectionRect.width > 0
        && entry.intersectionRect.height > 0;
      positionOverlay(highlight, target, element.getBoundingClientRect());
    });
    target.visibilityObserver.observe(element);
    positionOverlay(highlight, target, rect);

    const showLabel = () => {
      if (!state.showLabelsOnHover) return;
      window.clearTimeout(target.hideLabelTimer);
      target.hideLabelTimer = null;
      target.labelVisible = true;
      label.style.opacity = "1";
      label.style.visibility = target.inViewport ? "visible" : "hidden";
      scheduleOverlayPositionUpdate();
    };
    const hideLabel = () => {
      if (!state.showLabelsOnHover) return;
      window.clearTimeout(target.hideLabelTimer);
      target.hideLabelTimer = window.setTimeout(() => {
        target.labelVisible = false;
        label.style.opacity = "0";
        label.style.visibility = "hidden";
      }, 300);
    };
    target.showLabel = showLabel;
    target.hideLabel = hideLabel;
    target.hoverTarget.addEventListener("focusin", showLabel);
    target.hoverTarget.addEventListener("focusout", hideLabel);
    target.hoverTarget.addEventListener("transitionend", scheduleOverlayPositionUpdate);
    highlight.addEventListener("pointerenter", showLabel);
    highlight.addEventListener("pointerleave", hideLabel);
  }

  function accessibleName(element, root) {
    const label = element.getAttribute("aria-label");
    if (label?.trim()) return label.trim();
    const ids = element.getAttribute("aria-labelledby");
    if (!ids) return "";
    return ids.split(/\s+/)
      .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent.trim() || "")
      .filter(Boolean)
      .join(" ");
  }

  function hoverTargetFor(element) {
    let pointerTarget = null;
    for (let current = element; current; current = composedParent(current)) {
      if (current.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = current.tagName.toLowerCase();
      const parent = composedParent(current);
      const hasPointerCursor = getComputedStyle(current).cursor === "pointer";
      const parentHasPointerCursor = parent?.nodeType === Node.ELEMENT_NODE
        && getComputedStyle(parent).cursor === "pointer";
      if (hasPointerCursor && !parentHasPointerCursor) pointerTarget = current;
      if (
        tag === "button"
        || (tag === "a" && current.hasAttribute("href"))
        || current.hasAttribute("href")
        || ["button", "link", "listitem"].includes(current.getAttribute("role"))
      ) {
        return current;
      }
    }
    return pointerTarget || element;
  }

  function listTypeForItem(element) {
    for (let current = composedParent(element); current; current = composedParent(current)) {
      if (current.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = current.tagName.toLowerCase();
      if (tag === "ol") return "ordered";
      if (tag === "ul" || current.getAttribute("role") === "list") return "unordered";
    }
    return element.getAttribute("role") === "listitem" ? "unordered" : null;
  }

  function walk(root, callback) {
    callback(root);
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) walk(host.shadowRoot, callback);
    }
  }

  function auditHeadings() {
    let count = 0;
    walk(document, (root) => {
      for (const element of root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading'][aria-level]")) {
        if (!isVisible(element) || isAriaHidden(element)) continue;
        const tag = element.tagName.toLowerCase();
        const isNativeHeading = /^h[1-6]$/.test(tag);
        const level = isNativeHeading ? Number(tag.slice(1)) : Number(element.getAttribute("aria-level"));
        const headingLabel = isNativeHeading ? tag.toUpperCase() : `ARIA H${element.getAttribute("aria-level")}`;
        const headingText = element.textContent.replace(/\s+/g, " ").trim();
        const text = headingText ? `${headingLabel}: ${headingText}` : headingLabel;
        const style = styles.heading.levels[level] || styles.heading.fallback;
        if (state.headings) {
          addOverlay(element, text, style);
        }
        count += 1;
      }
    });
    return count;
  }

  function auditImages() {
    const count = { informative: 0, decorative: 0, missing: 0 };
    walk(document, (root) => {
      for (const image of root.querySelectorAll("img,svg")) {
        if (!isVisible(image)) continue;
        if (isAriaHidden(image)) {
          count.decorative += 1;
          if (state.image.decorative) addOverlay(image, 'DECORATIVE (aria-hidden="true")', styles.image.empty);
          continue;
        }
        if (image.tagName.toLowerCase() === "svg") {
          const name = accessibleName(image, root);
          if (name) {
            count.informative += 1;
            if (state.image.informative) {
            addOverlay(image, `SVG NAME: "${name}"`, styles.image.filled);
            }
          } else {
            count.missing += 1;
            if (state.image.missing) addOverlay(image, "SVG NO ACCESSIBLE NAME", styles.image.missing);
          }
          continue;
        }
        const hasAlt = image.hasAttribute("alt");
        const alt = image.getAttribute("alt") || "";
        if (hasAlt && !alt.trim()) {
          count.decorative += 1;
          if (state.image.decorative) addOverlay(image, 'ALT EMPTY ("")', styles.image.empty);
        } else if (!hasAlt) {
          count.missing += 1;
          if (state.image.missing) addOverlay(image, "NO ALT", styles.image.missing);
        } else {
          count.informative += 1;
          if (state.image.informative) addOverlay(image, `ALT: ${alt}`, styles.image.filled);
        }
      }
      for (const element of root.querySelectorAll('[role="img"]:not(img):not(svg)')) {
        if (!isVisible(element)) continue;
        if (isAriaHidden(element)) {
          count.decorative += 1;
          if (state.image.decorative) addOverlay(element, 'DECORATIVE (aria-hidden="true")', styles.image.empty);
          continue;
        }
        const name = accessibleName(element, root);
        if (name) {
          count.informative += 1;
          if (state.image.informative) addOverlay(element, `ROLE=IMG NAME: "${name}"`, styles.image.role);
        } else {
          count.missing += 1;
          if (state.image.missing) addOverlay(element, "ROLE=IMG NO ACCESSIBLE NAME", styles.image.missing);
        }
      }
    });
    return count;
  }

  function auditLists() {
    const count = { unordered: 0, ordered: 0 };
    walk(document, (root) => {
      for (const element of root.querySelectorAll("ul,[role='list']")) {
        if (isVisible(element) && !isAriaHidden(element)) {
          count.unordered += 1;
          if (state.list.unordered) addOverlay(element, "Unordered list", styles.list.unordered);
        }
      }
      for (const element of root.querySelectorAll("ol")) {
        if (isVisible(element) && !isAriaHidden(element)) {
          count.ordered += 1;
          if (state.list.ordered) addOverlay(element, "Ordered list", styles.list.ordered);
        }
      }
      for (const element of root.querySelectorAll("li,[role='listitem']")) {
        const listType = listTypeForItem(element);
        if (isVisible(element) && !isAriaHidden(element) && listType && state.list[listType]) {
          addOverlay(element, "List item", styles.list.item, "inside-top-right");
        }
      }
    });
    return count;
  }

  function render() {
    removeOverlays();
    walk(document, (root) => {
      root.querySelectorAll("[data-a11y-extension-outline]").forEach((element) => {
        element.style.removeProperty("outline");
        element.style.removeProperty("box-shadow");
        element.style.removeProperty("outline-offset");
        element.removeAttribute("data-a11y-extension-outline");
      });
    });
    const counts = {
      headings: auditHeadings(),
      "image.informative": 0,
      "image.decorative": 0,
      "image.missing": 0,
      "list.unordered": 0,
      "list.ordered": 0
    };
    const imageCounts = auditImages();
    counts["image.informative"] = imageCounts.informative;
    counts["image.decorative"] = imageCounts.decorative;
    counts["image.missing"] = imageCounts.missing;
    const listCounts = auditLists();
    counts["list.unordered"] = listCounts.unordered;
    counts["list.ordered"] = listCounts.ordered;
    if (!state.extensionActive || !state.overlaysVisible) {
      removeOverlays();
      walk(document, (root) => {
        root.querySelectorAll("[data-a11y-extension-outline]").forEach((element) => {
          element.style.removeProperty("outline");
          element.style.removeProperty("box-shadow");
          element.style.removeProperty("outline-offset");
          element.removeAttribute("data-a11y-extension-outline");
        });
      });
    }
    chrome.runtime.sendMessage({ type: "a11y-counts", counts });
    lastCounts = counts;
  }

  function removeOverlays() {
    document.querySelectorAll("[data-a11y-extension-highlight-overlay]").forEach((highlight) => {
      const target = overlayTargets.get(highlight);
      if (!target) return;
      window.clearTimeout(target.hideLabelTimer);
      overlayTargetsByHoverTarget.get(target.hoverTarget)?.delete(target);
      target.visibilityObserver.disconnect();
      highlight.remove();
    });
    document.querySelectorAll(`[${overlayAttribute}]`).forEach((overlay) => overlay.remove());
  }

  let lastCounts = {
    headings: 0,
    "image.informative": 0,
    "image.decorative": 0,
    "image.missing": 0,
    "list.unordered": 0,
    "list.ordered": 0
  };

  function toggleCheck(message) {
    if (message?.type !== "a11y-check-toggle" || typeof message.check !== "string") return;
    if (message.check.startsWith("image.")) {
      const category = message.check.slice("image.".length);
      if (!(category in state.image)) return;
      state.image[category] = message.enabled === true;
    } else if (message.check.startsWith("list.")) {
      const category = message.check.slice("list.".length);
      if (!(category in state.list)) return;
      state.list[category] = message.enabled === true;
    } else if (message.check in state) {
      state[message.check] = message.enabled === true;
    } else {
      return;
    }

    render();
  }

  function applyOperationalState(message) {
    if (typeof message.extensionActive === "boolean") state.extensionActive = message.extensionActive;
    if (typeof message.overlaysVisible === "boolean") state.overlaysVisible = message.overlaysVisible;
    if (typeof message.showLabelsOnHover === "boolean") state.showLabelsOnHover = message.showLabelsOnHover;
    render();
  }

  function forwardToChildFrames(message) {
    for (let index = 0; index < window.frames.length; index += 1) {
      window.frames[index].postMessage(message, "*");
    }
  }

  window.addEventListener("a11y-extension-toggle", (event) => {
    toggleCheck({
      type: "a11y-check-toggle",
      check: event.detail?.check,
      enabled: event.detail?.enabled
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "a11y-operational-state") {
      applyOperationalState(message);
      forwardToChildFrames(message);
      return;
    }
    if (message?.type === "a11y-toggle-overlay-visibility") {
      state.overlaysVisible = !state.overlaysVisible;
      render();
      forwardToChildFrames({
        type: "a11y-operational-state",
        extensionActive: state.extensionActive,
        overlaysVisible: state.overlaysVisible
      });
      return;
    }
    toggleCheck(message);
    forwardToChildFrames({
      type: "a11y-extension-toggle",
      check: message?.check,
      enabled: message?.enabled
    });
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "a11y-check-state") return;
    sendResponse({
      headings: state.headings,
      lists: state.list.unordered || state.list.ordered,
      "list.unordered": state.list.unordered,
      "list.ordered": state.list.ordered,
      "image.informative": state.image.informative,
      "image.decorative": state.image.decorative,
      "image.missing": state.image.missing
    });
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "a11y-get-frame-counts") return;
    sendResponse(lastCounts);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "a11y-extension-toggle") toggleCheck(event.data);
    if (event.data?.type === "a11y-operational-state") applyOperationalState(event.data);
  });

  render();
})();
