/**
 * AuthGate — the account panel. Shows the player's Campaign Funds and lifetime
 * record, and lets a guest "Save my progress" by entering an email (magic link),
 * which links the same uid so unlocks/funds carry over. Never blocks play.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';

interface AuthGateProps {
  onClose: () => void;
}

export function AuthGate({ onClose }: AuthGateProps) {
  const profile = useProfile((s) => s.profile);
  const guest = useProfile((s) => s.guest);
  const signInWithEmail = useProfile((s) => s.signInWithEmail);
  const signOut = useProfile((s) => s.signOut);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function save() {
    if (!email.trim()) return;
    setStatus('sending');
    const { error: err } = await signInWithEmail(email.trim());
    if (err) {
      setStatus('error');
      setError(err);
    } else {
      setStatus('sent');
    }
  }

  const { stats } = profile;

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" onClick={() => { AudioManager.play('quit'); onClose(); }}>
      <div className="help-overlay__panel auth-gate" onClick={(e) => e.stopPropagation()}>
        <div className="howto__head">
          <h2 className="howto__title">Your Account</h2>
          <button type="button" className="howto__close" onClick={() => { AudioManager.play('quit'); onClose(); }} aria-label="Close">✕</button>
        </div>

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

        {guest ? (
          <div className="auth-gate__save">
            <p className="auth-gate__hint">
              You’re playing as a guest. Save your progress to keep your funds and unlocks across devices.
            </p>
            {status === 'sent' ? (
              <p className="auth-gate__ok">Check your email for a sign-in link. Your progress is preserved.</p>
            ) : (
              <>
                <div className="auth-gate__row">
                  <input
                    type="email"
                    className="auth-gate__input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="tutorial__btn"
                    onClick={save}
                    disabled={status === 'sending'}
                  >
                    {status === 'sending' ? 'Sending…' : 'Save Progress'}
                  </button>
                </div>
                {status === 'error' && <p className="auth-gate__err">{error}</p>}
              </>
            )}
          </div>
        ) : (
          <button type="button" className="tutorial__btn tutorial__btn--ghost" onClick={() => signOut()}>
            Sign out
          </button>
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
