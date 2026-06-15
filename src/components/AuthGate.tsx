/**
 * AuthGate — the account panel.
 *
 * Signed out: sign in with Apple, Google, or an email magic link. An account is
 * required to earn Campaign Funds, unlock characters, and play online.
 * Signed in without a username: claim the one-time permanent username.
 * Signed in with a username: show username, Campaign Funds, lifetime record, and
 * a sign-out button.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { UsernameClaim } from './UsernameClaim';

// Flip to true once the Apple provider is configured in Supabase
// (Authentication → Providers → Apple). Until then the button is hidden so
// users don't hit an "provider not enabled" error. Google + email work today.
const APPLE_SIGNIN_ENABLED = false;

interface AuthGateProps {
  onClose: () => void;
}

export function AuthGate({ onClose }: AuthGateProps) {
  const profile = useProfile((s) => s.profile);
  const guest = useProfile((s) => s.guest);
  const displayName = useProfile((s) => s.displayName);
  const signInWithEmail = useProfile((s) => s.signInWithEmail);
  const signInWithGoogle = useProfile((s) => s.signInWithGoogle);
  const signInWithApple = useProfile((s) => s.signInWithApple);
  const signOut = useProfile((s) => s.signOut);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  function close() {
    AudioManager.play('quit');
    onClose();
  }

  async function sendEmail() {
    if (!email.trim()) return;
    setStatus('sending');
    const { error: err } = await signInWithEmail(email.trim());
    if (err) { setStatus('error'); setError(err); }
    else setStatus('sent');
  }

  async function oauth(fn: () => Promise<{ error?: string }>) {
    setError('');
    const { error: err } = await fn();
    if (err) { setStatus('error'); setError(err); }
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

            <div className="auth-gate__providers">
              {APPLE_SIGNIN_ENABLED && (
                <button type="button" className="tutorial__btn" onClick={() => void oauth(signInWithApple)}>
                   Sign in with Apple
                </button>
              )}
              <button type="button" className="tutorial__btn" onClick={() => void oauth(signInWithGoogle)}>
                Sign in with Google
              </button>
            </div>

            <p className="auth-gate__hint" style={{ marginTop: '0.75rem' }}>Or use an email link:</p>
            {status === 'sent' ? (
              <p className="auth-gate__ok">Check your email for a sign-in link.</p>
            ) : (
              <div className="auth-gate__row">
                <input
                  type="email"
                  className="auth-gate__input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="button" className="tutorial__btn" onClick={sendEmail} disabled={status === 'sending'}>
                  {status === 'sending' ? 'Sending…' : 'Email link'}
                </button>
              </div>
            )}
            {status === 'error' && <p className="auth-gate__err">{error}</p>}
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
