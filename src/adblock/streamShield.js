/**
 * YouTube Stream Ad Shield
 *
 * Specifically targets YouTube-served video ads (pre-roll, mid-roll, unskippable ads):
 * 1. Listens to YouTube IFrame postMessage events to detect when YouTube is serving an ad.
 * 2. Immediately mutes the audio during YouTube-served ads.
 * 3. Speeds up playback to 16x and triggers skip/seek jumps to burn through unskippable ads instantly.
 * 4. Hides the ad stream from the UI with a subtle ambient buffer state so the user never sees the ad.
 * 5. Handles delayed skip timing (when skip button appears after 5s countdown).
 * 6. Automatically restores 1x speed, un-mutes, and reveals the video as soon as the real video resumes.
 */

/**
 * Strict set of allowed YouTube embed origins.
 */
export const ALLOWED_YOUTUBE_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com'
]);

/**
 * Validates if a postMessage event origin is an authentic YouTube domain.
 */
export function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  return ALLOWED_YOUTUBE_ORIGINS.has(origin);
}

/**
 * Sends the official YouTube listening handshake to initialize postMessage event delivery.
 */
export function sendListeningHandshake(iframe) {
  if (!iframe?.contentWindow) return false;
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      '*'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if an incoming postMessage from the YouTube iframe indicates an ad or unskippable section is playing.
 */
/**
 * Identifies the specific authoritative signal triggering YouTube ad detection.
 * Returns a human-readable reason string or null if not an ad.
 */
export function getYouTubeServedAdReason(data, targetVideoId) {
  if (!data) return null;

  const info = data.info || (data.event === 'infoDelivery' ? data : null);
  if (!info) return null;

  // 1. Real YouTube internal player progressState (authoritative unskippable ad detection)
  const progress = info.progressState;
  if (progress) {
    if (progress.allowSeeking === false) {
      const dur = typeof progress.duration === 'number' ? `${progress.duration}s` : 'unknown';
      return `unskippable-section (progressState.allowSeeking=false, duration=${dur})`;
    }

    if (
      typeof progress.seekableEnd === 'number' &&
      progress.seekableEnd === 0 &&
      typeof info.currentTime === 'number' &&
      info.currentTime > 0.5
    ) {
      return `zero-seekable-window (seekableEnd=0 at ${info.currentTime.toFixed(1)}s)`;
    }
  }

  // 2. In-stream ad video ID mismatch (when YouTube swaps in an ad video ID)
  if (
    info.videoData &&
    info.videoData.video_id &&
    targetVideoId &&
    info.videoData.video_id !== targetVideoId
  ) {
    return `video_id mismatch ("${info.videoData.video_id}" !== "${targetVideoId}")`;
  }

  return null;
}

export function isYouTubeServedAd(data, targetVideoId) {
  return getYouTubeServedAdReason(data, targetVideoId) !== null;
}

/**
 * Sends a command to the YouTube embed iframe via postMessage.
 */
export function sendPlayerCommand(iframe, func, args = []) {
  if (!iframe) {
    logAdFailure('StreamShield', `Cannot send "${func}": iframe element is null`);
    return false;
  }
  if (!iframe.contentWindow) {
    logAdFailure('StreamShield', `Cannot send "${func}": iframe.contentWindow is inaccessible`);
    return false;
  }
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args
      }),
      '*'
    );
    logStreamVerbose(`postMessage dispatched → ${func}`, { args });
    return true;
  } catch (err) {
    logAdFailure('StreamShield', `Failed to post "${func}" command: ${err.message}`, { error: err });
    return false;
  }
}

/**
 * Checks if the current environment is running on localhost or loopback.
 */
export function isLocalhost() {
  if (typeof window === 'undefined' || !window.location) return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || (typeof h === 'string' && h.endsWith('.local'));
}

/**
 * Checks if the application is running in Vite dev mode or on localhost.
 */
export function isDevMode() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      return true;
    }
  } catch { }
  return isLocalhost();
}

export const PLAYER_STATE_MAP = {
  '-1': 'UNSTARTED',
  '0': 'ENDED',
  '1': 'PLAYING',
  '2': 'PAUSED',
  '3': 'BUFFERING',
  '5': 'VIDEO_CUED'
};

/**
 * Translates YouTube player API error codes into descriptive messages.
 */
export function getYouTubeErrorMessage(code) {
  switch (Number(code)) {
    case 2:
      return 'Invalid parameter value (e.g. malformed video ID)';
    case 5:
      return 'HTML5 player error (cannot be played in HTML5 player)';
    case 100:
      return 'Video not found (removed or marked private)';
    case 101:
    case 150:
      return 'Video owner does not allow embedded playback';
    default:
      return `Unknown player error (${code})`;
  }
}

/**
 * Logs general stream debug information about stream state only when in dev mode.
 */
export function logStreamDebug(label, payload) {
  if (!isDevMode()) return;
  const prefix = '%c[LiteTube Stream]';
  const prefixStyle = 'background: #2997ff; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;';
  if (payload !== undefined) {
    console.log(`${prefix}%c ${label}`, prefixStyle, 'color: inherit; font-weight: 500;', payload);
  } else {
    console.log(`${prefix}%c ${label}`, prefixStyle, 'color: inherit; font-weight: 500;');
  }
}

/**
 * Logs prominent debug information whenever an ad (stream ad, feed ad, or sponsor segment) is blocked.
 */
export function logAdBlocked(component, action, details) {
  if (!isDevMode()) return;
  const prefix = `%c[LiteTube ${component}] 🛡️ BLOCKED`;
  const prefixStyle = 'background: #00875a; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;';
  if (details !== undefined) {
    console.log(`${prefix}%c ${action}`, prefixStyle, 'color: inherit; font-weight: 600;', details);
  } else {
    console.log(`${prefix}%c ${action}`, prefixStyle, 'color: inherit; font-weight: 600;');
  }
}

/**
 * Logs warnings or errors when an ad operation, skip attempt, or stream command fails.
 */
export function logAdFailure(component, reason, details) {
  if (!isDevMode()) return;
  const prefix = `%c[LiteTube ${component}] ⚠️ AD WARNING / FAILURE`;
  const prefixStyle = 'background: #de350b; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;';
  if (details !== undefined) {
    console.warn(`${prefix}%c ${reason}`, prefixStyle, 'color: inherit; font-weight: 600;', details);
  } else {
    console.warn(`${prefix}%c ${reason}`, prefixStyle, 'color: inherit; font-weight: 600;');
  }
}

/**
 * Logs verbose stream events (postMessage deliveries, playback rate changes, skip attempt progress).
 */
export function logStreamVerbose(label, payload) {
  if (!isDevMode()) return;
  const prefix = '%c[LiteTube StreamShield:Verbose]';
  const prefixStyle = 'background: #5243aa; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px;';
  if (payload !== undefined) {
    console.log(`${prefix}%c ${label}`, prefixStyle, 'color: #888; font-weight: 400;', payload);
  } else {
    console.log(`${prefix}%c ${label}`, prefixStyle, 'color: #888; font-weight: 400;');
  }
}
