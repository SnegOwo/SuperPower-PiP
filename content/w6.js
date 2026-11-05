const fs = require('fs');

const part6 = `
  // Detect Opera GX
  function isOperaGX() {
    return navigator.userAgent.includes('OPR') && navigator.userAgent.includes('GX');
  }

  async function requestWithFallback(video) {
    const result = await chrome.storage.sync.get([
      'pipProAdvanced', 'pipProMultiPip', 'pipProRememberSize', 'pipProPipState'
    ]);
    updateSettingsCache(result);

    const isAdvanced = !!result.pipProAdvanced && !isOperaGX();
    const isMulti = !!result.pipProMultiPip;
    const rememberSize = !!result.pipProRememberSize;
    const pipState = result.pipProPipState;
    const pipOptions = { rememberSize, pipState };

    // Multi-PiP: start advanced PiP for ALL playing videos
    if (isMulti && isAdvanced) {
      const allVideos = Array.from(document.querySelectorAll("video"));
      const playing = allVideos.filter(v =>
        !v.paused &&
        v.readyState >= 2 &&
        !v.disablePictureInPicture
      );
      if (playing.length > 0) {
        const results = [];
        for (const v of playing) {
          const r = await createAdvancedPiP(v, { ...pipOptions, multi: true });
          results.push(r);
        }
        return { ok: true, action: "multi-started", results, count: results.length };
      }
      // If no playing videos, fall through to single-video path
    }

    if (isAdvanced) {
      const advancedResult = await createAdvancedPiP(video, pipOptions);
      if (advancedResult.ok) return advancedResult;
    }

    // Regular PiP fallback
    if (video.disablePictureInPicture) {
      video.disablePictureInPicture = false;
    }
    try {
      await video.requestPictureInPicture();
      return { ok: true, action: "started" };
    } catch (firstError) {
      try {
        video.disablePictureInPicture = false;
        if (video.paused) {
          await video.play().catch(() => {});
        }
        await video.requestPictureInPicture();
        return { ok: true, action: "started-fallback" };
      } catch (secondError) {
        return {
          ok: false,
          error: secondError.message || firstError.message,
          name: secondError.name || firstError.name
        };
      }
    }
  }
`;

fs.appendFileSync('content/pip-core.js', part6);
console.log('Part 6 appended: ' + part6.length + ' chars');
