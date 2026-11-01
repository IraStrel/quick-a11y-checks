# Accessibility Page Checks

A Manifest V3 Chrome extension that highlights accessibility-relevant headings,
images, and lists.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this folder.

Open a webpage, select the extension, and turn on any of the checks. Images
can be filtered with the Informative, Decorative, and Missing accessible name
subchecks. The Images checkbox is checked when all three are selected and
indeterminate when only some are selected. Turning a check off removes its
labels and outlines. The popup shows counts for headings, each image category,
and unordered lists, ordered lists, and list items across all frames.

## Highlight labels

Heading labels include the heading level and its text (for example, `H2:
Section title`). Labels for other checks describe the image or list result.
Long label text wraps so the full label remains readable.

Labels are placed just above the highlighted area when there is room, otherwise
below it, aligned with its left edge. They move with the highlighted element
when the page scrolls, and overlays are hidden when their target is outside the
visible area or clipped by a collapsed container.

## Show labels on hover

Use the "Show labels on hover" switch in the popup to keep the highlight
rectangles visible while hiding the text labels until you hover over the
highlighted element or its interactive ancestor, or focus it with the keyboard.
This also works for interactive components implemented with custom elements or
open shadow roots. This is useful when the page already has its own visible
tooltips or dialogs and you want the extension overlays to stay subtle.

The extension runs its content script in every frame, including cross-origin
iframes permitted by the active tab, and recursively checks open shadow roots.
Closed shadow roots cannot be inspected by browser content scripts.

## Chrome Web Store listing

### Description

Quick accessibility checks highlights headings, images, and lists on the
currently open webpage. It helps developers and content authors quickly inspect
heading structure, image accessible names, decorative images, and ordered and
unordered lists. Results are shown as temporary visual overlays and counts.

The checks run locally in Chrome. The extension does not send page content to a
server, collect browsing history, or permanently modify webpages.

### Category and language

- Category: Developer Tools
- Language: English

### Screenshots

Add screenshots showing the extension in use on a representative webpage. A
good set includes:

- The popup with the available heading, image, and list checks.
- A webpage with heading overlays and the heading count visible.
- A webpage showing image labels for informative, decorative, and missing-name
	images.
- A webpage showing ordered and unordered list overlays and counts.

Do not include real personal data, private URLs, or confidential webpage
content in screenshots.

### Support and contact information

Replace the placeholder below with a monitored support email or public issue
tracker before publishing:

- Support contact: irastrel1788+a11y@gmail.com
- Issue tracker: https://github.com/IraStrel/quick-a11y-checks/issues

### Privacy practices

Quick accessibility checks needs page access because it reads the current
webpage DOM, ARIA attributes, visibility, accessible names, frames, and open
shadow roots to calculate accessibility checks and add temporary overlays.

The extension stores only:

- User preferences in local extension storage: active or paused state, overlay
	visibility, and selected checks.
- Temporary numeric counts in session storage: headings, image categories,
	lists, and list items for the current tabs and frames.

The extension does not store page text, image content, accessible labels, URLs,
personal information, or browsing history. It does not transmit data outside
the browser. Temporary count data is removed when it is no longer needed,
including when its tab is closed.
