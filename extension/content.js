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

function fillInput(el, value) {
  el.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function base64ToFile(base64, fileName, fileType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: fileType });
}

// Waits for a thumbnail to appear in the uploader after a file is set.
function waitForUploadComplete(timeout) {
  return new Promise(resolve => {
    const root = document.body;

    const check = () =>
      root.querySelector('.photo-tile__img') ||
      root.querySelector('[class*="thumb"]') ||
      root.querySelector('[class*="preview"]') ||
      root.querySelector('img[src]:not([src=""])');

    if (check()) { resolve(); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Image zone probe ────────────────────────────────────────────────────────
  // Only the picupload iframe has this pathname; all other frames return 0.
  if (msg.action === "probeImageZones") {
    if (!location.pathname.includes("/lstng/picupload")) {
      sendResponse({ count: 0 });
      return;
    }
    const count = document.querySelectorAll('input[type="file"]').length;
    sendResponse({ count });
    return;
  }

  // ── Image upload ────────────────────────────────────────────────────────────
  // Runs inside the picupload iframe. Finds the Nth hidden file input
  // (one per variation, in DOM order) and sets its files.
  if (msg.action === "uploadImage") {
    if (!location.pathname.includes("/lstng/picupload")) return;

    const { index, fileName, fileData, fileType, uploadDelay } = msg;
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));

    (async () => {
      if (inputs.length === 0) {
        sendResponse({ success: false, error: "No file inputs found inside the picupload iframe." });
        return;
      }
      if (index >= inputs.length) {
        sendResponse({ success: false, error: `Index ${index} out of range (found ${inputs.length} inputs).` });
        return;
      }

      const input = inputs[index];
      const file  = base64ToFile(fileData, fileName, fileType);
      const dt    = new DataTransfer();
      dt.items.add(file);

      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input",  { bubbles: true }));

      await waitForUploadComplete(uploadDelay);
      sendResponse({ success: true });
    })();

    return true;
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

    return true;
  }
});
