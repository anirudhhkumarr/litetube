import React, { useState, useRef } from 'react';
import TubelightIcon from './TubelightIcon.jsx';

export default function Navbar({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  onOpenAccount,
  onSignIn,
  hasSession,
  onLogoClick,
  loading = false
}) {
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const inputRef = useRef(null);

  const handleClear = () => {
    if (onClearSearch) {
      onClearSearch();
    } else {
      onSearchChange('');
    }
  };

  const handleBrandClick = () => {
    if (onLogoClick) {
      onLogoClick();
    } else {
      window.location.reload();
    }
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    inputRef.current?.blur(); // Immediately dismiss virtual keyboard on mobile
    if (onSearchSubmit) {
      onSearchSubmit(e);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  const handleCollapseSearch = () => {
    setIsSearchExpanded(false);
    inputRef.current?.blur();
  };

  return (
    <header className={`navbar ${isSearchExpanded ? 'search-expanded' : ''}`}>
      <div className="brand" onClick={handleBrandClick} title="TubeLite Home" style={{ cursor: 'pointer' }}>
        <div className="brand-tubelight-icon">
          <TubelightIcon size={32} />
        </div>
        <span className="brand-name">Tube<span className="brand-lite">Lite</span></span>
      </div>

      <form className="search-container" onSubmit={handleSubmit}>
        <div className="search-input-wrap">
          {isSearchExpanded && (
            <button
              type="button"
              className="search-back-btn"
              onClick={handleCollapseSearch}
              title="Back"
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
            </button>
          )}
          <svg className="search-icon" viewBox="0 0 24 24">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search TubeLite"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsSearchExpanded(true)}
            onKeyDown={handleKeyDown}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear visible"
              onClick={handleClear}
              title="Clear search"
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            className="search-submit-btn"
            title="Search"
            disabled={loading}
          >
            {loading ? (
              <span className="search-btn-spinner" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            )}
          </button>
        </div>
      </form>

      <div className="nav-actions">
        {hasSession ? (
          <button
            type="button"
            className="nav-avatar-btn"
            onClick={onOpenAccount}
            title="Account"
            aria-label="Account"
          >
            <span className="avatar-circle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="nav-btn primary"
            onClick={onSignIn}
            title="Sign in"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
