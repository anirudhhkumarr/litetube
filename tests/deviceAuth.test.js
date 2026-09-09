import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestDeviceCode,
  pollDeviceToken,
  refreshTvAccessToken,
  YOUTUBE_TV_CLIENT_ID
} from '../src/api/deviceAuth.js';

describe('YouTube TV Device Auth Service', () => {
  it('requests device code with TV client ID and scope', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = null;
    let requestedBody = null;

    globalThis.fetch = async (url, options) => {
      requestedUrl = url;
      requestedBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'test_dev_code_123',
          user_code: 'ABCD-WXYZ',
          verification_url: 'https://www.google.com/device',
          expires_in: 1800,
          interval: 5
        })
      };
    };

    try {
      const res = await requestDeviceCode();
      assert.equal(res.deviceCode, 'test_dev_code_123');
      assert.equal(res.userCode, 'ABCD-WXYZ');
      assert.equal(res.verificationUrl, 'https://www.google.com/device');
      assert.equal(res.interval, 5000);
      assert.ok(requestedBody.includes(encodeURIComponent(YOUTUBE_TV_CLIENT_ID)));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('polls token and returns access and refresh tokens upon authorization', async () => {
    const originalFetch = globalThis.fetch;
    let pollCount = 0;

    globalThis.fetch = async () => {
      pollCount++;
      if (pollCount === 1) {
        return {
          ok: false,
          status: 428,
          json: async () => ({ error: 'authorization_pending' })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.authentic_tv_token_xyz',
          refresh_token: '1//refresh_token_abc',
          expires_in: 3600
        })
      };
    };

    try {
      const res = await pollDeviceToken('test_dev_code', 10);
      assert.equal(res.accessToken, 'ya29.authentic_tv_token_xyz');
      assert.equal(res.refreshToken, '1//refresh_token_abc');
      assert.equal(res.clientType, 'TVHTML5');
      assert.ok(res.expiresAt > Date.now());
      assert.equal(pollCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts polling immediately when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await pollDeviceToken('test_dev_code', 1000, controller.signal);
      },
      { message: /cancelled/i }
    );
  });

  it('refreshes TV access token correctly', async () => {
    const originalFetch = globalThis.fetch;
    let bodySent = null;

    globalThis.fetch = async (url, options) => {
      bodySent = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.refreshed_tv_token',
          expires_in: 3600
        })
      };
    };

    try {
      const res = await refreshTvAccessToken('1//refresh_token_abc');
      assert.equal(res.accessToken, 'ya29.refreshed_tv_token');
      assert.equal(res.refreshToken, '1//refresh_token_abc');
      assert.equal(res.clientType, 'TVHTML5');
      assert.ok(bodySent.includes('refresh_token=1%2F%2Frefresh_token_abc'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
