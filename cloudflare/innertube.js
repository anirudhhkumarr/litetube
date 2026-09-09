import { withCors } from './cors.js';
import { computeCacheKey, getCachedResponse, setCachedResponse } from './cache.js';
import { recursiveSanitize, extractVideoContents, appendContentsAndReplaceToken } from './sanitizer.js';


const YT_BASE_URL = 'https://www.youtube.com/youtubei/v1';
const YT_GOOGLE_APIS_BASE_URL = 'https://youtubei.googleapis.com/youtubei/v1';
const INNERTUBE_API_KEY = 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const TV_USER_AGENT =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Safari/537.36 WebAppManager';

export async function handleInnerTubeRequest(request, url, env, ctx) {
  const endpoint = url.pathname.replace(/^\/api\/innertube\//, '');
  if (!endpoint) {
    return withCors(new Response(JSON.stringify({ error: 'Endpoint required' }), { status: 400 }));
  }

  const hasAuth = request.headers.has('Authorization');
  const baseUrl = hasAuth ? YT_GOOGLE_APIS_BASE_URL : YT_BASE_URL;
  const ytUrl = `${baseUrl}/${endpoint}?key=${INNERTUBE_API_KEY}`;
  const geoCountry = request.cf?.country || 'US';

  const clientName = request.headers.get('X-YouTube-Client-Name') || '1';
  let clientNameHeader = clientName;
  if (clientName === 'WEB') clientNameHeader = '1';
  
  const clientVersion = request.headers.get('X-YouTube-Client-Version') || '2.20240901.00.00';

  const incomingUa = request.headers.get('User-Agent');
  let defaultUa = DESKTOP_USER_AGENT;
  if (clientName === '2') defaultUa = MOBILE_USER_AGENT;
  if (clientName === 'TVHTML5') defaultUa = TV_USER_AGENT;
  
  const forwardUa = (incomingUa && !incomingUa.includes('node') && !incomingUa.includes('undici')) ? incomingUa : defaultUa;

  const forwardHeaders = new Headers();
  forwardHeaders.set('Content-Type', 'application/json');
  forwardHeaders.set('User-Agent', forwardUa);
  forwardHeaders.set('Origin', 'https://www.youtube.com');
  forwardHeaders.set('Referer', 'https://www.youtube.com');
  forwardHeaders.set('X-YouTube-Client-Name', clientNameHeader);
  forwardHeaders.set('X-YouTube-Client-Version', clientVersion);

  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) {
    forwardHeaders.set('X-Forwarded-For', clientIp);
  }

  if (request.headers.has('Authorization')) {
    forwardHeaders.set('Authorization', request.headers.get('Authorization'));
  }
  if (request.headers.has('X-YouTube-Cookie')) {
    forwardHeaders.set('Cookie', request.headers.get('X-YouTube-Cookie'));
  }

  let forwardMethod = request.method;
  let body;

  if (request.method === 'GET' || request.method === 'HEAD') {
    forwardMethod = 'POST';
    forwardHeaders.set('X-YouTube-Client-Name', '1');
    if (endpoint === 'search') {
      const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
      body = JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00', hl: 'en', gl: geoCountry } },
        query: q,
        params: 'EgIQAQ=='
      });
    } else if (endpoint === 'browse') {
      const browseId = url.searchParams.get('browseId') || 'FEwhat_to_watch';
      body = JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00', hl: 'en', gl: geoCountry } },
        browseId
      });
    }
  } else {
    body = await request.text();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        let modified = false;
        if (geoCountry && parsed.context?.client && (!parsed.context.client.gl || parsed.context.client.gl === 'AUTO')) {
          parsed.context.client.gl = geoCountry;
          modified = true;
        }
        // Apply YouTube native "Type: Video" search filter (EgIQAQ==) if not already specified
        if (endpoint === 'search' && parsed.query && !parsed.params && !parsed.continuation) {
          parsed.params = 'EgIQAQ==';
          modified = true;
        }
        if (modified) {
          body = JSON.stringify(parsed);
        }
      } catch {}
    }
  }

  // 1. Check edge cache (per client IP)
  const cacheKey = await computeCacheKey(
    endpoint,
    forwardMethod,
    body,
    request.headers.get('Authorization'),
    request.headers.get('X-YouTube-Cookie'),
    clientIp
  );

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    return withCors(cached);
  }

  // Helper to detect rate-limit status or Google captcha challenge HTML
  function isRateLimitedResponse(status, text) {
    if (status === 429) return true;
    if (!text || typeof text !== 'string') return false;
    if (text.includes('<title>Sorry...</title>')) return true;
    if (text.includes('automated queries')) return true;
    if (text.includes('Too Many Requests')) return true;
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      return true;
    }
    return false;
  }

  // 2. Fetch upstream from YouTube with delay retry on rate limit
  const MAX_RETRIES = 2;
  let attempt = 0;
  let ytResponse = null;
  let responseBodyText = '';
  let rateLimited = false;

  while (attempt <= MAX_RETRIES) {
    try {
      ytResponse = await fetch(ytUrl, {
        method: forwardMethod,
        headers: forwardHeaders,
        body
      });

      responseBodyText = await ytResponse.text();
      rateLimited = isRateLimitedResponse(ytResponse.status, responseBodyText);

      if (rateLimited && attempt < MAX_RETRIES) {
        attempt++;
        const delayMs = attempt * 1200; // 1200ms, then 2400ms
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      break;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, attempt * 1200));
        continue;
      }
      return withCors(
        new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }
  }

  // If still rate-limited after retries: don't error out with broken HTML
  if (rateLimited) {
    const safePayload = JSON.stringify({
      responseContext: {},
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: [] } } } }]
        }
      }
    });
    return withCors(
      new Response(safePayload, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-LiteTube-RateLimited': 'true'
        }
      })
    );
  }

  const isPersonalized = forwardHeaders.has('Authorization') || forwardHeaders.has('Cookie');
  const responseHeaders = new Headers(ytResponse.headers);
  if (isPersonalized) {
    responseHeaders.set('Cache-Control', 'private, no-cache, no-store');
  } else {
    responseHeaders.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=15');
  }
  responseHeaders.set('X-LiteTube-Cache', 'MISS');

  let responseBodyToReturn = responseBodyText;

  // Sanitize and backfill if necessary (only for browse, search, next)
  if (ytResponse.status === 200 && (endpoint === 'browse' || endpoint === 'search' || endpoint === 'next')) {
    try {
      let jsonObj = JSON.parse(responseBodyText);
      let { sanitizedObj, validCount, continuationToken, continuationItemObj } = recursiveSanitize(jsonObj);
      
      let attempts = 0;
      let currentToken = continuationToken;
      let currentItemObj = continuationItemObj;
      const MAX_BACKFILL_ATTEMPTS = 3;
      
      while (validCount < 12 && currentToken && attempts < MAX_BACKFILL_ATTEMPTS) {
        attempts++;
        const reqBody = typeof body === 'string' && body ? JSON.parse(body) : {};
        const payload = {
            context: reqBody.context || { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00' } },
            continuation: currentToken
        };
        const nextRes = await fetch(ytUrl, {
            method: 'POST',
            headers: forwardHeaders,
            body: JSON.stringify(payload)
        });
        if (nextRes.status !== 200) break;
        
        const nextText = await nextRes.text();
        const nextJson = JSON.parse(nextText);
        const { sanitizedObj: nextSanitized, validCount: nextValidCount, continuationToken: nextTokenVal, continuationItemObj: nextItemObj } = recursiveSanitize(nextJson);
        
        const newContents = extractVideoContents(nextSanitized);
        appendContentsAndReplaceToken(sanitizedObj, newContents, nextItemObj);
        
        validCount += nextValidCount;
        currentToken = nextTokenVal;
      }
      
      responseBodyToReturn = JSON.stringify(sanitizedObj);
    } catch (e) {
      console.error("Sanitization error:", e);
      // Fallback to original response on error
    }
  }

  const finalResponse = withCors(
    new Response(responseBodyToReturn, {
      status: ytResponse.status,
      statusText: ytResponse.statusText,
      headers: responseHeaders
    })
  );

  // 3. Cache successful unauthenticated responses (protect personalized data)
  if (ytResponse.status === 200 && !isPersonalized && !rateLimited) {
    await setCachedResponse(cacheKey, finalResponse, responseBodyToReturn, ctx);
  }

  return finalResponse;
}
