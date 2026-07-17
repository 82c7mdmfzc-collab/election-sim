/**
 * Sheet — the shared edge-docked panel shell: portal to <body>, scrim, and a
 * bottom- or right-docked section. Structural only; content, sounds, and state
 * stay with the caller. Layered at --z-sheet.
 *
 * Existing surfaces adopt it by passing their skin classes (e.g.
 * className="native-game-sheet …") — those load later in the cascade and win.
 * The built-in header (title + 44px close) is optional; omit `title` to render
 * a fully custom header in children.
 *
 * Scrim, Escape, and the built-in close all play the exit animation before
 * invoking onClose; custom buttons in children can do the same via
 * useModalClose() (shared with Modal).
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import { useDismissable } from '../../hooks/useDismissable';
import { ModalCloseContext } from './modalCloseContext';

export function Sheet({ side = 'bottom', onClose, label, title, className, backdropClassName, children }: {
  side?: 'bottom' | 'right';
  onClose: () => void;
  /** Accessible name; defaults to `title` when that is a string. */
  label?: string;
  /** Optional built-in header: title text + close button. */
  title?: ReactNode;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
}) {
  const { closing, requestClose } = useDismissable(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return createPortal(
    <>
      <div
        className={`ui-sheet__backdrop${closing ? ' ui-sheet__backdrop--closing' : ''}${backdropClassName ? ` ${backdropClassName}` : ''}`}
        onClick={() => requestClose()}
      />
      <section
        className={`ui-sheet ui-sheet--${side}${closing ? ' ui-sheet--closing' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : label}
      >
        {title != null && (
          <header className="ui-sheet__header">
            <h2 className="ui-sheet__title">{title}</h2>
            <button type="button" className="ui-sheet__close btn-icon" onClick={() => requestClose()} aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </header>
        )}
        <ModalCloseContext.Provider value={requestClose}>
          {children}
        </ModalCloseContext.Provider>
      </section>
    </>,
    document.body,
  );
}
