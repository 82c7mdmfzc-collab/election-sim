/**
 * Modal — the shared centered-dialog shell: portal to <body>, scrim, panel.
 *
 * Structural only. Callers own their content, sounds, and open/closed state;
 * scrim click and Escape both invoke onClose. Layered at --z-modal (pass a
 * className to raise a specific modal above another overlay tier).
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className={`ui-modal${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        className={`ui-modal__panel${panelClassName ? ` ${panelClassName}` : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
