import { refreshTvAccessToken } from '../api/deviceAuth.js';

const STORAGE_KEYS = {

  FILTER_SETTINGS: 'litetube_filter_settings',
  SESSION: 'litetube_session',
  SUBSCRIPTIONS: 'litetube_subscriptions',
  WATCHED_VIDEOS: 'litetube_watched_videos'
};

const DEFAULT_FILTER_SETTINGS = {
  blockShorts: true,
  minDurationSeconds: 0,
  minViews: 1000,
  hideWatched: true
};

/** Refresh token 5 minutes before it actually expires */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function createStore({ storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  const listeners = new Set();
  let _refreshPromise = null;

  function safeGet(key, fallback) {
    if (!storage) return fallback;
    try {
      const val = storage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  }

  function safeSet(key, value) {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage set failed:', e);
    }
  }


  let filterSettings = { ...DEFAULT_FILTER_SETTINGS, ...safeGet(STORAGE_KEYS.FILTER_SETTINGS, {}) };
  let session = safeGet(STORAGE_KEYS.SESSION, null);
  let subscriptions = safeGet(STORAGE_KEYS.SUBSCRIPTIONS, []);
  let watchedVideos = safeGet(STORAGE_KEYS.WATCHED_VIDEOS, []);

  function notify() {
    listeners.forEach(fn => fn());
  }

  const api = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },


    getFilterSettings() {
      return { ...filterSettings };
    },

    setFilterSettings(newSettings) {
      filterSettings = { ...filterSettings, ...newSettings };
      safeSet(STORAGE_KEYS.FILTER_SETTINGS, filterSettings);
      notify();
    },

    /** True only when we hold a TVHTML5 access token */
    hasSession() {
      return !!(session && session.accessToken);
    },

    getSession() {
      if (!session) return null;
      return { ...session };
    },

    /**
     * Returns a valid access token, silently refreshing when near expiry.
     * Multiple concurrent callers share the same in-flight refresh promise.
     * Returns null when no session or refresh fails.
     */
    async getValidAccessToken() {
      if (!session?.accessToken) return null;

      const nearExpiry =
        session.expiresAt && Date.now() > session.expiresAt - REFRESH_BUFFER_MS;

      if (!nearExpiry) return session.accessToken;

      if (!session.refreshToken) {
        api.clearSession();
        return null;
      }

      if (!_refreshPromise) {
        _refreshPromise = refreshTvAccessToken(session.refreshToken)
          .then((newTokenData) => {
            session = { ...session, ...newTokenData };
            safeSet(STORAGE_KEYS.SESSION, session);
            notify();
            return session.accessToken;
          })
          .catch((err) => {
            console.warn('[LiteTube] Token refresh failed, clearing session:', err.message);
            api.clearSession();
            return null;
          })
          .finally(() => {
            _refreshPromise = null;
          });
      }

      return _refreshPromise;
    },

    setSession(data) {
      session = data ? { ...data } : null;
      safeSet(STORAGE_KEYS.SESSION, session);
      notify();
    },

    clearSession() {
      session = null;
      _refreshPromise = null;
      if (storage) storage.removeItem(STORAGE_KEYS.SESSION);
      notify();
    },

    getSubscriptions() {
      return [...subscriptions];
    },

    addSubscription(channel) {
      if (!channel || !channel.channelId) return;
      if (subscriptions.some(s => s.channelId === channel.channelId)) return;
      subscriptions = [...subscriptions, channel];
      safeSet(STORAGE_KEYS.SUBSCRIPTIONS, subscriptions);
      notify();
    },

    removeSubscription(channelId) {
      subscriptions = subscriptions.filter(s => s.channelId !== channelId);
      safeSet(STORAGE_KEYS.SUBSCRIPTIONS, subscriptions);
      notify();
    },

    isSubscribed(channelId) {
      return subscriptions.some(s => s.channelId === channelId);
    },

    getWatchedVideos() {
      return [...watchedVideos];
    },

    markVideoWatched(videoId) {
      if (!videoId) return;
      const cleanId = String(videoId).trim();
      if (!cleanId) return;
      watchedVideos = [cleanId, ...watchedVideos.filter(id => id !== cleanId)].slice(0, 1000);
      safeSet(STORAGE_KEYS.WATCHED_VIDEOS, watchedVideos);
      notify();
    },

    isWatched(videoId) {
      if (!videoId) return false;
      return watchedVideos.includes(String(videoId).trim());
    },

    clearWatchedVideos() {
      watchedVideos = [];
      if (storage) storage.removeItem(STORAGE_KEYS.WATCHED_VIDEOS);
      notify();
    }
  };

  return api;
}

export const store = createStore();
