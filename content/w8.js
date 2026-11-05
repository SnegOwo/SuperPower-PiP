const fs = require('fs');

const part8 = `
  // ---- Auto PiP on page leave ----
  function enableAutoLeave() {
    if (autoLeaveHandler) return { ok: true, alreadyActive: true };
    refreshSettingsCache();

    autoLeaveHandler = function () {
      try {
        const videos = Array.from(document.querySelectorAll('video'));
        const playing = videos.find(v =>
          !v.paused && v.readyState >= 2 && !v.disablePictureInPicture &&
          document.pictureInPictureElement !== v
        );
        if (!playing) return;

        const useAdvanced = settingsCache.advanced && !isOperaGX();
        if (useAdvanced && 'documentPictureInPicture' in window) {
          createAdvancedPiP(playing, {
            multi: settingsCache.multi,
            rememberSize: settingsCache.rememberSize,
            pipState: settingsCache.pipState
          }).catch(() => {});
        } else if (document.pictureInPictureEnabled) {
          if (playing.disablePictureInPicture) playing.disablePictureInPicture = false;
          playing.requestPictureInPicture().catch(() => {});
        }
      } catch (e) { /* page unloading — fail silently */ }
    };

    window.addEventListener('beforeunload', autoLeaveHandler);
    window.addEventListener('pagehide', autoLeaveHandler);
    return { ok: true, active: true };
  }

  function disableAutoLeave() {
    if (!autoLeaveHandler) return { ok: true, alreadyInactive: true };
    window.removeEventListener('beforeunload', autoLeaveHandler);
    window.removeEventListener('pagehide', autoLeaveHandler);
    autoLeaveHandler = null;
    return { ok: true, stopped: true };
  }
`;

fs.appendFileSync('content/pip-core.js', part8);
console.log('Part 8 appended: ' + part8.length + ' chars');
