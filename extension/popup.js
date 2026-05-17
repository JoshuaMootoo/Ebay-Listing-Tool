// ── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setStatus(el, msg, type = "") {
  el.textContent = msg;
  el.className = "status-line" + (type ? " " + type : "");
}

function setProgress(bar, label, current, total) {
  bar.value = Math.round((current / total) * 100);
  label.textContent = `${current} / ${total}`;
}

async function getEbayFrame(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return frames; // caller iterates to find the right frame
}

async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ── Variations tab ────────────────────────────────────────────────────────────

const varFileInput    = document.getElementById("varFileInput");
const startVarBtn     = document.getElementById("startVarBtn");
const varPreview      = document.getElementById("varPreview");
const varDelay        = document.getElementById("varDelay");
const varProgressWrap = document.getElementById("varProgressWrap");
const varProgressBar  = document.getElementById("varProgressBar");
const varProgressLabel= document.getElementById("varProgressLabel");
const varStatus       = document.getElementById("varStatus");

let varLines = [];

varFileInput.addEventListener("change", () => {
  const file = varFileInput.files[0];
  if (!file) { varLines = []; startVarBtn.disabled = true; varPreview.style.display = "none"; return; }

  const reader = new FileReader();
  reader.onload = e => {
    varLines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (varLines.length === 0) {
      setStatus(varStatus, "File is empty.", "error");
      startVarBtn.disabled = true;
      varPreview.style.display = "none";
      return;
    }

    varPreview.style.display = "block";
    varPreview.innerHTML =
      `<div class="meta">${varLines.length} variation${varLines.length === 1 ? "" : "s"} found</div>` +
      varLines.map(l => `<div class="row">• ${escHtml(l)}</div>`).join("");

    startVarBtn.disabled = false;
    setStatus(varStatus, "");
  };
  reader.readAsText(file);
});

startVarBtn.addEventListener("click", async () => {
  if (varLines.length === 0) return;

  const delay = Math.max(200, parseInt(varDelay.value, 10) || 800);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus(varStatus, "No active tab found.", "error"); return; }

  if (!tab.url || !tab.url.includes("ebay.")) {
    setStatus(varStatus, "Please navigate to an eBay listing page first.", "error");
    return;
  }

  lockUI(true, "var");
  varProgressWrap.style.display = "flex";
  setProgress(varProgressBar, varProgressLabel, 0, varLines.length);
  setStatus(varStatus, "Running…");

  try {
    const frames = await getEbayFrame(tab.id);
    let result = null;

    for (const frame of frames) {
      try {
        result = await sendToFrame(tab.id, frame.frameId, { action: "addVariations", lines: varLines, delay });
        if (result != null) break;
      } catch (_) { /* frame has no content script */ }
    }

    if (result?.success) {
      setStatus(varStatus, `Done! Added ${result.added} of ${varLines.length} variation${varLines.length === 1 ? "" : "s"}.`, "success");
      setProgress(varProgressBar, varProgressLabel, varLines.length, varLines.length);
    } else {
      setStatus(varStatus, result?.error || "Something went wrong.", "error");
    }
  } catch (err) {
    setStatus(varStatus, "Could not reach the page. Reload the tab and try again.", "error");
  } finally {
    lockUI(false, "var");
  }
});

// ── Images tab ────────────────────────────────────────────────────────────────

const folderInput     = document.getElementById("folderInput");
const orderFileInput  = document.getElementById("orderFileInput");
const startImgBtn     = document.getElementById("startImgBtn");
const imgPreview      = document.getElementById("imgPreview");
const imgDelay        = document.getElementById("imgDelay");
const imgProgressWrap = document.getElementById("imgProgressWrap");
const imgProgressBar  = document.getElementById("imgProgressBar");
const imgProgressLabel= document.getElementById("imgProgressLabel");
const imgStatus       = document.getElementById("imgStatus");

let imageMap   = {};  // filename (lowercase) → File
let imageOrder = [];  // ordered list of filenames from order.txt

function tryEnableImgStart() {
  const ready = imageOrder.length > 0 && Object.keys(imageMap).length > 0;
  startImgBtn.disabled = !ready;
  if (ready) renderImgPreview();
}

function renderImgPreview() {
  const missing = imageOrder.filter(name => !imageMap[name.toLowerCase()]);
  let html = `<div class="meta">${imageOrder.length} image${imageOrder.length === 1 ? "" : "s"} in order`;
  if (missing.length) html += ` · <span style="color:#c0272c">${missing.length} not found in folder</span>`;
  html += "</div>";
  html += imageOrder.map((name, i) => {
    const found = !!imageMap[name.toLowerCase()];
    return `<div class="row">${found ? "✓" : "✗"} ${i + 1}. ${escHtml(name)}</div>`;
  }).join("");
  imgPreview.innerHTML = html;
  imgPreview.style.display = "block";
}

folderInput.addEventListener("change", () => {
  imageMap = {};
  for (const file of folderInput.files) {
    imageMap[file.name.toLowerCase()] = file;
  }
  tryEnableImgStart();
});

orderFileInput.addEventListener("change", () => {
  const file = orderFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    imageOrder = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    tryEnableImgStart();
  };
  reader.readAsText(file);
});

startImgBtn.addEventListener("click", async () => {
  if (imageOrder.length === 0) return;

  const uploadDelay = Math.max(500, parseInt(imgDelay.value, 10) || 3000);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus(imgStatus, "No active tab found.", "error"); return; }

  if (!tab.url || !tab.url.includes("ebay.")) {
    setStatus(imgStatus, "Please navigate to an eBay listing page first.", "error");
    return;
  }

  // Find the frame that has the variation upload zones
  let targetFrameId = null;
  try {
    const frames = await getEbayFrame(tab.id);
    for (const frame of frames) {
      try {
        const probe = await sendToFrame(tab.id, frame.frameId, { action: "probeImageZones" });
        if (probe && probe.count > 0) { targetFrameId = frame.frameId; break; }
      } catch (_) { /* frame has no content script */ }
    }
  } catch (err) {
    setStatus(imgStatus, "Could not reach the page. Reload the tab and try again.", "error");
    return;
  }

  if (targetFrameId === null) {
    setStatus(imgStatus, "No variation upload zones found. Make sure the Variations section is expanded.", "error");
    return;
  }

  lockUI(true, "img");
  imgProgressWrap.style.display = "flex";
  setProgress(imgProgressBar, imgProgressLabel, 0, imageOrder.length);
  setStatus(imgStatus, "Uploading…");

  let uploaded = 0;

  for (let i = 0; i < imageOrder.length; i++) {
    const fileName = imageOrder[i];
    const file = imageMap[fileName.toLowerCase()];

    if (!file) {
      setStatus(imgStatus, `File not found in folder: "${fileName}"`, "error");
      break;
    }

    setStatus(imgStatus, `Uploading ${i + 1}/${imageOrder.length}: ${escHtml(fileName)}…`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);

      const result = await sendToFrame(tab.id, targetFrameId, {
        action: "uploadImage",
        index: i,
        fileName: file.name,
        fileData: base64,
        fileType: file.type || "image/jpeg",
        uploadDelay,
      });

      if (!result?.success) {
        setStatus(imgStatus, result?.error || `Failed on image ${i + 1}.`, "error");
        break;
      }

      uploaded++;
      setProgress(imgProgressBar, imgProgressLabel, uploaded, imageOrder.length);
    } catch (err) {
      setStatus(imgStatus, `Error on image ${i + 1}: ${err.message}`, "error");
      break;
    }
  }

  if (uploaded === imageOrder.length) {
    setStatus(imgStatus, `Done! Uploaded all ${uploaded} image${uploaded === 1 ? "" : "s"}.`, "success");
  }

  lockUI(false, "img");
});

// ── Progress updates from content script (variations) ─────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "progress") {
    setProgress(varProgressBar, varProgressLabel, msg.current, msg.total);
    setStatus(varStatus, `Adding: "${escHtml(msg.line)}"…`);
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function lockUI(locked, section) {
  if (section === "var") {
    startVarBtn.disabled = locked;
    varFileInput.disabled = locked;
    varDelay.disabled = locked;
  } else {
    startImgBtn.disabled = locked;
    folderInput.disabled = locked;
    orderFileInput.disabled = locked;
    imgDelay.disabled = locked;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Process in chunks to avoid call-stack limits on large files
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
