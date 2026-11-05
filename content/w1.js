const fs = require('fs');
const path = require('path');

let content = `/**
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
  function describeVideo(el, idx) {
    const rect = el.getBoundingClientRect();
    const area = Math.max(rect.width, 0) * Math.max(rect.height, 0);
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";

    if (!el.dataset.pipExtId) {
      el.dataset.pipExtId =
        "pipext-" + idx + "-" + Math.random().toString(36).slice(2, 9);
    }

    return {
      id: el.dataset.pipExtId,
      width: el.videoWidth || 0,
      height: el.videoHeight || 0,
      duration: isFinite(el.duration) ? el.duration : 0,
      paused: el.paused,
      muted: el.muted,
      readyState: el.readyState,
      area: Math.round(area),
      visible,
      disablePiP: !!el.disablePictureInPicture,
      inPiP: document.pictureInPictureElement === el,
      hasSource: !!(el.currentSrc || el.src || el.querySelector("source"))
    };
  }

  function detect() {
    const videos = Array.from(document.querySelectorAll("video"));
    return {
      pipEnabled: !!document.pictureInPictureEnabled,
      url: location.href,
      title: document.title,
      videoCount: videos.length,
      videos: videos.map((v, i) => describeVideo(v, i))
    };
  }
`;

fs.writeFileSync('content/pip-core.js', content);
console.log('Part 1 written: ' + content.length + ' chars');
