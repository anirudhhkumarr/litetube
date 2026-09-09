import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPONSOR_CATEGORIES,
  fetchSponsorSegments,
  findActiveSponsorSegment,
  clearSponsorBlockCache
} from '../src/adblock/sponsorBlock.js';

describe('Native SponsorBlock Engine', () => {
  beforeEach(() => {
    clearSponsorBlockCache();
  });

  it('exports expected default sponsor categories', () => {
    assert.ok(DEFAULT_SPONSOR_CATEGORIES.includes('sponsor'));
    assert.ok(DEFAULT_SPONSOR_CATEGORIES.includes('selfpromo'));
    assert.ok(DEFAULT_SPONSOR_CATEGORIES.includes('intro'));
    assert.ok(DEFAULT_SPONSOR_CATEGORIES.includes('outro'));
  });

  it('findActiveSponsorSegment accurately identifies active segment intervals', () => {
    const segments = [
      { start: 0, end: 30, category: 'intro', UUID: 'uuid-1' },
      { start: 120, end: 180, category: 'sponsor', UUID: 'uuid-2' }
    ];

    // Before any segment
    assert.equal(findActiveSponsorSegment(50, segments), null);

    // Inside intro segment
    const introMatch = findActiveSponsorSegment(15, segments);
    assert.ok(introMatch);
    assert.equal(introMatch.category, 'intro');
    assert.equal(introMatch.end, 30);

    // Inside sponsor segment
    const sponsorMatch = findActiveSponsorSegment(145, segments);
    assert.ok(sponsorMatch);
    assert.equal(sponsorMatch.category, 'sponsor');
    assert.equal(sponsorMatch.end, 180);

    // Trailing edge epsilon (within 0.2s of end) should not trigger
    assert.equal(findActiveSponsorSegment(179.9, segments), null);

    // After all segments
    assert.equal(findActiveSponsorSegment(200, segments), null);
  });

  it('returns null for invalid inputs to findActiveSponsorSegment', () => {
    assert.equal(findActiveSponsorSegment(null, []), null);
    assert.equal(findActiveSponsorSegment(undefined, []), null);
    assert.equal(findActiveSponsorSegment('10', []), null);
    assert.equal(findActiveSponsorSegment(10, null), null);
  });

  it('fetchSponsorSegments handles missing or invalid video ID gracefully', async () => {
    assert.deepEqual(await fetchSponsorSegments(''), []);
    assert.deepEqual(await fetchSponsorSegments(null), []);
  });

  it('fetchSponsorSegments parses API response and caches results', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = async (url) => {
      fetchCount++;
      return {
        ok: true,
        json: async () => [
          {
            category: 'sponsor',
            actionType: 'skip',
            segment: [60.5, 120.2],
            UUID: 'test-uuid-1'
          },
          {
            category: 'intro',
            actionType: 'skip',
            segment: [0, 15.0],
            UUID: 'test-uuid-2'
          }
        ]
      };
    };

    try {
      const segments = await fetchSponsorSegments('video123');
      assert.equal(segments.length, 2);
      // Verify sorted order by start time asc
      assert.equal(segments[0].category, 'intro');
      assert.equal(segments[0].start, 0);
      assert.equal(segments[1].category, 'sponsor');
      assert.equal(segments[1].start, 60.5);
      assert.equal(fetchCount, 1);

      // Second fetch should use cache and not invoke fetch again
      const cached = await fetchSponsorSegments('video123');
      assert.equal(cached.length, 2);
      assert.equal(fetchCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchSponsorSegments handles 404 cleanly by returning empty array', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => ({
      ok: false,
      status: 404
    });

    try {
      const segments = await fetchSponsorSegments('no_sponsors_vid');
      assert.deepEqual(segments, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
