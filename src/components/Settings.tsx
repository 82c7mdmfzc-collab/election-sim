/**
 * Settings — the consolidated preferences panel (account + audio + accessibility).
 *
 * Opened from the home gear; available signed-in or out. Reuses the audio volume
 * bars and the `.help-overlay` modal shell. Motion + colorblind toggles re-apply
 * the live html classes / palette via applyAppearancePrefs so changes show instantly.
 */

import { useEffect, useState } from 'react';
import { useProfile, selectFunds, selectIsSignedIn } from '../hooks/useProfile';
import { CloseIcon } from './icons';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { useDismissable } from '../hooks/useDismissable';
import { AudioManager } from '../utils/audioManager';
import { isNativeRuntime } from '../utils/platform';
import { applyAppearancePrefs } from '../utils/appearance';
import {
  isHapticsEnabled, setHapticsEnabled,
  isReducedMotion, setReducedMotion,
  isColorblindMode, setColorblindMode,
} from '../utils/localPrefs';
import { SfxVolumeBar, MusicVolumeBar } from './MuteButton';
import { AccountDeletionSection } from './AccountDeletionSection';

function ToggleRow({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle__text">
        <span className="settings-toggle__label">{label}</span>
        {hint && <span className="settings-toggle__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="settings-toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-toggle__switch" aria-hidden><span className="settings-toggle__thumb" /></span>
    </label>
  );
}

interface SettingsProps {
  onClose: () => void;
  onOpenAccount?: () => void;
}

export function Settings({ onClose, onOpenAccount }: SettingsProps) {
  const native = isNativeRuntime();
  const signedIn = useProfile(selectIsSignedIn);
  const displayName = useProfile((s) => s.displayName);
  const funds = useProfile(selectFunds);
  const signOut = useProfile((s) => s.signOut);
  const [haptics, setHaptics] = useState(() => isHapticsEnabled());
  const [motion, setMotion] = useState(() => isReducedMotion());
  const [cb, setCb] = useState(() => isColorblindMode());
  const [signingOut, setSigningOut] = useState(false);
  const { closing, requestClose } = useDismissable(onClose);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      AudioManager.play('quit');
      requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  function close() {
    AudioManager.play('quit');
    requestClose();
  }

  // Android hardware back closes the panel, same as the ✕ button.
  useAndroidBack(close);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      close();
    }
  }

  function handleSignIn() {
    AudioManager.play('click');
    requestClose(() => { onClose(); onOpenAccount?.(); });
  }

  function toggleHaptics(next: boolean) {
    setHaptics(next);
    setHapticsEnabled(next);
    // Fires after the pref flip: ticks (sound + haptic) when re-enabled,
    // sound-only when just disabled — confirming the new state either way.
    AudioManager.play('click');
  }

  function toggleMotion(next: boolean) {
    setMotion(next);
    setReducedMotion(next);
    applyAppearancePrefs();
    AudioManager.play('click');
  }

  function toggleColorblind(next: boolean) {
    setCb(next);
    setColorblindMode(next);
    applyAppearancePrefs();
    AudioManager.play('click');
  }

  return (
    <div className={`help-overlay${closing ? ' help-overlay--closing' : ''}`} role="dialog" aria-modal="true" onClick={close}>
      <div className="help-overlay__panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="howto__head">
          <h2 className="howto__title">Settings</h2>
          <button type="button" className="howto__close" onClick={close} aria-label="Close"><CloseIcon size={18} /></button>
        </div>

        <div className="settings-section settings-section--account">
          <div className="settings-section__title">Account</div>
          {signedIn ? (
            <div className="settings-account">
              <div className="settings-account__summary">
                <span className="settings-account__name">{displayName ? `@${displayName}` : 'Signed in'}</span>
                <span className="settings-account__funds">{funds.toLocaleString()} Campaign Funds</span>
              </div>
              <button
                type="button"
                className="auth-gate__signout settings-account__button"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
              <AccountDeletionSection className="settings-account__delete" onDeleted={onClose} />
            </div>
          ) : (
            <div className="settings-account">
              <div className="settings-account__summary">
                <span className="settings-account__name">Not signed in</span>
                <span className="settings-account__funds">Sign in to sync progress and unlocks.</span>
              </div>
              <button
                type="button"
                className="auth-gate__signout settings-account__button"
                onClick={handleSignIn}
              >
                Sign in
              </button>
            </div>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section__title">Sound</div>
          <SfxVolumeBar />
          <MusicVolumeBar />
        </div>

        <div className="settings-section">
          <div className="settings-section__title">Accessibility</div>
          {native && (
            <ToggleRow
              label="Haptics"
              hint="Vibration feedback on taps and key moments."
              checked={haptics}
              onChange={toggleHaptics}
            />
          )}
          <ToggleRow
            label="Reduce motion"
            hint="Calmer screen transitions and effects."
            checked={motion}
            onChange={toggleMotion}
          />
          <ToggleRow
            label="Colorblind-safe colors"
            hint="A distinct palette for player seats and the map."
            checked={cb}
            onChange={toggleColorblind}
          />
        </div>
      </div>
    </div>
  );
}
