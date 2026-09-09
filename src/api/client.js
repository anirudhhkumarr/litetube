/**
 * LiteTube InnerTube Client — Dual-Path Routing
 *
 * AUTHENTICATED (Bearer token):
 *   Browser → youtubei.googleapis.com directly (user's real IP → no bot detection)
 *
 * UNAUTHENTICATED (guest):
 *   Browser → Cloudflare Worker → www.youtube.com (CORS proxy, shared IP)
 */

export const DEFAULT_WORKER_URL = 'https://litetube-gateway.anirudhkumar.workers.dev';

// The official YouTube TV / mobile API endpoint — allows direct Bearer token auth from browsers
const DIRECT_YT_BASE = 'https://youtubei.googleapis.com/youtubei/v1';

// Public InnerTube API key (same one YouTube web + TV apps embed in their JS bundles)
const INNERTUBE_API_KEY = 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8';

/**
 * Route the request:
 *  - If we have a Bearer token → call youtubei.googleapis.com directly from the browser.
 *    This uses the user's real IP so Google never sees it as a bot.
 *  - Otherwise → proxy through the Cloudflare Worker for CORS support.
 */
export async function callInnerTube(endpoint, payload, options = {}) {
  const { accessToken = '' } = options;

  return callViaWorker(endpoint, payload, options);
}



/** Proxied call through the Cloudflare Worker (guest / unauthenticated path) */
async function callViaWorker(endpoint, payload, options = {}) {
  const gatewayUrl = (options.workerUrl && String(options.workerUrl).trim()) || DEFAULT_WORKER_URL;
  const url = `${gatewayUrl.replace(/\/+$/, '')}/api/innertube/${endpoint}`;

  const clientName = payload?.context?.client?.clientName || 'WEB';
  const clientVersion = payload?.context?.client?.clientVersion || '2.20240901.00.00';
  
  // Use exact clientName for the header instead of mapping everything non-WEB to '2' (mWeb)
  const clientNameHeader = clientName;

  const headers = {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': clientNameHeader,
    'X-YouTube-Client-Version': clientVersion
  };

  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  let currentHeaders = { ...headers };
  const MAX_CLIENT_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_CLIENT_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: currentHeaders,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      if (typeof res.text === 'function') {
        const text = await res.text().catch(() => '');
        if (text.startsWith('<!') || text.includes('automated queries') || text.includes('Sorry...')) {
          if (attempt < MAX_CLIENT_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1200));
            continue;
          }
        } else {
          try {
            const data = JSON.parse(text);
            if (data) return data;
          } catch {}
        }
      } else if (typeof res.json === 'function') {
        const data = await res.json().catch(() => null);
        if (data) return data;
      }
    }

    if (res.status === 401 && options.accessToken) {
      delete currentHeaders['Authorization'];
      if (attempt < MAX_CLIENT_RETRIES) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
    }

    const text = typeof res.text === 'function' ? await res.text().catch(() => res.statusText || '') : (res.statusText || '');
    const isRateLimited = res.status === 429 || text.includes('automated queries') || text.includes('Too Many Requests') || text.includes('Sorry...') || text.startsWith('<!');

    if (isRateLimited && attempt < MAX_CLIENT_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1200));
      continue;
    }

    if (isRateLimited) {
      return {
        responseContext: {},
        contents: {
          twoColumnBrowseResultsRenderer: {
            tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: [] } } } }]
          }
        }
      };
    }

    throw new Error(`Gateway error (${res.status}): ${res.statusText}`);
  }

  return { responseContext: {}, contents: {} };
}

export async function fetchContinuation(endpoint, continuationToken, options = {}) {
  const isTv = options.clientType === 'TVHTML5' || options.clientName === 'TVHTML5';
  const clientName = options.clientName || (isTv ? 'TVHTML5' : 'WEB');
  const clientVersion = options.clientVersion || (isTv ? '7.20240901.00.00' : '2.20240901.00.00');
  const region = options.region || 'US';

  const payload = {
    context: {
      client: {
        clientName,
        clientVersion,
        hl: 'en',
        gl: region
      }
    },
    continuation: continuationToken
  };

  return callInnerTube(endpoint, payload, options);
}

