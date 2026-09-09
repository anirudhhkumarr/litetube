const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-YouTube-Client-Name, X-YouTube-Client-Version, X-YouTube-Cookie',
  'Access-Control-Max-Age': '86400'
};

export function handleCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
