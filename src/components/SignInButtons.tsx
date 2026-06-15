/**
 * SignInButtons — shared sign-in options used by both the Landing page and the
 * account modal (AuthGate). Offers Apple, Google, and email magic-link sign-in.
 *
 * The Apple button is always rendered; until APPLE_SIGNIN_ENABLED is flipped on
 * (once the provider is configured in Supabase) it responds with a friendly
 * "coming soon" message instead of a raw OAuth error.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { APPLE_SIGNIN_ENABLED } from '../utils/authClient';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function SignInButtons() {
  const signInWithEmail = useProfile((s) => s.signInWithEmail);
  const signInWithGoogle = useProfile((s) => s.signInWithGoogle);
  const signInWithApple = useProfile((s) => s.signInWithApple);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function oauth(fn: () => Promise<{ error?: string }>) {
    setStatus('idle');
    setMessage('');
    const { error } = await fn();
    if (error) { setStatus('error'); setMessage(error); }
  }

  function onApple() {
    if (!APPLE_SIGNIN_ENABLED) {
      setStatus('error');
      setMessage('Sign in with Apple is coming soon — use Google or email for now.');
      return;
    }
    void oauth(signInWithApple);
  }

  async function sendEmail() {
    if (!email.trim()) return;
    setStatus('sending');
    setMessage('');
    const { error } = await signInWithEmail(email.trim());
    if (error) { setStatus('error'); setMessage(error); }
    else setStatus('sent');
  }

  return (
    <div className="signin">
      <div className="signin__providers">
        <button type="button" className="signin__provider" onClick={onApple}>
           Sign in with Apple
        </button>
        <button type="button" className="signin__provider" onClick={() => void oauth(signInWithGoogle)}>
          Sign in with Google
        </button>
      </div>

      <div className="signin__divider"><span>or use email</span></div>

      {status === 'sent' ? (
        <p className="auth-gate__ok">Check your email for a sign-in link.</p>
      ) : (
        <div className="auth-gate__row">
          <input
            type="email"
            className="auth-gate__input"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void sendEmail(); }}
          />
          <button type="button" className="tutorial__btn" onClick={() => void sendEmail()} disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Email link'}
          </button>
        </div>
      )}

      {status === 'error' && <p className="auth-gate__err">{message}</p>}
    </div>
  );
}
