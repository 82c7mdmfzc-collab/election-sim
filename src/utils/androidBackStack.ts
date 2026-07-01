/**
 * androidBackStack.ts — Android hardware/gesture back support.
 *
 * The Tauri Android activity (wry's WryActivity) maps system back to
 * `webView.goBack()` whenever the webview CAN go back, and otherwise lets the
 * system background the app. The app is a flat state machine with no router, so
 * we exploit that: while anything dismissable is open we keep exactly ONE
 * sentinel history entry pushed. System back then pops the sentinel (firing
 * `popstate`), and we dismiss the top layer — the same function its on-screen
 * ← / ✕ button calls. At Home the stack is empty, no sentinel exists, and
 * system back backgrounds the app, which is the correct Android behavior.
 *
 * No-op on iOS / web / desktop: nothing installs and history is never touched.
 */
import { platformKind } from './platform';

type BackHandler = () => void;

const handlers: BackHandler[] = [];
let armed = false; // sentinel entry currently on the history stack
let suppressNextPop = false; // consume our own programmatic history.back()
let installed = false;

function arm() {
  if (armed) return;
  window.history.pushState({ electorBack: true }, '');
  armed = true;
}

function install() {
  if (installed || platformKind() !== 'android') return;
  installed = true;
  window.addEventListener('popstate', () => {
    if (suppressNextPop) {
      suppressNextPop = false;
      return;
    }
    armed = false;
    const top = handlers[handlers.length - 1];
    if (!top) return;
    // Re-arm BEFORE dismissing: if the handler is a no-op (e.g. an online game
    // deliberately swallowing back) or more layers remain underneath, the next
    // back press must still reach us instead of backgrounding the app. When the
    // stack empties, the unregister cleanup below rebalances history.
    arm();
    top();
  });
}

/**
 * Register `onBack` as the current top back handler. Returns an unregister
 * function (call it on unmount/close). LIFO: the most recently registered
 * handler receives the next hardware back press.
 */
export function pushBackHandler(onBack: BackHandler): () => void {
  install();
  if (!installed) return () => {}; // not Android — inert
  handlers.push(onBack);
  arm();
  return () => {
    const i = handlers.lastIndexOf(onBack);
    if (i >= 0) handlers.splice(i, 1);
    if (handlers.length === 0 && armed) {
      // Last layer closed via its own UI (or after a re-armed pop): drop the
      // now-stale sentinel silently so the next system back exits the app.
      suppressNextPop = true;
      armed = false;
      window.history.back();
    }
  };
}
