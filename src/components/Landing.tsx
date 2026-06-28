/**
 * Landing — the front door for signed-out visitors. Shown on every load while
 * logged out. Starts with the game, then offers account sign-in as a sync path.
 */

import { BrandMark } from './BrandMark';
import { SignInButtons } from './SignInButtons';
import { RotatingTip } from './RotatingTip';
import { HomeAudioControls } from './MuteButton';
import { CANDIDATES } from '../game/candidates';
import { isNativeRuntime } from '../utils/platform';

interface LandingProps {
  onContinueAsGuest: () => void;
  primaryLabel?: string;
}

const LANDING_HOOKS = [
  'Build coalitions, not just majorities.',
  'Every state is a negotiation.',
  'Outspend and outmaneuver your rivals.',
  'Read your opponent — a collision burns you both.',
  'Your candidate, your strategy, your 270.',
];

export function Landing({ onContinueAsGuest, primaryLabel = 'Start Solo' }: LandingProps) {
  const native = isNativeRuntime();
  return (
    <div className="landing">
      <HomeAudioControls />
      <BrandMark />

      <div className="landing__hero">
        {!native && (
          <p className="landing__eyebrow">Solo Campaign • Local Campaign • Online Campaign</p>
        )}
        <p className="landing__pitch">
          Start with a practice campaign, learn the map as you play, and race to 270 electoral votes.
        </p>
        {!native && (
          <>
            <div className="landing__chips">
              <span className="daily__chip">50 states</span>
              <span className="daily__chip">{CANDIDATES.length} candidates</span>
              <span className="daily__chip">Race to 270</span>
            </div>
            <RotatingTip tips={LANDING_HOOKS} label="Why Elector" className="landing__hooks" />
          </>
        )}
        <button type="button" className="landing__guest" onClick={onContinueAsGuest}>
          {primaryLabel} →
        </button>
      </div>

      <div className="landing__card">
        <h2 className="landing__title">Account</h2>
        <p className="landing__account-copy">
          Sync your roster, earned funds, and online play.
        </p>

        <SignInButtons />
      </div>

      <p className="landing__guest-note">Guest play includes Solo and pass-and-play.</p>

      <p className="landing__legal">
        {native
          ? 'Satirical strategy game — not affiliated with any person or party depicted.'
          : 'Elector is a satirical strategy game. It is not affiliated with, authorized, or endorsed by any person, party, or government depicted; all names and likenesses are used for parody and commentary.'}
      </p>
    </div>
  );
}
