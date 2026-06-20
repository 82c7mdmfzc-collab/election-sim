/**
 * Landing — the front door for signed-out visitors. Shown on every load while
 * logged out. Starts with the game, then offers account sign-in as a sync path.
 */

import { BrandMark } from './BrandMark';
import { SignInButtons } from './SignInButtons';

interface LandingProps {
  onContinueAsGuest: () => void;
}

export function Landing({ onContinueAsGuest }: LandingProps) {
  return (
    <div className="landing">
      <BrandMark />

      <div className="landing__hero">
        <p className="landing__eyebrow">Strategy • Solo • Online</p>
        <p className="landing__pitch">
          Campaign across the map, build coalitions, and race to 270 electoral votes.
        </p>
        <button type="button" className="landing__guest" onClick={onContinueAsGuest}>
          Start Solo →
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
        Elector is a satirical strategy game. It is not affiliated with, authorized, or endorsed
        by any person, party, or government depicted; all names and likenesses are used for parody
        and commentary.
      </p>
    </div>
  );
}
