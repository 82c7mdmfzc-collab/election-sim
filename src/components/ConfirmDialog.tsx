/**
 * ConfirmDialog — a small centered yes/no modal for guarding an action.
 *
 * Used for the "end your turn without campaigning?" guard (PhaseFooter +
 * NativeGameHud). Overlay click and the cancel button both dismiss. Sized to fit
 * the landscape / short-viewport native layout (App.css .confirm-dialog).
 */

import { AudioManager } from '../utils/audioManager';

export function ConfirmDialog({
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => { AudioManager.play('quit'); onCancel(); }}
    >
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog__msg">{message}</p>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="btn-ghost confirm-dialog__btn"
            onClick={() => { AudioManager.play('quit'); onCancel(); }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-cta confirm-dialog__btn"
            onClick={() => { AudioManager.play('confirm'); onConfirm(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
