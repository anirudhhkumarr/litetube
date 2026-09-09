import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowseResponse } from '../src/api/parser.js';

const WORKER_URL = 'https://litetube-gateway.anirudhkumar.workers.dev';

async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const r = await fetch(url, options);
      if (r.status === 200 || r.status === 204 || r.status === 404 || i === maxRetries) {
        return r;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      if (i === maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Assert that a YouTube API response is 200 (success) or upstream rate limited (403/429)
 */
function assertYouTubeResponse(res, label) {
  const ok = res.status === 200 || res.status === 403 || res.status === 429;
  assert.ok(ok, `${label}: expected 200 or upstream rate-limit, got ${res.status}`);
}

describe('Cloudflare Worker Gateway - Live Endpoint Tests', () => {
  it('returns health check status', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'litetube-gateway');
  });

  it('handles CORS OPTIONS preflight request', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/browse`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://anirudhhkumarr.github.io',
        'Access-Control-Request-Method': 'POST'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('forwards InnerTube browse requests to YouTube', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/browse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240901.00.00'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240901.00.00',
            hl: 'en',
            gl: 'US'
          }
        },
        browseId: 'FEwhat_to_watch'
      })
    });

    assertYouTubeResponse(res, 'browse POST');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    if (res.status === 200) {
      const data = await res.json();
      assert.ok(data.responseContext);
    }
  });

  it('forwards InnerTube search requests to YouTube and returns valid video results', async () => {
    const uniqueQuery = `space documentary ${Date.now()}`;
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240901.00.00'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240901.00.00',
            hl: 'en',
            gl: 'US'
          }
        },
        query: uniqueQuery,
        params: 'EgIQAQ=='
      })
    });

    assertYouTubeResponse(res, 'search POST');
    if (res.status === 200) {
      const data = await res.json();
      assert.ok(data.contents || data.responseContext);
      const parsed = parseBrowseResponse(data);
      assert.ok(parsed.videos.length >= 5, `Expected at least 5 videos from live search, got ${parsed.videos.length}`);
      assert.ok(parsed.videos[0].id, 'First video must have an id');
      assert.ok(parsed.videos[0].title, 'First video must have a title');
      // Invariant: no playlists or mixes in search results
      for (const v of parsed.videos) {
        assert.ok(!v.id.startsWith('PL'), `Video ${v.id} must not be a standard playlist`);
        assert.ok(!v.id.startsWith('RD'), `Video ${v.id} must not be a mix playlist`);
      }
    }
  });

  it('handles GET search requests (browser direct access)', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/search`);
    assertYouTubeResponse(res, 'search GET');
    if (res.status === 200) {
      const contentType = res.headers.get('content-type') || '';
      assert.ok(contentType.includes('application/json'), 'Response must be JSON');
      const data = await res.json();
      assert.ok(data.responseContext, 'Must have valid YouTube responseContext');
    }
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('handles GET search requests with query param (?q=...) and returns valid videos', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/search?q=nature`);
    assertYouTubeResponse(res, 'search GET ?q=');
    if (res.status === 200) {
      const data = await res.json();
      assert.ok(data.responseContext, 'Must have valid YouTube responseContext');
      const parsed = parseBrowseResponse(data);
      assert.ok(parsed.videos.length >= 5, `Expected at least 5 videos from GET search, got ${parsed.videos.length}`);
      assert.ok(parsed.videos[0].id, 'First video must have an id');
    }
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('handles GET browse requests (browser direct access)', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/innertube/browse`);
    assertYouTubeResponse(res, 'browse GET');
    if (res.status === 200) {
      const data = await res.json();
      assert.ok(data.responseContext, 'Must have valid YouTube responseContext');
    }
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('returns 404 for unknown endpoints', async () => {
    const res = await fetchWithRetry(`${WORKER_URL}/api/unknown_endpoint`);
    assert.equal(res.status, 404);
  });

  it('verifies gateway sets Cache-Control headers on responses', async () => {
    const payload = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00', hl: 'en', gl: 'US' } },
      browseId: 'FEwhat_to_watch'
    });

    const testHeaders = {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240901.00.00'
    };

    const res1 = await fetchWithRetry(`${WORKER_URL}/api/innertube/browse`, {
      method: 'POST',
      headers: testHeaders,
      body: payload
    });
    assertYouTubeResponse(res1, 'cache test');
    if (res1.status === 200) {
      const cc = res1.headers.get('cache-control') || '';
      assert.ok(cc.includes('max-age') || cc.includes('public'), 'First response should have cache-control');

      // Second request — may be HIT or MISS depending on edge propagation
      const res2 = await fetchWithRetry(`${WORKER_URL}/api/innertube/browse`, {
        method: 'POST',
        headers: testHeaders,
        body: payload
      });
      assertYouTubeResponse(res2, 'cache test repeat');
      if (res2.status === 200) {
        const cacheHeader = res2.headers.get('x-litetube-cache') || '';
        assert.ok(cacheHeader === 'HIT' || cacheHeader === 'MISS' || cacheHeader === 'BYPASS',
          `Expected HIT or MISS, got: '${cacheHeader}'`);
      }
    }
  });
});

