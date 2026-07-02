/**
 * SignInButtons — shared sign-in options used by both the Landing page and the
 * account modal (AuthGate).
 *
 * Passwordless with two clear modes:
 *   • Sign In       — rejects an unknown email (prompts to create instead)
 *   • Create Account — makes a new account
 * Apple, Google, and email-code sign-in are offered on both web and native iOS.
 * Native OAuth opens the provider in an in-app browser and returns through the
 * com.playelector.app:// deep link (see utils/nativeAuthCallback).
 */

import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import {
  APPLE_SIGNIN_ENABLED,
  NATIVE_OAUTH_ENABLED,
  REVIEW_ACCOUNT_EMAIL,
  isNativeRuntime,
} from '../utils/authClient';
import { track } from '../utils/analytics';
import { openExternal, PRIVACY_URL, TERMS_URL } from '../utils/openExternal';

// Seconds to disable re-sending after a code is emailed. Supabase enforces a
// per-email cooldown (~60s) server-side; mirroring it here stops users from
// hammering the button and tripping the rate limit.
const RESEND_COOLDOWN_S = 60;

type Mode = 'signin' | 'signup';
type Step = 'email' | 'code' | 'password';
type Status = 'idle' | 'sending' | 'verifying' | 'sent' | 'error';
type AuthMethod = 'apple' | 'google' | 'email';

function authFailureReason(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('no account')) return 'unknown_account';
  if (lower.includes('invalid') || lower.includes('expired') || lower.includes('code')) return 'invalid_code';
  if (lower.includes('rate') || lower.includes('too many')) return 'rate_limited';
  if (lower.includes('network') || lower.includes('fetch')) return 'network';
  return 'provider_error';
}

export function SignInButtons() {
  const sendEmailCode = useProfile((s) => s.sendEmailCode);
  const verifyEmailCode = useProfile((s) => s.verifyEmailCode);
  const signInWithPassword = useProfile((s) => s.signInWithPassword);
  const signInWithGoogle = useProfile((s) => s.signInWithGoogle);
  const signInWithApple = useProfile((s) => s.signInWithApple);

  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const showOauth = !isNativeRuntime() || NATIVE_OAUTH_ENABLED;

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function switchMode(next: Mode) {
    setMode(next);
    setStep('email');
    setStatus('idle');
    setMessage('');
    setCode('');
    setPassword('');
  }

  async function oauth(
    method: AuthMethod,
    fn: () => Promise<{ error?: string; cancelled?: boolean }>,
  ) {
    setStatus('idle');
    setMessage('');
    track('auth_started', { method, mode });
    if (method === 'apple' || method === 'google') {
      window.sessionStorage.setItem('elector.pendingAuthMethod', method);
    }
    const { error, cancelled } = await fn();
    // User dismissed the native sheet — an expected action, keep the UI quiet.
    if (cancelled) {
      window.sessionStorage.removeItem('elector.pendingAuthMethod');
      return;
    }
    if (error) {
      window.sessionStorage.removeItem('elector.pendingAuthMethod');
      track('auth_failed', { method, mode, reason_category: authFailureReason(error) });
      setStatus('error');
      setMessage(error);
    }
  }

  function onApple() {
    if (!APPLE_SIGNIN_ENABLED) {
      setStatus('error');
      setMessage('Sign in with Apple is coming soon — use Google or email for now.');
      track('auth_failed', { method: 'apple', mode, reason_category: 'provider_unavailable' });
      return;
    }
    void oauth('apple', signInWithApple);
  }

  async function sendCode() {
    if (!email.trim() || status === 'sending' || cooldown > 0) return;
    // App Review demo account: show a password field instead of emailing an OTP.
    if (email.trim().toLowerCase() === REVIEW_ACCOUNT_EMAIL) {
      setStep('password');
      setStatus('idle');
      setMessage('');
      return;
    }
    setStatus('sending');
    setMessage('');
    track('auth_started', { method: 'email', mode });
    const { error } = await sendEmailCode(email.trim(), mode === 'signup');
    if (error) {
      track('auth_failed', { method: 'email', mode, reason_category: authFailureReason(error) });
      setStatus('error');
      setMessage(error);
      return;
    }
    setStep('code');
    setStatus('sent');
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function verifyPassword() {
    if (!password || status === 'verifying') return;
    setStatus('verifying');
    setMessage('');
    const { error } = await signInWithPassword(email.trim(), password);
    if (error) {
      track('auth_failed', { method: 'email', mode, reason_category: authFailureReason(error) });
      setStatus('error');
      setMessage(error);
      return;
    }
    track('auth_completed', { method: 'email', mode });
  }

  async function verify() {
    if (code.trim().length < 6) return;
    setStatus('verifying');
    setMessage('');
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    // On success, auth state flips guest→false and the app re-routes; no callback needed.
    if (error) {
      track('auth_failed', { method: 'email', mode, reason_category: authFailureReason(error) });
      setStatus('error');
      setMessage(error);
      return;
    }
    track('auth_completed', { method: 'email', mode });
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

      {showOauth && (
        <>
          <div className="signin__providers">
            <button type="button" className="signin__provider signin__provider--apple" onClick={onApple}>
              Continue with Apple
            </button>
            <button
              type="button"
              className="signin__provider signin__provider--google"
              onClick={() => void oauth('google', signInWithGoogle)}
            >
              Continue with Google
            </button>
          </div>

          <div className="signin__divider"><span>or use email</span></div>
        </>
      )}

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
          <button type="button" className="tutorial__btn" onClick={() => void sendCode()} disabled={status === 'sending' || cooldown > 0}>
            {status === 'sending' ? 'Sending…' : cooldown > 0 ? `Wait ${cooldown}s` : 'Send code'}
          </button>
        </div>
      ) : step === 'password' ? (
        <div className="signin__verify">
          <p className="auth-gate__hint">
            Enter the password for <strong>{email}</strong>.
          </p>
          <div className="auth-gate__row">
            <input
              type="password"
              autoComplete="current-password"
              className="auth-gate__input"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void verifyPassword(); }}
            />
            <button type="button" className="tutorial__btn" onClick={() => void verifyPassword()} disabled={status === 'verifying' || !password}>
              {status === 'verifying' ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
          <div className="signin__actions">
            <button type="button" className="home__link" onClick={() => { setStep('email'); setPassword(''); setStatus('idle'); setMessage(''); }}>
              Use a different email
            </button>
          </div>
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
            <button type="button" className="home__link" onClick={() => void sendCode()} disabled={status === 'sending' || cooldown > 0}>
              {status === 'sending' ? 'Resending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
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

      <p className="signin__legal">
        By continuing you agree to our{' '}
        <button type="button" className="signin__inline-link" onClick={() => void openExternal(PRIVACY_URL)}>
          Privacy&nbsp;Policy
        </button>
        {' '}and{' '}
        <button type="button" className="signin__inline-link" onClick={() => void openExternal(TERMS_URL)}>
          Terms
        </button>.
      </p>
    </div>
  );
}
