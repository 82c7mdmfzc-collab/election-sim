/**
 * haptics.ts — thin wrapper over the native Tauri haptics plugin.
 *
 * The plugin (@tauri-apps/plugin-haptics, StoreKit/UIKit under the hood) is a
 * mobile-only crate, so this module:
 *   • no-ops on web / desktop (the website is secondary and has no haptics),
 *   • dynamic-imports the plugin so it never lands in the web bundle's main
 *     chunk and never module-evals off-native,
 *   • swallows every error (haptics are a nicety, never load-bearing).
 *
 * It is intentionally decoupled from AudioManager (which calls into here) to
 * avoid an import cycle. Mute is honored at the AudioManager.play() call site,
 * which already returns early when muted.
 */
import { isNativeRuntime } from './platform';

export type HapticKind =
  // impact feedback (UIImpactFeedbackGenerator)
  | 'light'
  | 'medium'
  | 'heavy'
  // notification feedback (UINotificationFeedbackGenerator)
  | 'success'
  | 'warning'
  | 'error'
  // selection feedback (UISelectionFeedbackGenerator) — the lightest "tick"
  | 'selection';

type HapticsModule = typeof import('@tauri-apps/plugin-haptics');
let modulePromise: Promise<HapticsModule | null> | null = null;

function loadModule(): Promise<HapticsModule | null> {
  if (!modulePromise) {
    modulePromise = import('@tauri-apps/plugin-haptics').catch(() => null);
  }
  return modulePromise;
}

/** Fire a single haptic. No-op unless running in the native app. */
export function haptic(kind: HapticKind): void {
  if (!isNativeRuntime()) return;
  void loadModule().then((m) => {
    if (!m) return;
    try {
      switch (kind) {
        case 'light':
        case 'medium':
        case 'heavy':
          return void m.impactFeedback(kind);
        case 'success':
        case 'warning':
        case 'error':
          return void m.notificationFeedback(kind);
        case 'selection':
          return void m.selectionFeedback();
      }
    } catch {
      /* haptics are non-essential — never surface an error */
    }
  });
}
