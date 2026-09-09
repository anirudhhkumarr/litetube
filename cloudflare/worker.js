import { handleCorsPreflight, withCors } from './cors.js';
import { handleInnerTubeRequest } from './innertube.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return handleCorsPreflight();
    }

    // 2. Health check
    if (url.pathname === '/' || url.pathname === '/api/health') {
      return withCors(
        new Response(JSON.stringify({ status: 'ok', service: 'litetube-gateway' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }

    // 3. InnerTube Gateway
    if (url.pathname.startsWith('/api/innertube/')) {
      return handleInnerTubeRequest(request, url, env, ctx);
    }

    // 4. 404 Fallback
    return withCors(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }
};
