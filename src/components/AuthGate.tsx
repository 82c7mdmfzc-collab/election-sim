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

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { UsernameClaim } from './UsernameClaim';
import { SignInButtons } from './SignInButtons';
import { ProgressPanel } from './ProgressPanel';
import { openExternal, PRIVACY_URL, TERMS_URL } from '../utils/openExternal';

interface AuthGateProps {
  onClose: () => void;
}

export function AuthGate({ onClose }: AuthGateProps) {
  const profile = useProfile((s) => s.profile);
  const guest = useProfile((s) => s.guest);
  const displayName = useProfile((s) => s.displayName);
  const signOut = useProfile((s) => s.signOut);
  const deleteAccount = useProfile((s) => s.deleteAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [tab, setTab] = useState<'profile' | 'progress' | 'danger'>('profile');

  function close() {
    AudioManager.play('quit');
    onClose();
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteErr('');
    const ok = await deleteAccount();
    setDeleting(false);
    if (ok) {
      AudioManager.play('quit');
      onClose();
    } else {
      setDeleteErr('Could not delete your account. Please try again, or email support@playelector.com.');
    }
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
                <Stat label="Streak" value={stats.winStreak} />
                <Stat label="Best streak" value={stats.bestWinStreak} />
              </div>
            </div>

            <div className={`auth-pane auth-pane--progress${tab === 'progress' ? ' is-active' : ''}`}>
              <ProgressPanel />
            </div>

            <div className={`auth-pane auth-pane--danger${tab === 'danger' ? ' is-active' : ''}`}>
              {!confirmDelete ? (
                <button
                  type="button"
                  className="auth-gate__delete-link"
                  onClick={() => { AudioManager.play('click'); setConfirmDelete(true); }}
                >
                  Delete account
                </button>
              ) : (
                <div className="auth-gate__delete">
                  <p className="auth-gate__delete-warn">
                    Permanently delete your account and all associated data — Campaign Funds,
                    unlocks, stats, and username? This cannot be undone.
                  </p>
                  {deleteErr && <p className="auth-gate__delete-err">{deleteErr}</p>}
                  <div className="auth-gate__delete-actions">
                    <button
                      type="button"
                      className="auth-gate__delete-confirm"
                      disabled={deleting}
                      onClick={handleDelete}
                    >
                      {deleting ? 'Deleting…' : 'Delete forever'}
                    </button>
                    <button
                      type="button"
                      className="tutorial__btn tutorial__btn--ghost"
                      disabled={deleting}
                      onClick={() => { AudioManager.play('quit'); setConfirmDelete(false); setDeleteErr(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="auth-gate__stat">
      <span className="auth-gate__stat-value">{value}</span>
      <span className="auth-gate__stat-label">{label}</span>
    </div>
  );
}
