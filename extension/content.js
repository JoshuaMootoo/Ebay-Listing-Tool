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

function waitForUploadComplete(root, timeout) {
  return new Promise(resolve => {
    const check = () =>
      root.querySelector('img[src]:not([src=""])') ||
      root.querySelector('.photo-tile__img') ||
      root.querySelector('[class*="thumb"]') ||
      root.querySelector('[class*="preview"]');

    if (check()) { resolve(); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
  });
}

// ── Role: picupload iframe ────────────────────────────────────────────────────
// When running inside a picupload iframe, listen for file data sent via
// postMessage from the parent frame content script.
window.addEventListener("message", async (event) => {
  if (!event.data || event.data.action !== "ebayBulkUpload") return;

  const { messageId, fileName, fileData, fileType, uploadDelay } = event.data;

  try {
    const file = base64ToFile(fileData, fileName, fileType);
    const dt = new DataTransfer();
    dt.items.add(file);

    // Strategy 1: find a hidden <input type="file">
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input",  { bubbles: true }));
    } else {
      // Strategy 2: simulate drag-and-drop on the drop zone
      const dropZone =
        document.querySelector('[aria-description*="Drag and drop"]') ||
        document.querySelector('.uploader-ui-ux__options--no-stencils') ||
        document.body;

      for (const evtName of ["dragenter", "dragover", "drop"]) {
        dropZone.dispatchEvent(new DragEvent(evtName, {
          dataTransfer: dt, bubbles: true, cancelable: true,
        }));
      }
    }

    await waitForUploadComplete(document.body, uploadDelay);
    event.source.postMessage({ action: "ebayBulkUploadResult", messageId, success: true }, "*");
  } catch (err) {
    event.source.postMessage({ action: "ebayBulkUploadResult", messageId, success: false, error: err.message }, "*");
  }
});

// ── Role: parent / listing frame ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // Probe: how many variation upload iframes are in this frame?
  if (msg.action === "probeImageZones") {
    const count = document.querySelectorAll('iframe[class*="picupload-variations__"]').length;
    sendResponse({ count });
    return;
  }

  // Upload: send one image to the Nth variation iframe via postMessage.
  if (msg.action === "uploadImage") {
    const { index, fileName, fileData, fileType, uploadDelay } = msg;

    const iframes = Array.from(document.querySelectorAll('iframe[class*="picupload-variations__"]'));

    if (iframes.length === 0) {
      sendResponse({ success: false, error: "No variation upload iframes found on this page. Make sure the Variations section is expanded." });
      return;
    }
    if (index >= iframes.length) {
      sendResponse({ success: false, error: `Index ${index} out of range (found ${iframes.length} iframes).` });
      return;
    }

    const iframe = iframes[index];
    const messageId = `ebay-upload-${Date.now()}-${index}`;

    // Listen for the result that the iframe's content script sends back.
    const resultHandler = (event) => {
      if (event.data?.action === "ebayBulkUploadResult" && event.data.messageId === messageId) {
        window.removeEventListener("message", resultHandler);
        clearTimeout(safetyTimer);
        sendResponse({ success: event.data.success, error: event.data.error });
      }
    };
    window.addEventListener("message", resultHandler);

    // Safety timeout in case the iframe never replies.
    const safetyTimer = setTimeout(() => {
      window.removeEventListener("message", resultHandler);
      sendResponse({ success: false, error: `Timed out waiting for iframe response on image ${index + 1}.` });
    }, uploadDelay + 15000);

    // Wait for the iframe to be ready, then send the file data.
    const send = () => {
      iframe.contentWindow.postMessage({
        action: "ebayBulkUpload",
        messageId,
        fileName,
        fileData,
        fileType,
        uploadDelay,
      }, "*");
    };

    if (iframe.contentDocument?.readyState === "complete" || iframe.src === "") {
      send();
    } else {
      iframe.addEventListener("load", send, { once: true });
    }

    return true; // keep channel open for async response
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
