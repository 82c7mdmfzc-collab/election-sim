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
  const [confirmText, setConfirmText] = useState('');

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

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
    setConfirmText('');
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
          <div className="auth-gate__row">
            <input
              type="text"
              className="auth-gate__input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm account deletion"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
            />
          </div>
          <div className="auth-gate__delete-actions">
            <button
              type="button"
              className="auth-gate__delete-confirm"
              disabled={deleting || !canDelete}
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
