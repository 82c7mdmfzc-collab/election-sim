/**
 * updateGate — global store for the remote forced-update gate.
 *
 * The server (public.app_config) owns the update policy per platform; the client
 * fetches it on launch + resume (see hooks/useUpdateCheck) and evaluates it
 * against the installed marketing semver. This tiny store holds the resulting
 * status so <UpdateGate> (a top-level sibling of <App>) and the online/store/
 * account entry points can react. Lives outside the game/profile stores so a
 * version check never touches persisted state — mirrors connectionStatus.ts.
 */

import { create } from 'zustand';
import { APP_VERSION, isOlder } from './appVersion';

export interface AppUpdateConfig {
  latestVersion: string;
  minimumSupportedVersion: string;
  forceUpdate: boolean;
  softUpdate: boolean;
  updateUrl: string;
  message: string;
}

export type UpdateStatus = 'ok' | 'soft' | 'required';

interface UpdateGateStore {
  status: UpdateStatus;
  /** true → block EVERYTHING including offline solo (global forceUpdate kill switch). */
  hardWall: boolean;
  config: AppUpdateConfig | null;
  /** First launch check has resolved (whether from cache, network, or timeout). */
  checked: boolean;
  /** "Later" pressed on the soft prompt this session — don't nag again. */
  softDismissed: boolean;
  /** "Play offline" pressed this session (below-min, non-force) — allow solo modes. */
  offlineAck: boolean;

  /** Apply a freshly-fetched config. Null = leave current decision, just mark checked. */
  evaluate: (config: AppUpdateConfig | null) => void;
  /** A server call returned UPDATE_REQUIRED — force the required state immediately. */
  setRequiredFromServer: () => void;
  dismissSoft: () => void;
  acknowledgeOffline: () => void;
}

export const useUpdateGate = create<UpdateGateStore>((set) => ({
  status: 'ok',
  hardWall: false,
  config: null,
  checked: false,
  softDismissed: false,
  offlineAck: false,

  evaluate: (config) => {
    if (!config) {
      set({ checked: true });
      return;
    }
    let status: UpdateStatus = 'ok';
    let hardWall = false;
    if (config.forceUpdate) {
      status = 'required';
      hardWall = true;
    } else if (isOlder(APP_VERSION, config.minimumSupportedVersion)) {
      status = 'required';
    } else if (config.softUpdate && isOlder(APP_VERSION, config.latestVersion)) {
      status = 'soft';
    }
    set({ status, hardWall, config, checked: true });
  },

  // A guarded RPC / edge function rejected this build. Treat as required. Keep any
  // hardWall we already learned from config; default to solo-playable otherwise.
  setRequiredFromServer: () => set({ status: 'required', checked: true }),

  dismissSoft: () => set({ softDismissed: true }),
  acknowledgeOffline: () => set({ offlineAck: true }),
}));

/** Non-hook accessor for the Supabase fetch interceptor (no React context there). */
export function setUpdateRequiredFromServer(): void {
  useUpdateGate.getState().setRequiredFromServer();
}
