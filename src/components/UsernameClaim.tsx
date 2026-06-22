/**
 * UsernameClaim — one-time, permanent username claim.
 *
 * Shown after sign-in when the account has no display_name yet. The chosen name
 * is PERMANENT (the server rejects any later change), so we make that explicit.
 * Validation mirrors the server: 3–20 chars, letters/digits/underscore/hyphen.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { containsProfanity } from '../utils/profanity';

const NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

interface Props {
  /** Called once a username is successfully claimed (or found already set). */
  onClaimed?: () => void;
}

export function UsernameClaim({ onClaimed }: Props) {
  const claimUsername = useProfile((s) => s.claimUsername);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const trimmed = name.trim();
  const valid = NAME_RE.test(trimmed);
  const clean = valid && !containsProfanity(trimmed);

  async function submit() {
    if (busy) return;
    if (!valid) { setError('Use 3–20 letters, numbers, _ or - only.'); return; }
    if (containsProfanity(trimmed)) { setError('Please choose a different username.'); return; }
    setBusy(true);
    setError('');
    const result = await claimUsername(trimmed);
    setBusy(false);

    switch (result) {
      case 'ok':
      case 'already_set':
        AudioManager.play('confirm');
        onClaimed?.();
        break;
      case 'taken':
        setError('That username is already taken — try another.');
        break;
      case 'invalid':
        setError('Use 3–20 letters, numbers, _ or - only.');
        break;
      default:
        setError('Could not save your username. Check your connection and try again.');
    }
  }

  return (
    <div className="auth-gate__save">
      <p className="auth-gate__hint">
        Choose your username. This is <strong>permanent</strong> and can’t be changed later —
        it’s how other players will see you online.
      </p>
      <div className="auth-gate__row">
        <input
          type="text"
          className="auth-gate__input"
          placeholder="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        <button
          type="button"
          className="tutorial__btn"
          onClick={() => void submit()}
          disabled={!clean || busy}
        >
          {busy ? 'Saving…' : 'Claim'}
        </button>
      </div>
      {error && <p className="auth-gate__err">{error}</p>}
    </div>
  );
}
