const fs = require('fs');

const part4 = `      // --- HTML structure ---
      pipWindow.document.body.innerHTML = \`
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
      \`;

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
        timeDisplay.textContent = \`\${formatTime(video.currentTime)} / \${formatTime(video.duration)}\`;
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
`;

fs.appendFileSync('content/pip-core.js', part4);
console.log('Part 4 appended: ' + part4.length + ' chars');
