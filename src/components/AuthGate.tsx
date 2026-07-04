/**
 * AuthGate — the account panel.
 *
 * Signed out: the shared SignInButtons. Web can show OAuth providers; native
 * iOS currently uses email-code auth. An account is required to earn Campaign
 * Funds, unlock characters, and play online.
 * Signed in without a username: claim the one-time permanent username.
 * Signed in with a username: show username, Campaign Funds, lifetime record, and
 * a sign-out button.
 */

import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { AudioManager } from '../utils/audioManager';
import { UsernameClaim } from './UsernameClaim';
import { SignInButtons } from './SignInButtons';
import { ProgressPanel } from './ProgressPanel';
import { AccountDeletionSection } from './AccountDeletionSection';
import { fetchLeaderboardRemote } from '../game/leaderboard';
import { openExternal, PRIVACY_URL, TERMS_URL } from '../utils/openExternal';

interface AuthGateProps {
  onClose: () => void;
  /** Open the full Leaderboard screen (closes this panel first). */
  onViewLeaderboard?: () => void;
}

export function AuthGate({ onClose, onViewLeaderboard }: AuthGateProps) {
  const profile = useProfile((s) => s.profile);
  const guest = useProfile((s) => s.guest);
  const displayName = useProfile((s) => s.displayName);
  const signOut = useProfile((s) => s.signOut);
  const [tab, setTab] = useState<'profile' | 'progress' | 'danger'>('profile');
  const [rank, setRank] = useState<number | null>(null);

  // Pull the player's all-time wins rank for the profile tab (small top-N fetch;
  // we only use the `me` field). Silent on failure — the rank line just hides.
  useEffect(() => {
    if (!displayName) return;
    let live = true;
    void fetchLeaderboardRemote('wins_all', 3).then((res) => {
      if (live && res?.me) setRank(res.me.rank);
    });
    return () => { live = false; };
  }, [displayName]);

  function close() {
    AudioManager.play('quit');
    onClose();
  }

  // Android hardware back closes the panel, same as the ✕ button.
  useAndroidBack(close);

  const { stats } = profile;
  const counters = profile.achievementCounters;

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
            <div className="auth-tabs native-only" role="tablist" aria-label="Account sections">
              {[
                ['profile', 'Profile'],
                ['progress', 'Progress'],
                ['danger', 'Account'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`auth-tabs__tab${tab === id ? ' is-active' : ''}`}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id as 'profile' | 'progress' | 'danger')}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className={`auth-pane auth-pane--profile${tab === 'profile' ? ' is-active' : ''}`}>
              <div className="auth-gate__username">@{displayName}</div>

              <div className="auth-gate__funds">
                <span className="auth-gate__funds-amt">{profile.campaignFunds.toLocaleString()}</span>
                <span className="auth-gate__funds-label">Campaign Funds</span>
              </div>

              <button
                type="button"
                className="auth-gate__signout"
                onClick={async () => { await signOut(); close(); }}
              >
                Sign out
              </button>

              <div className="auth-gate__stats">
                <Stat label="Games" value={stats.gamesPlayed} />
                <Stat label="Wins" value={stats.gamesWon} />
                <Stat
                  label="Win rate"
                  value={stats.gamesPlayed > 0 ? `${Math.round((stats.gamesWon / stats.gamesPlayed) * 100)}%` : '—'}
                />
                <Stat label="Streak" value={stats.winStreak} />
                <Stat label="Best streak" value={stats.bestWinStreak} />
                <Stat label="Coalitions" value={stats.coalitionsDominated} />
                <Stat label="Best EV" value={counters.maxWinEv || '—'} />
                <Stat label="Online wins" value={counters.onlineWon} />
                <Stat label="Fastest win" value={counters.fastestWinTurn != null ? `T${counters.fastestWinTurn}` : '—'} />
              </div>

              <button
                type="button"
                className="auth-gate__leaderboard"
                onClick={() => { AudioManager.play('click'); onViewLeaderboard?.(); }}
              >
                <span className="auth-gate__rank">
                  {rank != null ? `Ranked #${rank.toLocaleString()} in wins` : 'View the leaderboard'}
                </span>
                <span className="auth-gate__leaderboard-arrow" aria-hidden>→</span>
              </button>
            </div>

            <div className={`auth-pane auth-pane--progress${tab === 'progress' ? ' is-active' : ''}`}>
              <ProgressPanel />
            </div>

            <div className={`auth-pane auth-pane--danger${tab === 'danger' ? ' is-active' : ''}`}>
              <AccountDeletionSection onDeleted={onClose} />
            </div>
          </>
        )}

        <p className="auth-gate__legal">
          Elector is a satirical game and is not affiliated with, authorized, or endorsed by any
          person, party, or government depicted; all names and likenesses are used for parody and
          commentary.
        </p>

        <p className="auth-gate__legal-links">
          <button type="button" className="signin__inline-link" onClick={() => void openExternal(PRIVACY_URL)}>
            Privacy Policy
          </button>
          <span className="auth-gate__legal-sep" aria-hidden="true">·</span>
          <button type="button" className="signin__inline-link" onClick={() => void openExternal(TERMS_URL)}>
            Terms of Service
          </button>
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="auth-gate__stat">
      <span className="auth-gate__stat-value">{value}</span>
      <span className="auth-gate__stat-label">{label}</span>
    </div>
  );
}
