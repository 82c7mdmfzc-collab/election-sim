/**
 * Modal — the shared centered-dialog shell: portal to <body>, scrim, panel.
 *
 * Structural only. Callers own their content, sounds, and open/closed state;
 * scrim click and Escape both play the exit animation, then invoke onClose.
 * Layered at --z-modal (pass a className to raise a specific modal above
 * another overlay tier).
 *
 * Custom close/confirm buttons inside the panel should dismiss through
 * useModalClose() so they animate out too: `requestClose(onConfirm)` runs the
 * exit animation, then the action. Outside a Modal/Sheet the hook degrades to
 * running the action immediately.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismissable } from '../../hooks/useDismissable';

/** Dismiss the enclosing Modal/Sheet with its exit animation, then run `after`
 *  (defaults to the surface's onClose). */
export type RequestClose = (after?: () => void) => void;

export const ModalCloseContext = createContext<RequestClose>((after) => after?.());
export const useModalClose = (): RequestClose => useContext(ModalCloseContext);

export function Modal({ onClose, label, className, panelClassName, children }: {
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** Extra class(es) on the scrim wrapper (skins, z overrides). */
  className?: string;
  /** Extra class(es) on the panel (the surface skin, e.g. confirm-dialog). */
  panelClassName?: string;
  children: ReactNode;
}) {
  const { closing, requestClose } = useDismissable(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return createPortal(
    <div
      className={`ui-modal${closing ? ' ui-modal--closing' : ''}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => requestClose()}
    >
      <div
        className={`ui-modal__panel${panelClassName ? ` ${panelClassName}` : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalCloseContext.Provider value={requestClose}>
          {children}
        </ModalCloseContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
