/**
 * MuteButton — the header audio control. The speaker button opens a small
 * popover with a master-volume slider and a mute toggle; both persist to
 * localPrefs and drive the AudioManager. Mute is a hard override of volume.
 * Mounted in the HeaderHud beside the help affordance.
 */

import { useEffect, useRef, useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { isMuted, setMuted, getVolume, setVolume } from '../utils/localPrefs';
import { VolumeOnIcon, VolumeOffIcon } from './icons';

export function MuteButton() {
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [volume, setVolumeState] = useState<number>(() => Math.round(getVolume() * 100));
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the popover on any pointer-down outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
    AudioManager.setMuted(next);
    if (!next) AudioManager.play('click'); // audible confirmation when un-muting
  }

  function changeVolume(next: number) {
    setVolumeState(next);
    const frac = next / 100;
    setVolume(frac);                 // persist (clamped in localPrefs)
    AudioManager.setVolume(frac);    // apply live
    AudioManager.play('tick');       // feedback at the new level (de-duped; muted stays silent)
  }

  // Speaker icon reflects "no audible sound": muted or volume at zero.
  const silent = muted || volume === 0;

  return (
    <div className="audio-ctl" ref={rootRef}>
      <button
        type="button"
        className="mute-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Audio settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={muted ? 'Sound off' : `Volume ${volume}%`}
      >
        {silent ? <VolumeOffIcon size={18} /> : <VolumeOnIcon size={18} />}
      </button>

      {open && (
        <div className="audio-pop" role="dialog" aria-label="Audio settings">
          <button
            type="button"
            className={`audio-pop__mute${muted ? ' is-muted' : ''}`}
            onClick={toggleMute}
            aria-pressed={muted}
          >
            {muted ? <VolumeOffIcon size={16} /> : <VolumeOnIcon size={16} />}
            <span>{muted ? 'Muted' : 'Sound on'}</span>
          </button>
          <input
            className="audio-pop__slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Master volume"
            disabled={muted}
          />
          <span className="audio-pop__pct">{volume}%</span>
        </div>
      )}
    </div>
  );
}
