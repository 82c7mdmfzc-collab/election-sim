/**
 * Landing — the front door for signed-out visitors. Shown on every load while
 * logged out. Offers Apple/Google/email sign-in (an account unlocks Campaign
 * Funds, unlocks, and online play) plus an explicit "Continue as Guest" path
 * into vs-bot and pass-and-play.
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

      <div className="landing__card">
        <p className="landing__pitch">
          Sign in to earn Campaign Funds, unlock candidates, and play online — your progress
          follows you across devices.
        </p>

        <SignInButtons />
      </div>

      <button type="button" className="landing__guest" onClick={onContinueAsGuest}>
        Continue as Guest →
      </button>
      <p className="landing__guest-note">Guests can play vs Bot and pass-and-play.</p>

      <p className="landing__legal">
        Elector is a satirical strategy game. It is not affiliated with, authorized, or endorsed
        by any person, party, or government depicted; all names and likenesses are used for parody
        and commentary.
      </p>
    </div>
  );
}
