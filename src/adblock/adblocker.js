import { logAdBlocked } from './streamShield.js';

export const AD_DOMAINS = [
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'ad.doubleclick.net',
  'static.doubleclick.net',
  'adservice.google.com',
  'securepubads.g.doubleclick.net',
  'youtube.com/pagead',
  'youtube.com/api/stats/ads'
];

export function isAdItem(item) {
  if (!item) return false;

  const adTypes = [
    'adSlotRenderer',
    'promotedSparklesWebRenderer',
    'inFeedAdRenderer',
    'statementBannerRenderer',
    'displayAdRenderer',
    'promotedVideoRenderer',
    'brandVideoSingletonRenderer',
    'primetimePromoRenderer',
    'feedAdRenderer',
    'adPlacementRenderer',
    'adBreakServiceRenderer'
  ];

  if (item.type && adTypes.includes(item.type)) {
    logAdBlocked('FeedAdBlocker', `Filtered feed ad type "${item.type}"`, { id: item.id, title: item.title });
    return true;
  }
  if (item.isPromoted || item.isAd) {
    logAdBlocked('FeedAdBlocker', 'Filtered promoted video item', { id: item.id, title: item.title });
    return true;
  }
  if (item.contentType && /promoted|ad/i.test(item.contentType)) {
    logAdBlocked('FeedAdBlocker', `Filtered ad contentType "${item.contentType}"`, { id: item.id, title: item.title });
    return true;
  }

  if (item.badge && typeof item.badge === 'string') {
    const b = item.badge.trim().toLowerCase();
    if (b === 'ad' || b === 'sponsored' || b === 'promoted' || b.includes('sponsored') || b.includes('promotion')) {
      logAdBlocked('FeedAdBlocker', `Filtered sponsored badge "${item.badge}"`, { id: item.id, title: item.title });
      return true;
    }
  }

  if (item.title && typeof item.title === 'string') {
    const t = item.title.trim();
    if (/^(ad|sponsored|promoted):/i.test(t) || /(?:^|\s)#ad(?:\s|$)/i.test(t)) {
      logAdBlocked('FeedAdBlocker', `Filtered ad title pattern "${item.title}"`, { id: item.id });
      return true;
    }
  }

  return false;
}

export function filterAdsFromFeed(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => !isAdItem(item));
}

export function isAdUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return AD_DOMAINS.some(domain => urlStr.includes(domain));
}

export function cleanVideoUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const url = new URL(urlStr);
    const paramsToDelete = [];

    for (const [key] of url.searchParams.entries()) {
      if (
        key.startsWith('ad_') ||
        key.startsWith('utm_') ||
        ['gclid', 'dclid', 'fbclid', 'feature'].includes(key)
      ) {
        paramsToDelete.push(key);
      }
    }

    paramsToDelete.forEach(k => url.searchParams.delete(k));
    return url.toString();
  } catch {
    return urlStr;
  }
}

export function extractDirectStream(streamingData) {
  if (!streamingData || typeof streamingData !== 'object') return null;

  if (streamingData.hlsManifestUrl && typeof streamingData.hlsManifestUrl === 'string') {
    return {
      type: 'hls',
      url: streamingData.hlsManifestUrl,
      quality: 'auto'
    };
  }

  if (Array.isArray(streamingData.formats) && streamingData.formats.length > 0) {
    const sorted = [...streamingData.formats]
      .filter(f => f && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    if (sorted.length > 0) {
      const best = sorted[0];
      return {
        type: 'mp4',
        url: best.url,
        quality: best.qualityLabel || `${best.height || 360}p`,
        itag: best.itag
      };
    }
  }

  return null;
}
