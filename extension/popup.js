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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

// Runs a function directly in a specific frame using scripting.executeScript.
// This works even if the content script was never injected into that frame.
async function execInFrame(tabId, frameId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func,
    args,
  });
  return results?.[0]?.result;
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
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    let result = null;

    for (const frame of frames) {
      try {
        result = await sendToFrame(tab.id, frame.frameId, { action: "addVariations", lines: varLines, delay });
        if (result != null) break;
      } catch (_) {}
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

const imgVarFileInput = document.getElementById("imgVarFileInput");
const folderInput     = document.getElementById("folderInput");
const orderFileInput  = document.getElementById("orderFileInput");
const startImgBtn     = document.getElementById("startImgBtn");
const imgPreview      = document.getElementById("imgPreview");
const imgDelay        = document.getElementById("imgDelay");
const imgProgressWrap = document.getElementById("imgProgressWrap");
const imgProgressBar  = document.getElementById("imgProgressBar");
const imgProgressLabel= document.getElementById("imgProgressLabel");
const imgStatus       = document.getElementById("imgStatus");

let imageMap      = {};  // filename (lowercase) → File
let imageOrder    = [];  // ordered image filenames from file-list txt
let imgVarLines   = [];  // ordered variation names (same file as Variations tab)

// Encodes a variation name to match eBay's file input id format.
// "001 / 185 - Weedle" → "001_FSLASH_185_-_Weedle"
function encodeVariation(name) {
  return name.replace(/\//g, "FSLASH").replace(/ /g, "_");
}

function tryEnableImgStart() {
  const ready = imgVarLines.length > 0 && imageOrder.length > 0 && Object.keys(imageMap).length > 0;
  startImgBtn.disabled = !ready;
  if (ready) renderImgPreview();
}

function renderImgPreview() {
  const count = Math.max(imgVarLines.length, imageOrder.length);
  const mismatched = imgVarLines.length !== imageOrder.length;
  let html = `<div class="meta">${count} entr${count === 1 ? "y" : "ies"}`;
  if (mismatched) html += ` · <span style="color:#c0272c">line count mismatch!</span>`;
  html += "</div>";
  for (let i = 0; i < Math.min(imgVarLines.length, imageOrder.length); i++) {
    const found = !!imageMap[imageOrder[i].toLowerCase()];
    html += `<div class="row">${found ? "✓" : "✗"} ${i + 1}. ${escHtml(imageOrder[i])}</div>`;
  }
  imgPreview.innerHTML = html;
  imgPreview.style.display = "block";
}

imgVarFileInput.addEventListener("change", () => {
  const file = imgVarFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    imgVarLines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    tryEnableImgStart();
  };
  reader.readAsText(file);
});

folderInput.addEventListener("change", () => {
  imageMap = {};
  for (const file of folderInput.files) imageMap[file.name.toLowerCase()] = file;
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

  if (imgVarLines.length === 0) {
    setStatus(imgStatus, "Please select a variations .txt file.", "error");
    return;
  }

  // Only find the parent frame once — it's stable throughout.
  setStatus(imgStatus, "Finding listing frame…");
  let parentFrameId = null;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && parentFrameId === null; attempt++) {
    if (attempt > 0) await sleep(1500);
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    for (const frame of frames) {
      try {
        const found = await execInFrame(tab.id, frame.frameId,
          () => document.querySelector('[class*="picupload-variations__"]') !== null
        );
        if (found) { parentFrameId = frame.frameId; break; }
      } catch (_) {}
    }
  }

  if (parentFrameId === null) {
    setStatus(imgStatus, "Could not find the listing frame. Make sure the Variations section is visible.", "error");
    return;
  }

  // There are two picupload iframes in the msku frame:
  //   div#picupload-variations  → variation photos  (what we want)
  //   div#photos-default        → default/main photos (wrong one)
  // Read the src of the iframe inside div#picupload-variations and match it to the frame list.
  setStatus(imgStatus, "Finding upload frame…");
  let picuploadFrameId = null;
  {
    const varIframeSrc = await execInFrame(tab.id, parentFrameId, () => {
      const div = document.getElementById("picupload-variations");
      const iframe = div && div.querySelector("iframe");
      return iframe ? iframe.src : null;
    });

    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });

    if (varIframeSrc) {
      for (const frame of frames) {
        if (frame.url && frame.url === varIframeSrc) {
          picuploadFrameId = frame.frameId;
          break;
        }
      }
    }

    // Fall back: any picupload frame whose URL contains the variation windowName.
    if (picuploadFrameId === null) {
      for (const frame of frames) {
        if (frame.url && frame.url.includes("photo-iframe-picupload-variations")) {
          picuploadFrameId = frame.frameId;
          break;
        }
      }
    }

    // Last resort: child of msku frame with picupload in URL.
    if (picuploadFrameId === null) {
      for (const frame of frames) {
        if (frame.url && frame.url.includes("/lstng/picupload") && frame.parentFrameId === parentFrameId) {
          picuploadFrameId = frame.frameId;
          break;
        }
      }
    }
  }

  if (picuploadFrameId === null) {
    setStatus(imgStatus, "Could not find the upload frame. Make sure the Variations section is visible.", "error");
    return;
  }

  lockUI(true, "img");
  imgProgressWrap.style.display = "flex";
  setProgress(imgProgressBar, imgProgressLabel, 0, imageOrder.length);
  setStatus(imgStatus, "Uploading…");

  let uploaded = 0;
  const errorLog = [];

  function logError(varName, fileName, message) {
    errorLog.push({ varName, fileName, message });
  }

  for (let i = 0; i < imageOrder.length; i++) {
    const fileName = imageOrder[i];
    const varName  = imgVarLines[i];
    const file     = imageMap[fileName.toLowerCase()];

    if (!varName) {
      setStatus(imgStatus, `Variations file is shorter than image list — stopped at line ${i + 1}.`, "error");
      break;
    }

    setProgress(imgProgressBar, imgProgressLabel, i, imageOrder.length);

    if (!file) {
      logError(varName, fileName, "File not found in selected folder");
      continue;
    }

    const encoded = encodeVariation(varName);
    setStatus(imgStatus, `Uploading ${i + 1}/${imageOrder.length}: ${escHtml(fileName)}…`);

    try {
      // Click the <li> to select this variation if not already active.
      const isSelected = await execInFrame(tab.id, parentFrameId,
        (enc) => {
          const el = document.querySelector(`[class*="__${enc}"]`);
          return el ? el.classList.contains("select") : false;
        },
        [encoded]
      );

      if (!isSelected) {
        const clicked = await execInFrame(tab.id, parentFrameId,
          (enc) => {
            const el = document.querySelector(`[class*="__${enc}"]`);
            if (!el) return false;
            el.click();
            return true;
          },
          [encoded]
        );

        if (!clicked) {
          logError(varName, fileName, "Variation button not found");
          continue;
        }

        // Wait for the <li> to gain the "select" class confirming the switch.
        let confirmed = false;
        for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
          await sleep(500);
          confirmed = await execInFrame(tab.id, parentFrameId,
            (enc) => {
              const el = document.querySelector(`[class*="__${enc}"]`);
              return el ? el.classList.contains("select") : false;
            },
            [encoded]
          );
        }

        if (!confirmed) {
          logError(varName, fileName, "Variation did not become active after clicking");
          continue;
        }
      }

      // Poll for the variation's file input (id = encoded variation name) in the picupload frame.
      let inputReady = false;
      for (let attempt = 0; attempt < 10 && !inputReady; attempt++) {
        if (attempt > 0) await sleep(500);
        try {
          const found = await execInFrame(tab.id, picuploadFrameId,
            (enc) => !!document.getElementById(enc),
            [encoded]
          );
          if (found) inputReady = true;
        } catch (_) {
          // Re-find using div#picupload-variations iframe src.
          const varSrc = await execInFrame(tab.id, parentFrameId, () => {
            const div = document.getElementById("picupload-variations");
            const iframe = div && div.querySelector("iframe");
            return iframe ? iframe.src : null;
          }).catch(() => null);
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          if (varSrc) {
            for (const frame of frames) {
              if (frame.url && frame.url === varSrc) { picuploadFrameId = frame.frameId; break; }
            }
          }
          if (!picuploadFrameId) {
            for (const frame of frames) {
              if (frame.url && frame.url.includes("photo-iframe-picupload-variations")) {
                picuploadFrameId = frame.frameId; break;
              }
            }
          }
          if (!picuploadFrameId) {
            for (const frame of frames) {
              if (frame.url && frame.url.includes("/lstng/picupload") && frame.parentFrameId === parentFrameId) {
                picuploadFrameId = frame.frameId; break;
              }
            }
          }
        }
      }

      if (!inputReady) {
        const foundIds = await execInFrame(tab.id, picuploadFrameId,
          () => Array.from(document.querySelectorAll("input")).map(el => el.id || "(no id)").join(", ")
        ).catch(() => "frame unreachable");
        logError(varName, fileName, `Upload input not ready (inputs found: ${foundIds})`);
        continue;
      }

      // Inject the file into the variation's input in the picupload frame.
      const arrayBuffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);

      const result = await execInFrame(tab.id, picuploadFrameId,
        (base64Data, name, type, enc) => {
          const input = document.getElementById(enc);
          if (!input) return { success: false, error: `Input #${enc} not found` };

          const binary = atob(base64Data);
          const bytes  = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
          const f = new File([bytes], name, { type });

          const dt = new DataTransfer();
          dt.items.add(f);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("input",  { bubbles: true }));
          return { success: true };
        },
        [base64, file.name, file.type || "image/jpeg", encoded]
      );

      if (!result?.success) {
        logError(varName, fileName, result?.error || "Injection failed");
        continue;
      }

      uploaded++;
      setProgress(imgProgressBar, imgProgressLabel, uploaded, imageOrder.length);
      await sleep(uploadDelay);
    } catch (err) {
      logError(varName, fileName, err.message);
    }
  }

  setProgress(imgProgressBar, imgProgressLabel, imageOrder.length, imageOrder.length);

  if (errorLog.length === 0) {
    setStatus(imgStatus, `Done! Uploaded all ${uploaded} image${uploaded === 1 ? "" : "s"}.`, "success");
  } else {
    setStatus(imgStatus, `Done: ${uploaded} uploaded, ${errorLog.length} skipped — downloading error log.`, uploaded > 0 ? "success" : "error");
    const lines = ["Variation\tFile\tError", ...errorLog.map(e => `${e.varName}\t${e.fileName}\t${e.message}`)];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "upload-errors.txt";
    a.click();
    URL.revokeObjectURL(a.href);
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
    imgVarFileInput.disabled = locked;
    folderInput.disabled = locked;
    orderFileInput.disabled = locked;
    imgDelay.disabled = locked;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}
