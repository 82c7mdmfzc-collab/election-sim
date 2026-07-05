/**
 * localPrefs — the thin localStorage layer for device-local preferences that
 * exist before (and independently of) a signed-in account.
 *
 * In Phase 2 the cloud profile mirrors these keys (tutorialSeen, muted) and
 * reconciles on sign-in, so this stays the offline/guest source of truth.
 */

const KEY = 'election-sim-prefs-v1';

/** Device-local Daily Challenge progress (the accountless source of truth). */
export interface DailyChallengeLocal {
  /** UTC YYYY-MM-DD of the most recent day the challenge was played. */
  lastPlayedDate: string | null;
  /** UTC YYYY-MM-DD of the most recent day the challenge was won. */
  lastWonDate: string | null;
  /** Consecutive-day play streak. */
  streak: number;
  /** Owner-seat EV from the most recent daily attempt. */
  lastEv: number;
}

/**
 * A finished-game result that failed to sync to the server (network down at game
 * end). Persisted so the next launch can replay it against the idempotent
 * complete_game_result RPC — see useProfile.replayPendingCompletion. Bound to the
 * account it belongs to so a different signed-in user never inherits the credit.
 */
export interface PendingGameCompletion {
  userId: string;
  gameId: string;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
  winStreak: number;
  mode: 'single' | 'bot' | 'daily' | 'online';
  botDifficulty: string | null;
  botCount: number;
  turns: number;
  electoralVotes: number;
  candidateId: string | null;
  opponentCount: number;
}

export interface LocalPrefs {
  tutorialSeen: boolean;
  muted: boolean;
  sfxMuted: boolean;
  musicMuted: boolean;
  /** SFX volume 0–100. */
  sfxVolume: number;
  /** Music volume 0–100. */
  musicVolume: number;
  /** gameId of the most recent game whose reward was already granted (idempotency). */
  lastAwardedGameId: string | null;
  /** Equipped victory-message cosmetic id (see game/victoryMessages.ts). */
  selectedVictoryMessage: string;
  /** Equipped share-card frame cosmetic id (see game/cosmetics.ts). */
  selectedShareFrame: string;
  /** Equipped board map-theme cosmetic id (see game/mapTheme.ts; 'classic' = default). */
  selectedMapTheme: string;
  /** Device-local mirror of the account's equipped profile banner ('' = none). Set
   *  by set_equipped_banner on the server; cached here for instant local render. */
  equippedBanner: string;
  /** Device-local mirror of the account's avatar preset id ('' = initials). Set by
   *  set_avatar on the server; cached here so the Home card renders instantly. */
  avatar: string;
  /** Referral code captured from a ?ref= invite link, pending set_referrer after sign-in. */
  pendingReferralCode: string | null;
  /** Whether the live first-campaign coach has been dismissed on this device. */
  firstRunCoachDismissed: boolean;
  /** Whether the one-time first-gameplay tips overlay has been dismissed. */
  firstGameplayTipsSeen: boolean;
  /** Whether the interactive guided first game (spotlight coach-marks) is complete. */
  guidedOnboardingDone: boolean;
  /** Normalized usernames the player has blocked online (Apple Guideline 1.2). */
  blockedPlayers: string[];
  /** Whether we've already shown the OS notification-permission prompt once. */
  notifPermissionAsked: boolean;
  /** Device-local Daily Challenge progress. */
  dailyChallenge: DailyChallengeLocal;
  /** Native haptic feedback on/off (no-op on web; see utils/haptics.ts). */
  hapticsEnabled: boolean;
  /** Suppress screen-transition + non-essential animation (accessibility). */
  reducedMotion: boolean;
  /** Colorblind-safe player palette (remaps seat/map colors; see game/playerColors.ts). */
  colorblindMode: boolean;
  /** A finished game whose reward failed to sync, queued for replay on next launch. */
  pendingCompletion: PendingGameCompletion | null;
}

const DEFAULT_DAILY_CHALLENGE: DailyChallengeLocal = {
  lastPlayedDate: null,
  lastWonDate: null,
  streak: 0,
  lastEv: 0,
};

const DEFAULTS: LocalPrefs = {
  tutorialSeen: false,
  muted: false,
  sfxMuted: false,
  musicMuted: false,
  sfxVolume: 80,
  musicVolume: 30,
  lastAwardedGameId: null,
  selectedVictoryMessage: 'classic', // DEFAULT_VICTORY_MESSAGE_ID
  selectedShareFrame: 'midnight', // DEFAULT_SHARE_FRAME_ID
  selectedMapTheme: 'classic', // DEFAULT_MAP_THEME_ID
  equippedBanner: '', // none
  avatar: '', // DEFAULT_AVATAR_ID — initials fallback
  pendingReferralCode: null,
  firstRunCoachDismissed: false,
  firstGameplayTipsSeen: false,
  guidedOnboardingDone: false,
  blockedPlayers: [],
  notifPermissionAsked: false,
  dailyChallenge: { ...DEFAULT_DAILY_CHALLENGE },
  hapticsEnabled: true,
  reducedMotion: false,
  colorblindMode: false,
  pendingCompletion: null,
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
export const isSfxMuted = () => getPrefs().sfxMuted;
export const setSfxMuted = (sfxMuted: boolean) => setPrefs({ sfxMuted });
export const isMusicMuted = () => getPrefs().musicMuted;
export const setMusicMuted = (musicMuted: boolean) => setPrefs({ musicMuted });
export const getSfxVolume = () => getPrefs().sfxVolume;
export const setSfxVolumeLevel = (sfxVolume: number) => setPrefs({ sfxVolume });
export const getMusicVolume = () => getPrefs().musicVolume;
export const setMusicVolumeLevel = (musicVolume: number) => setPrefs({ musicVolume });
export const getLastAwardedGameId = () => getPrefs().lastAwardedGameId;
export const setLastAwardedGameId = (lastAwardedGameId: string) => setPrefs({ lastAwardedGameId });
export const getSelectedVictoryMessage = () => getPrefs().selectedVictoryMessage;
export const setSelectedVictoryMessage = (selectedVictoryMessage: string) => setPrefs({ selectedVictoryMessage });
export const getSelectedShareFrame = () => getPrefs().selectedShareFrame;
export const setSelectedShareFrame = (selectedShareFrame: string) => setPrefs({ selectedShareFrame });
export const getSelectedMapTheme = () => getPrefs().selectedMapTheme;
export const setSelectedMapTheme = (selectedMapTheme: string) => setPrefs({ selectedMapTheme });
export const getEquippedBanner = () => getPrefs().equippedBanner;
export const setEquippedBannerLocal = (equippedBanner: string) => setPrefs({ equippedBanner });
export const getAvatarLocal = () => getPrefs().avatar;
export const setAvatarLocal = (avatar: string) => setPrefs({ avatar });
export const getPendingReferralCode = () => getPrefs().pendingReferralCode;
export const setPendingReferralCode = (pendingReferralCode: string) => setPrefs({ pendingReferralCode });
export const clearPendingReferralCode = () => setPrefs({ pendingReferralCode: null });
export const isFirstRunCoachDismissed = () => getPrefs().firstRunCoachDismissed;
export const markFirstRunCoachDismissed = () => setPrefs({ firstRunCoachDismissed: true });
export const isFirstGameplayTipsSeen = () => getPrefs().firstGameplayTipsSeen;
export const markFirstGameplayTipsSeen = () => setPrefs({ firstGameplayTipsSeen: true });
export const isGuidedOnboardingDone = () => getPrefs().guidedOnboardingDone;
export const markGuidedOnboardingDone = () => setPrefs({ guidedOnboardingDone: true });

// ── Accessibility & feel toggles (Settings screen) ────────────────────────────
export const isHapticsEnabled = () => getPrefs().hapticsEnabled;
export const setHapticsEnabled = (hapticsEnabled: boolean) => setPrefs({ hapticsEnabled });
export const isReducedMotion = () => getPrefs().reducedMotion;
export const setReducedMotion = (reducedMotion: boolean) => setPrefs({ reducedMotion });
export const isColorblindMode = () => getPrefs().colorblindMode;
export const setColorblindMode = (colorblindMode: boolean) => setPrefs({ colorblindMode });

// ── Pending game-completion replay (offline resilience) ───────────────────────
export const getPendingCompletion = (): PendingGameCompletion | null => getPrefs().pendingCompletion;
export const setPendingCompletion = (pendingCompletion: PendingGameCompletion | null) =>
  setPrefs({ pendingCompletion });

// ── Daily Challenge (device-local progress) ───────────────────────────────────
export const getDailyChallengeLocal = (): DailyChallengeLocal => ({
  ...DEFAULT_DAILY_CHALLENGE,
  ...getPrefs().dailyChallenge,
});

/** UTC YYYY-MM-DD one day before the given key (''  on a malformed key). */
function isoYesterday(dateKey: string): string {
  const t = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Record a finished daily attempt for `dateKey`. The first finish of a new day
 * advances the consecutive-day streak (resets to 1 on a gap); re-finishing the
 * same day keeps the streak and just refreshes the won flag / EV. Returns the
 * updated local record.
 */
export function recordDailyChallengeResult(dateKey: string, won: boolean, ev: number): DailyChallengeLocal {
  const prev = getDailyChallengeLocal();
  let next: DailyChallengeLocal;
  if (prev.lastPlayedDate === dateKey) {
    next = { ...prev, lastEv: ev, lastWonDate: won ? dateKey : prev.lastWonDate };
  } else {
    const consecutive = prev.lastPlayedDate != null && prev.lastPlayedDate === isoYesterday(dateKey);
    next = {
      lastPlayedDate: dateKey,
      lastWonDate: won ? dateKey : prev.lastWonDate,
      streak: consecutive ? prev.streak + 1 : 1,
      lastEv: ev,
    };
  }
  setPrefs({ dailyChallenge: next });
  return next;
}

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
