const fileInput    = document.getElementById("fileInput");
const startBtn     = document.getElementById("startBtn");
const statusEl     = document.getElementById("status");
const previewEl    = document.getElementById("preview");
const delayInput   = document.getElementById("delay");
const progressWrap = document.getElementById("progressWrap");
const progressBar  = document.getElementById("progressBar");
const progressLabel= document.getElementById("progressLabel");

let lines = [];

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) { lines = []; startBtn.disabled = true; previewEl.style.display = "none"; return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    lines = e.target.result
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      setStatus("File is empty or has no valid lines.", "error");
      startBtn.disabled = true;
      previewEl.style.display = "none";
      return;
    }

    previewEl.style.display = "block";
    previewEl.innerHTML =
      `<div class="meta">${lines.length} variation${lines.length === 1 ? "" : "s"} found:</div>` +
      lines.map(l => `<div class="line">• ${escHtml(l)}</div>`).join("");

    startBtn.disabled = false;
    setStatus("");
  };
  reader.readAsText(file);
});

startBtn.addEventListener("click", async () => {
  if (lines.length === 0) return;

  const delay = Math.max(200, parseInt(delayInput.value, 10) || 800);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus("No active tab found.", "error"); return; }

  if (!tab.url || !tab.url.includes("ebay.")) {
    setStatus("Please navigate to an eBay listing page first.", "error");
    return;
  }

  startBtn.disabled = true;
  fileInput.disabled = true;
  delayInput.disabled = true;
  progressWrap.style.display = "flex";
  progressBar.value = 0;
  progressLabel.textContent = `0 / ${lines.length}`;
  setStatus("Running…");

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      action: "addVariations",
      lines,
      delay,
    });

    if (result && result.success) {
      setStatus(`Done! Added ${result.added} of ${lines.length} variation${lines.length === 1 ? "" : "s"}.`, "success");
    } else {
      setStatus(result?.error || "Something went wrong.", "error");
    }
  } catch (err) {
    setStatus("Could not reach the page. Make sure you are on an eBay listing page and the extension is loaded.", "error");
  } finally {
    startBtn.disabled = false;
    fileInput.disabled = false;
    delayInput.disabled = false;
  }
});

// Listen for progress updates from the content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "progress") {
    const pct = Math.round((msg.current / msg.total) * 100);
    progressBar.value = pct;
    progressLabel.textContent = `${msg.current} / ${msg.total}`;
    setStatus(`Adding: "${escHtml(msg.line)}"…`);
  }
});

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
