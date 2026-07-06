/**
 * icons.tsx — a small inline-SVG icon set (Lucide-style, 24×24, currentColor).
 *
 * Replaces emoji/text glyphs for a crisp, professional look. All icons inherit
 * `color` via stroke="currentColor" and scale with font-size / width props.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}><polygon points="6 4 20 12 6 20 6 4" /></svg>
);

export const SeasonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3v18" />
    <path d="M5 4h11l-2 3 2 3H5" />
  </svg>
);

export const BotIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="2" />
    <path d="M12 8V4M9 4h6" />
    <circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" />
    <path d="M2 13v2M22 13v2" />
  </svg>
);

export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </svg>
);

export const GlobeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z" />
  </svg>
);

export const CartIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" />
    <path d="M2 3h3l2.4 12.3a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
  </svg>
);

export const BookIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
    <path d="M19 19H6a2 2 0 0 0-2 2" />
  </svg>
);

export const UsersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 5.2A3.2 3.2 0 0 1 16 11M21 20c0-2.6-1.7-4.9-4-5.7" />
  </svg>
);

export const VolumeOnIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" />
  </svg>
);

export const VolumeOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M22 9l-5 6M17 9l5 6" />
  </svg>
);

export const HelpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.3-2.6 4" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" /><circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const TrophyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
    <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    <path d="M12 14v3M9 21h6M9.5 17h5" />
  </svg>
);

/** Winner's-podium bars (2nd · 1st · 3rd) — the Leaderboard glyph. */
export const RankingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="12" width="5" height="8" rx="1" />
    <rect x="9.5" y="7" width="5" height="13" rx="1" />
    <rect x="15.5" y="14" width="5" height="6" rx="1" />
  </svg>
);

/** Sliders glyph — the Settings affordance (audio + accessibility toggles). */
export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h11M19 7h1M4 17h1M9 17h11" />
    <circle cx="17" cy="7" r="2.4" />
    <circle cx="7" cy="17" r="2.4" />
  </svg>
);

/** Ribbon medal; pass rank to engrave 1/2/3 (color it via CSS on the parent). */
export const MedalIcon = ({ rank, ...p }: IconProps & { rank?: 1 | 2 | 3 }) => (
  <svg {...base(p)}>
    <path d="M8.2 9.6 5.4 3h4l1.6 4M15.8 9.6 18.6 3h-4l-1.6 4" />
    <circle cx="12" cy="15" r="6" />
    {rank ? (
      <text
        x="12" y="15" textAnchor="middle" dominantBaseline="central"
        fontSize="8" fontWeight="700" fontFamily="inherit"
        fill="currentColor" stroke="none"
      >
        {rank}
      </text>
    ) : (
      <path d="M12 12.4v5.2" />
    )}
  </svg>
);

export const FlameIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5c.4 2.6 1.8 4.8 3.8 6.5 1.9 1.6 3.2 3.6 3.2 6a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3.4.4 1 1.3 1.9 2.5 1.9A2.5 2.5 0 0 0 11 11c0-1.4-.6-2-1-3-.9-2 .1-4 2-5.5z" />
  </svg>
);

export const DiceIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <circle cx="8.2" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.8" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8.2" cy="15.8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.8" cy="15.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Ballot dropping into a box — election moments. */
export const BallotIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 11 2 2 4-4" />
    <path d="M5 8c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v11H5V8z" />
    <path d="M22 19H2" />
  </svg>
);

export const BoltIcon = (p: IconProps) => (
  <svg {...base(p)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);

export const FlagIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <path d="M4 22v-7" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

/** Circular arrow — reset / play again. */
export const RestartIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m18 15-6-6-6 6" /></svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14M12 5v14" /></svg>
);

export const MinusIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14" /></svg>
);

export const StarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
  </svg>
);

/** Gift box — daily bonus / rewards. */
export const GiftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
    <path d="M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 11 5 12 8c1-3 2.5-5 4.5-5a2.5 2.5 0 0 1 0 5" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);

/** Discord mark (filled — brand glyph, not a stroke icon). */
export const DiscordIcon = ({ size = 24, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M19.54 5.34A16.2 16.2 0 0 0 15.4 4.1a.06.06 0 0 0-.07.03c-.18.32-.38.73-.51 1.05a15 15 0 0 0-4.5 0c-.14-.33-.34-.73-.52-1.05a.06.06 0 0 0-.07-.03c-1.45.25-2.84.68-4.14 1.24a.06.06 0 0 0-.03.02C2.4 9.2 1.67 12.95 2.03 16.66a.07.07 0 0 0 .03.05 16.3 16.3 0 0 0 4.9 2.48.06.06 0 0 0 .07-.02c.38-.52.71-1.06.99-1.63a.06.06 0 0 0-.03-.09 10.7 10.7 0 0 1-1.53-.73.06.06 0 0 1 0-.1l.3-.24a.06.06 0 0 1 .07 0c3.2 1.46 6.67 1.46 9.84 0a.06.06 0 0 1 .06 0l.3.24a.06.06 0 0 1 0 .1c-.49.29-1 .53-1.53.73a.06.06 0 0 0-.03.09c.29.57.62 1.11.99 1.63a.06.06 0 0 0 .07.02 16.2 16.2 0 0 0 4.9-2.48.06.06 0 0 0 .03-.05c.42-4.29-.71-8.01-3.02-11.3a.05.05 0 0 0-.03-.02zM8.68 14.4c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2c1 0 1.79.9 1.77 2 0 1.1-.78 2-1.77 2zm6.54 0c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2c1 0 1.79.9 1.77 2 0 1.1-.77 2-1.77 2z" />
  </svg>
);

/** Instagram camera glyph (stroke, matching the set). */
export const InstagramIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
