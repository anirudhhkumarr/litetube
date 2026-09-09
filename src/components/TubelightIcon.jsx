import React from 'react';

/**
 * Modern, sophisticated, minimalist Tubelight logo icon.
 * Clean architectural geometry: sleek horizontal luminescent cylinder,
 * precision micro-beveled end caps, and an ethereal ambient neon bloom.
 */
export default function TubelightIcon({ size = 28, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="TubeLite Logo"
    >
      <defs>
        {/* Soft, sophisticated ambient glow */}
        <filter id="tl-sophisticated-glow" x="-25%" y="-50%" width="150%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Minimalist phosphor glass gradient */}
        <linearGradient id="tl-glass-lumen" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0284c7" stopOpacity="0.75" />
          <stop offset="18%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="82%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.75" />
        </linearGradient>

        {/* Clean titanium end caps */}
        <linearGradient id="tl-cap-metallic" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
      </defs>

      {/* Atmospheric diffused aura */}
      <rect
        x="5"
        y="12.5"
        width="22"
        height="7"
        rx="3.5"
        fill="#38bdf8"
        opacity="0.28"
        filter="url(#tl-sophisticated-glow)"
      />

      {/* Precision Left Connector Pin & End Cap */}
      <line x1="2.5" y1="16" x2="4.5" y2="16" stroke="#94a3b8" strokeWidth="1.25" strokeLinecap="round" />
      <rect x="4.5" y="13.25" width="2" height="5.5" rx="0.75" fill="url(#tl-cap-metallic)" />

      {/* Precision Right Connector Pin & End Cap */}
      <rect x="25.5" y="13.25" width="2" height="5.5" rx="0.75" fill="url(#tl-cap-metallic)" />
      <line x1="27.5" y1="16" x2="29.5" y2="16" stroke="#94a3b8" strokeWidth="1.25" strokeLinecap="round" />

      {/* Main Luminescent Tube Body */}
      <rect
        x="6"
        y="13"
        width="20"
        height="6"
        rx="3"
        fill="url(#tl-glass-lumen)"
        stroke="#7dd3fc"
        strokeWidth="0.5"
        filter="url(#tl-sophisticated-glow)"
      />

      {/* Minimalist central phosphor filament beam */}
      <line
        x1="8.5"
        y1="16"
        x2="23.5"
        y2="16"
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Delicate top specular glaze */}
      <line
        x1="8"
        y1="14"
        x2="24"
        y2="14"
        stroke="#ffffff"
        strokeWidth="0.6"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
