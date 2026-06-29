/**
 * Settings — the consolidated preferences panel (audio + accessibility).
 *
 * Opened from the home gear; available signed-in or out, since these are
 * device-local prefs (localPrefs), not account data. Reuses the audio volume bars
 * and the `.help-overlay` modal shell. Motion + colorblind toggles re-apply the
 * live html classes / palette via applyAppearancePrefs so changes show instantly.
 */

import { useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { isNativeRuntime } from '../utils/platform';
import { haptic } from '../utils/haptics';
import { applyAppearancePrefs } from '../utils/appearance';
import {
  isHapticsEnabled, setHapticsEnabled,
  isReducedMotion, setReducedMotion,
  isColorblindMode, setColorblindMode,
} from '../utils/localPrefs';
import { SfxVolumeBar, MusicVolumeBar } from './MuteButton';

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

export function Settings({ onClose }: { onClose: () => void }) {
  const native = isNativeRuntime();
  const [haptics, setHaptics] = useState(() => isHapticsEnabled());
  const [motion, setMotion] = useState(() => isReducedMotion());
  const [cb, setCb] = useState(() => isColorblindMode());

  function close() {
    AudioManager.play('quit');
    onClose();
  }

  function toggleHaptics(next: boolean) {
    setHaptics(next);
    setHapticsEnabled(next);
    if (next) haptic('selection'); // a tick confirms it's back on
  }

  function toggleMotion(next: boolean) {
    setMotion(next);
    setReducedMotion(next);
    applyAppearancePrefs();
  }

  function toggleColorblind(next: boolean) {
    setCb(next);
    setColorblindMode(next);
    applyAppearancePrefs();
    AudioManager.play('click');
  }

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="help-overlay__panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="howto__head">
          <h2 className="howto__title">Settings</h2>
          <button type="button" className="howto__close" onClick={close} aria-label="Close">✕</button>
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
