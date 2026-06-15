/**
 * AuthGate — the account panel.
 *
 * Signed out: the shared SignInButtons (Apple/Google/email). An account is
 * required to earn Campaign Funds, unlock characters, and play online.
 * Signed in without a username: claim the one-time permanent username.
 * Signed in with a username: show username, Campaign Funds, lifetime record, and
 * a sign-out button.
 */

import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { UsernameClaim } from './UsernameClaim';
import { SignInButtons } from './SignInButtons';

interface AuthGateProps {
  onClose: () => void;
}

export function AuthGate({ onClose }: AuthGateProps) {
  const profile = useProfile((s) => s.profile);
  const guest = useProfile((s) => s.guest);
  const displayName = useProfile((s) => s.displayName);
  const signOut = useProfile((s) => s.signOut);

  function close() {
    AudioManager.play('quit');
    onClose();
  }

  const { stats } = profile;

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="help-overlay__panel auth-gate" onClick={(e) => e.stopPropagation()}>
        <div className="howto__head">
          <h2 className="howto__title">Your Account</h2>
          <button type="button" className="howto__close" onClick={close} aria-label="Close">✕</button>
        </div>

        {guest ? (
          <div className="auth-gate__save">
            <p className="auth-gate__hint">
              Sign in to earn Campaign Funds, unlock characters, and play online. Your progress
              syncs across every device.
            </p>
            <SignInButtons />
          </div>
        ) : !displayName ? (
          <UsernameClaim />
        ) : (
          <>
            <div className="auth-gate__username">@{displayName}</div>

            <div className="auth-gate__funds">
              <span className="auth-gate__funds-amt">{profile.campaignFunds.toLocaleString()}</span>
              <span className="auth-gate__funds-label">Campaign Funds</span>
            </div>

            <div className="auth-gate__stats">
              <Stat label="Games" value={stats.gamesPlayed} />
              <Stat label="Wins" value={stats.gamesWon} />
              <Stat label="Streak" value={stats.winStreak} />
              <Stat label="Best streak" value={stats.bestWinStreak} />
            </div>

            <button type="button" className="tutorial__btn tutorial__btn--ghost" onClick={() => signOut()}>
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="auth-gate__stat">
      <span className="auth-gate__stat-value">{value}</span>
      <span className="auth-gate__stat-label">{label}</span>
    </div>
  );
}
