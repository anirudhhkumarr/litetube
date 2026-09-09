const responseCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const MAX_CACHE_ENTRIES = 200;

export async function computeCacheKey(endpoint, method, body, authHeader, cookieHeader, clientIp = '') {
  const raw = [clientIp || '', endpoint, method, authHeader || '', cookieHeader || '', body || ''].join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getCachedResponse(cacheKey) {
  // 1. In-memory fast path
  const memCached = responseCache.get(cacheKey);
  if (memCached && Date.now() < memCached.expiresAt) {
    const headers = new Headers(memCached.headers);
    headers.set('X-LiteTube-Cache', 'HIT');
    return new Response(memCached.body, {
      status: memCached.status,
      statusText: memCached.statusText,
      headers
    });
  }

  // 2. Cloudflare Global Edge Cache fallback
  try {
    const cacheUrl = `https://litetube-cache.internal/${cacheKey}`;
    const cached = await caches.default.match(cacheUrl);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-LiteTube-Cache', 'HIT');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
  } catch {}

  return null;
}

export async function setCachedResponse(cacheKey, response, bodyText, ctx) {
  if (response.status !== 200) return;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=15');

  // 1. Save in in-memory cache
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(cacheKey, {
    body: bodyText,
    status: response.status,
    statusText: response.statusText,
    headers,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  // 2. Save in Cloudflare Global Edge Cache
  try {
    const cacheUrl = `https://litetube-cache.internal/${cacheKey}`;
    const cacheResponse = new Response(bodyText, {
      status: 200,
      statusText: 'OK',
      headers
    });
    const putPromise = caches.default.put(cacheUrl, cacheResponse);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(putPromise);
    } else {
      await putPromise;
    }
  } catch {}
}
