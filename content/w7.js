const fs = require('fs');

const part7 = `
  async function trigger(id) {
    let video = null;

    if (id) {
      video = findById(id);
    }
    if (!video) {
      const all = Array.from(document.querySelectorAll("video"));
      if (all.length === 0) {
        return { ok: false, error: "no-video" };
      }
      const scored = all
        .map((el, i) => ({ el, d: describeVideo(el, i) }))
        .sort((a, b) => scoreVideo(b.d) - scoreVideo(a.d));
      video = scored[0].el;
    }

    if (!video) return { ok: false, error: "no-video" };

    if (document.pictureInPictureElement === video) {
      try {
        await document.exitPictureInPicture();
        return { ok: true, action: "exited" };
      } catch (e) {
        return { ok: false, error: e.message, name: e.name };
      }
    }

    if (!document.pictureInPictureEnabled) {
      return { ok: false, error: "pip-disabled-by-site", name: "NotAllowedError" };
    }

    return requestWithFallback(video);
  }

  /** Starts PiP for ALL playing videos in this frame (multi-PiP mode). */
  async function triggerMulti() {
    await refreshSettingsCache();

    if (!settingsCache.advanced) {
      return { ok: false, error: "advanced-required" };
    }

    const all = Array.from(document.querySelectorAll("video"));
    if (all.length === 0) return { ok: false, error: "no-video" };

    const playing = all.filter(v =>
      !v.paused &&
      v.readyState >= 2 &&
      !v.disablePictureInPicture &&
      document.pictureInPictureElement !== v
    );
    if (playing.length === 0) return { ok: false, error: "no-playing-video" };

    const pipOptions = {
      rememberSize: settingsCache.rememberSize,
      pipState: settingsCache.pipState
    };
    const results = [];
    for (const v of playing) {
      const r = await createAdvancedPiP(v, { ...pipOptions, multi: true });
      results.push(r);
    }
    return { ok: true, action: "multi-started", results, count: results.length };
  }

  /** Exits native PiP and closes ALL advanced PiP windows. */
  async function exitPip() {
    let closedAdvanced = 0;
    for (const w of advancedPiPWindows) {
      try { w.close(); closedAdvanced++; } catch (e) {}
    }
    advancedPiPWindows = [];

    let closedNative = false;
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        closedNative = true;
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    return { ok: true, action: "exited", closedAdvanced, closedNative };
  }

  /** Closes ALL PiP windows (native + advanced). */
  async function exitAllPip() {
    let closed = 0;
    for (const w of advancedPiPWindows) {
      try { w.close(); closed++; } catch (e) {}
    }
    advancedPiPWindows = [];
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        closed++;
      } catch (e) {}
    }
    return { ok: true, closed };
  }

  /** Sets the volume on the active (or first) video element. */
  function setVideoVolume(volume) {
    const videos = Array.from(document.querySelectorAll('video'));
    const playing = videos.find(v => !v.paused) || videos[0];
    if (playing) {
      playing.volume = Math.max(0, Math.min(1, volume));
      if (volume <= 0) playing.muted = true;
      else playing.muted = false;
      return { ok: true, volume: playing.volume, muted: playing.muted };
    }
    return { ok: false, error: "no-video" };
  }

  /** Returns info about any active PiP state. */
  function isAnyPipActive() {
    return {
      native: !!document.pictureInPictureElement,
      advanced: advancedPiPWindows.length,
      total: (document.pictureInPictureElement ? 1 : 0) + advancedPiPWindows.length
    };
  }
`;

fs.appendFileSync('content/pip-core.js', part7);
console.log('Part 7 appended: ' + part7.length + ' chars');
