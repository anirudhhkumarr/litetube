import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from './components/Navbar.jsx';
import VideoGrid from './components/VideoGrid.jsx';
import PlayerModal from './components/PlayerModal.jsx';
import AccountModal from './components/AccountModal.jsx';

import { store } from './state/store.js';
import { filterVideos } from './filters/engine.js';
import {
  callInnerTube,
  fetchContinuation,
  parseBrowseResponse,
  buildBrowsePayload,
  buildSearchPayload,
  buildNextPayload,
  getBrowserRegion
} from './api/innertube.js';

const PAGE_SIZE = 12;

export default function App() {

  const [filterSettings, setFilterSettings] = useState(store.getFilterSettings());
  const [watchedVideos, setWatchedVideos] = useState(store.getWatchedVideos());
  const [session, setSession] = useState(store.getSession());

  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [continuationToken, setContinuationToken] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState('browse');

  // Read initial query parameters synchronously to avoid flash of content
  const initialUrlParams = typeof window !== 'undefined' && window.location?.search
    ? new URLSearchParams(window.location.search)
    : null;
  const initialVideoId = initialUrlParams?.get('v') || null;
  const initialQuery = initialUrlParams?.get('q') || '';

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [activeVideo, setActiveVideo] = useState(
    initialVideoId
      ? {
          id: initialVideoId,
          title: 'Loading video...',
          channelTitle: '',
          views: '',
          publishedTime: ''
        }
      : null
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [feedError, setFeedError] = useState(null);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(false);

  const feedBufferRef = useRef([]);
  const continuationTokenRef = useRef(null);
  const isPrefetchingRef = useRef(false);
  const rateLimitCooldownRef = useRef(0);
  const hasHydratedRef = useRef(false);
  const loadFeedRef = useRef(null);
  const hasBridgedToSubscriptionsRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      try {
        window.history.scrollRestoration = 'manual';
      } catch {}
    }
    return store.subscribe(() => {
      setFilterSettings(store.getFilterSettings());
      setWatchedVideos(store.getWatchedVideos());
      setSession(store.getSession());
    });
  }, []);

  const prefetchBuffer = useCallback(async (targetCount, currentTokenOverride = null) => {
    if (isPrefetchingRef.current) return;
    if (Date.now() < rateLimitCooldownRef.current) return;
    const token = currentTokenOverride || continuationTokenRef.current;
    if (!token) return;
    if (feedBufferRef.current.length >= targetCount) return;

    isPrefetchingRef.current = true;
    try {
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();
      const accessToken = await store.getValidAccessToken();
      const isTv = !!accessToken && activeEndpoint === 'browse';

      let currentToken = token;
      let prevToken = null;
      let attempts = 0;
      const MAX_PREFETCH_ATTEMPTS = 2;
      const seenIds = new Set(feedBufferRef.current.map((v) => v.id));

      while (feedBufferRef.current.length < targetCount && currentToken && attempts < MAX_PREFETCH_ATTEMPTS) {
        if (currentToken === prevToken) break;
        prevToken = currentToken;
        attempts++;

        if (attempts > 1) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }

        const rawData = await fetchContinuation(activeEndpoint, currentToken, {
          workerUrl,
          region,
          clientName: isTv ? 'TVHTML5' : 'WEB',
          clientVersion: isTv ? '7.20240901.00.00' : '2.20240901.00.00',
          accessToken: isTv ? accessToken : undefined
        });

        const parsed = parseBrowseResponse(rawData);
        const filtered = filterVideos(parsed.videos, {
          blockShorts: filterSettings.blockShorts,
          minViews: filterSettings.minViews ?? 1000,
          hideWatched: filterSettings.hideWatched,
          watchedVideos
        });

        const newItems = [];
        for (const item of filtered.items) {
          if (!seenIds.has(item.id)) {
            newItems.push(item);
            seenIds.add(item.id);
          }
        }

        if (newItems.length > 0) {
          feedBufferRef.current = [...feedBufferRef.current, ...newItems];
        }

        currentToken = parsed.continuationToken || null;
        if (!currentToken) break;
      }

      // Auto-extend via Subscriptions if recommendations continuation ran out
      if (isTv && !currentToken && feedBufferRef.current.length < targetCount && !hasBridgedToSubscriptionsRef.current) {
        hasBridgedToSubscriptionsRef.current = true;
        try {
          const subRaw = await callInnerTube('browse', buildBrowsePayload({
            browseId: 'FEsubscriptions',
            region,
            clientType: 'TVHTML5'
          }), { workerUrl, accessToken });
          const subParsed = parseBrowseResponse(subRaw);
          const subFiltered = filterVideos(subParsed.videos, {
            blockShorts: filterSettings.blockShorts,
            minViews: filterSettings.minViews ?? 1000,
            hideWatched: filterSettings.hideWatched,
            watchedVideos
          });

          const subItems = [];
          for (const item of subFiltered.items) {
            if (!seenIds.has(item.id)) {
              subItems.push(item);
              seenIds.add(item.id);
            }
          }

          if (subItems.length > 0) {
            feedBufferRef.current = [...feedBufferRef.current, ...subItems];
          }
          currentToken = subParsed.continuationToken || null;
        } catch (err) {
          console.warn('[Prefetch] Auto-extend via subscriptions failed:', err);
        }
      }

      continuationTokenRef.current = currentToken;
      setContinuationToken(currentToken);
    } catch (err) {
      if (err.message && (err.message.includes('rate-limit') || err.message.includes('429'))) {
        rateLimitCooldownRef.current = Date.now() + 30000;
      }
    } finally {
      isPrefetchingRef.current = false;
    }
  }, [activeEndpoint, session, filterSettings.blockShorts, filterSettings.minViews, filterSettings.hideWatched, watchedVideos]);

  const loadFeed = useCallback(async (query = null) => {
    setLoading(true);
    setVideos([]);
    setFeedError(null);
    continuationTokenRef.current = null;
    setContinuationToken(null);
    feedBufferRef.current = [];
    setVisibleCount(PAGE_SIZE);
    hasBridgedToSubscriptionsRef.current = false;

    try {
      let rawData;
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();
      const accessToken = await store.getValidAccessToken();
      const endpoint = query ? 'search' : 'browse';
      setActiveEndpoint(endpoint);
      setAppliedQuery(query || '');

      if (query) {
        const payload = buildSearchPayload({ query, region });
        rawData = await callInnerTube('search', payload, { workerUrl });
      } else if (accessToken) {
        try {
          rawData = await callInnerTube('browse', buildBrowsePayload({
            browseId: 'FEwhat_to_watch',
            region,
            clientType: 'TVHTML5'
          }), { workerUrl, accessToken });
        } catch (err) {
          if (err.message?.includes('401') || err.status === 401) {
            store.clearSession();
            rawData = await callInnerTube('browse', buildBrowsePayload({
              browseId: 'FEwhat_to_watch',
              region,
              clientType: 'WEB'
            }), { workerUrl });
          } else {
            throw err;
          }
        }
      } else {
        const payload = buildBrowsePayload({
          browseId: 'FEwhat_to_watch',
          region,
          clientType: 'WEB'
        });
        rawData = await callInnerTube('browse', payload, { workerUrl });
      }

      const parsed = parseBrowseResponse(rawData);
      const accumulated = filterVideos(parsed.videos, {
        blockShorts: filterSettings.blockShorts,
        minViews: filterSettings.minViews ?? 1000,
        hideWatched: filterSettings.hideWatched,
        watchedVideos
      }).items;

      let nextToken = parsed.continuationToken || null;
      let prevToken = null;

      // Accumulate up to PAGE_SIZE (12) items, capped at at most 2 safe attempts
      let attempts = 0;
      const MAX_ACCUMULATION_ATTEMPTS = 2;
      const isTv = !!accessToken && endpoint === 'browse';
      const seenIds = new Set(accumulated.map((v) => v.id));

      while (accumulated.length < PAGE_SIZE && nextToken && attempts < MAX_ACCUMULATION_ATTEMPTS) {
        if (nextToken === prevToken) {
          break;
        }
        prevToken = nextToken;
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 250));

        try {
          const contRaw = await fetchContinuation(endpoint, nextToken, {
            workerUrl,
            region,
            clientName: isTv ? 'TVHTML5' : 'WEB',
            clientVersion: isTv ? '7.20240901.00.00' : '2.20240901.00.00',
            accessToken: isTv ? accessToken : undefined
          });
          const contParsed = parseBrowseResponse(contRaw);
          const contFiltered = filterVideos(contParsed.videos, {
            blockShorts: filterSettings.blockShorts,
            minViews: filterSettings.minViews ?? 1000,
            hideWatched: filterSettings.hideWatched,
            watchedVideos
          }).items;

          for (const item of contFiltered) {
            if (!seenIds.has(item.id)) {
              accumulated.push(item);
              seenIds.add(item.id);
            }
          }
          nextToken = contParsed.continuationToken || null;
        } catch (err) {
          if (err.message && (err.message.includes('rate-limit') || err.message.includes('429'))) {
            rateLimitCooldownRef.current = Date.now() + 30000;
          }
          break;
        }
      }

      // Seamless Auto-Extend via Subscriptions:
      // If signed-in and FEwhat_to_watch runs out of items or continuation before PAGE_SIZE,
      // bridge to latest subscription videos so the feed never feels empty or limited.
      if (isTv && accumulated.length < PAGE_SIZE && !hasBridgedToSubscriptionsRef.current) {
        hasBridgedToSubscriptionsRef.current = true;
        try {
          const subRaw = await callInnerTube('browse', buildBrowsePayload({
            browseId: 'FEsubscriptions',
            region,
            clientType: 'TVHTML5'
          }), { workerUrl, accessToken });
          const subParsed = parseBrowseResponse(subRaw);
          const subFiltered = filterVideos(subParsed.videos, {
            blockShorts: filterSettings.blockShorts,
            minViews: filterSettings.minViews ?? 1000,
            hideWatched: filterSettings.hideWatched,
            watchedVideos
          }).items;

          for (const item of subFiltered) {
            if (!seenIds.has(item.id)) {
              accumulated.push(item);
              seenIds.add(item.id);
            }
          }
          if (!nextToken && subParsed.continuationToken) {
            nextToken = subParsed.continuationToken;
          }
        } catch (err) {
          console.warn('[Feed] Auto-extend via subscriptions failed:', err);
        }
      }

      feedBufferRef.current = accumulated;
      const initialVisible = Math.min(PAGE_SIZE, accumulated.length);
      setVisibleCount(initialVisible);
      setVideos(accumulated.slice(0, initialVisible));
      continuationTokenRef.current = nextToken;
      setContinuationToken(nextToken);
      setLoading(false);

      // PREFETCH: Fetch next 12 into buffer in background only if not rate-limited
      if (nextToken && Date.now() >= rateLimitCooldownRef.current) {
        prefetchBuffer(initialVisible + PAGE_SIZE, nextToken);
      }
    } catch (err) {
      if (err.message && (err.message.includes('rate-limit') || err.message.includes('429'))) {
        rateLimitCooldownRef.current = Date.now() + 30000;
      }
      feedBufferRef.current = [];
      setVideos([]);
      continuationTokenRef.current = null;
      setContinuationToken(null);
      setFeedError(err.message || 'Failed to load videos. Please check your connection.');
      setLoading(false);
    }
  }, [session, filterSettings.blockShorts, filterSettings.minViews, filterSettings.hideWatched, watchedVideos, prefetchBuffer]);

  loadFeedRef.current = loadFeed;

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore) return;
    setLoadMoreError(null);

    const targetCount = visibleCount + PAGE_SIZE;

    // CASE 1: Instant reveal from prefetched buffer!
    if (feedBufferRef.current.length >= targetCount) {
      setVisibleCount(targetCount);
      setVideos(feedBufferRef.current.slice(0, targetCount));
      // Immediately queue background prefetch for the NEXT 12 hidden videos
      prefetchBuffer(targetCount + PAGE_SIZE);
      return;
    }

    // CASE 2: Buffer has some videos but fewer than targetCount
    if (feedBufferRef.current.length > visibleCount) {
      const availableCount = feedBufferRef.current.length;
      setVisibleCount(availableCount);
      setVideos(feedBufferRef.current.slice(0, availableCount));
      if (!continuationToken) return;
    }

    // CASE 3: Fetch continuation from network to reach targetCount
    setIsLoadingMore(true);
    let currentToken = continuationToken;
    let prevToken = null;

    try {
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();
      const accessToken = await store.getValidAccessToken();
      const isTv = !!accessToken && activeEndpoint === 'browse';

      let attempts = 0;
      const MAX_CONTINUATION_ATTEMPTS = 10;
      const seenIds = new Set(feedBufferRef.current.map((v) => v.id));

      // If the buffer has fewer items than targetCount, fetch continuation until we have 12 more unique items after filtering
      while (feedBufferRef.current.length < targetCount && currentToken && attempts < MAX_CONTINUATION_ATTEMPTS) {
        if (currentToken === prevToken) {
          break;
        }
        prevToken = currentToken;
        attempts++;

        const rawData = await fetchContinuation(activeEndpoint, currentToken, {
          workerUrl,
          region,
          clientName: isTv ? 'TVHTML5' : 'WEB',
          clientVersion: isTv ? '7.20240901.00.00' : '2.20240901.00.00',
          accessToken: isTv ? accessToken : undefined
        });

        const parsed = parseBrowseResponse(rawData);
        const filtered = filterVideos(parsed.videos, {
          blockShorts: filterSettings.blockShorts,
          minViews: filterSettings.minViews ?? 1000,
          hideWatched: filterSettings.hideWatched,
          watchedVideos
        });

        const newItems = [];
        for (const item of filtered.items) {
          if (!seenIds.has(item.id)) {
            newItems.push(item);
            seenIds.add(item.id);
          }
        }

        if (newItems.length > 0) {
          feedBufferRef.current = [...feedBufferRef.current, ...newItems];
        }

        currentToken = parsed.continuationToken || null;
        if (!currentToken) break;
      }

      // If continuation for FEwhat_to_watch ran out, seamlessly extend via FEsubscriptions
      if (isTv && !currentToken && !hasBridgedToSubscriptionsRef.current) {
        hasBridgedToSubscriptionsRef.current = true;
        try {
          const subRaw = await callInnerTube('browse', buildBrowsePayload({
            browseId: 'FEsubscriptions',
            region,
            clientType: 'TVHTML5'
          }), { workerUrl, accessToken });
          const subParsed = parseBrowseResponse(subRaw);
          const subFiltered = filterVideos(subParsed.videos, {
            blockShorts: filterSettings.blockShorts,
            minViews: filterSettings.minViews ?? 1000,
            hideWatched: filterSettings.hideWatched,
            watchedVideos
          });

          const subItems = [];
          for (const item of subFiltered.items) {
            if (!seenIds.has(item.id)) {
              subItems.push(item);
              seenIds.add(item.id);
            }
          }

          if (subItems.length > 0) {
            feedBufferRef.current = [...feedBufferRef.current, ...subItems];
          }
          currentToken = subParsed.continuationToken || null;
        } catch (err) {
          console.warn('[Feed] LoadMore auto-extend via subscriptions failed:', err);
        }
      }

      const newVisible = Math.min(targetCount, feedBufferRef.current.length);
      setVisibleCount(newVisible);
      setVideos(feedBufferRef.current.slice(0, newVisible));
      setContinuationToken(currentToken);

      // Trigger prefetch for the NEXT 12 hidden videos
      if (currentToken) {
        prefetchBuffer(newVisible + PAGE_SIZE, currentToken);
      }
    } catch (err) {
      setLoadMoreError(err.message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [continuationToken, isLoadingMore, visibleCount, activeEndpoint, session, filterSettings.blockShorts, filterSettings.minViews, filterSettings.hideWatched, watchedVideos, prefetchBuffer]);

  // Hydrates page view and player state directly from URL query parameters (?v= and ?q=)
  const hydrateFromUrl = useCallback(async (isInitial = false) => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlVideoId = params.get('v');
      const urlQuery = params.get('q');

      if (urlVideoId) {
        // Watch / Player Page
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        const found = feedBufferRef.current.find((v) => v.id === urlVideoId);
        if (found) {
          setActiveVideo(found);
        } else {
          setActiveVideo((prev) => (prev?.id === urlVideoId ? prev : {
            id: urlVideoId,
            title: 'Loading video...',
            channelTitle: '',
            views: '',
            publishedTime: ''
          }));

          // Asynchronously fetch watch next metadata to fill in title and author
          try {
            const workerUrl = session?.workerUrl || undefined;
            const region = getBrowserRegion();
            const payload = buildNextPayload({ videoId: urlVideoId, region });
            const rawData = await callInnerTube('next', payload, { workerUrl });
            const primaryContents =
              rawData?.contents?.twoColumnWatchNextResults?.results?.results?.contents ||
              rawData?.contents?.singleColumnWatchNextResults?.results?.results?.contents ||
              [];
            const primaryInfo =
              primaryContents.find((c) => c?.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer ||
              primaryContents.find((c) => c?.videoMetadataRenderer)?.videoMetadataRenderer;
            const secondaryInfo =
              primaryContents.find((c) => c?.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;

            const title =
              primaryInfo?.title?.runs?.map((r) => r.text).join('') ||
              primaryInfo?.title?.simpleText ||
              primaryInfo?.title?.content;

            const ownerRenderer =
              secondaryInfo?.owner?.videoOwnerRenderer ||
              primaryInfo?.owner?.videoOwnerRenderer;
            const channelName =
              ownerRenderer?.title?.runs?.map((r) => r.text).join('') ||
              ownerRenderer?.title?.simpleText ||
              ownerRenderer?.title?.content;
            const channelThumb =
              ownerRenderer?.thumbnail?.thumbnails?.[0]?.url;

            if (title) {
              setActiveVideo((prev) => (prev?.id === urlVideoId ? {
                ...prev,
                title: title || prev.title,
                channelTitle: channelName || prev.channelTitle,
                channelThumbnail: channelThumb || prev?.channelThumbnail || ''
              } : prev));
            }
          } catch {}
        }
      } else {
        // Navigating away from watch URL: minimize player to mini dock
        setIsPlayerMinimized(true);
      }

      if (urlQuery !== null && urlQuery !== appliedQuery) {
        setSearchQuery(urlQuery || '');
        setAppliedQuery(urlQuery || '');
        if (loadFeedRef.current) loadFeedRef.current(urlQuery || null);
      } else if (!urlVideoId && isInitial && !urlQuery) {
        if (loadFeedRef.current) loadFeedRef.current(null);
      }
    } catch {}
  }, [appliedQuery, session]);

  // Listen to browser Back and Forward arrow navigation
  useEffect(() => {
    const handlePopState = () => {
      hydrateFromUrl(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [hydrateFromUrl]);

  // Initial page hydration on mount: runs exactly once!
  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      hydrateFromUrl(true);
    }
  }, []);

  const handleSearchSubmit = (e) => {
    e?.preventDefault?.();
    const query = searchQuery.trim();
    if (query) {
      if (activeVideo) {
        setIsPlayerMinimized(true);
      }
      setVideos([]);
      setLoading(true);
      setAppliedQuery(query);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('q', query);
        url.searchParams.delete('v');
        window.history.pushState({ page: 'search', query }, '', url.pathname + url.search);
      } catch {}
      window.scrollTo({ top: 0, behavior: 'smooth' });
      loadFeed(query);
    } else {
      handleClearSearch();
    }
  };

  const handleGoHome = useCallback(() => {
    if (activeVideo) {
      setIsPlayerMinimized(true);
    }
    setSearchQuery('');
    setAppliedQuery('');
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('v');
      url.searchParams.delete('q');
      const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
      window.history.pushState({ page: 'home' }, '', cleanUrl);
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadFeed(null);
  }, [loadFeed, activeVideo]);

  const handleClearSearch = () => {
    if (activeVideo) {
      setIsPlayerMinimized(true);
    }
    setSearchQuery('');
    setAppliedQuery('');
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      url.searchParams.delete('v');
      const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
      window.history.pushState({ page: 'home' }, '', cleanUrl);
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadFeed();
  };

  const handlePlayVideo = (video) => {
    if (video?.id) {
      store.markVideoWatched(video.id);
      setActiveVideo(video);
      setIsPlayerMinimized(false);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('v', video.id);
        window.history.pushState({ page: 'watch', videoId: video.id }, '', url.pathname + url.search);
      } catch {}
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };

  const handleExpandPlayer = () => {
    setIsPlayerMinimized(false);
    if (activeVideo?.id) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('v', activeVideo.id);
        window.history.pushState({ page: 'watch', videoId: activeVideo.id }, '', url.pathname + url.search);
      } catch {}
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };

  const handleClosePlayer = () => {
    setActiveVideo(null);
    setIsPlayerMinimized(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('v');
      const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
      window.history.pushState({}, '', cleanUrl);
    } catch {}
  };

  const handleSaveSession = (sessionData) => {
    store.setSession(sessionData);
    setShowAccountModal(false);
    loadFeed();
  };

  const handleClearSession = () => {
    store.clearSession();
    loadFeed();
  };

  const hasMore =
    feedBufferRef.current.length > visibleCount ||
    Boolean(continuationToken) ||
    (store.hasSession() && !appliedQuery && !hasBridgedToSubscriptionsRef.current);

  return (
    <div>
      <Navbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={handleSearchSubmit}
        onClearSearch={handleClearSearch}
        onLogoClick={handleGoHome}
        onOpenAccount={() => setShowAccountModal(true)}
        onSignIn={() => setShowAccountModal(true)}
        hasSession={store.hasSession()}
        loading={loading}
      />

      {(!activeVideo || isPlayerMinimized) && (
        <main className="main-content">
          {appliedQuery && (
            <div className="search-banner">
              <div className="search-banner-info">
                <span>Results for: <strong>"{appliedQuery}"</strong></span>
                <span className="search-badge-count">
                  {loading ? 'Searching...' : `${videos.length} videos shown`}
                </span>
              </div>
              <button
                type="button"
                className="search-banner-clear"
                onClick={handleClearSearch}
              >
                Clear Search
              </button>
            </div>
          )}

          <VideoGrid
            videos={videos}
            loading={loading}
            onPlay={handlePlayVideo}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            isLoadingMore={isLoadingMore}
            loadMoreError={loadMoreError}
            feedError={feedError}
            onRetryFeed={() => loadFeed(appliedQuery || null)}
            isGuestHome={!store.hasSession() && !appliedQuery}
            onSignIn={() => setShowAccountModal(true)}
          />
        </main>
      )}

      {activeVideo && (
        <PlayerModal
          video={activeVideo}
          onPlay={handlePlayVideo}
          filterSettings={filterSettings}
          watchedVideos={watchedVideos}
          session={session}
          onClose={handleClosePlayer}
          isMinimized={isPlayerMinimized}
          onToggleMinimize={() => setIsPlayerMinimized(prev => !prev)}
          onExpand={handleExpandPlayer}
        />
      )}

      <AccountModal
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        currentSession={session}
        onSaveSession={handleSaveSession}
        onClearSession={handleClearSession}
        watchedCount={watchedVideos.length}
        onClearWatched={() => store.clearWatchedVideos()}
      />


    </div>
  );
}
