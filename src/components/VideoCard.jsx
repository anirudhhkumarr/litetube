import React, { useState } from 'react';

export default function VideoCard({ video, onPlay }) {
  const [imgError, setImgError] = useState(false);
  const thumbnail = video.thumbnails && video.thumbnails.length > 0
    ? video.thumbnails[video.thumbnails.length - 1].url
    : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  return (
    <article className="video-card" onClick={() => onPlay(video)}>
      <div className="thumbnail-wrap">
        <img
          src={thumbnail}
          alt={video.title}
          className="thumbnail-img"
          loading="lazy"
        />
        <div className="card-play-overlay">
          <div className="play-glyph-circle">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {video.duration && (
          <span className="duration-badge">{video.duration}</span>
        )}
      </div>

      <div className="video-details">
        <div className="channel-avatar">
          {video.channelThumbnail && !imgError ? (
            <img
              src={video.channelThumbnail}
              alt={video.channelTitle}
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            (video.channelTitle || 'Y')[0].toUpperCase()
          )}
        </div>
        <div className="meta-wrap">
          <h3 className="video-title" title={video.title}>
            {video.title}
          </h3>
          <div className="channel-title">
            <span>{video.channelTitle}</span>
          </div>
          <div className="video-stats">
            {video.views && <span>{video.views}</span>}
            {video.views && video.publishedTime && <span> • </span>}
            {video.publishedTime && <span>{video.publishedTime}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}
