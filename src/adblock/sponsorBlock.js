import {
  logAdFailure
} from './streamShield.js';

export const DEFAULT_SPONSOR_CATEGORIES = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro'
];

const segmentCache = new Map();

/**
 * Fetches skip segments for a given video ID from the SponsorBlock API.
 *
 * @param {string} videoId
 * @param {string[]} [categories]
 * @returns {Promise<Array<{start: number, end: number, category: string, UUID: string}>>}
 */
export async function fetchSponsorSegments(videoId, categories = DEFAULT_SPONSOR_CATEGORIES) {
  if (!videoId || typeof videoId !== 'string') return [];

  const cacheKey = `${videoId}_${categories.sort().join(',')}`;
  if (segmentCache.has(cacheKey)) {
    return segmentCache.get(cacheKey);
  }

  try {
    const encodedCategories = encodeURIComponent(JSON.stringify(categories));
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodedCategories}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status !== 404) {
        logAdFailure('SponsorBlock', `SponsorBlock API returned HTTP ${res.status}: ${res.statusText}`, { videoId });
      }
      segmentCache.set(cacheKey, []);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      segmentCache.set(cacheKey, []);
      return [];
    }

    const segments = data
      .filter((item) => Array.isArray(item?.segment) && item.segment.length >= 2)
      .map((item) => ({
        start: Number(item.segment[0]),
        end: Number(item.segment[1]),
        category: item.category || 'sponsor',
        actionType: item.actionType || 'skip',
        UUID: item.UUID || ''
      }))
      .filter((item) => !isNaN(item.start) && !isNaN(item.end) && item.end > item.start)
      .sort((a, b) => a.start - b.start);

    segmentCache.set(cacheKey, segments);
    return segments;
  } catch (err) {
    // Network or parse error: fail open so playback continues uninterrupted
    logAdFailure('SponsorBlock', `Failed to load sponsor segments: ${err.message}`, { videoId, error: err });
    return [];
  }
}

/**
 * Pure stateless function to check if the current playback time falls within
 * any active sponsor segment that should be skipped.
 *
 * @param {number} currentTime
 * @param {Array<{start: number, end: number, category: string}>} segments
 * @returns {{start: number, end: number, category: string} | null}
 */
export function findActiveSponsorSegment(currentTime, segments) {
  if (typeof currentTime !== 'number' || !Array.isArray(segments) || segments.length === 0) {
    return null;
  }

  // Find segment where currentTime is inside [start, end)
  // Epsilon of 0.2s prevents redundant skips right at the trailing boundary
  return segments.find((s) => currentTime >= s.start && currentTime < (s.end - 0.2)) || null;
}

/**
 * Clears the in-memory SponsorBlock segment cache (useful for testing).
 */
export function clearSponsorBlockCache() {
  segmentCache.clear();
}
