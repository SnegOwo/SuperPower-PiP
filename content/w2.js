const fs = require('fs');

const part2 = `
  function findById(id) {
    return document.querySelector(
      'video[data-pip-ext-id="' + CSS.escape(id) + '"]'
    );
  }

  function scoreVideo(v) {
    let score = 0;
    if (v.visible) score += 100;
    if (!v.paused) score += 60;
    if (v.duration > 0) score += 15;
    if (v.hasSource) score += 10;
    score += Math.min(v.area / 8000, 60);
    if (v.muted) score -= 5;
    return score;
  }

  // Track all advanced PiP windows (supports multi-PiP)
  let advancedPiPWindows = [];

  // Cached settings used by the beforeunload handler (cannot await storage)
  let settingsCache = {
    advanced: false,
    multi: false,
    rememberSize: false,
    pipState: null
  };

  // Debounce timer for saving window state
  let saveTimer = null;

  // beforeunload handler reference (for auto-PiP-on-leave)
  let autoLeaveHandler = null;

  /** Updates the settings cache from a storage result object. */
  function updateSettingsCache(result) {
    settingsCache.advanced = !!result.pipProAdvanced && !isOperaGX();
    settingsCache.multi = !!result.pipProMultiPip;
    settingsCache.rememberSize = !!result.pipProRememberSize;
    settingsCache.pipState = result.pipProPipState || null;
  }

  /** Refresh settings cache from chrome.storage.sync. */
  async function refreshSettingsCache() {
    try {
      const result = await chrome.storage.sync.get([
        'pipProAdvanced', 'pipProMultiPip', 'pipProRememberSize', 'pipProPipState'
      ]);
      updateSettingsCache(result);
    } catch (e) { /* keep stale cache */ }
  }

  /** Formats seconds into M:SS. */
  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
  }

  /** Saves PiP window size/position to storage with debounce. */
  function savePipWindowState(pipWindow) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.sync.set({
        pipProPipState: {
          width: pipWindow.width,
          height: pipWindow.height,
          x: pipWindow.screenX,
          y: pipWindow.screenY
        }
      });
      saveTimer = null;
    }, 500);
  }
`;

fs.appendFileSync('content/pip-core.js', part2);
console.log('Part 2 appended: ' + part2.length + ' chars');
