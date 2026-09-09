/**
 * Comprehensive Multi-Tiered Best-Effort Region Resolver
 * Tiers:
 * 1. Explicit user preference
 * 2. Browser locale hierarchy (navigator.languages / navigator.language via Intl.Locale)
 * 3. IANA timezone resolution (Intl.DateTimeFormat)
 * 4. Cloudflare Worker Edge Geo-IP fallback ('AUTO' -> request.cf.country)
 * 5. Safe global fallback ('US')
 */

export const TIMEZONE_COUNTRY_MAP = {
  // Asia
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP',
  'Asia/Jerusalem': 'IL',
  'Asia/Beirut': 'LB',

  // Europe
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR',
  'Europe/Kyiv': 'UA',
  'Europe/Lisbon': 'PT',

  // North America
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Detroit': 'US',
  'America/Indiana/Indianapolis': 'US',
  'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Montreal': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/Mexico_City': 'MX',
  'America/Monterrey': 'MX',
  'America/Tijuana': 'MX',

  // South America
  'America/Sao_Paulo': 'BR',
  'America/Rio_Branco': 'BR',
  'America/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Caracas': 'VE',
  'America/Montevideo': 'UY',

  // Oceania
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',

  // Africa
  'Africa/Johannesburg': 'ZA',
  'Africa/Cairo': 'EG',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Casablanca': 'MA'
};

export function getBrowserRegion(userOverride = null, env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  const intl = env.Intl || (typeof Intl !== 'undefined' ? Intl : null);

  // Tier 1: User Explicit Preference
  if (userOverride && typeof userOverride === 'string') {
    const clean = userOverride.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(clean)) return clean;
  }

  // Tier 2: Browser Locale Hierarchy
  try {
    if (nav) {
      const candidates = [];
      if (Array.isArray(nav.languages)) {
        candidates.push(...nav.languages);
      }
      if (nav.language) {
        candidates.push(nav.language);
      }

      for (const tag of candidates) {
        if (!tag || typeof tag !== 'string') continue;

        // Try Intl.Locale
        try {
          const loc = new intl.Locale(tag);
          if (loc.region && /^[A-Za-z]{2}$/.test(loc.region)) {
            return loc.region.toUpperCase();
          }
        } catch {}

        // Fallback regex on tag like "en-GB" or "pt_BR"
        const match = tag.match(/[-_]([A-Za-z]{2})(?:[-_]|$)/);
        if (match && match[1]) {
          return match[1].toUpperCase();
        }
      }
    }
  } catch {}

  // Tier 3: IANA Timezone Resolution
  try {
    if (intl && intl.DateTimeFormat) {
      const tz = intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        // Direct timezone match
        if (TIMEZONE_COUNTRY_MAP[tz]) {
          return TIMEZONE_COUNTRY_MAP[tz];
        }

        // Prefix match (e.g. "America/Argentina/Buenos_Aires" or region names)
        for (const [knownTz, country] of Object.entries(TIMEZONE_COUNTRY_MAP)) {
          if (tz.startsWith(knownTz) || knownTz.startsWith(tz)) {
            return country;
          }
        }
      }
    }
  } catch {}

  // Tier 4: Delegate to Cloudflare Edge Geo-IP via 'AUTO'
  return 'AUTO';
}
