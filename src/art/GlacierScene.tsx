/**
 * Glacier National Park — original WPA-poster scene.
 * Built for depth: a graded alpine sky, three haze-separated mountain ranges
 * with two-tone light/shadow faces and snowfields, a reflecting glacial lake,
 * layered pine forest, a framing foreground of dark pines, and a mountain goat
 * on a rocky bluff. Vector-only; recolors cleanly.
 */
export default function GlacierScene({ className }: { className?: string }) {
  // A row of pine silhouettes between x0..x1 along baseline y, count trees.
  const pines = (
    x0: number,
    x1: number,
    y: number,
    h: number,
    count: number,
    fill: string,
    key: string,
  ) => {
    const step = (x1 - x0) / count;
    return Array.from({ length: count }).map((_, i) => {
      const x = x0 + i * step + (i % 2) * step * 0.3;
      const w = step * (0.7 + (i % 3) * 0.12);
      const hh = h * (0.8 + ((i * 7) % 5) * 0.06);
      return (
        <polygon
          key={`${key}-${i}`}
          points={`${x},${y} ${x + w / 2},${y - hh} ${x + w},${y}`}
          fill={fill}
        />
      );
    });
  };

  return (
    <svg
      className={className}
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gl-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d6f9e" />
          <stop offset="42%" stopColor="#74a3c4" />
          <stop offset="78%" stopColor="#b7d4e2" />
          <stop offset="100%" stopColor="#dcebef" />
        </linearGradient>
        <linearGradient id="gl-lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fc0c6" />
          <stop offset="18%" stopColor="#3a99a3" />
          <stop offset="100%" stopColor="#184e58" />
        </linearGradient>
        <linearGradient id="gl-hero-lit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6f93ab" />
          <stop offset="100%" stopColor="#54748d" />
        </linearGradient>
        <linearGradient id="gl-hero-shad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#46647c" />
          <stop offset="100%" stopColor="#37526a" />
        </linearGradient>
        <radialGradient id="gl-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbf6e2" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#eaf2ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#eaf2ee" stopOpacity="0" />
        </radialGradient>
        <filter id="gl-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Sky */}
      <rect x="0" y="0" width="1200" height="520" fill="url(#gl-sky)" />
      <circle cx="270" cy="150" r="180" fill="url(#gl-sun)" />
      <circle cx="270" cy="150" r="46" fill="#fbf6e2" opacity="0.85" filter="url(#gl-soft)" />

      {/* Clouds — flat WPA bands with soft underside */}
      <g filter="url(#gl-soft)">
        <g fill="#f4f8f6">
          <ellipse cx="560" cy="96" rx="120" ry="22" />
          <ellipse cx="650" cy="84" rx="78" ry="18" />
          <ellipse cx="470" cy="106" rx="66" ry="15" />
          <ellipse cx="950" cy="150" rx="130" ry="24" />
          <ellipse cx="1050" cy="138" rx="72" ry="17" />
        </g>
        <g fill="#cfe0e2" opacity="0.55">
          <ellipse cx="560" cy="106" rx="120" ry="9" />
          <ellipse cx="950" cy="160" rx="130" ry="10" />
        </g>
      </g>

      {/* Far range — hazy, nearly merging with sky */}
      <polygon
        points="0,330 120,232 250,308 360,228 470,300 600,236 720,312 840,240 980,308 1100,250 1200,318 1200,430 0,430"
        fill="#a7c1d0"
      />
      <rect
        x="0"
        y="300"
        width="1200"
        height="150"
        fill="#cfe2ea"
        opacity="0.45"
        filter="url(#gl-soft)"
      />

      {/* Mid range — two-tone faces + snow caps */}
      <g>
        <polygon points="0,392 170,250 330,392" fill="#7397ad" />
        <polygon points="170,250 330,392 250,392" fill="#5c7d93" />
        <polygon points="300,392 470,236 640,392" fill="#7397ad" />
        <polygon points="470,236 640,392 545,392" fill="#5c7d93" />
        <polygon points="600,392 770,255 940,392" fill="#7397ad" />
        <polygon points="770,255 940,392 850,392" fill="#5c7d93" />
        <polygon points="880,392 1040,250 1200,392 1200,392" fill="#7397ad" />
        <polygon points="1040,250 1200,392 1110,392" fill="#5c7d93" />
        {/* snow caps with shadow side */}
        <g>
          <polygon points="170,250 200,300 140,300" fill="#eef5f7" />
          <polygon points="170,250 200,300 185,300" fill="#bcd3de" />
          <polygon points="470,236 504,294 436,294" fill="#eef5f7" />
          <polygon points="470,236 504,294 487,294" fill="#bcd3de" />
          <polygon points="770,255 800,305 740,305" fill="#eef5f7" />
          <polygon points="770,255 800,305 785,305" fill="#bcd3de" />
          <polygon points="1040,250 1070,300 1010,300" fill="#eef5f7" />
          <polygon points="1040,250 1070,300 1055,300" fill="#bcd3de" />
        </g>
      </g>

      {/* Hero massif — dominant peak, lit + shadow faces, snowfields, crevasses */}
      <polygon points="360,470 660,168 960,470" fill="url(#gl-hero-lit)" />
      <polygon points="660,168 960,470 660,470" fill="url(#gl-hero-shad)" />
      {/* summit snowfield */}
      <polygon points="660,168 712,260 608,260" fill="#eef5f7" />
      <polygon points="660,168 712,260 660,260" fill="#c7d9e2" />
      {/* snow streaks down the faces */}
      <g fill="#e3eef1" opacity="0.9">
        <polygon points="600,290 628,290 614,430 590,392" />
        <polygon points="688,290 714,294 704,440 680,392" />
      </g>
      {/* ridge/crevasse lines */}
      <g stroke="#3a566c" strokeWidth="2.5" opacity="0.5" fill="none">
        <path d="M660 200 L640 320 L612 470" />
        <path d="M660 200 L690 330 L716 470" />
      </g>

      {/* base haze separating mountains from lake */}
      <rect
        x="0"
        y="430"
        width="1200"
        height="60"
        fill="#dcebef"
        opacity="0.5"
        filter="url(#gl-soft)"
      />

      {/* Glacial lake with reflection */}
      <rect x="0" y="452" width="1200" height="120" fill="url(#gl-lake)" />
      {/* soft inverted reflection of the hero peak */}
      <polygon points="360,452 660,560 960,452" fill="#2f6f78" opacity="0.35" />
      <g fill="#bfe6e8" opacity="0.4">
        <rect x="120" y="486" width="360" height="4" />
        <rect x="540" y="500" width="440" height="4" />
        <rect x="240" y="520" width="300" height="3" />
        <rect x="760" y="472" width="240" height="3" />
      </g>

      {/* Far shore treeline */}
      <g>{pines(-10, 1210, 458, 36, 30, "#1c4a3e", "far")}</g>

      {/* Mid + near forest bands */}
      <rect x="0" y="540" width="1200" height="260" fill="#143329" />
      <g>{pines(-20, 1220, 560, 92, 16, "#0e231e", "mid")}</g>
      <g>{pines(-10, 1220, 596, 70, 20, "#1a3f33", "near")}</g>

      {/* Foreground rocky bluff + mountain goat (right) */}
      <path d="M820,800 L820,628 Q900,600 1000,612 Q1110,628 1200,604 L1200,800 Z" fill="#22302c" />
      <path d="M820,648 Q900,624 1000,632 Q1110,646 1200,628 L1200,800 L820,800 Z" fill="#16231f" />
      {/* goat */}
      <g transform="translate(966,572)">
        <path
          d="M0,28 q4,-22 26,-25 q16,-2 24,8 l6,16 l-8,4 l-4,-10 l-7,1 l-1,12 l-8,0 l-1,-12 q-13,1 -22,-3 l-3,12 l-8,-1 l4,-16 z"
          fill="#eef3f3"
        />
        <path d="M0,28 q-4,-16 6,-24 q10,2 18,4 l-2,8 q-12,-2 -18,2 z" fill="#cfdcdd" />
        {/* legs */}
        <g fill="#dfe9ea">
          <rect x="10" y="30" width="4" height="14" />
          <rect x="22" y="31" width="4" height="13" />
          <rect x="40" y="30" width="4" height="14" />
          <rect x="52" y="29" width="4" height="14" />
        </g>
        {/* head + horns */}
        <path d="M-4,8 l-12,-3 q-5,-3 -1,-8 l9,-1 l2,-9 l7,1 l-1,17 z" fill="#eef3f3" />
        <path d="M-13,-2 q-6,-9 -2,-17 q4,6 5,15 z" fill="#5a4a3a" />
        <path d="M-7,-3 q-3,-9 1,-16 q3,6 3,14 z" fill="#6b5a48" />
      </g>

      {/* Framing foreground pines (depth) */}
      <g fill="#0a1c17">
        <polygon points="-30,800 -30,470 40,540 70,470 120,560 150,800" />
        <polygon points="30,800 70,500 110,560 130,520 160,800" />
        <polygon points="1130,800 1110,520 1160,560 1180,500 1240,540 1240,800" />
        <polygon points="1060,800 1090,560 1120,610 1150,800" />
      </g>
    </svg>
  );
}
