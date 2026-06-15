/**
 * SignInButtons — shared sign-in options used by both the Landing page and the
 * account modal (AuthGate).
 *
 * Passwordless with two clear modes:
 *   • Sign In       — rejects an unknown email (prompts to create instead)
 *   • Create Account — makes a new account
 * Apple / Google work in both modes. The email path is two-step: send an 8-digit
 * code (also delivered as a magic link), then verify the code — so a player can
 * read the email on one device and type the code on the device they're playing on.
 *
 * The Apple button is always rendered; until APPLE_SIGNIN_ENABLED is flipped on
 * it responds with a friendly "coming soon" message instead of an OAuth error.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { APPLE_SIGNIN_ENABLED } from '../utils/authClient';

type Mode = 'signin' | 'signup';
type Step = 'email' | 'code';
type Status = 'idle' | 'sending' | 'verifying' | 'sent' | 'error';

export function SignInButtons() {
  const sendEmailCode = useProfile((s) => s.sendEmailCode);
  const verifyEmailCode = useProfile((s) => s.verifyEmailCode);
  const signInWithGoogle = useProfile((s) => s.signInWithGoogle);
  const signInWithApple = useProfile((s) => s.signInWithApple);

  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  function switchMode(next: Mode) {
    setMode(next);
    setStep('email');
    setStatus('idle');
    setMessage('');
    setCode('');
  }

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

  async function sendCode() {
    if (!email.trim()) return;
    setStatus('sending');
    setMessage('');
    const { error } = await sendEmailCode(email.trim(), mode === 'signup');
    if (error) { setStatus('error'); setMessage(error); return; }
    setStep('code');
    setStatus('sent');
  }

  async function verify() {
    if (code.trim().length < 6) return;
    setStatus('verifying');
    setMessage('');
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    // On success, auth state flips guest→false and the app re-routes; no callback needed.
    if (error) { setStatus('error'); setMessage(error); }
  }

  return (
    <div className="signin">
      <div className="signin__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`signin__tab${mode === 'signin' ? ' is-active' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Sign In
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`signin__tab${mode === 'signup' ? ' is-active' : ''}`}
          onClick={() => switchMode('signup')}
        >
          Create Account
        </button>
      </div>

      <div className="signin__providers">
        <button type="button" className="signin__provider" onClick={onApple}>
           Continue with Apple
        </button>
        <button type="button" className="signin__provider" onClick={() => void oauth(signInWithGoogle)}>
          Continue with Google
        </button>
      </div>

      <div className="signin__divider"><span>or use email</span></div>

      {step === 'email' ? (
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
            onKeyDown={(e) => { if (e.key === 'Enter') void sendCode(); }}
          />
          <button type="button" className="tutorial__btn" onClick={() => void sendCode()} disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send code'}
          </button>
        </div>
      ) : (
        <div className="signin__verify">
          <p className="auth-gate__hint">
            We emailed an 8-digit code (and a sign-in link) to <strong>{email}</strong>. Enter the code
            below — it expires in 15 minutes.
          </p>
          <div className="auth-gate__row">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="auth-gate__input signin__code"
              placeholder="········"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
            />
            <button type="button" className="tutorial__btn" onClick={() => void verify()} disabled={status === 'verifying' || code.length < 6}>
              {status === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
          </div>
          <div className="signin__actions">
            <button type="button" className="home__link" onClick={() => void sendCode()} disabled={status === 'sending'}>
              {status === 'sending' ? 'Resending…' : 'Resend code'}
            </button>
            <button type="button" className="home__link" onClick={() => { setStep('email'); setCode(''); setStatus('idle'); setMessage(''); }}>
              Use a different email
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="auth-gate__err">
          {message}
          {/no account found/i.test(message) && (
            <> <button type="button" className="signin__inline-link" onClick={() => switchMode('signup')}>Create one →</button></>
          )}
        </p>
      )}
    </div>
  );
}
