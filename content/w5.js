const fs = require('fs');

const part5 = `
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
          timeDisplay.textContent = \`\${formatTime(seekTime)} / \${formatTime(video.duration)}\`;
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
        speedDisplay.textContent = \`\${speed.toFixed(2)}x\`;
      });

      // ---- Size/location memory ----
      if (options.rememberSize) {
        pipWindow.addEventListener('resize', () => savePipWindowState(pipWindow));
        try {
          pipWindow.addEventListener('move', () => savePipWindowState(pipWindow));
        } catch (e) { /* 'move' not supported in this Chrome version */ }
      }

      // ---- Cleanup on window close ----
      const windowCloseHandler = () => {
        try {
          if (originalParent) {
            if (originalNextSibling) {
              originalParent.insertBefore(video, originalNextSibling);
            } else {
              originalParent.appendChild(video);
            }
          } else {
            document.body.appendChild(video);
          }
        } catch (err) {
          console.error('Failed to restore video:', err);
          try { document.body.appendChild(video); } catch (e) {}
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
      speedDisplay.textContent = \`\${video.playbackRate.toFixed(2)}x\`;
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
`;

fs.appendFileSync('content/pip-core.js', part5);
console.log('Part 5 appended: ' + part5.length + ' chars');
