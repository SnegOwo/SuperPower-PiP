/**
 * pip-core.js
 * Injected on demand (chrome.scripting.executeScript) into each frame of the active tab.
 * Never runs automatically: only following a user action
 * (button click, keyboard shortcut, context menu), which preserves
 * the "user gesture" required for requestPictureInPicture()
 *
 * Exposes window.__pipExt = {
 *   detect, trigger, exitPip, startHoverMode, stopHoverMode,
 *   enableAutoLeave, disableAutoLeave, triggerMulti, exitAllPip,
 *   setVideoVolume, isAnyPipActive
 * } in the page's isolated world.
 * Re-injecting this file multiple times is safe (idempotent).
 */
(function () {
  // Persist PiP window tracking across re-injections (ensureCoreInjected
  // re-executes this file on every popup open — a fresh `let` would orphan
  // previously opened advanced windows so "exit all" could never close them).
  window._pipExtWindows = window._pipExtWindows || [];
  window._pipExtAutoLeave = window._pipExtAutoLeave || { handler: null, active: false, videoId: null };

  function getAllVideosDeep() {
    const out = [];
    const seen = new Set();
    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      let videos = [];
      try {
        videos = root.querySelectorAll ? Array.from(root.querySelectorAll("video")) : [];
      } catch (e) { videos = []; }
      for (const v of videos) out.push(v);
      // Traverse shadow roots (custom players hide <video> inside them).
      let all = [];
      try {
        all = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
      } catch (e) { all = []; }
      for (const el of all) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    }
    try { walk(document); } catch (e) {}
    // Fallback: direct list in case shadow walk missed anything.
    try {
      for (const v of Array.from(document.querySelectorAll("video"))) {
        if (!out.includes(v)) out.push(v);
      }
    } catch (e) {}
    return out;
  }

  function describeVideo(el, idx) {
    let rect = { width: 0, height: 0 };
    try { rect = el.getBoundingClientRect(); } catch (e) {}
    const area = Math.max(rect.width || 0, 0) * Math.max(rect.height || 0, 0);
    let style = null;
    try { style = window.getComputedStyle(el); } catch (e) {}

    // A video is "visible" if it has non-zero dimensions OR if it's playing
    // with a source (some sites use zero-size video elements that still play).
    const hasDimensions = (rect.width || 0) > 0 && (rect.height || 0) > 0;
    const hasVideoSize = (el.videoWidth || 0) > 0 && (el.videoHeight || 0) > 0;
    const isHiddenByStyle = style ? (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity || "1") === 0) : false;
    let inViewport = true;
    try {
      inViewport = (rect.bottom || 0) >= 0 && (rect.right || 0) >= 0 &&
        (rect.top || 0) <= (window.innerHeight || 0) && (rect.left || 0) <= (window.innerWidth || 0);
    } catch (e) {}
    const visible = (hasDimensions || hasVideoSize) && !isHiddenByStyle;

    if (!el.dataset.pipExtId) {
      el.dataset.pipExtId =
        "pipext-" + idx + "-" + Math.random().toString(36).slice(2, 9);
    }

    let hasSource = false;
    try { hasSource = !!(el.currentSrc || el.src || el.srcObject || (el.querySelector && el.querySelector("source"))); } catch (e) {}
    let netState = 0;
    try { netState = el.networkState || 0; } catch (e) {}
    return {
      id: el.dataset.pipExtId,
      width: el.videoWidth || 0,
      height: el.videoHeight || 0,
      duration: isFinite(el.duration) ? el.duration : 0,
      paused: !!el.paused,
      muted: !!el.muted,
      readyState: (typeof el.readyState === "number" ? el.readyState : 0),
      networkState: netState,
      currentTime: (typeof el.currentTime === "number" ? el.currentTime : 0),
      area: Math.round(area),
      visible,
      inViewport,
      disablePiP: !!el.disablePictureInPicture,
      inPiP: (typeof document !== "undefined" && document.pictureInPictureElement === el),
      hasSource,
      // Ready for native PiP? Exposed so the popup can explain failures.
      pipReady: ((typeof el.readyState === "number" ? el.readyState : 0) >= 2) && ((el.videoWidth || 0) > 0 || (el.videoHeight || 0) > 0 || !!el.srcObject) && hasSource
    };
  }

  function detect() {
    let videos = [];
    try { videos = getAllVideosDeep(); } catch (e) { videos = []; }
    let pipEnabled = false;
    try { pipEnabled = !!document.pictureInPictureEnabled; } catch (e) {}
    let url = "", title = "";
    try { url = location.href; } catch (e) {}
    try { title = document.title; } catch (e) {}
    return {
      pipEnabled,
      url,
      title,
      videoCount: videos.length,
      videos: videos.map((v, i) => { try { return describeVideo(v, i); } catch (e) { return null; } }).filter(Boolean)
    };
  }

  function findById(id) {
    if (!id) return null;
    try {
      const sel = 'video[data-pip-ext-id="' + CSS.escape(id) + '"]';
      return document.querySelector(sel) || getAllVideosDeep().find(v => v.dataset && v.dataset.pipExtId === id) || null;
    } catch (e) {
      try { return getAllVideosDeep().find(v => v.dataset && v.dataset.pipExtId === id) || null; } catch (e2) { return null; }
    }
  }

  function scoreVideo(v) {
    if (!v) return -Infinity;
    let score = 0;
    if (v.visible) score += 100;
    if (!v.paused) score += 60;
    // Prefer videos that are actually PiP-ready (kills the
    // "metadata not loaded" pick-a-dead-video bug).
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

  // Track all advanced PiP windows (supports multi-PiP).
  // Stored on window so re-injection never orphans open windows.
  let advancedPiPWindows = window._pipExtWindows;

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
  // (declared later, persisted on window._pipExtAutoLeave across re-injections)

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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * THE "metadata not ready" FIX.
   * requestPictureInPicture() throws InvalidStateError when readyState < 2
   * or videoWidth/Height are still 0 — even while the page *looks* like it is
   * playing (lazy MSE players, background tabs, zero-size tech elements).
   * Instead of surfacing that raw error, we actively drive the element to a
   * ready state: nudge load/play, then wait for a real readiness signal.
   */
  function isPipReady(video) {
    try {
      if (!video) return false;
      const rs = (typeof video.readyState === "number") ? video.readyState : 0;
      if (rs < 2) return false;
      // srcObject streams (WebRTC) may legitimately report 0x0 briefly.
      if (video.srcObject) return true;
      if ((video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) return true;
      // Audio-only / metadata-only edge: readyState>=2 with a source is enough.
      return !!(video.currentSrc || video.src);
    } catch (e) { return false; }
  }

  function waitForPipReady(video, timeoutMs) {
    const timeout = Math.max(500, Math.min(timeoutMs || 5000, 12000));
    return new Promise((resolve) => {
      try {
        if (isPipReady(video)) { resolve(true); return; }
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          try {
            video.removeEventListener("loadedmetadata", onSignal);
            video.removeEventListener("loadeddata", onSignal);
            video.removeEventListener("canplay", onSignal);
            video.removeEventListener("canplaythrough", onSignal);
            video.removeEventListener("playing", onSignal);
            video.removeEventListener("resize", onSignal);
          } catch (e) {}
          resolve(!!ok);
        };
        const onSignal = () => { if (isPipReady(video)) finish(true); };
        try {
          video.addEventListener("loadedmetadata", onSignal);
          video.addEventListener("loadeddata", onSignal);
          video.addEventListener("canplay", onSignal);
          video.addEventListener("canplaythrough", onSignal);
          video.addEventListener("playing", onSignal);
          video.addEventListener("resize", onSignal);
        } catch (e) {}
        // Re-check on an interval: some players flip readyState without events.
        const iv = setInterval(() => {
          if (isPipReady(video)) { clearInterval(iv); finish(true); }
        }, 150);
        setTimeout(() => { clearInterval(iv); finish(isPipReady(video)); }, timeout);
        // Nudge the element: ask for metadata without breaking playback.
        try {
          if ((video.preload || "") === "none") video.preload = "metadata";
          if ((video.readyState || 0) === 0 && typeof video.load === "function" && !video.currentSrc && !video.srcObject) {
            // Only force load() when there is truly nothing loaded yet.
            try { video.load(); } catch (e) {}
          }
        } catch (e) {}
      } catch (e) { resolve(false); }
    });
  }

  /** Best-effort "prime": ensure the element is playing so metadata exists. */
  async function primeVideo(video) {
    try {
      if (!video) return;
      if (video.disablePictureInPicture) {
        try { video.disablePictureInPicture = false; } catch (e) {}
      }
      try { await video.play().catch(() => {}); } catch (e) {}
      // If still paused (autoplay policy), a muted play usually succeeds and
      // is enough to produce metadata; restore mute state afterwards.
      try {
        if (video.paused) {
          const wasMuted = !!video.muted;
          try { video.muted = true; } catch (e) {}
          await video.play().catch(() => {});
          if (!wasMuted) { try { video.muted = false; } catch (e) {} }
        }
      } catch (e) {}
    } catch (e) {}
  }

  /**
   * Robust native PiP request with readiness wait + InvalidStateError retry.
   * Returns { ok, action } or { ok:false, error, name, stage }.
   */
  async function requestNativePipRobust(video) {
    if (!video) return { ok: false, error: "no-video", name: "NotSupportedError", stage: "no-video" };
    try {
      if (video.disablePictureInPicture) {
        try { video.disablePictureInPicture = false; } catch (e) {}
      }
    } catch (e) {}
    if (!document.pictureInPictureEnabled) {
      return { ok: false, error: "pip-disabled-by-site", name: "NotAllowedError", stage: "site-blocked" };
    }
    // Fast path: already ready -> single attempt.
    // Slow path: prime + wait up to ~5s, then retry InvalidStateError twice.
    await primeVideo(video);
    let ready = isPipReady(video);
    if (!ready) ready = await waitForPipReady(video, 5000);
    // One last prime after metadata arrives (some players need it).
    if (ready && video.paused) {
      try { await video.play().catch(() => {}); } catch (e) {}
    }
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await video.requestPictureInPicture();
        return { ok: true, action: attempt === 0 ? "started" : "started-fallback", waitedForReady: !ready || attempt > 0 };
      } catch (err) {
        lastErr = err;
        const name = (err && err.name) || "";
        try { video.disablePictureInPicture = false; } catch (e) {}
        if (name === "InvalidStateError") {
          // Metadata race: wait a beat longer, re-prime, retry.
          await primeVideo(video);
          const becameReady = await waitForPipReady(video, 2500);
          if (!becameReady && attempt >= 1) break;
          continue;
        }
        // NotAllowedError on first try can mean "not primed yet" — one retry after play().
        if (attempt === 0) {
          await primeVideo(video);
          continue;
        }
        break;
      }
    }
    // Still failing with InvalidStateError but the video IS audibly playing?
    // Report a clearer stage so the popup can suggest the next candidate
    // instead of the cryptic raw message.
    return {
      ok: false,
      error: (lastErr && lastErr.message) || "Video is not ready",
      name: (lastErr && lastErr.name) || "InvalidStateError",
      stage: "not-ready",
      readyState: (video && video.readyState) || 0,
      videoSize: ((video && video.videoWidth) || 0) + "x" + ((video && video.videoHeight) || 0)
    };
  }

  /** Saves PiP window size/position to storage with debounce. */
  function savePipWindowState(pipWindow) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (pipWindow.closed) { saveTimer = null; return; }
        chrome.storage.sync.set({
          pipProPipState: {
            width: pipWindow.width,
            height: pipWindow.height,
            x: pipWindow.screenX,
            y: pipWindow.screenY
          }
        });
      } catch (e) {}
      saveTimer = null;
    }, 500);
  }

  /**
   * Creates an advanced PiP window (documentPictureInPicture) for the given video.
   * Options:
   *   multi         (bool) – if true, don't close existing windows
   *   rememberSize  (bool) – if true, restore saved size/location
   *   pipState      (obj)  – { width, height, x, y } from cache
   */
  async function createAdvancedPiP(video, options = {}) {
    if (!('documentPictureInPicture' in window)) {
      return { ok: false, error: "Advanced PiP not supported", name: "NotSupportedError" };
    }

    try {
      pruneAdvancedWindows();
      // Close existing windows unless in multi mode
      if (!options.multi && advancedPiPWindows.length > 0) {
        const copy = advancedPiPWindows.slice();
        advancedPiPWindows.length = 0;
        for (const w of copy) { try { w.close(); } catch (e) {} }
      }

      const originalParent = video.parentElement;
      const originalNextSibling = video.nextSibling;

      // Determine initial window size
      let winWidth, winHeight;
      if (options.rememberSize && options.pipState && options.pipState.width) {
        winWidth = options.pipState.width;
        winHeight = options.pipState.height;
      } else {
        winWidth = Math.min(600, Math.max(320, video.videoWidth || 480));
        winHeight = Math.min(400, Math.max(240, (video.videoHeight || 360) + 80));
      }

      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: winWidth,
        height: winHeight
      });
      advancedPiPWindows.push(pipWindow);

      // Restore saved position
      if (options.rememberSize && options.pipState &&
          options.pipState.x !== undefined && options.pipState.y !== undefined) {
        pipWindow.moveTo(options.pipState.x, options.pipState.y);
      }

      // --- Styles ---
      const style = pipWindow.document.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #000;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #pipVideoContainer {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
        }
        #pipVideo { width: 100%; height: 100%; object-fit: contain; }
        #controls {
          background: linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.8));
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .controls-row { display: flex; align-items: center; gap: 10px; }
        .control-btn {
          background: rgba(255,255,255,0.15);
          border: none;
          border-radius: 8px;
          padding: 8px 12px;
          color: #fff;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }
        .control-btn:hover { background: rgba(255,255,255,0.25); }
        .control-btn:active { transform: scale(0.95); }
        .slider-container { flex: 1; display: flex; align-items: center; gap: 8px; }
        .slider-label { color: #fff; font-size: 12px; width: 40px; }
        input[type="range"] {
          flex: 1;
          height: 6px;
          -webkit-appearance: none;
          background: rgba(255,255,255,0.2);
          border-radius: 3px;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #38bdf8;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .time-display { color: rgba(255,255,255,0.8); font-size: 12px; font-variant-numeric: tabular-nums; }
        .spacer { flex: 1; }
      `;
      pipWindow.document.head.appendChild(style);
      // --- HTML structure ---
      pipWindow.document.body.innerHTML = `
        <div id="pipVideoContainer"></div>
        <div id="controls">
          <div class="controls-row">
            <button id="prevBtn" class="control-btn" title="Rewind 10s">⏪</button>
            <button id="playPauseBtn" class="control-btn" title="Play/Pause">⏸️</button>
            <button id="nextBtn" class="control-btn" title="Forward 10s">⏩</button>
            <div class="spacer"></div>
            <button id="muteBtn" class="control-btn" title="Mute/Unmute">🔊</button>
            <button id="exitBtn" class="control-btn" title="Exit PiP">✕</button>
          </div>
          <div class="controls-row">
            <div class="slider-container">
              <span class="slider-label">Seek</span>
              <input type="range" id="seekSlider" min="0" max="100" value="0" />
              <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
            </div>
          </div>
          <div class="controls-row">
            <div class="slider-container">
              <span class="slider-label">Volume</span>
              <input type="range" id="volumeSlider" min="0" max="100" value="100" />
            </div>
          </div>
          <div class="controls-row">
            <div class="slider-container">
              <span class="slider-label">Speed</span>
              <input type="range" id="speedSlider" min="25" max="200" value="100" />
              <span class="time-display" id="speedDisplay">1.00x</span>
            </div>
          </div>
        </div>
      `;

      // Move video into the PiP window
      const videoContainer = pipWindow.document.getElementById('pipVideoContainer');
      videoContainer.appendChild(video);
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';

      // Control references
      const playPauseBtn = pipWindow.document.getElementById('playPauseBtn');
      const muteBtn      = pipWindow.document.getElementById('muteBtn');
      const prevBtn      = pipWindow.document.getElementById('prevBtn');
      const nextBtn      = pipWindow.document.getElementById('nextBtn');
      const exitBtn      = pipWindow.document.getElementById('exitBtn');
      const seekSlider   = pipWindow.document.getElementById('seekSlider');
      const volumeSlider = pipWindow.document.getElementById('volumeSlider');
      const speedSlider  = pipWindow.document.getElementById('speedSlider');
      const timeDisplay  = pipWindow.document.getElementById('timeDisplay');
      const speedDisplay = pipWindow.document.getElementById('speedDisplay');

      // ---- Smooth UI via requestAnimationFrame (fixes jank) ----
      let ticking = false;
      let isSeeking = false;

      const updatePlayPauseBtn = () => {
        playPauseBtn.textContent = video.paused ? '▶️' : '⏸️';
      };
      const updateMuteBtn = () => {
        muteBtn.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
      };
      const updateTimeDisplay = () => {
        if (!isSeeking && isFinite(video.duration) && video.duration > 0) {
          seekSlider.value = (video.currentTime / video.duration) * 100;
        }
        timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
      };
      const tick = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          updateTimeDisplay();
          ticking = false;
        });
      };

      // ---- Auto-resize: resize window when video metadata loads ----
      const handleAutoResize = () => {
        if (options.rememberSize) return;
        const newW = Math.min(800, Math.max(320, video.videoWidth || pipWindow.width));
        const newH = Math.min(600, Math.max(240, (video.videoHeight || (pipWindow.height - 80)) + 80));
        if (pipWindow.width !== newW || pipWindow.height !== newH) {
          pipWindow.resizeTo(newW, newH);
        }
      };

      video.addEventListener('loadedmetadata', () => {
        tick();
        handleAutoResize();
      });
      video.addEventListener('resize', handleAutoResize);

      // ---- Video event listeners ----
      video.addEventListener('play', () => { updatePlayPauseBtn(); tick(); });
      video.addEventListener('pause', () => { updatePlayPauseBtn(); tick(); });
      video.addEventListener('volumechange', () => {
        updateMuteBtn();
        volumeSlider.value = video.muted ? 0 : video.volume * 100;
      });
      video.addEventListener('timeupdate', tick);
      video.addEventListener('seeked', tick);
      video.addEventListener('ended', () => { updatePlayPauseBtn(); tick(); });

      // ---- Button handlers ----
      playPauseBtn.addEventListener('click', () => {
        if (video.paused) video.play(); else video.pause();
      });
      muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
      prevBtn.addEventListener('click', () => {
        video.currentTime = Math.max(0, video.currentTime - 10);
      });
      nextBtn.addEventListener('click', () => {
        video.currentTime = Math.min(video.duration || video.currentTime, video.currentTime + 10);
      });
      // Exit closes ONLY this window (multi-PiP safe)
      exitBtn.addEventListener('click', () => { pipWindow.close(); });

      // ---- Seek slider: preview on input, seek on change (no jank) ----
      seekSlider.addEventListener('input', (e) => {
        isSeeking = true;
        if (isFinite(video.duration) && video.duration > 0) {
          const seekTime = (e.target.value / 100) * video.duration;
          timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(video.duration)}`;
        }
      });
      seekSlider.addEventListener('change', (e) => {
        isSeeking = false;
        if (isFinite(video.duration) && video.duration > 0) {
          video.currentTime = (e.target.value / 100) * video.duration;
        }
        tick();
      });

      // ---- Volume slider ----
      volumeSlider.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        video.volume = val;
        if (val > 0) video.muted = false;
      });

      // ---- Speed slider ----
      speedSlider.addEventListener('input', (e) => {
        const speed = e.target.value / 100;
        video.playbackRate = speed;
        speedDisplay.textContent = `${speed.toFixed(2)}x`;
      });

      // ---- Size/location memory ----
      if (options.rememberSize) {
        pipWindow.addEventListener('resize', () => savePipWindowState(pipWindow));
        try {
          pipWindow.addEventListener('move', () => savePipWindowState(pipWindow));
        } catch (e) { /* 'move' not supported in this Chrome version */ }
      }

      // ---- Save video state for restoration on close ----
      // We save the outerHTML and playback state so we can reconstruct
      // the video if it gets destroyed when the PiP window closes.
      const videoOuterHTML = video.outerHTML;
      const videoState = {
        currentTime: video.currentTime,
        paused: video.paused,
        muted: video.muted,
        volume: video.volume,
        playbackRate: video.playbackRate,
        src: video.currentSrc || video.src,
        autoplay: video.autoplay,
        loop: video.loop,
        preload: video.preload,
        id: video.id,
        className: video.className,
        style: video.style.cssText,
        dataset: { ...video.dataset }
      };

      // ---- Cleanup on window close ----
      const windowCloseHandler = () => {
        try {
          // Reconstruct video element if it was destroyed
          let videoEl = video;
          if (!video.isConnected) {
            // Video was destroyed - reconstruct from saved HTML
            const template = document.createElement('div');
            template.innerHTML = videoOuterHTML;
            videoEl = template.querySelector('video');
            if (!videoEl) {
              // Fallback: create a new video element
              videoEl = document.createElement('video');
            }
            // Restore attributes
            if (videoState.src) videoEl.src = videoState.src;
            if (videoState.id) videoEl.id = videoState.id;
            if (videoState.className) videoEl.className = videoState.className;
            if (videoState.style) videoEl.style.cssText = videoState.style;
            if (videoState.autoplay) videoEl.autoplay = true;
            if (videoState.loop) videoEl.loop = true;
            videoEl.muted = videoState.muted;
            videoEl.volume = videoState.volume;
            videoEl.playbackRate = videoState.playbackRate;
            // Restore dataset
            for (const key in videoState.dataset) {
              videoEl.dataset[key] = videoState.dataset[key];
            }
          }

          // Try to restore to original position
          let restored = false;
          if (originalParent && originalParent.isConnected) {
            try {
              if (originalNextSibling && originalNextSibling.isConnected) {
                originalParent.insertBefore(videoEl, originalNextSibling);
              } else {
                originalParent.appendChild(videoEl);
              }
              restored = true;
            } catch (e) {
              // Parent might be in an invalid state
            }
          }

          // Fallback: append to body
          if (!restored) {
            try { (document.body || document.documentElement).appendChild(videoEl); } catch (e) {}
          }

          // Restore playback state (async, don't await)
          if (!videoState.paused && videoEl.paused) {
            videoEl.play().catch(() => {});
          }
          videoEl.currentTime = videoState.currentTime;
        } catch (err) {
          console.error('Failed to restore video:', err);
        }

        const idx = advancedPiPWindows.indexOf(pipWindow);
        if (idx > -1) advancedPiPWindows.splice(idx, 1);
      };
      pipWindow.addEventListener('pagehide', windowCloseHandler);

      // Initialize controls
      updatePlayPauseBtn();
      updateMuteBtn();
      volumeSlider.value = video.muted ? 0 : video.volume * 100;
      speedSlider.value = video.playbackRate * 100;
      speedDisplay.textContent = `${video.playbackRate.toFixed(2)}x`;
      updateTimeDisplay();

      return {
        ok: true,
        action: "advanced-started",
        windowCount: advancedPiPWindows.length
      };
    } catch (err) {
      console.error('Advanced PiP failed:', err);
      return { ok: false, error: err.message, name: err.name };
    }
  }

  // Detect Opera GX
  function isOperaGX() {
    return navigator.userAgent.includes('OPR') && navigator.userAgent.includes('GX');
  }

  function getPlayingCandidates() {
    let all = [];
    try { all = getAllVideosDeep(); } catch (e) { all = []; }
    // Include paused-but-ready videos as last resort (user explicitly asked).
    const playing = all.filter(v => {
      try { return !v.paused && !v.ended; } catch (e) { return false; }
    });
    const rest = all.filter(v => playing.indexOf(v) === -1);
    const rank = (list) => list
      .map((el, i) => { let d = null; try { d = describeVideo(el, i); } catch (e) {} return { el, d }; })
      .filter(x => x.d)
      .sort((a, b) => scoreVideo(b.d) - scoreVideo(a.d));
    return rank(playing).concat(rank(rest));
  }

  async function tryNativeOnCandidates(candidates) {
    let lastFail = null;
    let tried = 0;
    for (const c of candidates) {
      tried++;
      // Skip elements already in PiP (toggle handled by caller).
      try {
        if (document.pictureInPictureElement === c.el) {
          await document.exitPictureInPicture();
          return { ok: true, action: "exited" };
        }
      } catch (e) {}
      const r = await requestNativePipRobust(c.el);
      if (r.ok) {
        r.usedVideoId = (c.el.dataset && c.el.dataset.pipExtId) || null;
        r.triedCount = tried;
        return r;
      }
      lastFail = { ...r, videoId: (c.el.dataset && c.el.dataset.pipExtId) || null };
      // Fatal site-level blocks: no point trying the next <video>.
      if (r.name === "NotAllowedError" && r.stage === "site-blocked") break;
      if (r.name === "SecurityError") break;
    }
    return { ...(lastFail || { ok: false, error: "no-playing-video" }), ok: false, triedCount: tried };
  }

  async function requestWithFallback(video) {
    let result = { pipProAdvanced: false, pipProMultiPip: false };
    try {
      result = await chrome.storage.sync.get([
        'pipProAdvanced', 'pipProMultiPip', 'pipProRememberSize', 'pipProPipState'
      ]);
    } catch (e) {}
    updateSettingsCache(result);

    // On complex player sites (YouTube, etc.), always use native PiP to avoid breaking the player
    const isAdvanced = !!result.pipProAdvanced && !isOperaGX() && !isComplexPlayerSite();
    const isMulti = !!result.pipProMultiPip;
    const rememberSize = !!result.pipProRememberSize;
    const pipState = result.pipProPipState;
    const pipOptions = { rememberSize, pipState };

    // Multi-PiP: start advanced PiP for ALL playing videos
    if (isMulti && isAdvanced) {
      const ranked = getPlayingCandidates().filter(c => {
        try { return !c.el.paused && document.pictureInPictureElement !== c.el; } catch (e) { return false; }
      });
      if (ranked.length > 0) {
        const results = [];
        for (const c of ranked) {
          try {
            const r = await createAdvancedPiP(c.el, { ...pipOptions, multi: true });
            results.push(r);
          } catch (e) { results.push({ ok: false, error: String((e && e.message) || e) }); }
        }
        const anyOk = results.some(r => r.ok);
        if (anyOk) return { ok: true, action: "multi-started", results, count: results.filter(r => r.ok).length };
        // Advanced failed on all -> fall through to robust native path below.
      }
      // If no playing videos, fall through to single-video path
    }

    if (isAdvanced && video) {
      // Advanced PiP also needs metadata: wait briefly instead of opening a 0x0 window.
      try {
        if (!isPipReady(video)) await waitForPipReady(video, 3000);
      } catch (e) {}
      try {
        const advancedResult = await createAdvancedPiP(video, pipOptions);
        if (advancedResult.ok) return advancedResult;
      } catch (e) {}
    }

    // Robust native path: single video if given, else best-effort across all.
    if (video) {
      // If the requested video is not ready, transparently try siblings
      // before giving up — this is the un-breakable fallback.
      const direct = await requestNativePipRobust(video);
      if (direct.ok) return direct;
      const retriable = direct.name === "InvalidStateError" || direct.stage === "not-ready";
      if (retriable) {
        const others = getPlayingCandidates().filter(c => c.el !== video);
        if (others.length > 0) {
          const alt = await tryNativeOnCandidates(others);
          if (alt.ok) return { ...alt, fallbackUsed: true, firstError: direct.error };
        }
      }
      return direct;
    }
    const ranked = getPlayingCandidates();
    if (ranked.length === 0) return { ok: false, error: "no-video" };
    return tryNativeOnCandidates(ranked);
  }

  async function trigger(id, opts) {
    opts = opts || {};
    let video = null;

    if (id) {
      try { video = findById(id); } catch (e) { video = null; }
    }
    if (!video) {
      const ranked = getPlayingCandidates();
      if (ranked.length === 0) {
        return { ok: false, error: "no-video" };
      }
      // Try in rank order until one succeeds (un-breakable).
      if (!id) return requestWithFallback(null);
      video = ranked[0].el;
    }

    if (!video) return { ok: false, error: "no-video" };

    try {
      if (document.pictureInPictureElement === video) {
        try {
          await document.exitPictureInPicture();
          return { ok: true, action: "exited" };
        } catch (e) {
          return { ok: false, error: e.message, name: e.name };
        }
      }
    } catch (e) {}

    let pipAllowed = true;
    try { pipAllowed = !!document.pictureInPictureEnabled; } catch (e) {}
    if (!pipAllowed) {
      return { ok: false, error: "pip-disabled-by-site", name: "NotAllowedError" };
    }

    // Per-video multi flag (popup passes { multi:true } on manual picks):
    // prefer a dedicated advanced window without closing the others.
    if (opts.multi) {
      try {
        const st = await chrome.storage.sync.get(['pipProAdvanced', 'pipProRememberSize', 'pipProPipState']);
        if (st.pipProAdvanced && !isOperaGX() && !isComplexPlayerSite() && ('documentPictureInPicture' in window)) {
          if (!isPipReady(video)) await waitForPipReady(video, 3000);
          const adv = await createAdvancedPiP(video, {
            multi: true,
            rememberSize: !!st.pipProRememberSize,
            pipState: st.pipProPipState
          });
          if (adv.ok) return adv;
        }
      } catch (e) {}
    }

    return requestWithFallback(video);
  }

  /** Try every ranked video in this frame until one enters PiP. */
  async function triggerAny() {
    let pipAllowed = true;
    try { pipAllowed = !!document.pictureInPictureEnabled; } catch (e) {}
    if (!pipAllowed) return { ok: false, error: "pip-disabled-by-site", name: "NotAllowedError" };
    const ranked = getPlayingCandidates();
    if (ranked.length === 0) return { ok: false, error: "no-video" };
    return tryNativeOnCandidates(ranked);
  }

  /** Starts PiP for ALL playing videos in this frame (multi-PiP mode). */
  async function triggerMulti() {
    await refreshSettingsCache();

    const ranked = getPlayingCandidates();
    if (ranked.length === 0) return { ok: false, error: "no-video" };

    const playing = ranked.filter(c => {
      try { return !c.el.paused && !c.el.ended && document.pictureInPictureElement !== c.el; } catch (e) { return false; }
    });
    if (playing.length === 0) return { ok: false, error: "no-playing-video" };

    // On complex player sites, fall back to robust native PiP across candidates.
    if (isComplexPlayerSite()) {
      return tryNativeOnCandidates(playing);
    }

    if (!settingsCache.advanced) {
      return { ok: false, error: "advanced-required" };
    }

    const pipOptions = {
      rememberSize: settingsCache.rememberSize,
      pipState: settingsCache.pipState
    };
    const results = [];
    for (const c of playing) {
      try {
        const r = await createAdvancedPiP(c.el, { ...pipOptions, multi: true });
        results.push(r);
      } catch (e) { results.push({ ok: false, error: String((e && e.message) || e) }); }
    }
    const okCount = results.filter(r => r.ok).length;
    if (okCount === 0) {
      // Advanced windows failed (e.g. metadata race) — try native as last resort.
      return tryNativeOnCandidates(playing);
    }
    return { ok: true, action: "multi-started", results, count: okCount };
  }

  function pruneAdvancedWindows() {
    try {
      for (let i = advancedPiPWindows.length - 1; i >= 0; i--) {
        try { if (advancedPiPWindows[i].closed) advancedPiPWindows.splice(i, 1); } catch (e) {}
      }
    } catch (e) {}
  }

  function closeAllAdvancedWindows() {
    pruneAdvancedWindows();
    let closed = 0;
    const copy = advancedPiPWindows.slice();
    // Keep the same array reference so re-injected copies stay in sync.
    advancedPiPWindows.length = 0;
    for (const w of copy) {
      try { w.close(); closed++; } catch (e) {}
    }
    return closed;
  }

  /** Exits native PiP and closes ALL advanced PiP windows. */
  async function exitPip() {
    const closedAdvanced = closeAllAdvancedWindows();

    let closedNative = false;
    try {
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
          closedNative = true;
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    } catch (e) {}
    return { ok: true, action: "exited", closedAdvanced, closedNative };
  }

  /** Closes ALL PiP windows (native + advanced). */
  async function exitAllPip() {
    let closed = closeAllAdvancedWindows();
    try {
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
          closed++;
        } catch (e) {}
      }
    } catch (e) {}
    return { ok: true, closed };
  }

  /** Sets the volume on the active (or first) video element. */
  function setVideoVolume(volume) {
    let videos = [];
    try { videos = getAllVideosDeep(); } catch (e) {}
    let playing = null;
    try { playing = videos.find(v => !v.paused) || videos[0]; } catch (e) {}
    if (playing) {
      try {
        playing.volume = Math.max(0, Math.min(1, volume));
        if (volume <= 0) playing.muted = true;
        else playing.muted = false;
        return { ok: true, volume: playing.volume, muted: playing.muted };
      } catch (e) { return { ok: false, error: e.message, name: e.name }; }
    }
    return { ok: false, error: "no-video" };
  }

  /** Returns info about any active PiP state. */
  function isAnyPipActive() {
    pruneAdvancedWindows();
    let native = false;
    try { native = !!document.pictureInPictureElement; } catch (e) {}
    return {
      native,
      advanced: advancedPiPWindows.length,
      total: (native ? 1 : 0) + advancedPiPWindows.length
    };
  }

  // ---- Auto PiP on page leave / Anti-PiP on return ----
  // Persisted on window so re-injection never double-registers listeners.
  let autoLeaveHandler = window._pipExtAutoLeave.handler || null;
  function getAutoLeaveState() { return window._pipExtAutoLeave; }

  // Detect YouTube (and similar complex players) to use native PiP instead of advanced
  function isComplexPlayerSite() {
    let host = "";
    try { host = location.hostname || ""; } catch (e) {}
    return host.includes('youtube.com') ||
           host.includes('youtu.be') ||
           host.includes('netflix.com') ||
           host.includes('primevideo.com') ||
           host.includes('disneyplus.com') ||
           host.includes('hulu.com') ||
           host.includes('twitch.tv') ||
           host.includes('vimeo.com') ||
           host.includes('dailymotion.com');
  }

  function enableAutoLeave() {
    if (autoLeaveHandler) return { ok: true, alreadyActive: true };
    try { refreshSettingsCache(); } catch (e) {}

    autoLeaveHandler = function () {
      const st = getAutoLeaveState();
      let vis = "";
      try { vis = document.visibilityState; } catch (e) {}
      // Tab became visible again -> close auto-leave PiP (anti-PiP)
      if (vis === 'visible') {
        if (st.active) {
          st.active = false;
          // Exit any PiP we started
          try {
            if (document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(() => {});
            }
          } catch (e) {}
          // Close any advanced PiP windows we opened
          closeAllAdvancedWindows();
        }
        return;
      }

      // Tab became hidden -> start PiP
      if (vis !== 'hidden') return;

      try {
        const ranked = getPlayingCandidates().filter(c => {
          try { return !c.el.paused && !c.el.ended && document.pictureInPictureElement !== c.el; } catch (e) { return false; }
        });
        const playing = ranked.length ? ranked[0].el : null;
        if (!playing) return;

        // Check if this is a complex player site (YouTube, etc.) - use native PiP
        const useAdvanced = settingsCache.advanced && !isOperaGX() && !isComplexPlayerSite();

        if (useAdvanced && 'documentPictureInPicture' in window) {
          // Try advanced PiP first
          try { st.videoId = playing.dataset ? playing.dataset.pipExtId : null; } catch (e) {}
          createAdvancedPiP(playing, {
            multi: settingsCache.multi,
            rememberSize: settingsCache.rememberSize,
            pipState: settingsCache.pipState
          }).then(result => {
            if (result.ok) st.active = true;
          }).catch(() => {});
        } else if (document.pictureInPictureEnabled) {
          // Robust native path (waits for metadata instead of failing).
          requestNativePipRobust(playing).then((result) => {
            if (result.ok) st.active = true;
          }).catch(() => {});
        }
      } catch (e) { /* fail silently */ }
    };
    window._pipExtAutoLeave.handler = autoLeaveHandler;

    // Use visibilitychange which fires when tab is hidden (user switches tabs).
    try { document.addEventListener('visibilitychange', autoLeaveHandler); } catch (e) {}

    // Also listen for beforeunload as a fallback for navigation/tab close cases.
    try {
      window.addEventListener('beforeunload', autoLeaveHandler);
      window.addEventListener('pagehide', autoLeaveHandler);
    } catch (e) {}
    return { ok: true, active: true };
  }

  function disableAutoLeave() {
    if (!autoLeaveHandler) return { ok: true, alreadyInactive: true };
    try { document.removeEventListener('visibilitychange', autoLeaveHandler); } catch (e) {}
    try {
      window.removeEventListener('beforeunload', autoLeaveHandler);
      window.removeEventListener('pagehide', autoLeaveHandler);
    } catch (e) {}
    autoLeaveHandler = null;
    window._pipExtAutoLeave.handler = null;
    window._pipExtAutoLeave.active = false;
    return { ok: true, stopped: true };
  }

  // ---- Hover mode (kept from original) ----
  let hoverModeActive = false;
  let hoverHighlightStyle = null;
  let hoverOverlay = null;
  let escapeKeyListener = null;
  let documentClickListener = null;
  let mutationObserver = null;
  let debounceTimer = null;

  function createHighlightStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .__pip-ext-highlight {
        outline: 4px solid #0284c7 !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        transition: outline-width 0.1s ease !important;
      }
      .__pip-ext-highlight:hover {
        outline-width: 6px !important;
      }
      .__pip-ext-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 2147483646 !important;
        pointer-events: none !important;
      }
      .__pip-ext-overlay-text {
        position: fixed !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: #0f172a !important;
        color: #fff !important;
        padding: 12px 24px !important;
        border-radius: 10px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        z-index: 2147483647 !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        pointer-events: none !important;
      }
    `;
    return style;
  }

  function showOverlay() {
    try {
      const overlay = document.createElement('div');
      overlay.className = '__pip-ext-overlay';
      const text = document.createElement('div');
      text.className = '__pip-ext-overlay-text';
      text.textContent = 'Click a video to put it in PiP (Escape to cancel)';
      overlay.appendChild(text);
      (document.body || document.documentElement).appendChild(overlay);
      return overlay;
    } catch (e) { return null; }
  }

  function highlightAllVideos() {
    let videos = [];
    try { videos = getAllVideosDeep(); } catch (e) {}
    videos.forEach(video => {
      try { video.classList.add('__pip-ext-highlight'); } catch (e) {}
    });
  }

  function startHoverMode() {
    if (hoverModeActive) return { ok: true, alreadyActive: true };
    hoverModeActive = true;
    try {
      hoverHighlightStyle = createHighlightStyle();
      (document.head || document.documentElement).appendChild(hoverHighlightStyle);
    } catch (e) {}
    hoverOverlay = showOverlay();
    highlightAllVideos();
    documentClickListener = async (e) => {
      let video = null;
      try { video = e.target && e.target.closest ? e.target.closest('video') : null; } catch (err) { video = null; }
      if (video) {
        try { e.preventDefault(); } catch (err) {}
        try { e.stopPropagation(); } catch (err) {}
        stopHoverMode();
        try { await requestWithFallback(video); } catch (err) { console.error('PiP failed:', err); }
      }
    };
    try { document.addEventListener('click', documentClickListener, true); } catch (e) {}
    try {
      mutationObserver = new MutationObserver(() => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          highlightAllVideos();
        }, 100);
      });
      mutationObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) { mutationObserver = null; }
    escapeKeyListener = (e) => { try { if (e.key === 'Escape') stopHoverMode(); } catch (err) {} };
    try { document.addEventListener('keydown', escapeKeyListener); } catch (e) {}
    let videos = [];
    try { videos = getAllVideosDeep(); } catch (e) {}
    return { ok: true, videoCount: videos.length, active: true };
  }

  function stopHoverMode() {
    if (!hoverModeActive) return { ok: true, alreadyInactive: true };
    let videos = [];
    try { videos = getAllVideosDeep(); } catch (e) {}
    videos.forEach(video => { try { video.classList.remove('__pip-ext-highlight'); } catch (e) {} });
    if (documentClickListener) {
      try { document.removeEventListener('click', documentClickListener, true); } catch (e) {}
      documentClickListener = null;
    }
    if (mutationObserver) { try { mutationObserver.disconnect(); } catch (e) {} mutationObserver = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (escapeKeyListener) { try { document.removeEventListener('keydown', escapeKeyListener); } catch (e) {} escapeKeyListener = null; }
    if (hoverHighlightStyle) { try { hoverHighlightStyle.remove(); } catch (e) {} hoverHighlightStyle = null; }
    if (hoverOverlay) { try { hoverOverlay.remove(); } catch (e) {} hoverOverlay = null; }
    hoverModeActive = false;
    return { ok: true, stopped: true };
  }

  // If a previous injection enabled auto-leave, re-attach its handler to the
  // new function closure so disableAutoLeave() keeps working.
  try {
    if (window._pipExtAutoLeave.handler && !autoLeaveHandler) {
      try { document.removeEventListener('visibilitychange', window._pipExtAutoLeave.handler); } catch (e) {}
      autoLeaveHandler = null;
      window._pipExtAutoLeave.handler = null;
      window._pipExtAutoLeave.active = false;
    }
  } catch (e) {}

  window.__pipExt = {
    detect,
    trigger,
    triggerAny,
    exitPip,
    startHoverMode,
    stopHoverMode,
    enableAutoLeave,
    disableAutoLeave,
    triggerMulti,
    exitAllPip,
    setVideoVolume,
    isAnyPipActive,
    __bootstrapped: true
  };
})();
