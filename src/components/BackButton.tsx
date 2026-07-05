/**
 * BackButton — the one back affordance for hub/setup screens.
 *
 * Chevron icon + label on the shared .btn-back style (aliased to the legacy
 * .mp-back look). Plays the standard quit blip unless silenced. Replaces the
 * assorted "← Back" / "← Back to Menu" text-glyph buttons.
 */

import { AudioManager } from '../utils/audioManager';
import { ChevronLeftIcon } from './icons';

export function BackButton({
  onClick,
  label = 'Back',
  silent = false,
  className = '',
}: {
  onClick: () => void;
  label?: string;
  /** Skip the quit SFX (caller plays its own, or none). */
  silent?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn-back${className ? ` ${className}` : ''}`}
      onClick={() => { if (!silent) AudioManager.play('quit'); onClick(); }}
    >
      <ChevronLeftIcon size={16} />
      {label}
    </button>
  );
}
