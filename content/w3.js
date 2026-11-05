const fs = require('fs');

const part3 = `
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
      // Close existing windows unless in multi mode
      if (!options.multi && advancedPiPWindows.length > 0) {
        for (const w of advancedPiPWindows) { try { w.close(); } catch (e) {} }
        advancedPiPWindows = [];
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
      style.textContent = \`
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
      \`;
      pipWindow.document.head.appendChild(style);
`;

fs.appendFileSync('content/pip-core.js', part3);
console.log('Part 3 appended: ' + part3.length + ' chars');
