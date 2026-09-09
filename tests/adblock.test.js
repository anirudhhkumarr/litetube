import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAdItem,
  filterAdsFromFeed,
  extractDirectStream,
  isAdUrl,
  cleanVideoUrl
} from '../src/adblock/adblocker.js';

describe('AdBlocker - Feed Ad Detection', () => {
  it('detects explicit ad renderers and badges', () => {
    assert.equal(isAdItem({ type: 'adSlotRenderer' }), true);
    assert.equal(isAdItem({ type: 'promotedSparklesWebRenderer' }), true);
    assert.equal(isAdItem({ type: 'inFeedAdRenderer' }), true);
    assert.equal(isAdItem({ isPromoted: true }), true);
    assert.equal(isAdItem({ badge: 'Ad' }), true);
    assert.equal(isAdItem({ badge: 'Sponsored' }), true);
  });

  it('preserves authentic organic videos', () => {
    assert.equal(isAdItem({ id: 'v123', title: 'Calculus Explained', badge: null }), false);
    assert.equal(isAdItem({ id: 'v456', title: 'WWDC Keynote', type: 'videoRenderer' }), false);
  });

  it('filters all ad slots out of feed lists', () => {
    const mixedFeed = [
      { id: 'v1', title: 'Organic Video 1', type: 'videoRenderer' },
      { id: 'ad1', title: 'Buy Best Car Now', type: 'promotedSparklesWebRenderer', badge: 'Sponsored' },
      { id: 'v2', title: 'Organic Video 2', type: 'videoRenderer' },
      { id: 'ad2', title: 'Insurance Discount', isPromoted: true }
    ];

    const cleaned = filterAdsFromFeed(mixedFeed);
    assert.equal(cleaned.length, 2);
    assert.deepEqual(cleaned.map(i => i.id), ['v1', 'v2']);
  });
});

describe('AdBlocker - Direct Native Stream Resolution (Zero Ad Engine)', () => {
  it('prioritizes HLS adaptive master manifest if available', () => {
    const streamingData = {
      hlsManifestUrl: 'https://manifest.googlevideo.com/api/manifest/hls_variant/...',
      formats: [
        { itag: 22, qualityLabel: '720p', url: 'https://googlevideo.com/videoplayback?itag=22' }
      ]
    };

    const stream = extractDirectStream(streamingData);
    assert.equal(stream.type, 'hls');
    assert.equal(stream.url, 'https://manifest.googlevideo.com/api/manifest/hls_variant/...');
  });

  it('falls back to progressive MP4 stream with highest quality', () => {
    const streamingData = {
      formats: [
        { itag: 18, qualityLabel: '360p', height: 360, url: 'https://googlevideo.com/360p.mp4' },
        { itag: 22, qualityLabel: '720p', height: 720, url: 'https://googlevideo.com/720p.mp4' }
      ]
    };

    const stream = extractDirectStream(streamingData);
    assert.equal(stream.type, 'mp4');
    assert.equal(stream.url, 'https://googlevideo.com/720p.mp4');
    assert.equal(stream.quality, '720p');
  });

  it('returns null if streamingData is invalid', () => {
    assert.equal(extractDirectStream(null), null);
    assert.equal(extractDirectStream({}), null);
  });
});

describe('AdBlocker - Network and URL Ad Sanitization', () => {
  it('identifies known ad tracking domains', () => {
    assert.equal(isAdUrl('https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-123'), true);
    assert.equal(isAdUrl('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'), true);
    assert.equal(isAdUrl('https://ad.doubleclick.net/ddm/track/clk'), true);
    assert.equal(isAdUrl('https://static.doubleclick.net/instream/ad_status.js'), true);
    assert.equal(isAdUrl('https://googlevideo.com/videoplayback?expire=123'), false);
  });

  it('strips tracking and ad tags from video URLs', () => {
    const dirtyUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&ad_type=preroll&gclid=Cj0KCQ&feature=emb_rel_end';
    const cleaned = cleanVideoUrl(dirtyUrl);
    assert.equal(cleaned, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

import {
  isYouTubeServedAd,
  getYouTubeServedAdReason,
  isLocalhost,
  isDevMode,
  logStreamDebug,
  logAdBlocked,
  logAdFailure,
  logStreamVerbose,
  getYouTubeErrorMessage,
  PLAYER_STATE_MAP
} from '../src/adblock/streamShield.js';

describe('AdBlocker - YouTube Stream Ad Shield', () => {
  it('detects unskippable ad when progressState.allowSeeking is false', () => {
    const adData = {
      info: {
        progressState: {
          allowSeeking: false,
          duration: 15,
          seekableStart: 0,
          seekableEnd: 0
        },
        currentTime: 2.5
      }
    };
    assert.equal(isYouTubeServedAd(adData, 'real123'), true);
    assert.ok(getYouTubeServedAdReason(adData, 'real123')?.includes('progressState.allowSeeking=false'));
  });

  it('allows normal playback when progressState.allowSeeking is true', () => {
    const normalData = {
      info: {
        progressState: {
          allowSeeking: true,
          duration: 12021,
          seekableStart: 0,
          seekableEnd: 12020.641
        },
        currentTime: 3.9
      }
    };
    assert.equal(isYouTubeServedAd(normalData, 'real123'), false);
    assert.equal(getYouTubeServedAdReason(normalData, 'real123'), null);
  });

  it('detects zero seekable window as ad section', () => {
    const zeroSeekData = {
      info: {
        progressState: {
          seekableEnd: 0
        },
        currentTime: 2.0
      }
    };
    assert.equal(isYouTubeServedAd(zeroSeekData, 'real123'), true);
    assert.ok(getYouTubeServedAdReason(zeroSeekData, 'real123')?.includes('zero-seekable-window'));
  });

  it('detects in-stream ad video ID mismatch', () => {
    // When YouTube swaps in an ad video ID
    assert.equal(isYouTubeServedAd({
      info: { videoData: { video_id: 'ad_commercial_999' } }
    }, 'real123'), true);

    // When the real video is playing
    assert.equal(isYouTubeServedAd({
      info: { videoData: { video_id: 'real123' } }
    }, 'real123'), false);
  });

  it('returns false for authentic video playback without ads', () => {
    assert.equal(isYouTubeServedAd({
      info: {
        adState: 0,
        isAd: false,
        videoData: { video_id: 'real123' },
        currentTime: 42
      }
    }, 'real123'), false);
    assert.equal(isYouTubeServedAd(null, 'real123'), false);
  });



  it('detects localhost and loopback environments correctly', () => {
    const originalWindow = globalThis.window;
    try {
      delete globalThis.window;
      assert.equal(isLocalhost(), false);

      globalThis.window = { location: { hostname: 'localhost' } };
      assert.equal(isLocalhost(), true);

      globalThis.window = { location: { hostname: '127.0.0.1' } };
      assert.equal(isLocalhost(), true);

      globalThis.window = { location: { hostname: 'app.local' } };
      assert.equal(isLocalhost(), true);

      globalThis.window = { location: { hostname: 'litetube.pages.dev' } };
      assert.equal(isLocalhost(), false);
    } finally {
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });

  it('verifies PLAYER_STATE_MAP mappings', () => {
    assert.equal(PLAYER_STATE_MAP['-1'], 'UNSTARTED');
    assert.equal(PLAYER_STATE_MAP['1'], 'PLAYING');
    assert.equal(PLAYER_STATE_MAP['2'], 'PAUSED');
    assert.equal(PLAYER_STATE_MAP['3'], 'BUFFERING');
    assert.equal(PLAYER_STATE_MAP['0'], 'ENDED');
  });

  it('logs stream debug messages only in localhost', () => {
    const originalWindow = globalThis.window;
    const originalLog = console.log;
    const logs = [];

    try {
      console.log = (...args) => logs.push(args);

      // On remote host -> should not log
      globalThis.window = { location: { hostname: 'youtube.com' } };
      logStreamDebug('Test Remote Event', { foo: 'bar' });
      assert.equal(logs.length, 0);

      // On localhost -> should log with prefix
      globalThis.window = { location: { hostname: 'localhost' } };
      logStreamDebug('Stream State → PLAYING', { state: 1 });
      assert.equal(logs.length, 1);
      assert.ok(logs[0][0].includes('[LiteTube Stream]'));
      assert.ok(logs[0][0].includes('Stream State → PLAYING'));
      assert.deepEqual(logs[0][3], { state: 1 });
    } finally {
      console.log = originalLog;
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });

  it('logs prominent blocked ad badge in dev mode and suppresses on remote host', () => {
    const originalWindow = globalThis.window;
    const originalLog = console.log;
    const logs = [];

    try {
      console.log = (...args) => logs.push(args);

      // On remote host -> should not log
      globalThis.window = { location: { hostname: 'youtube.com' } };
      logAdBlocked('FeedAdBlocker', 'Blocked sponsored video', { id: 'ad123' });
      assert.equal(logs.length, 0);

      // On localhost -> should log with green badge prefix
      globalThis.window = { location: { hostname: 'localhost' } };
      logAdBlocked('StreamShield', 'YouTube-Served Ad Intercepted: isAd=true', { isAd: true });
      assert.equal(logs.length, 1);
      assert.ok(logs[0][0].includes('[LiteTube StreamShield] 🛡️ BLOCKED'));
      assert.ok(logs[0][0].includes('YouTube-Served Ad Intercepted: isAd=true'));
      assert.deepEqual(logs[0][3], { isAd: true });
    } finally {
      console.log = originalLog;
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });

  it('logs ad failure warnings with red warning badge in dev mode', () => {
    const originalWindow = globalThis.window;
    const originalWarn = console.warn;
    const warnings = [];

    try {
      console.warn = (...args) => warnings.push(args);

      globalThis.window = { location: { hostname: 'localhost' } };
      logAdFailure('StreamShield', 'Ad still active after 5.0s', { attempts: 3 });
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0][0].includes('[LiteTube StreamShield] ⚠️ AD WARNING / FAILURE'));
      assert.ok(warnings[0][0].includes('Ad still active after 5.0s'));
      assert.deepEqual(warnings[0][3], { attempts: 3 });
    } finally {
      console.warn = originalWarn;
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });

  it('logs stream verbose details in dev mode', () => {
    const originalWindow = globalThis.window;
    const originalLog = console.log;
    const logs = [];

    try {
      console.log = (...args) => logs.push(args);

      globalThis.window = { location: { hostname: 'localhost' } };
      logStreamVerbose('Ad Shielding active (elapsed: 1.2s at 16x speed)', { elapsed: 1.2 });
      assert.equal(logs.length, 1);
      assert.ok(logs[0][0].includes('[LiteTube StreamShield:Verbose]'));
      assert.ok(logs[0][0].includes('Ad Shielding active'));
    } finally {
      console.log = originalLog;
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });

  it('translates YouTube player API error codes into descriptive messages', () => {
    assert.ok(getYouTubeErrorMessage(2).includes('Invalid parameter'));
    assert.ok(getYouTubeErrorMessage(5).includes('HTML5'));
    assert.ok(getYouTubeErrorMessage(100).includes('not found'));
    assert.ok(getYouTubeErrorMessage(101).includes('embedded playback'));
    assert.ok(getYouTubeErrorMessage(150).includes('embedded playback'));
    assert.ok(getYouTubeErrorMessage(999).includes('Unknown player error'));
  });
});

