/**
 * Volume controls — exported as three components:
 *   SfxVolumeBar   — slider + icon for sound effects volume
 *   MusicVolumeBar — slider + icon for music volume
 *   MuteButton     — legacy global mute (kept for web header compat)
 */

import { useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { haptic } from '../utils/haptics';
import {
  isMuted, setMuted,
  isSfxMuted, setSfxMuted, getSfxVolume, setSfxVolumeLevel,
  isMusicMuted, setMusicMuted, getMusicVolume, setMusicVolumeLevel,
} from '../utils/localPrefs';
import { VolumeOnIcon, VolumeOffIcon } from './icons';

export function SfxVolumeBar() {
  const [volume, setVolumeState] = useState<number>(() => getSfxVolume());
  const [muted, setMutedState] = useState<boolean>(() => isSfxMuted());

  function onSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    haptic('selection'); // iOS-style tick per 5% step while dragging
    setVolumeState(v);
    setSfxVolumeLevel(v);
    AudioManager.setSfxVolume(v / 100);
    if (v > 0 && muted) {
      setMutedState(false);
      setSfxMuted(false);
      AudioManager.setSfxMuted(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    setSfxMuted(next);
    AudioManager.setSfxMuted(next);
    if (!next) AudioManager.play('click');
  }

  const effectiveVolume = muted ? 0 : volume;

  return (
    <div className="vol-bar">
      <button
        type="button"
        className="vol-bar__icon"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
        aria-pressed={muted}
      >
        {effectiveVolume === 0 ? <VolumeOffIcon size={18} /> : <VolumeOnIcon size={18} />}
      </button>
      <span className="vol-bar__label">SFX</span>
      <input
        type="range"
        className="vol-bar__slider"
        min="0"
        max="100"
        step="5"
        value={volume}
        onChange={onSlider}
        aria-label="Sound effects volume"
        style={{ '--vol-pct': `${volume}%` } as React.CSSProperties}
      />
    </div>
  );
}

export function MusicVolumeBar() {
  const [volume, setVolumeState] = useState<number>(() => getMusicVolume());
  const [muted, setMutedState] = useState<boolean>(() => isMusicMuted());

  function onSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    haptic('selection'); // iOS-style tick per 5% step while dragging
    setVolumeState(v);
    setMusicVolumeLevel(v);
    AudioManager.setMusicVolume(v / 100);
    if (v > 0 && muted) {
      setMutedState(false);
      setMusicMuted(false);
      AudioManager.setMusicMuted(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    setMusicMuted(next);
    AudioManager.setMusicMuted(next);
  }

  const effectiveVolume = muted ? 0 : volume;

  return (
    <div className="vol-bar">
      <button
        type="button"
        className="vol-bar__icon"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute music' : 'Mute music'}
        aria-pressed={muted}
      >
        {effectiveVolume === 0 ? <VolumeOffIcon size={18} /> : <VolumeOnIcon size={18} />}
      </button>
      <span className="vol-bar__label">Music</span>
      <input
        type="range"
        className="vol-bar__slider"
        min="0"
        max="100"
        step="5"
        value={volume}
        onChange={onSlider}
        aria-label="Music volume"
        style={{ '--vol-pct': `${volume}%` } as React.CSSProperties}
      />
    </div>
  );
}

/**
 * HomeAudioControls — the home-page sound dial. A speaker button that toggles a
 * small panel holding the SFX + Music volume bars. Available on both web and
 * native so background music can be tuned or silenced from the main menu.
 */
export function HomeAudioControls() {
  const [open, setOpen] = useState(false);
  const allMuted = isSfxMuted() && isMusicMuted();

  return (
    <div className={`home-audio${open ? ' home-audio--open' : ''}`} data-sfx="none">
      <button
        type="button"
        className="home-audio__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Sound settings"
        aria-expanded={open}
        title="Sound"
      >
        {allMuted ? <VolumeOffIcon size={20} /> : <VolumeOnIcon size={20} />}
      </button>
      {open && (
        <>
          <div className="home-audio__scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="home-audio__panel" role="dialog" aria-label="Sound settings">
            <SfxVolumeBar />
            <MusicVolumeBar />
          </div>
        </>
      )}
    </div>
  );
}

/** Legacy global mute — kept so web HeaderHud still compiles. */
export function MuteButton() {
  const [muted, setMutedState] = useState<boolean>(() => isMuted());

  function toggle() {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
    AudioManager.setMuted(next);
    if (!next) AudioManager.play('click');
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
      {muted ? <VolumeOffIcon size={18} /> : <VolumeOnIcon size={18} />}
    </button>
  );
}
