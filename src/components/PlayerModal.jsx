import React, { useState, useEffect, useCallback, useRef } from 'react';
import { callInnerTube, fetchContinuation, parseBrowseResponse, buildNextPayload } from '../api/innertube.js';
import { filterVideos } from '../filters/engine.js';
import { store } from '../state/store.js';
import { getBrowserRegion } from '../utils/geo.js';
import {
  isYouTubeServedAd,
  sendPlayerCommand,
  sendListeningHandshake,
  isAllowedOrigin,
  logAdBlocked,
  logAdFailure,
  getYouTubeErrorMessage,
  PLAYER_STATE_MAP
} from '../adblock/streamShield.js';
import { fetchSponsorSegments, findActiveSponsorSegment } from '../adblock/sponsorBlock.js';

const RELATED_PAGE_SIZE = 10;

export default function PlayerModal({
  video,
  onPlay,
  filterSettings,
  watchedVideos,
  session,
  onClose = null,
  isMinimized = false,
  onToggleMinimize = null,
  onExpand = null
}) {
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [relatedError, setRelatedError] = useState(null);
  const [continuationToken, setContinuationToken] = useState(null);
  const [visibleCount, setVisibleCount] = useState(RELATED_PAGE_SIZE);
  const [sponsorSegments, setSponsorSegments] = useState([]);

  const [isPlaying, setIsPlaying] = useState(true);
  const [playerKey, setPlayerKey] = useState(0);
  const isPlayingRef = useRef(true);

  const [creatorAvatar, setCreatorAvatar] = useState(video?.channelThumbnail || null);

  useEffect(() => {
    setCreatorAvatar(video?.channelThumbnail || null);
  }, [video?.id, video?.channelThumbnail]);

  const relatedBufferRef = useRef([]);
  const relatedContinuationTokenRef = useRef(null);
  const loadedRelatedVideoIdRef = useRef(null);
  const loadRelatedRef = useRef(null);
  const isPrefetchingRelatedRef = useRef(false);
  const iframeRef = useRef(null);
  const lastCurrentTimeRef = useRef(0);

  // Always scroll to top immediately when video opens or expands to full view
  useEffect(() => {
    if (video?.id && !isMinimized) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const r1 = requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      });
      const t1 = setTimeout(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }, 50);
      const t2 = setTimeout(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }, 180);

      return () => {
        cancelAnimationFrame(r1);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [video?.id, isMinimized]);

  const togglePlayPause = () => {
    if (isPlayingRef.current) {
      sendPlayerCommand(iframeRef.current, 'pauseVideo');
      isPlayingRef.current = false;
      setIsPlaying(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } else {
      sendPlayerCommand(iframeRef.current, 'playVideo');
      isPlayingRef.current = true;
      setIsPlaying(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
  };

  // Dynamic Island & Media Session Integration for iOS Native WebApp
  useEffect(() => {
    if (!video?.id) return;

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: video.title || 'Playing on TubeLite',
          artist: video.channelTitle || 'TubeLite',
          album: 'TubeLite Focus Player',
          artwork: [
            { src: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
            { src: `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' }
          ]
        });

        navigator.mediaSession.setActionHandler('play', () => {
          sendPlayerCommand(iframeRef.current, 'playVideo');
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        });

        navigator.mediaSession.setActionHandler('pause', () => {
          sendPlayerCommand(iframeRef.current, 'pauseVideo');
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
          }
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (typeof details?.seekTime === 'number') {
            sendPlayerCommand(iframeRef.current, 'seekTo', [details.seekTime, true]);
          }
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const skip = details?.seekOffset || 10;
          sendPlayerCommand(iframeRef.current, 'seekTo', [Math.max(0, (lastCurrentTimeRef.current || 0) - skip), true]);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const skip = details?.seekOffset || 10;
          sendPlayerCommand(iframeRef.current, 'seekTo', [(lastCurrentTimeRef.current || 0) + skip, true]);
        });

        if (relatedVideos && relatedVideos.length > 0) {
          navigator.mediaSession.setActionHandler('nexttrack', () => {
            onPlay(relatedVideos[0]);
          });
        }
      } catch {}
    }

    return () => {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch {}
      }
    };
  }, [video?.id, video?.title, video?.channelTitle, relatedVideos, onPlay]);

  // Fetch native SponsorBlock segments for creator ad / sponsor skipping
  useEffect(() => {
    if (!video?.id) return;
    let isMounted = true;
    fetchSponsorSegments(video.id).then((segments) => {
      if (isMounted) {
        setSponsorSegments(segments);
      }
    });
    return () => { isMounted = false; };
  }, [video?.id]);

  // Monitor YouTube iframe postMessage events for YouTube-served ad detection & native SponsorBlock
  useEffect(() => {
    if (!video?.id) return;

    const lastLoggedState = { playerState: null };

    const triggerHandshake = () => {
      if (iframeRef.current) {
        sendListeningHandshake(iframeRef.current);
      }
    };

    triggerHandshake();
    const t1 = setTimeout(triggerHandshake, 400);
    const t2 = setTimeout(triggerHandshake, 1200);
    const t3 = setTimeout(triggerHandshake, 2500);

    const handleMessage = (event) => {
      if (!event.origin || (!isAllowedOrigin(event.origin) && !event.origin.includes('youtube.com'))) return;

      let rawData = event.data;
      try {
        if (typeof rawData === 'string') rawData = JSON.parse(rawData);
      } catch {}

      const data = rawData;
      if (!data) return;

      const info = data.info || (data.event === 'infoDelivery' ? data : null);

      // Log YouTube API errors if any
      if (data.event === 'onError' || (info && info.errorCode !== undefined)) {
        const code = data.info || info?.errorCode;
        logAdFailure('StreamShield', `YouTube Player reported error code ${code}: ${getYouTubeErrorMessage(code)}`, {
          errorCode: code,
          videoId: video.id
        });
      }

      if (info) {
        const stateKey = String(info.playerState);
        const stateName = PLAYER_STATE_MAP[stateKey] || (info.playerState !== undefined ? `STATE_${info.playerState}` : undefined);
        const streamTime = typeof info.currentTime === 'number' ? Number(info.currentTime.toFixed(2)) : undefined;
        const streamDuration = typeof info.duration === 'number' ? Number(info.duration.toFixed(2)) : undefined;
        const currentVideoId = info.videoData?.video_id;

        if (stateName && stateName !== lastLoggedState.playerState) {
          lastLoggedState.playerState = stateName;
          const playing = stateName === 'PLAYING';
          isPlayingRef.current = playing;
          setIsPlaying(playing);

          if ('mediaSession' in navigator) {
            if (playing) {
              navigator.mediaSession.playbackState = 'playing';
            } else if (stateName === 'PAUSED') {
              navigator.mediaSession.playbackState = 'paused';
            }
          }
        }

        if (typeof streamTime === 'number') {
          lastCurrentTimeRef.current = streamTime;
          if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && streamDuration > 0) {
            try {
              navigator.mediaSession.setPositionState({
                duration: streamDuration,
                playbackRate: 1.0,
                position: Math.min(streamTime, streamDuration)
              });
            } catch {}
          }
        }
      }

      const isAd = isYouTubeServedAd(data, video.id);

      if (isAd) {
        logAdBlocked('StreamShield', `YouTube-served ad detected. Bypassing by refetching iframe from scratch.`);
        setPlayerKey(prev => prev + 1);
        return;
      } else if (typeof info?.currentTime === 'number' && sponsorSegments.length > 0) {
        // Native SponsorBlock: pure range check skips creator sponsors & intros without any mutable Set tracking
        const activeSegment = findActiveSponsorSegment(info.currentTime, sponsorSegments);
        if (activeSegment) {
          logAdBlocked('SponsorBlock', `Auto-skipping ${activeSegment.category} segment (${activeSegment.start.toFixed(1)}s → ${activeSegment.end.toFixed(1)}s) [UUID: ${activeSegment.UUID || 'native'}]`, {
            activeSegment,
            currentTime: info.currentTime
          });
          sendPlayerCommand(iframeRef.current, 'seekTo', [activeSegment.end, true]);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('message', handleMessage);
    };
  }, [video?.id]);

  const prefetchRelated = useCallback(async (targetCount, currentTokenOverride = null) => {
    if (isPrefetchingRelatedRef.current) return;
    const token = currentTokenOverride || relatedContinuationTokenRef.current;
    if (!token) return;
    if (relatedBufferRef.current.length >= targetCount) return;

    isPrefetchingRelatedRef.current = true;
    try {
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();
      let currentToken = token;
      let prevToken = null;
      let attempts = 0;
      const seenIds = new Set(relatedBufferRef.current.map(v => v.id));

      while (relatedBufferRef.current.length < targetCount && currentToken && attempts < 2) {
        if (currentToken === prevToken) break;
        prevToken = currentToken;
        attempts++;

        if (attempts > 1) {
          await new Promise(r => setTimeout(r, 250));
        }

        const contRaw = await fetchContinuation('next', currentToken, {
          workerUrl,
          region,
          clientName: 'WEB',
          clientVersion: '2.20240901.00.00'
        });
        const contParsed = parseBrowseResponse(contRaw);
        const contFiltered = filterVideos(contParsed.videos, {
          blockShorts: filterSettings?.blockShorts ?? true,
          minViews: filterSettings?.minViews ?? 1000,
          hideWatched: filterSettings?.hideWatched ?? true,
          watchedVideos: watchedVideos || []
        }).items;

        const newItems = contFiltered.filter(v => !seenIds.has(v.id) && v.id !== video?.id);
        for (const item of newItems) {
          seenIds.add(item.id);
        }

        if (newItems.length > 0) {
          relatedBufferRef.current = [...relatedBufferRef.current, ...newItems];
        }

        currentToken = contParsed.continuationToken || null;
        if (!currentToken) break;
      }

      relatedContinuationTokenRef.current = currentToken;
      setContinuationToken(currentToken);
    } catch {
    } finally {
      isPrefetchingRelatedRef.current = false;
    }
  }, [session, filterSettings, watchedVideos, video?.id]);

  // Load related recommended videos whenever video.id changes
  const loadRelated = useCallback(async (videoId) => {
    if (!videoId) return;
    setLoadingRelated(true);
    setRelatedError(null);
    relatedContinuationTokenRef.current = null;
    setContinuationToken(null);
    relatedBufferRef.current = [];
    setVisibleCount(RELATED_PAGE_SIZE);

    try {
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();

      const payload = buildNextPayload({ videoId, region });
      const rawData = await callInnerTube('next', payload, { workerUrl });

      // Extract creator channel avatar from watch next secondary info
      const secondaryContents = rawData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      const secondaryInfo = secondaryContents.find((c) => c?.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer
        || secondaryContents[1]?.videoSecondaryInfoRenderer;
      const ownerThumb = secondaryInfo?.owner?.videoOwnerRenderer?.thumbnail?.thumbnails?.[0]?.url;
      if (ownerThumb) {
        setCreatorAvatar(ownerThumb);
      }

      const parsed = parseBrowseResponse(rawData);
      let accumulated = filterVideos(parsed.videos, {
        blockShorts: filterSettings?.blockShorts ?? true,
        minViews: filterSettings?.minViews ?? 1000,
        hideWatched: filterSettings?.hideWatched ?? true,
        watchedVideos: watchedVideos || []
      }).items;

      let nextToken = parsed.continuationToken || null;

      // Accumulate until we reach at least RELATED_PAGE_SIZE filtered videos, or no more tokens
      let attempts = 0;
      while (accumulated.length < RELATED_PAGE_SIZE && nextToken && attempts < 2) {
        attempts++;
        await new Promise(r => setTimeout(r, 200));
        try {
          const contRaw = await fetchContinuation('next', nextToken, {
            workerUrl,
            region,
            clientName: 'WEB',
            clientVersion: '2.20240901.00.00'
          });
          const contParsed = parseBrowseResponse(contRaw);
          const contFiltered = filterVideos(contParsed.videos, {
            blockShorts: filterSettings?.blockShorts ?? true,
            minViews: filterSettings?.minViews ?? 1000,
            hideWatched: filterSettings?.hideWatched ?? true,
            watchedVideos: watchedVideos || []
          }).items;

          const existingIds = new Set(accumulated.map(v => v.id));
          for (const item of contFiltered) {
            if (!existingIds.has(item.id) && item.id !== videoId) {
              accumulated.push(item);
              existingIds.add(item.id);
            }
          }
          nextToken = contParsed.continuationToken || null;
        } catch {
          break;
        }
      }

      // Filter out currently active video from recommendations
      accumulated = accumulated.filter(v => v.id !== videoId);

      relatedBufferRef.current = accumulated;
      setRelatedVideos(accumulated.slice(0, RELATED_PAGE_SIZE));
      setVisibleCount(Math.min(RELATED_PAGE_SIZE, accumulated.length));
      relatedContinuationTokenRef.current = nextToken;
      setContinuationToken(nextToken);
      setLoadingRelated(false);

      // PREFETCH: Quietly fetch the next 10 recommendations into the buffer in background
      if (nextToken) {
        prefetchRelated(RELATED_PAGE_SIZE + RELATED_PAGE_SIZE, nextToken);
      }
    } catch (err) {
      relatedBufferRef.current = [];
      setRelatedVideos([]);
      relatedContinuationTokenRef.current = null;
      setContinuationToken(null);
      setRelatedError(err.message || 'Failed to load recommendations. Please check your connection.');
      setLoadingRelated(false);
    }
  }, [session, filterSettings, watchedVideos, prefetchRelated]);

  loadRelatedRef.current = loadRelated;

  useEffect(() => {
    if (video?.id && loadedRelatedVideoIdRef.current !== video.id) {
      loadedRelatedVideoIdRef.current = video.id;
      loadRelated(video.id);
    }
  }, [video?.id]);

  const handleLoadMoreRelated = async () => {
    if (isLoadingMore) return;
    setLoadMoreError(null);

    const targetCount = visibleCount + RELATED_PAGE_SIZE;

    // CASE 1: Instant reveal from prefetched buffer!
    if (relatedBufferRef.current.length >= targetCount) {
      setVisibleCount(targetCount);
      setRelatedVideos(relatedBufferRef.current.slice(0, targetCount));
      // Queue next prefetch
      prefetchRelated(targetCount + RELATED_PAGE_SIZE);
      return;
    }

    // CASE 2: Partial buffer reveal
    if (relatedBufferRef.current.length > visibleCount) {
      const availableCount = relatedBufferRef.current.length;
      setVisibleCount(availableCount);
      setRelatedVideos(relatedBufferRef.current.slice(0, availableCount));
      if (!relatedContinuationTokenRef.current) return;
    }

    // CASE 3: Fetch continuation from network
    setIsLoadingMore(true);
    let currentToken = relatedContinuationTokenRef.current || continuationToken;
    let prevToken = null;

    try {
      const workerUrl = session?.workerUrl || undefined;
      const region = getBrowserRegion();

      let attempts = 0;
      const seenIds = new Set(relatedBufferRef.current.map(v => v.id));

      while (relatedBufferRef.current.length < targetCount && currentToken && attempts < 2) {
        if (currentToken === prevToken) break;
        prevToken = currentToken;
        attempts++;
        const contRaw = await fetchContinuation('next', currentToken, {
          workerUrl,
          region,
          clientName: 'WEB',
          clientVersion: '2.20240901.00.00'
        });
        const contParsed = parseBrowseResponse(contRaw);
        const contFiltered = filterVideos(contParsed.videos, {
          blockShorts: filterSettings?.blockShorts ?? true,
          minViews: filterSettings?.minViews ?? 1000,
          hideWatched: filterSettings?.hideWatched ?? true,
          watchedVideos: watchedVideos || []
        }).items;

        const newItems = contFiltered.filter(v => !seenIds.has(v.id) && v.id !== video.id);
        for (const item of newItems) {
          seenIds.add(item.id);
        }
        relatedBufferRef.current = [...relatedBufferRef.current, ...newItems];

        currentToken = contParsed.continuationToken || null;
        if (!currentToken) break;
      }

      const newVisible = Math.min(targetCount, relatedBufferRef.current.length);
      setVisibleCount(newVisible);
      setRelatedVideos(relatedBufferRef.current.slice(0, newVisible));
      relatedContinuationTokenRef.current = currentToken;
      setContinuationToken(currentToken);

      if (currentToken) {
        prefetchRelated(newVisible + RELATED_PAGE_SIZE, currentToken);
      }
    } catch (err) {
      setLoadMoreError(err.message);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (!video) return null;

  const playerSrc = `https://www.youtube.com/embed/${video.id}?enablejsapi=1&autoplay=1&rel=0&iv_load_policy=3&playsinline=1&modestbranding=1&controls=1&cc_load_policy=1`;
  const hasMoreRelated = relatedBufferRef.current.length > visibleCount || Boolean(relatedContinuationTokenRef.current || continuationToken);

  return (
    <>
      <main
        className={`player-page-view ${isMinimized ? 'player-page-view-minimized' : ''}`}
        aria-hidden={isMinimized ? 'true' : 'false'}
      >
        <div className="player-container watch-theater-container">
          <div className="watch-columns">
            {/* Main Player Column */}
            <div className="watch-main-col">
              <div className="watch-player-wrapper">
                <div className="video-frame-wrap">
                  <iframe
                    key={playerKey}
                    ref={iframeRef}
                    src={playerSrc}
                    title={video.title}
                    className="native-video-el"
                    tabIndex={-1}
                    aria-hidden="false"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    onLoad={() => sendListeningHandshake(iframeRef.current)}
                  />
                </div>
              </div>

              <div className="player-meta">
                <h1 className="player-title">{video.title}</h1>

                <div className="player-creator-row">
                  <div className="player-creator-info">
                    <div className="channel-avatar">
                      {(creatorAvatar || video.channelThumbnail) ? (
                        <img src={creatorAvatar || video.channelThumbnail} alt={video.channelTitle} />
                      ) : (
                        (video.channelTitle || 'Y')[0].toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="player-creator-name">{video.channelTitle}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {video.views} {video.publishedTime && `• ${video.publishedTime}`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {/* Related Recommended Videos Column */}
          <aside className="watch-sidebar-col">

            {loadingRelated ? (
              <div className="related-skeletons">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="related-skeleton-card">
                    <div className="skeleton" style={{ width: 140, height: 80, borderRadius: 8, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <div className="skeleton" style={{ height: 14, width: '90%' }} />
                      <div className="skeleton" style={{ height: 11, width: '60%' }} />
                      <div className="skeleton" style={{ height: 11, width: '40%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : relatedError && relatedVideos.length === 0 ? (
              <div className="empty-state error-state" style={{ padding: '32px 16px' }}>
                <p className="error-title" style={{ fontSize: '15px' }}>Unable to load recommendations</p>
                <p className="error-desc" style={{ fontSize: '13px', marginBottom: 8 }}>{relatedError}</p>
                <button
                  type="button"
                  className="load-more-btn related-load-more"
                  onClick={() => loadRelated(video.id)}
                  style={{ width: 'auto', padding: '10px 24px' }}
                >
                  Retry Recommendations
                </button>
              </div>
            ) : relatedVideos.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <p>No related videos found</p>
              </div>
            ) : (
              <div className="related-list">
                {relatedVideos.map((rVid) => {
                  const thumb = rVid.thumbnails && rVid.thumbnails.length > 0
                    ? rVid.thumbnails[rVid.thumbnails.length - 1].url
                    : `https://i.ytimg.com/vi/${rVid.id}/hqdefault.jpg`;

                  return (
                    <article
                      key={rVid.id}
                      className="related-video-card"
                      onClick={() => onPlay(rVid)}
                    >
                      <div className="related-thumb-wrap">
                        <img
                          src={thumb}
                          alt={rVid.title}
                          className="related-thumb-img"
                          loading="lazy"
                        />
                        {rVid.duration && (
                          <span className="duration-badge">{rVid.duration}</span>
                        )}
                      </div>

                      <div className="related-details">
                        <h4 className="related-title" title={rVid.title}>
                          {rVid.title}
                        </h4>
                        <div className="related-channel">{rVid.channelTitle}</div>
                        <div className="related-stats">
                          {rVid.views && <span>{rVid.views}</span>}
                          {rVid.views && rVid.publishedTime && <span> • </span>}
                          {rVid.publishedTime && <span>{rVid.publishedTime}</span>}
                        </div>
                      </div>

                    </article>
                  );
                })}

                {(hasMoreRelated || loadMoreError) && (
                  <div className="pagination-wrap" style={{ marginTop: 12 }}>
                    {loadMoreError && (
                      <div className="load-more-error" style={{ color: 'var(--red-500)', marginBottom: '8px', fontSize: '0.85rem', textAlign: 'center', width: '100%' }}>
                        {loadMoreError}
                      </div>
                    )}
                    <button
                      type="button"
                      className="load-more-btn related-load-more"
                      onClick={handleLoadMoreRelated}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? (
                        <>
                          <span className="btn-spinner" />
                          <span>Loading more...</span>
                        </>
                      ) : (
                        loadMoreError ? 'Retry Load More' : 'Load More Recommended'
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>

    {isMinimized && (
      <aside className="mini-player-dock" onClick={onExpand} aria-label="Mini floating player">
        <div className="mini-player-content">
          <div className="mini-player-thumb-wrap">
            <img
              src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
              alt={video.title}
              className="mini-player-thumb"
            />
            {isPlaying && <div className="mini-player-pulse-dot" />}
          </div>

          <div className="mini-player-meta">
            <div className="mini-player-title">{video.title}</div>
            <div className="mini-player-channel">{video.channelTitle}</div>
          </div>

          <div className="mini-player-controls" onClick={(e) => e.stopPropagation()}>

            <button
              type="button"
              className="mini-player-icon-btn play-btn"
              onClick={togglePlayPause}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="mini-player-icon-btn"
              onClick={onExpand}
              title="Expand Full Player"
              aria-label="Expand Full Player"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>

            {onClose && (
              <button
                type="button"
                className="mini-player-icon-btn close"
                onClick={onClose}
                title="Close Player"
                aria-label="Close Player"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </aside>
    )}
  </>
  );
}
