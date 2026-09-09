/**
 * Google YouTube Device Authorization Service
 * Implements the official OAuth 2.0 Device Code flow for the YouTube TV client.
 * Provides authentic, uncompromised YouTube recommendations without cookies.
 */

export const YOUTUBE_TV_CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
export const YOUTUBE_TV_CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';
export const YOUTUBE_TV_SCOPE = 'https://www.googleapis.com/auth/youtube';

export const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Initiates the device authorization flow.
 * Returns { deviceCode, userCode, verificationUrl, expiresIn, interval }
 */
export async function requestDeviceCode() {
  const params = new URLSearchParams();
  params.append('client_id', YOUTUBE_TV_CLIENT_ID);
  params.append('scope', YOUTUBE_TV_SCOPE);

  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Device code request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url || 'https://www.google.com/device',
    expiresIn: data.expires_in || 1800,
    interval: (data.interval || 5) * 1000
  };
}

/**
 * Polls Google's token endpoint until the user authorizes or the code expires.
 * @param {string} deviceCode 
 * @param {number} intervalMs 
 * @param {AbortSignal} [signal] 
 */
export async function pollDeviceToken(deviceCode, intervalMs = 5000, signal = null) {
  const startTime = Date.now();
  const maxWaitMs = 30 * 60 * 1000; // 30 minutes

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new Error('Authorization polling cancelled');
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));

    if (signal?.aborted) {
      throw new Error('Authorization polling cancelled');
    }

    const params = new URLSearchParams();
    params.append('client_id', YOUTUBE_TV_CLIENT_ID);
    params.append('client_secret', YOUTUBE_TV_CLIENT_SECRET);
    params.append('code', deviceCode);
    params.append('grant_type', 'http://oauth.net/grant_type/device/1.0');

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      const data = await res.json();

      if (res.ok && data.access_token) {
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in || 3600,
          expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
          clientType: 'TVHTML5'
        };
      }

      if (data.error === 'authorization_pending') {
        continue;
      }

      if (data.error === 'slow_down') {
        intervalMs += 2000;
        continue;
      }

      if (data.error === 'access_denied') {
        throw new Error('Sign-in request was denied on Google');
      }

      if (data.error === 'expired_token') {
        throw new Error('Authorization code expired. Please try signing in again');
      }

      throw new Error(`Google token error: ${data.error_description || data.error}`);
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw new Error('Authorization cancelled');
      }
      if (err.message.includes('Google token error') || err.message.includes('denied') || err.message.includes('expired')) {
        throw err;
      }
      // Transient network retry
    }
  }

  throw new Error('Device authorization timed out');
}

/**
 * Refreshes an expired YouTube TV OAuth access token.
 */
export async function refreshTvAccessToken(refreshToken) {
  if (!refreshToken) throw new Error('Refresh token required');

  const params = new URLSearchParams();
  params.append('client_id', YOUTUBE_TV_CLIENT_ID);
  params.append('client_secret', YOUTUBE_TV_CLIENT_SECRET);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed with status ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in || 3600,
    expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
    clientType: 'TVHTML5'
  };
}
