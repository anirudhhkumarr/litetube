import { parseDurationToSeconds, parseViewCount } from '../filters/engine.js';

/**
 * Detects if a video renderer contains an official YouTube "WATCHED" or resume playback annotation.
 * Returns { isWatched: boolean, percentWatched: number | null }
 */
export function extractWatchedAnnotation(renderer, overlays = []) {
  let isWatched = false;
  let percentWatched = null;

  // 1. Check overlays array (thumbnailOverlays or contentImage overlays)
  if (Array.isArray(overlays)) {
    for (const ov of overlays) {
      if (!ov) continue;

      // Resume playback renderer: percentDurationWatched
      const resumeRenderer = ov.thumbnailOverlayResumePlaybackRenderer;
      if (resumeRenderer && typeof resumeRenderer.percentDurationWatched === 'number') {
        percentWatched = resumeRenderer.percentDurationWatched;
        if (percentWatched >= 80) {
          isWatched = true;
        }
      }

      // Progress bar view model
      const progressBarVM = ov.thumbnailOverlayProgressBarViewModel;
      if (progressBarVM && typeof progressBarVM.progressBarPercentage === 'number') {
        percentWatched = progressBarVM.progressBarPercentage;
        if (percentWatched >= 80) {
          isWatched = true;
        }
      }

      // Playback status renderer (e.g. text "WATCHED")
      const playbackStatus = ov.thumbnailOverlayPlaybackStatusRenderer;
      if (playbackStatus) {
        const texts = playbackStatus.texts || [];
        for (const t of texts) {
          const txt = typeof t === 'string' ? t : (t?.runs?.[0]?.text || t?.simpleText || '');
          if (txt.toUpperCase().includes('WATCHED')) {
            isWatched = true;
          }
        }
      }

      // Time status renderer with WATCHED style or text
      const timeStatus = ov.thumbnailOverlayTimeStatusRenderer;
      if (timeStatus) {
        const style = timeStatus.style || '';
        const text = timeStatus.text?.simpleText || timeStatus.text?.runs?.[0]?.text || '';
        if (style.toUpperCase() === 'WATCHED' || text.toUpperCase() === 'WATCHED') {
          isWatched = true;
        }
      }

      // Bottom overlay view model badges
      const badges = ov.thumbnailBottomOverlayViewModel?.badges || [];
      for (const b of badges) {
        const badgeText = b?.thumbnailBadgeViewModel?.text || '';
        if (badgeText.toUpperCase().includes('WATCHED')) {
          isWatched = true;
        }
      }
    }
  }

  // 2. Check metadata badges (e.g. metadataBadgeRenderer on videoRenderer)
  if (renderer && Array.isArray(renderer.badges)) {
    for (const b of renderer.badges) {
      const label = b?.metadataBadgeRenderer?.label || b?.metadataBadgeRenderer?.tooltip || '';
      const style = b?.metadataBadgeRenderer?.style || '';
      if (label.toUpperCase().includes('WATCHED') || style.toUpperCase().includes('WATCHED')) {
        isWatched = true;
      }
    }
  }

  // 3. Check lockup metadata badge
  const lockupBadge = renderer?.metadata?.lockupMetadataViewModel?.badge?.badgeViewModel?.text || '';
  if (lockupBadge.toUpperCase().includes('WATCHED')) {
    isWatched = true;
  }

  return { isWatched, percentWatched };
}

/**
 * Robust text extractor that concatenates all runs if present,
 * or extracts simpleText / content.
 */
export function extractRunsText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (Array.isArray(obj.runs)) {
    return obj.runs.map((r) => (typeof r?.text === 'string' ? r.text : '')).join('');
  }
  return '';
}

function extractVideoFromLockup(lockup) {
  if (!lockup) return null;

  // Reject non-video lockup content types immediately (channels, playlists, radios, etc.)
  const contentType = lockup.contentType || '';
  if (
    contentType === 'LOCKUP_CONTENT_TYPE_CHANNEL' ||
    contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ||
    contentType === 'LOCKUP_CONTENT_TYPE_RADIO' ||
    contentType === 'LOCKUP_CONTENT_TYPE_MIX' ||
    contentType === 'LOCKUP_CONTENT_TYPE_POST' ||
    contentType === 'LOCKUP_CONTENT_TYPE_GAME'
  ) {
    return null;
  }

  const videoId = lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
                  lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
                  lockup.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
                  lockup.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
                  lockup.contentId ||
                  lockup.entityId;
  if (!videoId || typeof videoId !== 'string') return null;

  // Reject channel IDs (UC...), playlist IDs (PL...), and handles (@...)
  if (videoId.startsWith('UC') || videoId.startsWith('PL') || videoId.startsWith('@')) {
    return null;
  }

  const metaVM = lockup.metadata?.lockupMetadataViewModel;
  let title = extractRunsText(metaVM?.title) ||
              extractRunsText(lockup.overlayMetadata?.primaryText) ||
              lockup.rendererContext?.accessibilityContext?.label || '';

  const rows = metaVM?.metadata?.contentMetadataViewModel?.metadataRows || [];
  let channelTitle = '';
  let channelId = '';
  let views = '';
  let publishedTime = '';

  // Semantically inspect all rows and parts rather than assuming fixed row indices
  for (const row of rows) {
    const parts = row?.metadataParts || [];
    for (const p of parts) {
      const text = extractRunsText(p?.text) || p?.accessibilityLabel || '';
      if (!text) continue;

      // 1. Channel identification via browseEndpoint (UC... or @handle)
      const browseId = p.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId ||
                       p.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url;
      const isChannelEndpoint = Boolean(browseId) && (
        String(browseId).startsWith('UC') ||
        String(browseId).startsWith('@') ||
        String(browseId).includes('/@') ||
        String(browseId).includes('/channel/')
      );

      if (isChannelEndpoint) {
        if (!channelTitle) channelTitle = text;
        if (!channelId) channelId = p.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId || '';
        continue;
      }

      // 2. Metrics / Views identification
      const isViews = /view|watching/i.test(text) || /view|watching/i.test(p.accessibilityLabel || '');
      if (isViews && !views) {
        views = p.accessibilityLabel || (text.includes('view') ? text : `${text} views`);
        continue;
      }

      // 3. Published time / Relative date identification
      const isTimestamp = /ago|streamed|premiered|yesterday|today/i.test(text) || /ago|streamed|premiered|yesterday|today/i.test(p.accessibilityLabel || '');
      if (isTimestamp && !publishedTime) {
        publishedTime = text;
        continue;
      }

      // 4. Non-metric text fallback for channel title
      if (!channelTitle && !isViews && !isTimestamp && !/^(new|cc|4k|hd|subtitles|shorts)$/i.test(text.trim())) {
        channelTitle = text;
      }
    }
  }

  // Shorts lockup fallback (shortsLockupViewModel has overlayMetadata)
  if (!views && lockup.overlayMetadata?.secondaryText) {
    views = extractRunsText(lockup.overlayMetadata.secondaryText);
  }

  let durationStr = null;
  let isShortBadge = false;

  const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
  for (const ov of overlays) {
    const badges = ov?.thumbnailBottomOverlayViewModel?.badges || [];
    for (const b of badges) {
      const badgeText = b?.thumbnailBadgeViewModel?.text || '';
      if (badgeText.toUpperCase() === 'SHORTS') {
        isShortBadge = true;
      } else if (badgeText && !durationStr) {
        durationStr = badgeText;
      }
    }
  }

  const durationSec = parseDurationToSeconds(durationStr);
  const viewCount = parseViewCount(views);

  const isShortContentType = lockup.contentType === 'LOCKUP_CONTENT_TYPE_SHORTS' ||
                             lockup.contentType === 'LOCKUP_CONTENT_TYPE_REEL';
  const onTapUrl = lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || '';
  const hasShortUrl = onTapUrl.includes('/shorts/');
  const hasShortsTag = /(?:^|\s)#shorts?(?:\s|$|[!?.,])/i.test(title);

  const isShortVideo = isShortContentType || isShortBadge || Boolean(hasShortUrl) || hasShortsTag;
  const thumbnails = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];

  // Ad and Sponsored detection
  const badgeViewModelText = metaVM?.badge?.badgeViewModel?.text || '';
  const hasAdContext = Boolean(lockup.rendererContext?.adSlotContext);
  const isPromotedContentType = lockup.contentType === 'LOCKUP_CONTENT_TYPE_PROMOTED' ||
                                lockup.contentType === 'LOCKUP_CONTENT_TYPE_AD';
  const isSponsoredText = /sponsored|promoted|^ad$/i.test(badgeViewModelText) ||
                          /sponsored/i.test(views) ||
                          /sponsored/i.test(channelTitle);
  const isPromoted = hasAdContext || isPromotedContentType || isSponsoredText;

  const channelThumbnail = metaVM?.avatar?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url ||
                           metaVM?.avatar?.avatarViewModel?.image?.sources?.[0]?.url ||
                           metaVM?.image?.sources?.[0]?.url ||
                           '';

  const { isWatched, percentWatched } = extractWatchedAnnotation(lockup, overlays);

  return {
    id: videoId,
    title,
    channelTitle,
    channelId,
    duration: durationStr,
    durationSeconds: durationSec,
    views,
    viewCount,
    publishedTime,
    thumbnails,
    channelThumbnail,
    isShort: isShortVideo,
    badge: isPromoted ? 'Sponsored' : (isWatched ? 'WATCHED' : (isShortBadge ? 'SHORTS' : null)),
    isPromoted,
    isWatched,
    percentDurationWatched: percentWatched,
    type: 'lockupViewModel',
    contentType: lockup.contentType || 'LOCKUP_CONTENT_TYPE_VIDEO'
  };
}

function extractVideoFromRenderer(v, isContext = false) {
  if (!v) return null;

  // Handle tileRenderer (YouTube TV)
  if (v.contentId || v.metadata?.tileMetadataRenderer || v.header?.tileHeaderRenderer) {
    const contentType = v.contentType || '';
    if (
      contentType === 'TILE_CONTENT_TYPE_CHANNEL' ||
      contentType === 'TILE_CONTENT_TYPE_PLAYLIST' ||
      contentType === 'TILE_CONTENT_TYPE_RADIO' ||
      contentType === 'TILE_CONTENT_TYPE_MIX' ||
      contentType === 'TILE_CONTENT_TYPE_POST' ||
      contentType === 'TILE_CONTENT_TYPE_GAME'
    ) {
      return null;
    }

    const onSelect = v.onSelectCommand || v.navigationEndpoint;
    const browseEndpoint = onSelect?.browseEndpoint;
    if (browseEndpoint) {
      const browseId = browseEndpoint.browseId || '';
      if (
        browseId.startsWith('VL') ||
        browseId.startsWith('PL') ||
        browseId.startsWith('RD') ||
        browseId.startsWith('UU') ||
        browseId.startsWith('LL') ||
        browseId.startsWith('FL') ||
        browseId.startsWith('OLAK') ||
        browseId.startsWith('UC') ||
        browseId.startsWith('@')
      ) {
        return null;
      }
      if (browseEndpoint.pageAnimation?.preloadPageConfig?.ghostState === 'GHOST_STATE_EPISODIC_SHOW_PAGE') {
        return null;
      }
      if (!onSelect.watchEndpoint) {
        return null;
      }
    }

    const videoId = onSelect?.watchEndpoint?.videoId ||
                    v.contentId;
    if (!videoId || typeof videoId !== 'string') return null;
    if (
      videoId.startsWith('VL') ||
      videoId.startsWith('PL') ||
      videoId.startsWith('RD') ||
      videoId.startsWith('UU') ||
      videoId.startsWith('LL') ||
      videoId.startsWith('FL') ||
      videoId.startsWith('OLAK') ||
      videoId.startsWith('UC') ||
      videoId.startsWith('@')
    ) {
      return null;
    }

    const meta = v.metadata?.tileMetadataRenderer;
    const header = v.header?.tileHeaderRenderer;

    const title = extractRunsText(meta?.title) || extractRunsText(header?.title) || '';

    // Channel title and view count in tile metadata lines
    const lines = meta?.lines || [];
    let channelTitle = '';
    let channelId = '';
    let views = '';
    let publishedTime = '';

    for (const line of lines) {
      const items = line?.lineRenderer?.items || [];
      for (const it of items) {
        const text = extractRunsText(it?.lineItemRenderer?.text);
        if (text) {
          const browseId = it?.lineItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          const isChannelEndpoint = Boolean(browseId) && (browseId.startsWith('UC') || browseId.startsWith('@'));
          if (isChannelEndpoint) {
            if (!channelTitle) channelTitle = text;
            if (!channelId) channelId = browseId;
            continue;
          }

          if (/view|watching/i.test(text)) {
            if (!views) views = text;
          } else if (/ago|streamed|premiered/i.test(text)) {
            if (!publishedTime) publishedTime = text;
          } else if (!channelTitle && !/^(new|cc|4k|hd|shorts)$/i.test(text.trim())) {
            channelTitle = text;
          }
        }
      }
    }

    // Duration from thumbnailOverlays
    let durationStr = null;
    let isShortOverlay = false;
    const overlays = header?.thumbnailOverlays || v.thumbnailOverlays || [];
    for (const ov of overlays) {
      if (ov?.thumbnailOverlayStackingEffectRenderer) {
        return null;
      }
      const timeText = extractRunsText(ov?.thumbnailOverlayTimeStatusRenderer?.text);
      const style = ov?.thumbnailOverlayTimeStatusRenderer?.style || '';
      if (timeText && (timeText.toLowerCase().includes('episode') || timeText.toLowerCase().includes('video'))) {
        return null;
      }
      if (style === 'SHORTS' || (timeText && timeText.toUpperCase() === 'SHORTS')) {
        isShortOverlay = true;
      }
      if (timeText && !durationStr && timeText.toUpperCase() !== 'SHORTS') {
        durationStr = timeText;
      }
    }

    const durationSec = parseDurationToSeconds(durationStr);
    const viewCount = parseViewCount(views);
    const thumbnails = header?.thumbnail?.thumbnails || v.thumbnail?.thumbnails || [];

    const hasShortsTag = /(?:^|\s)#shorts?(?:\s|$|[!?.,])/i.test(title);
    const isShort = isShortOverlay || hasShortsTag || (durationSec !== null && durationSec <= 60 && !durationStr);
    const { isWatched, percentWatched } = extractWatchedAnnotation(v, overlays);

    return {
      id: videoId,
      title,
      channelTitle,
      channelId: channelId || '',
      duration: durationStr,
      durationSeconds: durationSec,
      views,
      viewCount,
      publishedTime,
      thumbnails,
      channelThumbnail: '',
      isShort,
      badge: isWatched ? 'WATCHED' : (isShortOverlay ? 'SHORTS' : null),
      isWatched,
      percentDurationWatched: percentWatched,
      type: 'tileRenderer'
    };
  }

  const videoId = v.videoId;
  if (!videoId || typeof videoId !== 'string') return null;
  if (videoId.startsWith('UC') || videoId.startsWith('PL') || videoId.startsWith('@')) {
    return null;
  }

  const title = extractRunsText(v.title) ||
                extractRunsText(v.headline) || '';

  const channelTitle = extractRunsText(v.ownerText) ||
                       extractRunsText(v.shortBylineText) ||
                       extractRunsText(v.longBylineText) || '';

  const channelId = v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                    v.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                    v.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';

  const channelThumbnail = v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails?.[0]?.url ||
                           v.channelThumbnail?.thumbnails?.[0]?.url ||
                           v.avatar?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url ||
                           v.avatar?.avatarViewModel?.image?.sources?.[0]?.url ||
                           v.avatar?.image?.sources?.[0]?.url ||
                           v.avatar?.thumbnails?.[0]?.url ||
                           '';

  let durationStr = extractRunsText(v.lengthText) || null;
  let isShortOverlay = false;

  if (Array.isArray(v.thumbnailOverlays)) {
    for (const ov of v.thumbnailOverlays) {
      const timeText = extractRunsText(ov?.thumbnailOverlayTimeStatusRenderer?.text);
      const style = ov?.thumbnailOverlayTimeStatusRenderer?.style || '';
      if (style === 'SHORTS' || (timeText && timeText.toUpperCase() === 'SHORTS')) {
        isShortOverlay = true;
      }
      if (timeText && !durationStr && timeText.toUpperCase() !== 'SHORTS') {
        durationStr = timeText;
      }
    }
  }

  const durationSec = parseDurationToSeconds(durationStr);

  const views = extractRunsText(v.viewCountText) ||
                extractRunsText(v.shortViewCountText) || '';

  const viewCount = parseViewCount(views);

  const publishedTime = extractRunsText(v.publishedTimeText) || '';

  const thumbnails = v.thumbnail?.thumbnails || [];

  let isPromoted = Boolean(v.isPromoted);
  let badgeLabel = null;
  if (Array.isArray(v.badges)) {
    for (const b of v.badges) {
      const label = b?.metadataBadgeRenderer?.label || b?.metadataBadgeRenderer?.tooltip || '';
      if (/sponsored|promoted|^ad$/i.test(label)) {
        isPromoted = true;
        badgeLabel = label;
      } else if (!badgeLabel) {
        badgeLabel = label;
      }
    }
  }
  const isShortBadge = (badgeLabel || '').toUpperCase() === 'SHORTS';
  const hasShortsTag = /(?:^|\s)#shorts?(?:\s|$|[!?.,])/i.test(title);
  const hasReelEndpoint = Boolean(v.navigationEndpoint?.reelWatchEndpoint);
  const hasShortsUrl = Boolean(v.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/'));

  const isShort = isShortBadge || isShortOverlay || hasShortsTag || hasReelEndpoint || hasShortsUrl || (durationSec !== null && durationSec <= 60 && !v.lengthText);
  const { isWatched, percentWatched } = extractWatchedAnnotation(v, v.thumbnailOverlays);

  return {
    id: videoId,
    title,
    channelTitle,
    channelId,
    duration: durationStr,
    durationSeconds: durationSec,
    views,
    viewCount,
    publishedTime,
    thumbnails,
    channelThumbnail,
    isShort,
    badge: isPromoted ? 'Sponsored' : (isWatched ? 'WATCHED' : (isShortBadge || isShortOverlay ? 'SHORTS' : badgeLabel)),
    isPromoted,
    isWatched,
    percentDurationWatched: percentWatched,
    type: isContext ? 'videoWithContextRenderer' : 'videoRenderer'
  };
}

function extractTokenFromContinuations(continuations) {
  if (!Array.isArray(continuations)) return null;
  for (const c of continuations) {
    if (c.nextContinuationData?.continuation) return c.nextContinuationData.continuation;
    if (c.reloadContinuationData?.continuation) return c.reloadContinuationData.continuation;
  }
  return null;
}

export function parseBrowseResponse(data) {
  const videos = [];
  let continuationToken = null;

  if (!data) return { videos, continuationToken };

  let contents = null;

  // 0. InnerTube continuationContents (Standard continuation responses across TV, Web, and Mobile)
  if (data.continuationContents) {
    const cc = data.continuationContents;
    const slc = cc.sectionListContinuation;
    const rgc = cc.richGridContinuation;
    const gc = cc.gridContinuation;
    const isc = cc.itemSectionContinuation;
    const hlc = cc.horizontalListContinuation;

    if (slc) {
      contents = [];
      if (Array.isArray(slc.contents)) {
        for (const sec of slc.contents) {
          if (sec.shelfRenderer?.content?.horizontalListRenderer?.items) {
            contents.push(...sec.shelfRenderer.content.horizontalListRenderer.items);
          } else if (sec.shelfRenderer?.content?.gridRenderer?.items) {
            contents.push(...sec.shelfRenderer.content.gridRenderer.items);
          } else if (sec.shelfRenderer?.content?.expandedListRenderer?.items) {
            contents.push(...sec.shelfRenderer.content.expandedListRenderer.items);
          } else if (sec.itemSectionRenderer?.contents) {
            contents.push(...sec.itemSectionRenderer.contents);
          } else if (sec.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
            continuationToken = sec.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
          } else {
            contents.push(sec);
          }
        }
      }
      if (!continuationToken) continuationToken = extractTokenFromContinuations(slc.continuations);
    } else if (rgc) {
      contents = Array.isArray(rgc.contents) ? rgc.contents : [];
      if (!continuationToken) continuationToken = extractTokenFromContinuations(rgc.continuations);
    } else if (gc) {
      contents = Array.isArray(gc.items) ? gc.items : [];
      if (!continuationToken) continuationToken = extractTokenFromContinuations(gc.continuations);
    } else if (isc) {
      contents = Array.isArray(isc.contents) ? isc.contents : [];
      if (!continuationToken) continuationToken = extractTokenFromContinuations(isc.continuations);
    } else if (hlc) {
      contents = Array.isArray(hlc.items) ? hlc.items : [];
      if (!continuationToken) continuationToken = extractTokenFromContinuations(hlc.continuations);
    }
  }

  // 1. TV Browse Renderer (YouTube TV / TVHTML5)
  if (!contents && data.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const slr = data.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
    const sections = slr.contents;
    contents = [];
    for (const sec of sections) {
      if (sec.shelfRenderer?.content?.horizontalListRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.horizontalListRenderer.items);
      } else if (sec.shelfRenderer?.content?.gridRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.gridRenderer.items);
      } else if (sec.shelfRenderer?.content?.expandedListRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.expandedListRenderer.items);
      } else if (sec.itemSectionRenderer?.contents) {
        contents.push(...sec.itemSectionRenderer.contents);
      } else if (sec.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = sec.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      }
    }
    
    if (!continuationToken) continuationToken = extractTokenFromContinuations(slr.continuations);
  }

  // 2. Watch Next Results (Secondary Results - Related / Recommended Videos)
  if (!contents && data.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results) {
    contents = data.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results;
  }
  if (!contents && data.contents?.twoColumnWatchNextResults?.secondaryResults?.sectionListRenderer?.contents) {
    contents = data.contents.twoColumnWatchNextResults.secondaryResults.sectionListRenderer.contents;
  }

  // 3. Initial Browse (Desktop or Mobile)
  if (!contents) {
    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs ||
                 data.contents?.singleColumnBrowseResultsRenderer?.tabs;
    if (Array.isArray(tabs) && tabs[0]?.tabRenderer?.content?.richGridRenderer?.contents) {
      const richGrid = tabs[0].tabRenderer.content.richGridRenderer;
      contents = richGrid.contents;
      
      if (!continuationToken && richGrid.continuations) {
        for (const cont of richGrid.continuations) {
          if (cont.nextContinuationData?.continuation) {
            continuationToken = cont.nextContinuationData.continuation;
          }
        }
      }
    }
  }

  // 4. Continuation Actions, Commands, or Endpoints (Desktop, Watch Next, & MWEB)
  const actionList = data.onResponseReceivedActions ||
                     data.onResponseReceivedCommands ||
                     data.onResponseReceivedEndpoints;
  if (!contents && Array.isArray(actionList)) {
    for (const action of actionList) {
      if (action.appendContinuationItemsAction?.continuationItems) {
        const rawItems = action.appendContinuationItemsAction.continuationItems;
        contents = [];
        for (const raw of rawItems) {
          if (raw.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
            continuationToken = raw.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
          } else if (raw.itemSectionRenderer?.contents) {
            for (const sub of raw.itemSectionRenderer.contents) {
              if (sub.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
                continuationToken = sub.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
              } else if (sub.videoWithContextRenderer) {
                contents.push({ videoWithContextRenderer: sub.videoWithContextRenderer });
              } else if (sub.videoRenderer) {
                contents.push({ richItemRenderer: { content: { videoRenderer: sub.videoRenderer } } });
              } else if (sub.lockupViewModel) {
                contents.push({ lockupViewModel: sub.lockupViewModel });
              }
            }
          } else if (raw.shelfRenderer?.content?.horizontalListRenderer?.items) {
            contents.push(...raw.shelfRenderer.content.horizontalListRenderer.items);
          } else if (raw.shelfRenderer?.content?.gridRenderer?.items) {
            contents.push(...raw.shelfRenderer.content.gridRenderer.items);
          } else {
            contents.push(raw);
          }
        }
        break;
      }
    }
  }

  // 5. Fallback to direct richGridRenderer
  if (!contents && data.contents?.richGridRenderer?.contents) {
    contents = data.contents.richGridRenderer.contents;
  }

  // 6. TwoColumn Search Results
  if (!contents && data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents) {
    const sections = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
    contents = [];
    for (const sec of sections) {
      if (sec.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = sec.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      }
      if (sec.itemSectionRenderer?.contents) {
        for (const it of sec.itemSectionRenderer.contents) {
          if (it.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
            continuationToken = it.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
          }
          if (it.videoRenderer) {
            contents.push({ richItemRenderer: { content: { videoRenderer: it.videoRenderer } } });
          } else if (it.videoWithContextRenderer) {
            contents.push({ videoWithContextRenderer: it.videoWithContextRenderer });
          } else if (it.lockupViewModel) {
            contents.push({ lockupViewModel: it.lockupViewModel });
          }
        }
      } else if (sec.videoRenderer) {
        contents.push({ richItemRenderer: { content: { videoRenderer: sec.videoRenderer } } });
      } else if (sec.videoWithContextRenderer) {
        contents.push({ videoWithContextRenderer: sec.videoWithContextRenderer });
      } else if (sec.lockupViewModel) {
        contents.push({ lockupViewModel: sec.lockupViewModel });
      }
    }
  }

  // 7. SectionListRenderer (Search & Category Browse)
  if (!contents && data.contents?.sectionListRenderer?.contents) {
    const slr = data.contents.sectionListRenderer;
    const sections = slr.contents;
    contents = [];
    for (const sec of sections) {
      if (sec.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = sec.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      }
      if (sec.shelfRenderer?.content?.horizontalListRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.horizontalListRenderer.items);
      } else if (sec.shelfRenderer?.content?.gridRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.gridRenderer.items);
      } else if (sec.shelfRenderer?.content?.expandedListRenderer?.items) {
        contents.push(...sec.shelfRenderer.content.expandedListRenderer.items);
      }
      if (sec.itemSectionRenderer?.contents) {
        for (const it of sec.itemSectionRenderer.contents) {
          if (it.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
            continuationToken = it.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
          }
          if (it.videoWithContextRenderer) {
            contents.push({ videoWithContextRenderer: it.videoWithContextRenderer });
          } else if (it.videoRenderer) {
            contents.push({ richItemRenderer: { content: { videoRenderer: it.videoRenderer } } });
          } else if (it.lockupViewModel) {
            contents.push({ lockupViewModel: it.lockupViewModel });
          }
        }
      }
    }
    if (!continuationToken && slr.continuations) {
      continuationToken = extractTokenFromContinuations(slr.continuations);
    }
  }

  if (!Array.isArray(contents)) {
    return { videos, continuationToken };
  }

  // Process and normalize extracted items
  function processItem(item) {
    if (!item) return;

    // Drop non-video items (channels, playlists, radios) and ads immediately
    if (
      item.channelRenderer ||
      item.playlistRenderer ||
      item.radioRenderer ||
      item.gridChannelRenderer ||
      item.compactChannelRenderer ||
      item.gridPlaylistRenderer ||
      item.compactPlaylistRenderer ||
      item.gridShelfViewModel ||
      item.richItemRenderer?.content?.channelRenderer ||
      item.richItemRenderer?.content?.playlistRenderer ||
      item.richItemRenderer?.content?.radioRenderer ||
      item.adSlotRenderer ||
      item.inFeedAdRenderer ||
      item.promotedSparklesWebRenderer ||
      item.statementBannerRenderer ||
      item.displayAdRenderer ||
      item.promotedVideoRenderer ||
      item.brandVideoSingletonRenderer ||
      item.richItemRenderer?.content?.adSlotRenderer ||
      item.richItemRenderer?.content?.inFeedAdRenderer ||
      item.richItemRenderer?.content?.promotedSparklesWebRenderer ||
      item.richItemRenderer?.content?.statementBannerRenderer
    ) {
      return;
    }

    if (item.lockupViewModel) {
      const parsed = extractVideoFromLockup(item.lockupViewModel);
      if (parsed) videos.push(parsed);
      return;
    }

    if (item.richItemRenderer?.content?.lockupViewModel) {
      const parsed = extractVideoFromLockup(item.richItemRenderer.content.lockupViewModel);
      if (parsed) videos.push(parsed);
      return;
    }

    if (item.richItemRenderer?.content?.shortsLockupViewModel) {
      const sLockup = item.richItemRenderer.content.shortsLockupViewModel;
      const parsed = extractVideoFromLockup(sLockup);
      if (parsed) {
        parsed.isShort = true;
        videos.push(parsed);
      }
      return;
    }

    if (item.richItemRenderer?.content?.tileRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.richItemRenderer.content.tileRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.tileRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.tileRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.gridVideoRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.gridVideoRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.compactVideoRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.compactVideoRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.videoRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.videoRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.richItemRenderer?.content?.videoRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.richItemRenderer.content.videoRenderer, false);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.videoWithContextRenderer) {
      const parsedVideo = extractVideoFromRenderer(item.videoWithContextRenderer, true);
      if (parsedVideo) videos.push(parsedVideo);
      return;
    }

    if (item.richSectionRenderer?.content?.richShelfRenderer) {
      const shelf = item.richSectionRenderer.content.richShelfRenderer;
      const shelfTitle = (shelf.title?.runs?.[0]?.text || shelf.title?.simpleText || '').toLowerCase();
      const isShortsShelf = shelfTitle.includes('shorts') || shelf.isShorts;
      const shelfItems = shelf.contents || [];
      for (const sItem of shelfItems) {
        const reel = sItem.richItemRenderer?.content?.reelItemRenderer;
        if (reel) {
          videos.push({
            id: reel.videoId,
            title: reel.headline?.simpleText || reel.headline?.runs?.[0]?.text || '',
            channelTitle: '',
            channelId: '',
            duration: '0:30',
            durationSeconds: 30,
            views: reel.viewCountText?.simpleText || '',
            viewCount: parseViewCount(reel.viewCountText?.simpleText),
            publishedTime: '',
            thumbnails: reel.thumbnail?.thumbnails || [],
            isShort: true,
            type: 'reelItemRenderer'
          });
        } else if (sItem.richItemRenderer?.content?.shortsLockupViewModel) {
          const parsed = extractVideoFromLockup(sItem.richItemRenderer.content.shortsLockupViewModel);
          if (parsed) {
            parsed.isShort = true;
            videos.push(parsed);
          }
        } else if (isShortsShelf && sItem.richItemRenderer?.content?.videoRenderer) {
          const parsed = extractVideoFromRenderer(sItem.richItemRenderer.content.videoRenderer, false);
          if (parsed) {
            parsed.isShort = true;
            videos.push(parsed);
          }
        }
      }
      return;
    }

    if (item.reelShelfRenderer) {
      const shelfItems = item.reelShelfRenderer.items || [];
      for (const rItem of shelfItems) {
        if (rItem.reelItemRenderer) {
          const reel = rItem.reelItemRenderer;
          videos.push({
            id: reel.videoId,
            title: reel.headline?.simpleText || '',
            channelTitle: '',
            channelId: '',
            duration: '0:30',
            durationSeconds: 30,
            views: reel.viewCountText?.simpleText || '',
            viewCount: parseViewCount(reel.viewCountText?.simpleText),
            publishedTime: '',
            thumbnails: reel.thumbnail?.thumbnails || [],
            isShort: true,
            type: 'reelItemRenderer'
          });
        }
      }
      return;
    }

    if (item.itemSectionRenderer?.contents) {
      for (const sub of item.itemSectionRenderer.contents) {
        processItem(sub);
      }
      return;
    }

    if (item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      continuationToken = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    }
  }

  for (const item of contents) {
    processItem(item);
  }

  return { videos, continuationToken };
}
