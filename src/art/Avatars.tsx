/**
 * Circular avatar medallions — a tinted sky disc with a bold silhouette
 * subject, in the spirit of NPS roundel badges. viewBox 0 0 64 64.
 * Rendered inside a gold ring by PlayerSeat.
 */
import type { ComponentType } from "react";

function Disc({
  from,
  to,
  children,
  id,
}: {
  from: string;
  to: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="64" height="64" fill={`url(#${id})`} />
        {children}
      </g>
    </svg>
  );
}

export function MountainAvatar() {
  return (
    <Disc id="av-mtn" from="#9cc3d6" to="#dcebec">
      <polygon points="-4,52 18,22 34,46 46,26 68,52" fill="#3d5d6a" />
      <polygon points="46,26 56,40 36,40" fill="#eef4f4" />
      <polygon points="18,22 27,35 9,35" fill="#eef4f4" />
      <rect x="0" y="50" width="64" height="14" fill="#143329" />
    </Disc>
  );
}

export function GoatAvatar() {
  return (
    <Disc id="av-goat" from="#a7cad9" to="#e3eef0">
      <rect x="0" y="48" width="64" height="16" fill="#26473c" />
      <g fill="#f3f6f2">
        <path d="M22 46 q2 -16 16 -18 q12 -1 16 8 l2 12 l-6 2 l-2 -8 l-4 0 l-1 9 l-6 0 l-1 -9 q-9 1 -14 -2 l-2 8 l-6 -1 l3 -10 z" />
        <path d="M20 44 l-7 -3 q-3 -3 1 -6 l5 -1 l1 -7 l5 1 l-1 12 z" />
      </g>
      <path d="M14 36 q-4 -6 -1 -11 q3 4 4 10 z" fill="#cdd6d0" />
    </Disc>
  );
}

export function BisonAvatar() {
  return (
    <Disc id="av-bison" from="#e0a85a" to="#9a5a23">
      <rect x="0" y="46" width="64" height="18" fill="#3a2410" />
      <g fill="#1c1206">
        <path d="M16 44 q4 -16 22 -18 l4 -8 l5 1 l-1 8 q11 1 16 11 q7 2 12 -1 l2 4 q-5 6 -14 4 l1 10 l-6 0 l-1 -9 l-30 0 l-1 9 l-6 0 l0 -10 q-6 -3 -8 -8 z" />
      </g>
      <path d="M14 44 q-8 2 -12 9 l-2 -1 q3 -10 13 -13 z" fill="#1c1206" />
    </Disc>
  );
}

export function RangerAvatar() {
  return (
    <Disc id="av-ranger" from="#3a4a52" to="#0e231e">
      <circle cx="32" cy="58" r="22" fill="#173f35" />
      <circle cx="32" cy="34" r="12" fill="#caa46b" />
      {/* ranger hat */}
      <ellipse cx="32" cy="24" rx="22" ry="5" fill="#5a3d1d" />
      <path d="M21 24 q1 -14 11 -15 q10 1 11 15 z" fill="#6b4a25" />
      <ellipse cx="32" cy="20" rx="11" ry="3" fill="#4f3518" />
    </Disc>
  );
}

export function GeyserAvatar() {
  return (
    <Disc id="av-geyser" from="#86a1b0" to="#e6b266">
      <path d="M0 44 Q 20 34 40 42 T 64 40 L 64 64 L 0 64 Z" fill="#a9742f" />
      <g fill="#f3f1e7">
        <path d="M28 56 q-6 -22 2 -38 q-4 -14 4 -24 q4 10 2 22 q6 18 -2 40 z" />
        <ellipse cx="33" cy="10" rx="7" ry="9" />
        <ellipse cx="27" cy="30" rx="8" ry="7" />
      </g>
      <ellipse cx="26" cy="58" rx="22" ry="6" fill="#2a9db0" />
    </Disc>
  );
}

export function MooseAvatar() {
  return (
    <Disc id="av-moose" from="#caa15a" to="#7a4a1e">
      <rect x="0" y="46" width="64" height="18" fill="#2f3a1e" />
      <g fill="#1c1206">
        {/* antlers */}
        <path d="M24 18 q-12 -4 -16 -14 q10 4 14 2 q-6 -6 -4 -12 q6 8 10 10 z" />
        <path d="M40 18 q12 -4 16 -14 q-10 4 -14 2 q6 -6 4 -12 q-6 8 -10 10 z" />
        {/* head + body */}
        <path d="M26 20 q6 -6 12 0 l3 10 q10 2 13 14 l1 12 l-7 0 l-2 -12 l-22 0 l-2 12 l-7 0 l1 -14 q3 -12 13 -14 z" />
        <path d="M27 30 q-5 4 -4 11 l5 0 z" />
      </g>
    </Disc>
  );
}

export const AVATAR_ART: Record<string, ComponentType> = {
  mountain: MountainAvatar,
  goat: GoatAvatar,
  bison: BisonAvatar,
  ranger: RangerAvatar,
  geyser: GeyserAvatar,
  moose: MooseAvatar,
};
