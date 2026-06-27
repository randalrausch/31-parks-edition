/**
 * Compact poster emblems — distilled versions of the park scenes for card backs
 * and Park-Picker thumbnails. Same WPA depth cues (graded sky, two-tone peaks,
 * snow/steam, layered pines) at small scale. viewBox 0 0 120 168 (card aspect).
 */

export function GlacierEmblem({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 168"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gle-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d6f9e" />
          <stop offset="60%" stopColor="#86b0cd" />
          <stop offset="100%" stopColor="#cfe2ea" />
        </linearGradient>
        <linearGradient id="gle-lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a99a3" />
          <stop offset="100%" stopColor="#184e58" />
        </linearGradient>
      </defs>
      <rect width="120" height="168" fill="#10302a" />
      <rect x="8" y="8" width="104" height="152" fill="url(#gle-sky)" />
      <circle cx="34" cy="36" r="11" fill="#fbf6e2" opacity="0.85" />
      {/* far range */}
      <polygon
        points="8,82 30,52 52,80 74,48 96,78 112,64 112,96 8,96"
        fill="#9fb8c9"
      />
      {/* hero peak two-tone + snow */}
      <polygon points="34,96 66,40 98,96" fill="#5f8199" />
      <polygon points="66,40 98,96 66,96" fill="#456279" />
      <polygon points="66,40 78,62 54,62" fill="#eef5f7" />
      {/* lake */}
      <rect x="8" y="96" width="104" height="22" fill="url(#gle-lake)" />
      <rect x="22" y="104" width="40" height="2" fill="#bfe6e8" opacity="0.5" />
      {/* forest */}
      <g fill="#143329">
        <polygon points="8,120 26,96 44,120" />
        <polygon points="40,120 60,92 80,120" />
        <polygon points="74,120 94,98 114,120" />
      </g>
      <rect x="8" y="116" width="104" height="44" fill="#0d2620" />
      <g fill="#0a1c17">
        <polygon points="8,160 8,118 22,134 34,118 46,160" />
        <polygon points="86,160 96,124 108,140 112,122 112,160" />
      </g>
    </svg>
  );
}

/**
 * Generic poster emblem for parks without a bespoke scene yet (the "coming
 * soon" picker slots). Driven by colors so any future park gets a presentable
 * thumbnail from its palette alone.
 */
export function makePosterEmblem(colors: {
  skyTop: string;
  skyBottom: string;
  land: string;
  peak: string;
  id: string;
}) {
  return function PosterEmblem({ className }: { className?: string }) {
    return (
      <svg
        className={className}
        viewBox="0 0 120 168"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`pe-${colors.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.skyTop} />
            <stop offset="100%" stopColor={colors.skyBottom} />
          </linearGradient>
        </defs>
        <rect width="120" height="168" fill={colors.land} />
        <rect
          x="8"
          y="8"
          width="104"
          height="152"
          fill={`url(#pe-${colors.id})`}
        />
        <circle cx="86" cy="40" r="12" fill="#f4e3b2" opacity="0.5" />
        <polygon
          points="8,96 38,44 64,90 86,52 112,92 112,120 8,120"
          fill={colors.peak}
        />
        <polygon points="86,52 98,74 74,74" fill="#f4e3b2" opacity="0.85" />
        <g fill={colors.land}>
          <polygon points="8,124 28,96 48,124" />
          <polygon points="44,124 66,92 88,124" />
          <polygon points="80,124 102,98 124,124" />
        </g>
        <rect x="8" y="120" width="104" height="40" fill={colors.land} />
      </svg>
    );
  };
}

export function YellowstoneEmblem({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 168"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="yse-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#557496" />
          <stop offset="50%" stopColor="#c98f4a" />
          <stop offset="100%" stopColor="#e6b266" />
        </linearGradient>
        <radialGradient id="yse-pool" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7fcdd6" />
          <stop offset="45%" stopColor="#2a9db0" />
          <stop offset="72%" stopColor="#7f9a3c" />
          <stop offset="100%" stopColor="#b5651d" />
        </radialGradient>
      </defs>
      <rect width="120" height="168" fill="#1c1206" />
      <rect x="8" y="8" width="104" height="152" fill="url(#yse-sky)" />
      <circle cx="86" cy="42" r="15" fill="#fdeec3" opacity="0.9" />
      {/* hills */}
      <path
        d="M8 92 Q 40 76 70 90 T 112 88 L 112 110 L 8 110 Z"
        fill="#a9742f"
      />
      {/* geyser plume */}
      <g fill="#f3f1e7">
        <path d="M52 110 q-8 -36 2 -64 q-6 -24 6 -42 q6 16 4 38 q8 28 -2 68 z" />
        <ellipse cx="58" cy="20" rx="11" ry="14" />
        <ellipse cx="50" cy="54" rx="13" ry="12" />
        <ellipse cx="60" cy="80" rx="11" ry="10" />
      </g>
      {/* thermal pool */}
      <ellipse cx="46" cy="134" rx="48" ry="19" fill="#d8c08a" />
      <ellipse cx="46" cy="133" rx="40" ry="15" fill="url(#yse-pool)" />
      <rect x="8" y="144" width="104" height="16" fill="#160f06" />
      <g fill="#0d1207">
        <polygon points="8,160 8,120 22,136 32,120 44,160" />
        <polygon points="92,160 100,128 110,142 112,124 112,160" />
      </g>
    </svg>
  );
}
