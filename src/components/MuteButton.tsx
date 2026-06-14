/**
 * MuteButton — toggles global sound and persists the choice to localPrefs.
 * Mounted in the HeaderHud beside the help affordance.
 */

import { useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { isMuted, setMuted } from '../utils/localPrefs';

export function MuteButton() {
  const [muted, setMutedState] = useState<boolean>(() => isMuted());

  function toggle() {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
    AudioManager.setMuted(next);
    if (!next) AudioManager.play('click'); // audible confirmation when un-muting
  }

  return (
    <button
      type="button"
      className="mute-btn"
      onClick={toggle}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
