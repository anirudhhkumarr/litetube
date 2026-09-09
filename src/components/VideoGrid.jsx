import React from 'react';
import VideoCard from './VideoCard.jsx';

export default function VideoGrid({
  videos,
  loading,
  onPlay,
  hasMore = false,
  onLoadMore = null,
  isLoadingMore = false,
  loadMoreError = null,
  feedError = null,
  onRetryFeed = null,
  isGuestHome = false,
  onSignIn = null
}) {
  if (loading) {
    return (
      <div className="video-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="video-card">
            <div className="thumbnail-wrap skeleton" style={{ aspectRatio: '16/9' }} />
            <div className="video-details">
              <div className="channel-avatar skeleton" />
              <div className="meta-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="skeleton" style={{ height: 16, width: '90%' }} />
                <div className="skeleton" style={{ height: 12, width: '60%' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (videos.length === 0) {

    if (feedError) {
      return (
        <div className="empty-state error-state">
          <p className="error-title">Unable to load videos</p>
          <p className="error-desc">{feedError}</p>
          {onRetryFeed && (
            <button
              type="button"
              className="load-more-btn"
              onClick={onRetryFeed}
              style={{ marginTop: 8 }}
            >
              Retry
            </button>
          )}
        </div>
      );
    }

    if (isGuestHome) {
      return (
        <div className="empty-state guest-home-state">
          <div className="sign-in-prompt-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="error-title" style={{ fontSize: '19px' }}>Try searching to get started</p>
          <p className="error-desc" style={{ marginBottom: 16 }}>
            Search above to find videos, or sign in to see your recommendations and subscriptions.
          </p>
          {onSignIn && (
            <button
              type="button"
              className="load-more-btn"
              onClick={onSignIn}
              style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 600 }}
            >
              Sign In
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="empty-state">
        <p className="error-title">No videos found</p>
        <p className="error-desc">Try searching with different keywords or check back later.</p>
      </div>
    );
  }

  return (
    <div className="video-grid">
      {videos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          onPlay={onPlay}
        />
      ))}

      {(hasMore || loadMoreError) && onLoadMore && (
        <div className="pagination-wrap">
          {loadMoreError && (
            <div className="load-more-error" style={{ color: 'var(--red-500)', marginBottom: '12px', fontSize: '0.9rem', textAlign: 'center', width: '100%' }}>
              {loadMoreError}
            </div>
          )}
          <button
            type="button"
            className="load-more-btn"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <span className="btn-spinner" />
                <span>Loading more videos...</span>
              </>
            ) : (
              loadMoreError ? 'Retry Load More' : 'Load More Videos'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
