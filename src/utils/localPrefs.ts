/**
 * localPrefs — the thin localStorage layer for device-local preferences that
 * exist before (and independently of) a signed-in account.
 *
 * In Phase 2 the cloud profile mirrors these keys (tutorialSeen, muted) and
 * reconciles on sign-in, so this stays the offline/guest source of truth.
 */

const KEY = 'election-sim-prefs-v1';

export interface LocalPrefs {
  tutorialSeen: boolean;
  muted: boolean;
  /** gameId of the most recent game whose reward was already granted (idempotency). */
  lastAwardedGameId: string | null;
}

const DEFAULTS: LocalPrefs = {
  tutorialSeen: false,
  muted: false,
  lastAwardedGameId: null,
};

export function getPrefs(): LocalPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPrefs(patch: Partial<LocalPrefs>): LocalPrefs {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
  return next;
}

export const isTutorialSeen = () => getPrefs().tutorialSeen;
export const markTutorialSeen = () => setPrefs({ tutorialSeen: true });
export const isMuted = () => getPrefs().muted;
export const setMuted = (muted: boolean) => setPrefs({ muted });
export const getLastAwardedGameId = () => getPrefs().lastAwardedGameId;
export const setLastAwardedGameId = (lastAwardedGameId: string) => setPrefs({ lastAwardedGameId });
