/**
 * ToastHost — renders the global toast queue (see utils/toast.ts). Mounted once
 * near the app root so errors from any async path surface to the player instead
 * of vanishing into the console.
 */

import { useToastStore } from '../utils/toast';

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`app-toast app-toast--${t.kind}`}>
          <span className="app-toast__msg">{t.message}</span>
          <button
            type="button"
            className="app-toast__close"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
