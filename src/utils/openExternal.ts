/**
 * openExternal — open a public URL (privacy policy, terms) in the system browser.
 *
 * On native iOS the WKWebView can't usefully navigate to an external https page
 * in a new tab, so we hand off to the opener plugin (opens the default browser).
 * On web we open a normal new tab. Both paths are wrapped so a failure here can
 * never throw into a click handler.
 */
import { isNativeRuntime } from './platform';

export const PRIVACY_URL = 'https://www.playelector.com/privacy';
export const TERMS_URL = 'https://www.playelector.com/terms';

export async function openExternal(url: string): Promise<void> {
  if (isNativeRuntime()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // Fall through to the web path if the plugin is unavailable.
    }
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* no-op — nothing more we can do from a click handler */
  }
}
