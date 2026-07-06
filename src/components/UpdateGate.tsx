/**
 * UpdateGate — the remote forced-update UI.
 *
 * Rendered as a top-level sibling of <App> (main.tsx), like OrientationGate. It
 * reads the update-gate store (populated by useUpdateCheck) and shows:
 *
 *   • a full-screen, non-dismissible "Update Required" wall when the global
 *     forceUpdate kill switch is on (hardWall) — blocks EVERYTHING;
 *   • the same wall at launch when below the minimum supported version, but with
 *     a secondary "Play offline" escape so Solo + pass-and-play stay reachable
 *     (the online/store/account entry points re-show <UpdateRequiredScreen>
 *     themselves — see App.tsx);
 *   • a soft, once-per-session "update available" nudge otherwise.
 *
 * The primary button opens the platform store via openExternal (App Store on iOS).
 */

import { Modal } from './ui/Modal';
import { AudioManager } from '../utils/audioManager';
import { openExternal } from '../utils/openExternal';
import { platformKind } from '../utils/platform';
import { useUpdateGate, type AppUpdateConfig } from '../utils/updateGate';

const APP_STORE_URL = 'https://apps.apple.com/app/elector/id6782414544';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.playelector.app';

function fallbackStoreUrl(): string {
  return platformKind() === 'android' ? PLAY_STORE_URL : APP_STORE_URL;
}

const DEFAULT_REQUIRED_MESSAGE =
  'An update is required to keep Elector stable and fair. Please update to the latest version to keep playing online.';

/**
 * The full-screen Update Required takeover. Reused both by the launch wall and by
 * the online/store/account feature gates. `allowOffline` shows a secondary escape.
 */
export function UpdateRequiredScreen({
  config,
  allowOffline,
  onOffline,
  offlineLabel = 'Play offline (Solo & Pass-and-play)',
}: {
  config: AppUpdateConfig | null;
  allowOffline: boolean;
  onOffline?: () => void;
  offlineLabel?: string;
}) {
  const url = config?.updateUrl || fallbackStoreUrl();
  const message = config?.message?.trim() || DEFAULT_REQUIRED_MESSAGE;
  return (
    <div className="update-gate" role="dialog" aria-modal="true" aria-label="Update required">
      <div className="update-gate__inner">
        <div className="update-gate__badge" aria-hidden>
          <svg viewBox="0 0 80 80" width="72" height="72" fill="none">
            <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="3" />
            <path d="M40 26 v20 M40 52 v0.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="update-gate__title">Update Required</h2>
        <p className="update-gate__text">{message}</p>
        <button
          type="button"
          className="btn-cta btn-cta--lg update-gate__cta"
          onClick={() => { AudioManager.play('confirm'); void openExternal(url); }}
        >
          Update Elector
        </button>
        {allowOffline && onOffline && (
          <button
            type="button"
            className="btn-ghost update-gate__offline"
            onClick={() => { AudioManager.play('quit'); onOffline(); }}
          >
            {offlineLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Optional "update available" nudge — soft, dismissible, once per session. */
function SoftUpdatePrompt({ config, onLater }: { config: AppUpdateConfig | null; onLater: () => void }) {
  const url = config?.updateUrl || fallbackStoreUrl();
  return (
    <Modal label="Update available" panelClassName="confirm-dialog" onClose={onLater}>
      <p className="confirm-dialog__msg">
        A new version of Elector is available{config?.latestVersion ? ` (v${config.latestVersion})` : ''} with the
        latest fixes and features.
      </p>
      <div className="confirm-dialog__actions">
        <button type="button" className="btn-ghost confirm-dialog__btn" onClick={() => { AudioManager.play('quit'); onLater(); }}>
          Later
        </button>
        <button
          type="button"
          className="btn-cta confirm-dialog__btn"
          onClick={() => { AudioManager.play('confirm'); void openExternal(url); }}
        >
          Update
        </button>
      </div>
    </Modal>
  );
}

/** Top-level gate: hard wall + launch takeover + soft nudge. */
export function UpdateGate() {
  const status = useUpdateGate((s) => s.status);
  const hardWall = useUpdateGate((s) => s.hardWall);
  const config = useUpdateGate((s) => s.config);
  const offlineAck = useUpdateGate((s) => s.offlineAck);
  const softDismissed = useUpdateGate((s) => s.softDismissed);
  const acknowledgeOffline = useUpdateGate((s) => s.acknowledgeOffline);
  const dismissSoft = useUpdateGate((s) => s.dismissSoft);

  if (status === 'required') {
    // Hard wall always blocks; below-min wall blocks until the player opts into
    // offline play for this session.
    if (hardWall || !offlineAck) {
      return (
        <UpdateRequiredScreen
          config={config}
          allowOffline={!hardWall}
          onOffline={acknowledgeOffline}
        />
      );
    }
    return null; // playing offline this session; feature gates handle the rest
  }

  if (status === 'soft' && !softDismissed) {
    return <SoftUpdatePrompt config={config} onLater={dismissSoft} />;
  }

  return null;
}
