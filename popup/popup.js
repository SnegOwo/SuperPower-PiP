/**
 * popup.js — Popup UI. Uses shared/tab-actions.js (loaded before this file).
 */
const autoBtn = document.getElementById("autoBtn");
const autoBtnLabel = document.getElementById("autoBtnLabel");
const hoverModeBtn = document.getElementById("hoverModeBtn");
const themeBtn = document.getElementById("themeBtn");
const advancedToggle = document.getElementById("advancedToggle");
const statusBox = document.getElementById("statusBox");
const listSection = document.getElementById("listSection");
const emptySection = document.getElementById("emptySection");
const videoList = document.getElementById("videoList");
const diagContent = document.getElementById("diagContent");
const refreshBtn = document.getElementById("refreshBtn");
const refreshBtnEmpty = document.getElementById("refreshBtnEmpty");
const promo = document.getElementById("promo");
const promoClose = document.getElementById("promoClose");
const operaWarning = document.getElementById("operaWarning");
const operaWarningClose = document.getElementById("operaWarningClose");
const settingsSection = document.getElementById("settingsSection");
const autoLeaveToggle = document.getElementById("autoLeaveToggle");
const multiPipToggle = document.getElementById("multiPipToggle");
const rememberSizeToggle = document.getElementById("rememberSizeToggle");
const volumeSection = document.getElementById("volumeSection");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");
const volumeIcon = document.getElementById("volumeIcon");
const exitAllBtn = document.getElementById("exitAllBtn");

let currentTabId = null;
let lastDetection = null;

// Theme system
const THEMES = ['light', 'dark', 'dark-fantasy'];
const THEME_ICONS = {
  'light': '☀️',
  'dark': '🌙',
  'dark-fantasy': '⚔️'
};

function getCurrentThemeIndex() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  return THEMES.indexOf(currentTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconSpan = themeBtn.querySelector('.theme-icon');
  iconSpan.textContent = THEME_ICONS[theme];
  // Save to storage
  chrome.storage.sync.set({ pipProTheme: theme });
}

function toggleTheme() {
  const currentIndex = getCurrentThemeIndex();
  const nextIndex = (currentIndex + 1) % THEMES.length;
  setTheme(THEMES[nextIndex]);
}

// Detect Opera GX
function isOperaGX() {
  return navigator.userAgent.includes('OPR') && navigator.userAgent.includes('GX');
}

async function loadTheme() {
  const result = await chrome.storage.sync.get([
    'pipProTheme', 'pipProAdvanced',
    'pipProAutoLeave', 'pipProMultiPip', 'pipProRememberSize'
  ]);
  const savedTheme = result.pipProTheme || 'light';
  setTheme(savedTheme);
  
  if (isOperaGX()) {
    const operaWarningData = await chrome.storage.local.get("pipProOperaWarningDismissed");
    if (!operaWarningData.pipProOperaWarningDismissed) {
      operaWarning.hidden = false;
    }
    advancedToggle.checked = false;
    await chrome.storage.sync.set({ pipProAdvanced: false });
  } else {
    advancedToggle.checked = !!result.pipProAdvanced;
  }

  // Load new feature settings
  autoLeaveToggle.checked = !!result.pipProAutoLeave;
  multiPipToggle.checked = !!result.pipProMultiPip;
  rememberSizeToggle.checked = !!result.pipProRememberSize;

  // Show the settings section always (even basic mode, for feature toggles)
  settingsSection.hidden = false;

  // If auto-leave is enabled, inject the listener into the current tab
  if (autoLeaveToggle.checked && currentTabId != null) {
    await enableAutoLeavePiPInTab(currentTabId);
  }
}

// Helper: check if any video is playing in advanced PiP on the current tab
async function checkPipActive() {
  if (currentTabId == null) return;
  try {
    const injected = await ensureCoreInjected(currentTabId);
    if (!injected) {
      exitAllBtn.hidden = true;
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.isAnyPipActive() : { total: 0 })
    });
    const total = results.reduce((sum, r) => sum + (r.result?.total || 0), 0);
    exitAllBtn.hidden = total === 0;
    volumeSection.hidden = total === 0;
  } catch (e) {
    exitAllBtn.hidden = true;
    volumeSection.hidden = true;
  }
}

function showStatus(kind, message) {
  statusBox.hidden = false;
  statusBox.className = "status-box " + kind;
  statusBox.textContent = message;
}

function clearStatus() {
  statusBox.hidden = true;
  statusBox.textContent = "";
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return "live / unknown length";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readyLabel(v) {
  if (v.pipReady) return "ready";
  if ((v.readyState || 0) >= 2) return "ready*";
  if ((v.readyState || 0) === 1) return "metadata-only";
  return "not-ready";
}

function renderDiagnostics(detection) {
  if (!detection) {
    diagContent.textContent = "No data.";
    return;
  }
  if (detection.injectionFailed) {
    diagContent.textContent =
      "Cannot inject on this page (internal Chrome page, Web Store, or local file).";
    return;
  }
  const lines = [];
  lines.push(`Frames analyzed: ${detection.frames.length}`);
  for (const f of detection.frames) {
    lines.push(`— Frame ${f.frameId} (${f.url})`);
    lines.push(`  PiP allowed by site: ${f.pipEnabled ? "yes" : "no"}`);
    lines.push(`  Videos found: ${f.videoCount}`);
    f.videos.forEach((v, i) => {
      lines.push(
        `    [${i}] ${v.width || 0}x${v.height || 0} | ${v.paused ? "paused" : "playing"} | ${readyLabel(v)} (rs:${v.readyState ?? 0}) | visible:${!!v.visible} | muted:${!!v.muted} | area:${v.area || 0}`
      );
    });
  }
  diagContent.textContent = lines.join("\n") || "No videos.";
}

function allVideosFlat(detection) {
  const flat = [];
  if (!detection || !detection.frames) return flat;
  for (const f of detection.frames) {
    for (const v of f.videos) {
      flat.push({ frameId: f.frameId, frameUrl: f.url, ...v });
    }
  }
  return flat;
}

function scoreVideo(v) {
  if (!v) return -Infinity;
  let score = 0;
  if (v.visible) score += 100;
  if (!v.paused) score += 60;
  if (v.pipReady) score += 50;
  else if ((v.readyState || 0) >= 1) score += 10;
  if ((v.width || 0) > 0 && (v.height || 0) > 0) score += 15;
  if (v.duration > 0) score += 15;
  if (v.hasSource) score += 10;
  score += Math.min((v.area || 0) / 8000, 60);
  if (v.inViewport) score += 5;
  if (v.muted) score -= 5;
  if (v.disablePiP) score -= 20;
  return score;
}

function renderList(detection) {
  const flat = allVideosFlat(detection);

  if (flat.length === 0) {
    listSection.hidden = true;
    emptySection.hidden = detection && detection.injectionFailed ? true : false;
    return;
  }

  emptySection.hidden = true;
  listSection.hidden = false;
  videoList.innerHTML = "";

  const sorted = [...flat].sort((a, b) => scoreVideo(b) - scoreVideo(a));
  const bestId = sorted[0].id;
  const bestVideo = sorted[0];

  for (const v of sorted) {
    const li = document.createElement("li");
    li.className = "video-item" + (v.id === bestId ? " best" : "");

    const meta = document.createElement("div");
    meta.className = "video-meta";

    const title = document.createElement("span");
    title.className = "v-title";
    title.textContent =
      (v.width && v.height ? `${v.width}×${v.height}` : "Video") +
      (v.id === bestId ? " · 🏆 Recommended" : "");
    meta.appendChild(title);

    const sub = document.createElement("span");
    sub.className = "v-sub";
    const readiness = v.pipReady ? "" : (v.paused ? " · needs play" : " · preparing…");
    sub.textContent = `${v.paused ? "Paused" : "Playing"} · ${formatDuration(
      v.duration
    )}${v.muted ? " · muted" : ""}${v.inPiP ? " · already in PiP" : ""}${readiness}`;
    meta.appendChild(sub);

    const btn = document.createElement("button");
    if (v.id === bestId) {
      btn.className = "best-video-btn";
      btn.innerHTML = v.inPiP ? "❌ Exit PiP" : "🎬 Recommended PiP";
    } else {
      btn.className = "use-btn";
      btn.textContent = v.inPiP ? "Exit" : "Use";
    }
    btn.addEventListener("click", () => useVideo(v));

    li.appendChild(meta);
    li.appendChild(btn);
    videoList.appendChild(li);
  }
}

async function refresh(showLoading = true) {
  if (currentTabId == null) return;
  if (showLoading) {
    diagContent.textContent = "Analyzing page…";
  }
  const detection = await detectVideosInTab(currentTabId);
  lastDetection = detection;
  renderDiagnostics(detection);
  renderList(detection);

  if (detection.injectionFailed) {
    showStatus(
      "info",
      "This page does not allow analysis (internal Chrome page, Web Store, or unauthorized local file)."
    );
    autoBtn.disabled = true;
    return;
  }

  autoBtn.disabled = false;

  const flat = allVideosFlat(detection);
  if (flat.length === 0) {
    clearStatus();
  }

  // Update volume/exit-all UI based on active PiP state
  await checkPipActive();
}

async function useVideo(v) {
  setBusy(true);
  const result = await triggerPipInFrame(currentTabId, v.frameId, v.id, {
    multi: multiPipToggle.checked
  });
  handleResult(result);
  setBusy(false);
  await refresh(false);
  await checkPipActive();
}

function setBusy(isBusy, label) {
  autoBtn.disabled = isBusy;
  autoBtn.classList.toggle("is-loading", !!isBusy);
  autoBtnLabel.textContent = isBusy ? (label || "Preparing video…") : "Start Picture-in-Picture";
}

function handleResult(result) {
  if (result.ok) {
    const suffix = result.fallbackUsed ? " (used next available video)" : "";
    if (result.action === "exited") {
      showStatus("success", "Picture-in-Picture closed.");
    } else if (result.action === "multi-started") {
      showStatus("success", `${result.count || result.results?.length || 1} PiP window(s) started ✔${suffix}`);
    } else if (result.waitedForReady) {
      showStatus("success", `Picture-in-Picture started ✔ (video needed a moment to get ready)${suffix}`);
    } else {
      showStatus("success", `Picture-in-Picture started ✔${suffix}`);
    }
  } else {
    showStatus("error", pipFriendlyError(result));
  }
}

autoBtn.addEventListener("click", async () => {
  clearStatus();
  setBusy(true);
  let result;
  if (multiPipToggle.checked && advancedToggle.checked) {
    result = await triggerMultiPipInTab(currentTabId);
  } else {
    result = await triggerAutoPip(currentTabId);
  }
  handleResult(result);
  setBusy(false);
  await refresh(false);
  await checkPipActive();
});

refreshBtn.addEventListener("click", () => refresh(true));
refreshBtnEmpty.addEventListener("click", () => refresh(true));

hoverModeBtn.addEventListener("click", async () => {
  clearStatus();
  if (currentTabId == null) {
    showStatus("error", "Cannot find active tab.");
    return;
  }
  const result = await startHoverModeInTab(currentTabId);
  if (result.ok) {
    if (result.alreadyActive) {
      showStatus("info", "Selection mode already active.");
    } else {
      showStatus("success", `Selection mode activated! ${result.videoCount} video(s) highlighted.`);
      window.close(); // Close the popup after starting the mode
    }
  } else {
    showStatus("error", pipFriendlyError(result));
  }
});

themeBtn.addEventListener("click", toggleTheme);

advancedToggle.addEventListener("change", async () => {
  if (isOperaGX() && advancedToggle.checked) {
    advancedToggle.checked = false;
    showStatus("warning", "Advanced Controls are not recommended on Opera GX due to built-in PiP conflicts.");
    return;
  }
  await chrome.storage.sync.set({ pipProAdvanced: advancedToggle.checked });
});

// --- New feature: Auto PiP on page leave ---
autoLeaveToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ pipProAutoLeave: autoLeaveToggle.checked });
  if (currentTabId == null) return;
  if (autoLeaveToggle.checked) {
    await enableAutoLeavePiPInTab(currentTabId);
    showStatus("success", "Auto PiP on page leave enabled.");
  } else {
    await disableAutoLeavePiPInTab(currentTabId);
    showStatus("info", "Auto PiP on page leave disabled.");
  }
});

// --- New feature: Multiple PiP mode ---
multiPipToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ pipProMultiPip: multiPipToggle.checked });
  if (multiPipToggle.checked) {
    showStatus("info", "Multiple PiP mode enabled. Click 'Start' to launch PiP on all playing videos.");
  }
});

// --- New feature: Remember PiP size & position ---
rememberSizeToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ pipProRememberSize: rememberSizeToggle.checked });
  if (rememberSizeToggle.checked) {
    showStatus("info", "PiP size & position will be remembered.");
  } else {
    // Clear saved state
    await chrome.storage.sync.remove('pipProPipState');
    showStatus("info", "PiP size & position memory cleared.");
  }
});

// --- Volume control ---
volumeSlider.addEventListener("input", async () => {
  const vol = parseInt(volumeSlider.value, 10) / 100;
  volumeValue.textContent = `${Math.round(vol * 100)}%`;
  volumeIcon.textContent = vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊';
  if (currentTabId != null) {
    await setPipVolumeInTab(currentTabId, vol);
  }
});

// --- Exit all PiP windows ---
exitAllBtn.addEventListener("click", async () => {
  if (currentTabId == null) return;
  setBusy(true);
  const result = await exitAllPipInTab(currentTabId);
  if (result.ok) {
    showStatus("success", "All PiP windows closed.");
  } else {
    showStatus("error", pipFriendlyError(result));
  }
  setBusy(false);
  await checkPipActive();
});

// Promo dismiss logic
promoClose.addEventListener("click", async () => {
  // Animate out
  promo.style.opacity = "0";
  promo.style.transform = "translateY(-5px)";
  setTimeout(async () => {
    promo.style.display = "none";
    await chrome.storage.local.set({ pipProPromoDismissed: true });
  }, 200);
});

// Opera Warning dismiss logic
operaWarningClose.addEventListener("click", async () => {
  // Animate out
  operaWarning.style.opacity = "0";
  setTimeout(async () => {
    operaWarning.style.display = "none";
    await chrome.storage.local.set({ pipProOperaWarningDismissed: true });
  }, 200);
});

(async function init() {
  await loadTheme();
  
  // Check if promo was dismissed
  const promoData = await chrome.storage.local.get("pipProPromoDismissed");
  if (promoData.pipProPromoDismissed) {
    promo.style.display = "none";
  }
  
  // Check if opera warning was dismissed
  const operaWarningData = await chrome.storage.local.get("pipProOperaWarningDismissed");
  if (operaWarningData.pipProOperaWarningDismissed) {
    operaWarning.style.display = "none";
  }
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    showStatus("error", "Cannot find active tab.");
    autoBtn.disabled = true;
    return;
  }
  currentTabId = tab.id;

  // If auto-leave was enabled, inject the listener now that we have the tab
  if (autoLeaveToggle.checked) {
    await enableAutoLeavePiPInTab(currentTabId);
  }

  await refresh(true);
  await checkPipActive();
})();
