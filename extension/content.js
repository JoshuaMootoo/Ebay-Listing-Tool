// Waits for an element matching `selector` to appear in the DOM, up to `timeout` ms.
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element "${selector}" not found within ${timeout}ms`));
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fills a text input, triggering React/Vue synthetic events so the framework sees the change.
function fillInput(el, value) {
  el.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Reconstructs a File object from base64-encoded data sent via message passing.
function base64ToFile(base64, fileName, fileType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: fileType });
}

// Waits for the upload zone to show a thumbnail or success indicator,
// falling back to a plain timeout so we never hang forever.
function waitForUploadComplete(zone, timeout) {
  return new Promise(resolve => {
    const check = () =>
      zone.querySelector('img[src]:not([src=""])') ||
      zone.querySelector('.photo-tile__img') ||
      zone.querySelector('[class*="thumb"]') ||
      zone.querySelector('[class*="preview"]');

    if (check()) { resolve(); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    observer.observe(zone, { childList: true, subtree: true, attributes: true });

    const timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // ── Probe (frame discovery) ──────────────────────────────────────────────────
  if (msg.action === "probeImageZones") {
    const count = document.querySelectorAll('[id^="picupload-variations__"]').length;
    sendResponse({ count });
    return;
  }

  // ── Variations ──────────────────────────────────────────────────────────────
  if (msg.action === "addVariations") {
    if (!document.querySelector("#msku-custom-option-link")) return;

    const { lines, delay } = msg;

    (async () => {
      let added = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        chrome.runtime.sendMessage({ action: "progress", current: i, total: lines.length, line });

        try {
          const createBtn = await waitForElement("#msku-custom-option-link");
          createBtn.click();

          const inputEl = await waitForElement("#msku-custom-option-input");
          await sleep(150);
          fillInput(inputEl, line);

          const addBtn = await waitForElement("#msku-custom-option-add");
          addBtn.click();

          added++;
        } catch (err) {
          sendResponse({ success: false, added, error: `Line ${i + 1} ("${line}"): ${err.message}` });
          return;
        }

        if (i < lines.length - 1) await sleep(delay);
      }

      sendResponse({ success: true, added });
    })();

    return true; // keep channel open
  }

  // ── Images ───────────────────────────────────────────────────────────────────
  if (msg.action === "uploadImage") {
    const { index, fileName, fileData, fileType, uploadDelay } = msg;

    // Find all variation upload zones in DOM order.
    // eBay gives each one an id starting with "picupload-variations__".
    const zones = Array.from(document.querySelectorAll('[id^="picupload-variations__"]'));

    if (zones.length === 0) {
      sendResponse({ success: false, error: "No variation upload zones found on this page. Make sure the Variations section is expanded and visible." });
      return true;
    }

    if (index >= zones.length) {
      sendResponse({ success: false, error: `Upload zone index ${index} out of range (found ${zones.length} zones).` });
      return true;
    }

    (async () => {
      const zone = zones[index];
      const file = base64ToFile(fileData, fileName, fileType);
      const dt = new DataTransfer();
      dt.items.add(file);

      // Strategy 1: find a hidden <input type="file"> inside the zone.
      const fileInput = zone.querySelector('input[type="file"]');
      if (fileInput) {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input",  { bubbles: true }));
      } else {
        // Strategy 2: simulate drag-and-drop on the drop zone div.
        const dropTarget =
          zone.querySelector('[aria-description*="Drag and drop"]') ||
          zone.querySelector('.uploader-ui-ux__options--no-stencils') ||
          zone;

        for (const evtName of ["dragenter", "dragover", "drop"]) {
          dropTarget.dispatchEvent(new DragEvent(evtName, {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }));
        }
      }

      // Wait until the upload UI reflects success (or the delay elapses).
      await waitForUploadComplete(zone, uploadDelay);

      sendResponse({ success: true });
    })();

    return true;
  }
});
