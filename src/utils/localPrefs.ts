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
  /** Master audio volume, 0–1. Scales every sound; `muted` overrides it. */
  volume: number;
  /** gameId of the most recent game whose reward was already granted (idempotency). */
  lastAwardedGameId: string | null;
  /** Equipped victory-message cosmetic id (see game/victoryMessages.ts). */
  selectedVictoryMessage: string;
  /** Referral code captured from a ?ref= invite link, pending set_referrer after sign-in. */
  pendingReferralCode: string | null;
  /** Whether the live first-campaign coach has been dismissed on this device. */
  firstRunCoachDismissed: boolean;
  /** Whether the one-time first-gameplay tips overlay has been dismissed. */
  firstGameplayTipsSeen: boolean;
  /** Normalized usernames the player has blocked online (Apple Guideline 1.2). */
  blockedPlayers: string[];
}

const DEFAULTS: LocalPrefs = {
  tutorialSeen: false,
  muted: false,
  volume: 0.8,
  lastAwardedGameId: null,
  selectedVictoryMessage: 'classic', // DEFAULT_VICTORY_MESSAGE_ID
  pendingReferralCode: null,
  firstRunCoachDismissed: false,
  firstGameplayTipsSeen: false,
  blockedPlayers: [],
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
export const getVolume = () => getPrefs().volume;
/** Persist master volume, clamped to 0–1. */
export const setVolume = (volume: number) =>
  setPrefs({ volume: Math.min(1, Math.max(0, volume)) });
export const getLastAwardedGameId = () => getPrefs().lastAwardedGameId;
export const setLastAwardedGameId = (lastAwardedGameId: string) => setPrefs({ lastAwardedGameId });
export const getSelectedVictoryMessage = () => getPrefs().selectedVictoryMessage;
export const setSelectedVictoryMessage = (selectedVictoryMessage: string) => setPrefs({ selectedVictoryMessage });
export const getPendingReferralCode = () => getPrefs().pendingReferralCode;
export const setPendingReferralCode = (pendingReferralCode: string) => setPrefs({ pendingReferralCode });
export const clearPendingReferralCode = () => setPrefs({ pendingReferralCode: null });
export const isFirstRunCoachDismissed = () => getPrefs().firstRunCoachDismissed;
export const markFirstRunCoachDismissed = () => setPrefs({ firstRunCoachDismissed: true });
export const isFirstGameplayTipsSeen = () => getPrefs().firstGameplayTipsSeen;
export const markFirstGameplayTipsSeen = () => setPrefs({ firstGameplayTipsSeen: true });

// ── Online safety: blocked players (Apple Guideline 1.2) ──────────────────────
const normPlayerName = (name: string) => name.trim().toLowerCase();
export const getBlockedPlayers = () => getPrefs().blockedPlayers;
export const isPlayerBlocked = (name: string) =>
  getPrefs().blockedPlayers.includes(normPlayerName(name));
export function blockPlayer(name: string) {
  const key = normPlayerName(name);
  const current = getPrefs().blockedPlayers;
  if (!key || current.includes(key)) return;
  setPrefs({ blockedPlayers: [...current, key] });
}
export function unblockPlayer(name: string) {
  const key = normPlayerName(name);
  setPrefs({ blockedPlayers: getPrefs().blockedPlayers.filter((n) => n !== key) });
}
