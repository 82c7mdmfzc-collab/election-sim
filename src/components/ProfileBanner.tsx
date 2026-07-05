/**
 * ProfileBanner — the equippable `profile_banner` cosmetic strip.
 *
 * Purely visual identity shown on the profile modal, leaderboard rows, and the
 * player's own versus card. Every banner is a CSS recipe (gradient/pattern) keyed
 * by `profile-banner--<id>` in App.css — no image assets. An empty/unknown id
 * renders nothing, so "no banner" is the zero-cost default.
 */

import { isBannerId } from '../game/cosmetics';

interface ProfileBannerProps {
  /** Cosmetic id (e.g. 'banner_laurel'); '' / null / unknown → nothing rendered. */
  bannerId: string | null | undefined;
  /** Visual density: 'strip' (full-width header) or 'chip' (compact leaderboard cue). */
  variant?: 'strip' | 'chip';
  className?: string;
}

export function ProfileBanner({ bannerId, variant = 'strip', className }: ProfileBannerProps) {
  if (!isBannerId(bannerId)) return null;
  const cls = [
    'profile-banner',
    `profile-banner--${variant}`,
    `profile-banner--${bannerId}`,
    className,
  ].filter(Boolean).join(' ');
  return <div className={cls} aria-hidden="true" />;
}
