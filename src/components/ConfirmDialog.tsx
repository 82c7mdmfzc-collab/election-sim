/**
 * ConfirmDialog — a small centered yes/no modal for guarding an action.
 *
 * Used for the "end your turn without campaigning?" guard (PhaseFooter +
 * NativeGameHud). Overlay click and the cancel button both dismiss. Sized to fit
 * the landscape / short-viewport native layout (styles: .confirm-dialog).
 */

import { AudioManager } from '../utils/audioManager';
import { Modal, useModalClose } from './ui/Modal';

// Rendered inside Modal so useModalClose() sees the provider: buttons play
// their sound immediately, then dismiss through the exit animation.
function ConfirmActions({ confirmLabel, cancelLabel, onConfirm, onCancel }: {
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const requestClose = useModalClose();
  return (
    <div className="confirm-dialog__actions">
      <button
        type="button"
        className="btn-ghost confirm-dialog__btn"
        onClick={() => { AudioManager.play('quit'); requestClose(onCancel); }}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        className="btn-cta confirm-dialog__btn"
        onClick={() => { AudioManager.play('confirm'); requestClose(onConfirm); }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

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
    <Modal
      label={message}
      className="confirm-overlay"
      panelClassName="confirm-dialog"
      onClose={() => { AudioManager.play('quit'); onCancel(); }}
    >
      <p className="confirm-dialog__msg">{message}</p>
      <ConfirmActions
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}
