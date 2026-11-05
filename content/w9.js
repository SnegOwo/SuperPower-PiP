const fs = require('fs');

const part9 = `
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
    style.textContent = \`
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
    \`;
    return style;
  }

  function showOverlay() {
    const overlay = document.createElement('div');
    overlay.className = '__pip-ext-overlay';
    const text = document.createElement('div');
    text.className = '__pip-ext-overlay-text';
    text.textContent = 'Click a video to put it in PiP (Escape to cancel)';
    overlay.appendChild(text);
    document.body.appendChild(overlay);
    return overlay;
  }

  function highlightAllVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach(video => {
      video.classList.add('__pip-ext-highlight');
    });
  }

  function startHoverMode() {
    if (hoverModeActive) return { ok: true, alreadyActive: true };
    hoverModeActive = true;
    hoverHighlightStyle = createHighlightStyle();
    document.head.appendChild(hoverHighlightStyle);
    hoverOverlay = showOverlay();
    highlightAllVideos();
    documentClickListener = async (e) => {
      const video = e.target.closest('video');
      if (video) {
        e.preventDefault();
        e.stopPropagation();
        stopHoverMode();
        try { await requestWithFallback(video); } catch (err) { console.error('PiP failed:', err); }
      }
    };
    document.addEventListener('click', documentClickListener, true);
    mutationObserver = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        highlightAllVideos();
      }, 100);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    escapeKeyListener = (e) => { if (e.key === 'Escape') stopHoverMode(); };
    document.addEventListener('keydown', escapeKeyListener);
    const videos = Array.from(document.querySelectorAll('video'));
    return { ok: true, videoCount: videos.length, active: true };
  }

  function stopHoverMode() {
    if (!hoverModeActive) return { ok: true, alreadyInactive: true };
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach(video => { video.classList.remove('__pip-ext-highlight'); });
    if (documentClickListener) {
      document.removeEventListener('click', documentClickListener, true);
      documentClickListener = null;
    }
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (escapeKeyListener) { document.removeEventListener('keydown', escapeKeyListener); escapeKeyListener = null; }
    if (hoverHighlightStyle) { hoverHighlightStyle.remove(); hoverHighlightStyle = null; }
    if (hoverOverlay) { hoverOverlay.remove(); hoverOverlay = null; }
    hoverModeActive = false;
    return { ok: true, stopped: true };
  }

  window.__pipExt = {
    detect,
    trigger,
    exitPip,
    startHoverMode,
    stopHoverMode,
    enableAutoLeave,
    disableAutoLeave,
    triggerMulti,
    exitAllPip,
    setVideoVolume,
    isAnyPipActive
  };
})();
`;

fs.appendFileSync('content/pip-core.js', part9);
console.log('Part 9 appended: ' + part9.length + ' chars');

// Run all parts in sequence
console.log('Total file size: ' + fs.statSync('content/pip-core.js').size + ' bytes');
