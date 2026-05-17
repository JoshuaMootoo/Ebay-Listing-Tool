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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "addVariations") return;
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
});
