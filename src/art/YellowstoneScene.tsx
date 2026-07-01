/**
 * Yellowstone National Park — original WPA-poster scene.
 * Golden-hour graded sky with a glowing sun, a volumetric erupting geyser,
 * a Grand-Prismatic-style thermal pool with a mineral rim and steam, two-tone
 * rolling hills, lodgepole pines, a bison on a rise, and framing foreground.
 */
export default function YellowstoneScene({ className }: { className?: string }) {
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
      const w = step * (0.66 + (i % 3) * 0.12);
      const hh = h * (0.8 + ((i * 5) % 5) * 0.06);
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
        <linearGradient id="ys-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f6f93" />
          <stop offset="34%" stopColor="#b07f48" />
          <stop offset="64%" stopColor="#dca857" />
          <stop offset="100%" stopColor="#eccb83" />
        </linearGradient>
        <radialGradient id="ys-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fdeec3" stopOpacity="1" />
          <stop offset="48%" stopColor="#f6d489" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#f6d489" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ys-steam" x1="0" y1="1" x2="0.3" y2="0">
          <stop offset="0%" stopColor="#fbf8ef" />
          <stop offset="100%" stopColor="#d9dccf" />
        </linearGradient>
        <radialGradient id="ys-pool" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9fdde2" />
          <stop offset="34%" stopColor="#2a9db0" />
          <stop offset="58%" stopColor="#5f9a52" />
          <stop offset="78%" stopColor="#cf9a2c" />
          <stop offset="100%" stopColor="#b5651d" />
        </radialGradient>
        <filter id="ys-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Sky */}
      <rect x="0" y="0" width="1200" height="540" fill="url(#ys-sky)" />
      <circle cx="880" cy="200" r="230" fill="url(#ys-sun)" />
      <circle cx="880" cy="200" r="60" fill="#fdeec3" opacity="0.9" filter="url(#ys-soft)" />

      {/* Warm clouds */}
      <g filter="url(#ys-soft)" fill="#f0ddb8" opacity="0.8">
        <ellipse cx="250" cy="120" rx="140" ry="22" />
        <ellipse cx="340" cy="104" rx="84" ry="17" />
        <ellipse cx="560" cy="158" rx="110" ry="18" />
      </g>

      {/* Far hills (hazy) */}
      <path d="M0 340 Q 200 296 430 330 T 850 320 T 1200 338 L 1200 470 L 0 470 Z" fill="#c79a52" />
      <rect
        x="0"
        y="320"
        width="1200"
        height="150"
        fill="#e6c884"
        opacity="0.4"
        filter="url(#ys-soft)"
      />

      {/* Mid hills — two-tone */}
      <path
        d="M0 400 Q 280 336 560 384 T 1060 372 T 1200 400 L 1200 500 L 0 500 Z"
        fill="#a9742f"
      />
      <path d="M0 430 Q 300 392 620 424 T 1200 420 L 1200 500 L 0 500 Z" fill="#8a5a22" />
      {/* ridge pines on the mid hill */}
      <g>{pines(0, 1200, 412, 26, 40, "#3a3f1c", "ridge")}</g>

      {/* Geyser plume — volumetric billows rising from the terrace */}
      <g>
        <path
          d="M735 470 q-34 -96 -8 -188 q-22 -84 14 -160 q20 -48 8 -92 q26 44 16 100 q28 70 6 160 q24 92 -6 182 q16 64 -12 102 q-32 -38 -16 -104 z"
          fill="url(#ys-steam)"
        />
        <g fill="#f7f4ec" filter="url(#ys-soft)">
          <ellipse cx="746" cy="70" rx="38" ry="50" />
          <ellipse cx="722" cy="150" rx="54" ry="44" />
          <ellipse cx="772" cy="214" rx="46" ry="38" />
          <ellipse cx="716" cy="286" rx="50" ry="40" />
          <ellipse cx="760" cy="360" rx="44" ry="34" />
        </g>
        <g fill="#d6d8ca" opacity="0.55" filter="url(#ys-soft)">
          <ellipse cx="764" cy="160" rx="26" ry="30" />
          <ellipse cx="744" cy="300" rx="26" ry="26" />
        </g>
        <g fill="#ffffff" opacity="0.5" filter="url(#ys-soft)">
          <ellipse cx="734" cy="92" rx="18" ry="24" />
          <ellipse cx="706" cy="168" rx="20" ry="18" />
        </g>
      </g>

      {/* Lodgepole pine ridge behind the pool */}
      <rect x="0" y="452" width="1200" height="66" fill="#2a3a1c" />
      <g>{pines(-10, 1210, 458, 40, 32, "#1d2a14", "back")}</g>

      {/* Grand-Prismatic thermal pool with mineral rim + steam */}
      <g>
        <ellipse cx="470" cy="612" rx="452" ry="158" fill="#d8c08a" />
        <ellipse cx="470" cy="610" rx="412" ry="138" fill="url(#ys-pool)" />
        <ellipse cx="470" cy="606" rx="150" ry="46" fill="#7fcdd6" opacity="0.7" />
        <g fill="#f3f1e4" opacity="0.3" filter="url(#ys-soft)">
          <ellipse cx="330" cy="556" rx="80" ry="16" />
          <ellipse cx="580" cy="560" rx="92" ry="17" />
        </g>
      </g>

      {/* Foreground terrace */}
      <path d="M0 700 Q 280 648 470 666 Q 720 692 1200 652 L 1200 800 L 0 800 Z" fill="#2a1c0e" />
      <path d="M0 738 Q 360 712 760 730 T 1200 724 L 1200 800 L 0 800 Z" fill="#160f06" />

      {/* Bison on the right rise */}
      <g transform="translate(980,628)" fill="#1c1206">
        <path d="M0,30 q10,-30 46,-34 l10,-18 l11,2 l-2,16 q42,0 70,24 q18,4 31,-2 l6,10 q-12,12 -35,10 l2,28 l-15,0 l-3,-22 l-92,0 l-2,22 l-15,0 l0,-26 q-15,-6 -19,-18 z" />
        <path d="M-6,30 q-22,4 -36,24 l-4,-2 q5,-24 28,-34 z" />
      </g>
      <g transform="translate(980,628)" fill="#2c1d10" opacity="0.7">
        <path d="M44,-4 q14,2 26,12 l-4,8 q-12,-10 -24,-12 z" />
      </g>

      {/* Framing foreground pines */}
      <g fill="#0d1207">
        <polygon points="-30,800 -30,470 50,540 80,470 130,560 160,800" />
        <polygon points="40,800 80,500 120,560 145,520 175,800" />
        <polygon points="1120,800 1100,510 1150,560 1175,495 1240,540 1240,800" />
        <polygon points="1050,800 1085,556 1115,606 1145,800" />
      </g>
    </svg>
  );
}
