/**
 * shared/tab-actions.js
 * Common functions to control pip-core.js from popup or background
 * Loaded as classic script (no ES modules) for compatibility
 * with MV3 service worker without bundler: simple global functions
 */

const PIP_CORE_FILE = "content/pip-core.js";

/** Error codes -> clear user messages (EN). */
const PIP_ERROR_MESSAGES = {
  "no-video": "No video detected on this page.",
  "pip-disabled-by-site":
    "This site explicitly blocks Picture-in-Picture (site policy).",
  NotAllowedError:
    "Browser refused Picture-in-Picture (action blocked by site or permissions).",
  "multi-pip-not-enabled": "Multiple PiP mode is not enabled.",
  "advanced-required": "Advanced Controls must be enabled for multi-PiP.",
  "no-playing-video": "No playing videos found on this page.",
  NotSupportedError:
    "This video does not support Picture-in-Picture (protected stream, canvas, or unsupported format).",
  InvalidStateError:
    "Video wasn't ready on the first try — the extension waited for metadata and retried. If this persists, try the next video in the list.",
  SecurityError:
    "Picture-in-Picture is blocked for security reasons on this content (often a protected stream/DRM)."
};

function pipFriendlyError(result) {
  if (!result) return "Unknown error.";
  if (result.injectionFailed) {
    return "Cannot access this page (internal Chrome page, Web Store, or unauthorized local file).";
  }
  // The core now reports a `stage` for readiness races — translate it.
  if (result.stage === "not-ready" || result.name === "InvalidStateError") {
    const tried = result.triedCount > 1 ? ` (tried ${result.triedCount} videos)` : "";
    return `That video's metadata never became ready${tried}, so PiP was refused. Playback was started automatically — try again or pick the next video in the list.`;
  }
  if (result.error === "no-playing-video") {
    return "Press play on the video first, then try again.";
  }
  const key = result.name || result.error;
  const base = PIP_ERROR_MESSAGES[key] || result.error || "Unknown error.";
  if (result.triedCount > 1 && !result.ok) {
    return `${base} (tried ${result.triedCount} videos)`;
  }
  return base;
}

/** Injects pip-core.js into all frames of the tab. Does nothing if it fails silently (restricted page). */
async function ensureCoreInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [PIP_CORE_FILE]
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** Detects videos from all frames of the tab. Returns {ok, frames:[{frameId, url, videoCount, videos, pipEnabled}], injectionFailed} */
async function detectVideosInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) {
    return { ok: false, injectionFailed: true, frames: [] };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.detect() : null)
    });

    const frames = results
      .filter((r) => r.result)
      .map((r) => ({ frameId: r.frameId, ...r.result }));

    return { ok: true, frames };
  } catch (e) {
    return { ok: false, injectionFailed: true, frames: [], error: e.message };
  }
}

/** Scores a detected video (mirrors the core scorer incl. readiness). */
function scoreDetectedVideo(v) {
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

/** Calculates the best candidate across all frames. */
function pickBestVideo(frames) {
  const ranked = rankAllVideos(frames);
  return ranked.length ? ranked[0] : null;
}

/** All candidates across all frames, best-first (for cross-video fallback). */
function rankAllVideos(frames) {
  const out = [];
  for (const frame of frames || []) {
    for (const v of frame.videos || []) {
      out.push({ frameId: frame.frameId, video: v, score: scoreDetectedVideo(v) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Errors worth trying the next video for (vs fatal site-level blocks). */
function isRetriablePipError(result) {
  if (!result || result.ok) return false;
  const name = result.name || result.error || "";
  if (result.stage === "not-ready") return true;
  return ["InvalidStateError", "NotSupportedError", "no-playing-video", "no-video", "no-result", "core-missing"].includes(name);
}

/** Triggers PiP for a specific video (frameId + id) or auto-select if videoId is null.
 *  options.multi – if true, don't close existing PiP windows (multi-PiP mode) */
async function triggerPipInFrame(tabId, frameId, videoId, options = {}) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) {
    return { ok: false, injectionFailed: true };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (id, opts) => (window.__pipExt ? window.__pipExt.trigger(id, opts) : { ok: false, error: "core-missing" }),
      args: [videoId || null, options]
    });
    return results[0] && results[0].result
      ? results[0].result
      : { ok: false, error: "no-result" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Auto: detects then launches PiP on the best candidate of the entire tab.
 *  options.multi – if true, starts PiP on all playing videos (multi-PiP mode)
 *  Un-breakable fallback: if the best video fails with a retriable error
 *  (notably InvalidStateError / metadata-not-ready), the next ranked videos
 *  are tried automatically — across frames. */
async function triggerAutoPip(tabId, options = {}) {
  const detection = await detectVideosInTab(tabId);
  if (!detection.ok) {
    return { ok: false, injectionFailed: true };
  }
  const ranked = rankAllVideos(detection.frames);
  if (ranked.length === 0) {
    return { ok: false, error: "no-video" };
  }
  let lastResult = null;
  for (let i = 0; i < ranked.length; i++) {
    const candidate = ranked[i];
    const result = await triggerPipInFrame(tabId, candidate.frameId, candidate.video.id, options);
    // The core itself may already have fallen back within its frame.
    if (result.ok) {
      return {
        ...result,
        usedFrameId: candidate.frameId,
        usedVideoId: (result.usedVideoId || candidate.video.id),
        fallbackUsed: i > 0 || !!result.fallbackUsed,
        triedCount: (result.triedCount || 1) + i
      };
    }
    lastResult = result;
    // Fatal blocks (site policy, security) — retrying siblings is pointless.
    if (!isRetriablePipError(result)) {
      return { ...result, usedFrameId: candidate.frameId, usedVideoId: candidate.video.id, triedCount: i + 1 };
    }
    // Otherwise keep looping to the next candidate.
  }
  return { ...(lastResult || { ok: false, error: "no-video" }), triedCount: ranked.length, fallbackUsed: ranked.length > 1 };
}

/** Starts hover mode to select a video on the page. */
async function startHoverModeInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) {
    return { ok: false, injectionFailed: true };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.startHoverMode() : { ok: false, error: "core-missing" })
    });
    const activeResult = results.find(r => r.result && r.result.active);
    return activeResult ? activeResult.result : (results[0]?.result || { ok: false, error: "no-result" });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Exits active PiP in any frame of the tab, if any. */
async function exitPipInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) return { ok: false, injectionFailed: true };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.exitPip() : { ok: true, noop: true })
        });
    return { ok: true, results: results.map((r) => r.result) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Enables auto-PiP-on-leave: injects a beforeunload listener that starts PiP
 *  on any playing video when the user navigates away. */
async function enableAutoLeavePiPInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) return { ok: false, injectionFailed: true };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.enableAutoLeave() : { ok: false, error: "core-missing" })
    });
    const active = results.find(r => r.result && r.result.active);
    return active ? active.result : { ok: false, error: "no-result" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Disables auto-PiP-on-leave. */
async function disableAutoLeavePiPInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) return { ok: false, injectionFailed: true };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.disableAutoLeave() : { ok: false, error: "core-missing" })
    });
    return { ok: true, results: results.map(r => r.result) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Multi-PiP: starts PiP on ALL playing videos across all frames of the tab. */
async function triggerMultiPipInTab(tabId) {
  const detection = await detectVideosInTab(tabId);
  if (!detection.ok) return { ok: false, injectionFailed: true };

  const frameResults = [];
  for (const frame of detection.frames) {
    if (frame.pipEnabled && frame.videos.length > 0) {
      const result = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: () => (window.__pipExt ? window.__pipExt.triggerMulti() : { ok: false, error: "core-missing" })
      });
      if (result[0] && result[0].result) {
        frameResults.push({ frameId: frame.frameId, url: frame.url, ...result[0].result });
      }
    }
  }
  const anyOk = frameResults.some(r => r.ok);
  return { ok: anyOk, frames: frameResults };
}

/** Closes ALL PiP windows (native + advanced) in every frame of the tab. */
async function exitAllPipInTab(tabId) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) return { ok: false, injectionFailed: true };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.__pipExt ? window.__pipExt.exitAllPip() : { ok: true, noop: true })
    });
    return { ok: true, results: results.map((r) => r.result) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Set the volume on the active video in the tab. Volume is 0.0–1.0. */
async function setPipVolumeInTab(tabId, volume) {
  const injected = await ensureCoreInjected(tabId);
  if (!injected) return { ok: false, injectionFailed: true };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (vol) => (window.__pipExt ? window.__pipExt.setVideoVolume(vol) : { ok: false, error: "core-missing" }),
      args: [volume]
    });
    const successful = results.find(r => r.result && r.result.ok);
    return successful ? successful.result : { ok: false, error: "no-video" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
