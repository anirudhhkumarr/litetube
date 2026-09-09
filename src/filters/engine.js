import { isAdItem } from '../adblock/adblocker.js';

export function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  if (!duration || typeof duration !== 'string') return null;

  const parts = duration.trim().split(':');
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10);
    const sec = parseInt(parts[1], 10);
    if (!isNaN(min) && !isNaN(sec)) return min * 60 + sec;
  } else if (parts.length === 3) {
    const hr = parseInt(parts[0], 10);
    const min = parseInt(parts[1], 10);
    const sec = parseInt(parts[2], 10);
    if (!isNaN(hr) && !isNaN(min) && !isNaN(sec)) return hr * 3600 + min * 60 + sec;
  }

  return null;
}

export function parseViewCount(views) {
  if (typeof views === 'number') return views;
  if (!views || typeof views !== 'string') return null;

  const cleaned = views.trim().toLowerCase();
  if (cleaned.includes('no view') || cleaned === '0 views' || cleaned === '0') return 0;

  const match = cleaned.match(/([\d,.]+)\s*([kmb])?/i);
  if (!match) return null;

  const numStr = match[1].replace(/,/g, '');
  let val = parseFloat(numStr);
  if (isNaN(val)) return null;

  const unit = match[2] ? match[2].toLowerCase() : '';
  if (unit === 'k') val *= 1000;
  else if (unit === 'm') val *= 1000000;
  else if (unit === 'b') val *= 1000000000;

  return Math.round(val);
}

export function isShort(item) {
  if (!item) return false;

  if (item.isShort === true) return true;
  if (
    item.type === 'reel' ||
    item.type === 'reelItemRenderer' ||
    item.type === 'shortsLockupViewModel' ||
    item.contentType === 'LOCKUP_CONTENT_TYPE_SHORTS'
  ) {
    return true;
  }
  if (item.url && typeof item.url === 'string' && item.url.includes('/shorts/')) {
    return true;
  }
  if (item.badge && typeof item.badge === 'string' && item.badge.toUpperCase() === 'SHORTS') {
    return true;
  }
  if (item.duration && typeof item.duration === 'string' && ['SHORTS', 'STATION', 'MIX'].includes(item.duration.toUpperCase())) {
    return true;
  }
  if (item.title && typeof item.title === 'string' && /(?:^|\s)#shorts?(?:\s|$|[!?.,])/i.test(item.title)) {
    return true;
  }

  const seconds = item.durationSeconds ?? parseDurationToSeconds(item.duration);
  if (typeof seconds === 'number' && seconds > 0 && seconds <= 60) {
    return true;
  }

  return false;
}



export function isWatchedVideo(item, watchedVideos = []) {
  if (!item) return false;

  // 1. Explicit watched flag from YouTube annotation
  if (item.isWatched === true) return true;

  // 2. Resume playback percentage from YouTube annotation (80% or higher watched)
  if (typeof item.percentDurationWatched === 'number' && item.percentDurationWatched >= 80) {
    return true;
  }

  // 3. Official YouTube WATCHED badge
  if (typeof item.badge === 'string' && item.badge.toUpperCase() === 'WATCHED') {
    return true;
  }

  // 4. Watched videos stored in LiteTube local session
  const watchedSet = watchedVideos instanceof Set
    ? watchedVideos
    : new Set(Array.isArray(watchedVideos) ? watchedVideos : []);

  return item.id ? watchedSet.has(item.id) : false;
}

export function filterVideos(items = [], options = {}) {
  const {
    blockShorts = true,
    minDurationSeconds = 0,
    minViews = 1000,
    hideWatched = true,
    watchedVideos = [],
    customRules = []
  } = options;

  let removedShorts = 0;

  let removedAds = 0;
  let removedWatched = 0;
  let removedLowViews = 0;
  let removedCustom = 0;

  let removedDuplicates = 0;

  const watchedSet = watchedVideos instanceof Set
    ? watchedVideos
    : new Set(Array.isArray(watchedVideos) ? watchedVideos : []);

  const kept = [];
  const seenIds = new Set();

  for (const item of items) {
    // Reject non-video items (channels, playlists, radios) or invalid IDs
    if (
      !item ||
      !item.id ||
      typeof item.id !== 'string' ||
      item.id.startsWith('UC') ||
      item.id.startsWith('PL') ||
      item.id.startsWith('@') ||
      item.type === 'channelRenderer' ||
      item.type === 'playlistRenderer' ||
      item.type === 'radioRenderer' ||
      item.contentType === 'LOCKUP_CONTENT_TYPE_CHANNEL' ||
      item.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ||
      item.contentType === 'LOCKUP_CONTENT_TYPE_RADIO'
    ) {
      continue;
    }

    if (isAdItem(item)) {
      removedAds++;
      continue;
    }

    // Deduplicate by ID
    if (item.id) {
      if (seenIds.has(item.id)) {
        removedDuplicates++;
        continue;
      }
      seenIds.add(item.id);
    }

    if (hideWatched && isWatchedVideo(item, watchedSet)) {
      removedWatched++;
      continue;
    }

    if (blockShorts && isShort(item)) {
      removedShorts++;
      continue;
    }



    if (minDurationSeconds > 0) {
      const dur = item.durationSeconds ?? parseDurationToSeconds(item.duration);
      if (dur !== null && dur < minDurationSeconds) {
        removedShorts++;
        continue;
      }
    }

    if (minViews > 0) {
      const count = item.viewCount ?? parseViewCount(item.views);
      if (count !== null && count < minViews) {
        removedLowViews++;
        continue;
      }
    }

    let passedRules = true;
    for (const rule of customRules) {
      if (typeof rule === 'function' && !rule(item)) {
        passedRules = false;
        break;
      }
    }
    if (!passedRules) {
      removedCustom++;
      continue;
    }

    kept.push(item);
  }

  return {
    items: kept,
    stats: {
      total: items.length,
      kept: kept.length,
      removedShorts,
      removedAds,
      removedWatched,
      removedLowViews,
      removedCustom,
      removedDuplicates
    }
  };
}

export class FilterEngine {
  constructor(options = {}) {
    this.options = {
      blockShorts: true,
      minDurationSeconds: 0,
      minViews: 1000,
      hideWatched: false,
      watchedVideos: [],
      ...options
    };
    this.customRules = [];
  }

  setMinViews(minViews) {
    this.options.minViews = minViews;
  }


  setBlockShorts(enabled) {
    this.options.blockShorts = enabled;
  }

  setWatchedVideos(watched) {
    this.options.watchedVideos = watched;
  }

  setHideWatched(enabled) {
    this.options.hideWatched = enabled;
  }

  addRule(predicateFn) {
    if (typeof predicateFn === 'function') {
      this.customRules.push(predicateFn);
    }
  }

  process(items) {
    return filterVideos(items, {
      ...this.options,
      customRules: this.customRules
    });
  }
}
