import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';

interface AccountDeletionSectionProps {
  onDeleted: () => void;
  className?: string;
}

export function AccountDeletionSection({ onDeleted, className = '' }: AccountDeletionSectionProps) {
  const deleteAccount = useProfile((s) => s.deleteAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  async function handleDelete() {
    setDeleting(true);
    setDeleteErr('');
    const ok = await deleteAccount();
    setDeleting(false);
    if (ok) {
      AudioManager.play('quit');
      onDeleted();
      return;
    }
    setDeleteErr('Could not delete your account. Please try again, or email support@playelector.com.');
  }

  function cancelDelete() {
    AudioManager.play('quit');
    setConfirmDelete(false);
    setDeleteErr('');
  }

  return (
    <div className={`account-delete${className ? ` ${className}` : ''}`}>
      {!confirmDelete ? (
        <button
          type="button"
          className="account-delete__trigger"
          onClick={() => { AudioManager.play('click'); setConfirmDelete(true); }}
        >
          Delete account
        </button>
      ) : (
        <div className="auth-gate__delete">
          <p className="auth-gate__delete-warn">
            Permanently delete your account and all associated data: Campaign Funds,
            unlocks, stats, and username. This cannot be undone.
          </p>
          {deleteErr && <p className="auth-gate__delete-err">{deleteErr}</p>}
          <div className="auth-gate__delete-actions">
            <button
              type="button"
              className="auth-gate__delete-confirm"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? 'Deleting...' : 'Delete forever'}
            </button>
            <button
              type="button"
              className="tutorial__btn tutorial__btn--ghost"
              disabled={deleting}
              onClick={cancelDelete}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
