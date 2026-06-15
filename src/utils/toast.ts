/**
 * toast — a tiny global notification queue, decoupled from the game store so it
 * can be called from plain async modules (multiplayerActions, supabaseClient)
 * without circular imports. Render <ToastHost /> once near the app root.
 */

import { create } from 'zustand';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    // Auto-dismiss after a few seconds.
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers usable from non-React code. */
export const notifyError = (message: string) => useToastStore.getState().push('error', message);
export const notifyInfo = (message: string) => useToastStore.getState().push('info', message);
