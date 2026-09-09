import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDurationToSeconds,
  parseViewCount,
  isShort,
  isWatchedVideo,
  filterVideos,
  FilterEngine
} from '../src/filters/engine.js';

describe('Filter Engine - Duration & View Count Parsing', () => {
  it('correctly parses duration strings to seconds', () => {
    assert.equal(parseDurationToSeconds('0:45'), 45);
    assert.equal(parseDurationToSeconds('1:00'), 60);
    assert.equal(parseDurationToSeconds('12:34'), 754);
    assert.equal(parseDurationToSeconds('1:02:15'), 3735);
    assert.equal(parseDurationToSeconds(45), 45);
    assert.equal(parseDurationToSeconds(null), null);
    assert.equal(parseDurationToSeconds('LIVE'), null);
  });

  it('correctly parses view count strings to numbers', () => {
    assert.equal(parseViewCount('1.2M views'), 1200000);
    assert.equal(parseViewCount('500K views'), 500000);
    assert.equal(parseViewCount('1.5B views'), 1500000000);
    assert.equal(parseViewCount('950 views'), 950);
    assert.equal(parseViewCount('1,234 views'), 1234);
    assert.equal(parseViewCount('No views'), 0);
    assert.equal(parseViewCount('0 views'), 0);
    assert.equal(parseViewCount('34 watching'), 34);
    assert.equal(parseViewCount('1.2K watching'), 1200);
    assert.equal(parseViewCount(1500), 1500);
    assert.equal(parseViewCount(null), null);
    assert.equal(parseViewCount(''), null);
  });
});

describe('Filter Engine - Shorts Detection', () => {
  it('detects explicit shorts flags and modern formats', () => {
    assert.equal(isShort({ isShort: true, duration: '12:00' }), true);
    assert.equal(isShort({ type: 'reel', duration: '12:00' }), true);
    assert.equal(isShort({ type: 'reelItemRenderer' }), true);
    assert.equal(isShort({ type: 'shortsLockupViewModel' }), true);
    assert.equal(isShort({ contentType: 'LOCKUP_CONTENT_TYPE_SHORTS' }), true);
    assert.equal(isShort({ url: 'https://youtube.com/shorts/abc123xyz' }), true);
    assert.equal(isShort({ badge: 'SHORTS' }), true);
    assert.equal(isShort({ duration: 'SHORTS' }), true);
    assert.equal(isShort({ title: 'Amazing science trick #shorts you must try' }), true);
    assert.equal(isShort({ title: 'Best Moments #short' }), true);
  });

  it('detects videos shorter than 60 seconds as shorts', () => {
    assert.equal(isShort({ duration: '0:35' }), true);
    assert.equal(isShort({ durationSeconds: 45 }), true);
    assert.equal(isShort({ duration: '0:59' }), true);
  });

  it('preserves small videos (>60s) that are not shorts', () => {
    assert.equal(isShort({ title: 'Quick Guitar Riff', duration: '1:15', durationSeconds: 75 }), false);
    assert.equal(isShort({ title: 'Movie Teaser Trailer', duration: '1:45', durationSeconds: 105 }), false);
    assert.equal(isShort({ duration: '1:01', durationSeconds: 61 }), false);
    assert.equal(isShort({ duration: '15:20', durationSeconds: 920 }), false);
    assert.equal(isShort({ duration: '2:14:05', durationSeconds: 8045 }), false);
  });
});



describe('Filter Engine - Full Pipeline', () => {
  const sampleVideos = [
    { id: 'v1', title: 'Deep Learning Course', channelId: 'c1', channelTitle: '3Blue1Brown', duration: '25:00', durationSeconds: 1500 },
    { id: 'v2', title: 'Funny Dance #shorts', channelId: 'c2', channelTitle: 'Viral Clips', duration: '0:30', durationSeconds: 30, isShort: true },
    { id: 'v3', title: 'Shocking Secret!', channelId: 'c3_bad', channelTitle: 'Clickbait Hub', duration: '12:00', durationSeconds: 720 },
    { id: 'v4', title: 'Minimal Desk Setup', channelId: 'c4', channelTitle: 'Ali Abdaal', duration: '18:45', durationSeconds: 1125 },
    { id: 'v5', title: 'Quick Tip', channelId: 'c5', channelTitle: 'Tech Quickie', duration: '0:55', durationSeconds: 55 }
  ];

  it('filters out shorts', () => {
    const result = filterVideos(sampleVideos, {
      blockShorts: true
    });

    // Kept should be v1, v3, and v4 (v2 and v5 are shorts)
    assert.equal(result.items.length, 3);
    assert.deepEqual(result.items.map(v => v.id), ['v1', 'v3', 'v4']);
    assert.equal(result.stats.removedShorts, 2); // v2 and v5
  });

  it('supports custom rule extensions', () => {
    const engine = new FilterEngine({ blockShorts: true });
    // Add rule to filter out videos with "Desk" in title
    engine.addRule(video => !video.title.toLowerCase().includes('desk'));

    const result = engine.process(sampleVideos);
    assert.equal(result.items.find(v => v.id === 'v4'), undefined);
    assert.ok(result.items.find(v => v.id === 'v1'));
  });

  it('filters out already-watched videos when hideWatched is true', () => {
    const result = filterVideos(sampleVideos, {
      blockShorts: true,
      hideWatched: true,
      watchedVideos: ['v1']
    });

    // Kept should be v3 and v4 (v1 is watched, v2 & v5 are shorts)
    assert.equal(result.items.some(v => v.id === 'v1'), false);
    assert.ok(result.items.some(v => v.id === 'v4'));
    assert.equal(result.stats.removedWatched, 1);
  });

  it('identifies and skips videos with user watched annotations (isWatched, resume playback, or WATCHED badge)', () => {
    const annotatedVideos = [
      { id: 'w1', title: 'Already finished video', duration: '12:00', durationSeconds: 720, views: '10K', isWatched: true },
      { id: 'w2', title: 'Mostly watched video', duration: '20:00', durationSeconds: 1200, views: '50K', percentDurationWatched: 92 },
      { id: 'w3', title: 'Watched badge video', duration: '15:00', durationSeconds: 900, views: '30K', badge: 'WATCHED' },
      { id: 'w4', title: 'Unwatched fresh video', duration: '18:00', durationSeconds: 1080, views: '100K', isWatched: false, percentDurationWatched: 10 },
      { id: 'w5', title: 'Barely started video', duration: '08:00', durationSeconds: 480, views: '20K', percentDurationWatched: 5 }
    ];

    // Verify isWatchedVideo helper
    assert.equal(isWatchedVideo(annotatedVideos[0]), true);
    assert.equal(isWatchedVideo(annotatedVideos[1]), true);
    assert.equal(isWatchedVideo(annotatedVideos[2]), true);
    assert.equal(isWatchedVideo(annotatedVideos[3]), false);
    assert.equal(isWatchedVideo(annotatedVideos[4]), false);

    // Verify filterVideos skips all videos with watched annotations
    const result = filterVideos(annotatedVideos, {
      hideWatched: true,
      blockShorts: false
    });

    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map(v => v.id), ['w4', 'w5']);
    assert.equal(result.stats.removedWatched, 3);
  });

  it('filters out videos with less than 1,000 views', () => {
    const videosWithViews = [
      { id: 'v10', title: 'Viral Hit', views: '2.5M views', viewCount: 2500000, duration: '10:00', durationSeconds: 600 },
      { id: 'v11', title: 'Popular Tech Review', views: '15K views', viewCount: 15000, duration: '08:30', durationSeconds: 510 },
      { id: 'v12', title: 'Decent Guide', views: '1.2K views', viewCount: 1200, duration: '14:20', durationSeconds: 860 },
      { id: 'v13', title: 'Exactly 1k', views: '1K views', viewCount: 1000, duration: '05:00', durationSeconds: 300 },
      { id: 'v14', title: 'Low views video', views: '950 views', viewCount: 950, duration: '12:00', durationSeconds: 720 },
      { id: 'v15', title: 'Tiny views video', views: '45 views', viewCount: 45, duration: '04:15', durationSeconds: 255 },
      { id: 'v16', title: 'Brand new no views', views: 'No views', viewCount: 0, duration: '07:30', durationSeconds: 450 }
    ];

    const result = filterVideos(videosWithViews, {
      minViews: 1000,
      blockShorts: false
    });

    assert.equal(result.items.length, 4);
    assert.deepEqual(result.items.map(v => v.id), ['v10', 'v11', 'v12', 'v13']);
    assert.equal(result.stats.removedLowViews, 3);
  });
});
