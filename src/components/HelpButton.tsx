/**
 * HelpButton — a persistent "?" affordance that opens the rules reference in a
 * modal overlay. Mounted in the HeaderHud so help is one tap away mid-game.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioManager } from '../utils/audioManager';
import { HowToPlayPanel } from './HowToPlayPanel';
import { HelpIcon } from './icons';

export function HelpButton() {
  const [open, setOpen] = useState(false);

  function show() { AudioManager.play('click'); setOpen(true); }
  function hide() { AudioManager.play('quit'); setOpen(false); }

  return (
    <>
      <button
        type="button"
        className="help-btn"
        onClick={show}
        aria-label="How to play"
        title="How to play"
      >
        <HelpIcon size={18} />
      </button>
      {open && createPortal(
        // Portal to <body>: mounted inside the in-game options sheet, which uses a
        // CSS transform — a transformed ancestor traps position:fixed children, so
        // without the portal this full-screen overlay would be confined to the sheet.
        <div className="help-overlay" role="dialog" aria-modal="true" onClick={hide}>
          <div className="help-overlay__panel" onClick={(e) => e.stopPropagation()}>
            <HowToPlayPanel onClose={hide} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
