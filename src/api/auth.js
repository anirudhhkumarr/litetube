export async function sha1Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateSAPISIDHASH(sapisid, origin = 'https://www.youtube.com', timestamp = Math.floor(Date.now() / 1000)) {
  if (!sapisid) return '';
  const payload = `${timestamp} ${sapisid} ${origin}`;
  const digest = await sha1Hex(payload);
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

export function extractSAPISID(cookieString) {
  if (!cookieString || typeof cookieString !== 'string') return '';
  const trimmed = cookieString.trim();
  // If user pasted just the raw alphanumeric SAPISID token directly
  if (!trimmed.includes('=') && !trimmed.includes(';')) {
    return trimmed;
  }
  // Extract from standard YouTube cookie names: __Secure-3PAPISID, __Secure-1PAPISID, or SAPISID
  const match = trimmed.match(/(?:^|;\s*)(?:__Secure-3PAPISID|__Secure-1PAPISID|SAPISID)=([^;]+)/i);
  return match ? match[1].trim() : '';
}
