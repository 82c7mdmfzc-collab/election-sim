/**
 * useProfile — Zustand store for the player's meta-progression account.
 *
 * The economy (Campaign Funds, unlocks, lifetime stats) and the permanent
 * username are ACCOUNT-ONLY: they exist only while signed in and live entirely
 * in Supabase. A signed-out "guest" has the DEFAULT_PROFILE (all zeros), no
 * username, and cannot earn funds, unlock characters, or play online — but can
 * still play Solo and pass-and-play.
 *
 * Responsibilities:
 *   • init(): load the current session (if any) and hydrate the account.
 *   • applyGameResult(): single entry point at game end — when signed in, claims
 *     the server-authoritative Campaign Funds award and syncs stats.
 *   • unlock(): server-validated character purchase (signed-in only).
 *   • claimUsername(): one-time permanent username claim.
 */

import { create } from 'zustand';
import {
  type Profile,
  type ProfileStats,
  type GameCompletionMode,
  DEFAULT_PROFILE,
  fetchRemoteAccount,
  completeGameResultRemote,
  claimAchievementRewardRemote,
  fetchAdRewardStatusRemote,
  claimAdRewardRemote,
  unlockCharacterRemote,
  claimFreeCharacterRemote,
  unlockCosmeticRemote,
  deleteAccountRemote,
  claimLoginBonusRemote,
  type AdRewardClaimRemote,
  type UnlockRemoteErrorReason,
} from '../game/profile';
import type { AdRewardStatus } from '../utils/rewardedAds';
import { computeReward, type RewardBreakdown } from '../game/rewards';
import {
  ACHIEVEMENTS,
  type AchievementCounters,
  isAchievementComplete,
  normalizeAchievementCounters,
} from '../game/achievements';
import { setReferrer } from '../game/referral';
import {
  getPendingReferralCode,
  setPendingReferralCode,
  clearPendingReferralCode,
  getPendingCompletion,
  setPendingCompletion,
} from '../utils/localPrefs';
import { clearSession } from '../utils/sessionStore';
import { onGameFinishedNotifications } from '../utils/notifications';
import {
  getSession,
  onAuthChange,
  sendEmailCode as authSendEmailCode,
  verifyEmailCode as authVerifyEmailCode,
  signInWithGoogle as authSignInWithGoogle,
  signInWithApple as authSignInWithApple,
  claimDisplayName,
  type ClaimNameResult,
  signOut as authSignOut,
  type User,
} from '../utils/authClient';
import { initNativeAuthCallback } from '../utils/nativeAuthCallback';

export interface GameResult {
  /** Unique id of the finished game — used for server-side reward dedup. */
  gameId: string;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
  mode: GameCompletionMode;
  botDifficulty: 'easy' | 'medium' | 'hard' | 'impossible' | null;
  botCount: number;
  turns: number;
  electoralVotes: number;
  candidateId: string | null;
  opponentCount: number;
}

export interface ProgressRewardBreakdown extends RewardBreakdown {
  /** Game reward alone, before the daily completion streak bonus. */
  gameTotal: number;
  /** 14-day completion streak reward for this game, if this was today's first finish. */
  dailyStreakBonus: number;
  /** Streak day after this completion. 0 when the server did not advance the daily streak. */
  dailyStreakDay: number;
  /** Achievement ids that became complete from this result. Claiming their coins is separate. */
  newlyCompletedAchievements: string[];
}

interface ProfileStore {
  profile: Profile;
  userId: string | null;
  /** True when there is no signed-in account (guest). */
  guest: boolean;
  /** The account's permanent username, or null if signed-out / not yet claimed. */
  displayName: string | null;
  ready: boolean;
  /** True once the signed-in account fetch has settled (success / fail / timeout).
   *  Gates the one-time username prompt so it never flashes before we actually
   *  know whether this account already has a username. */
  accountChecked: boolean;
  /** The most recent award breakdown, for the victory-screen reveal. */
  lastReward: ProgressRewardBreakdown | null;
  /** Rewarded-ad quota for the signed-in account. Null until fetched. */
  adRewardStatus: AdRewardStatus | null;

  init(): Promise<void>;
  applyGameResult(result: GameResult): Promise<{ breakdown: ProgressRewardBreakdown; claimed: boolean }>;
  /** Claim the once-per-UTC-day login bonus (account-only). Returns funds granted (0 if none/already claimed). */
  claimDailyLoginBonus(): Promise<number>;
  /** Re-fetch the account from the server (e.g. after an IAP fulfillment). */
  refresh(): Promise<void>;
  clearLastReward(): void;
  claimAchievement(achievementId: string): Promise<boolean>;
  refreshAdRewardStatus(): Promise<AdRewardStatus | null>;
  claimAdReward(args: { placement: string; provider?: string | null; adUnit?: string | null }): Promise<AdRewardClaimResult>;
  unlock(characterId: string): Promise<boolean>;
  /** Server-validated FREE claim (account-only; server owns the "free now" rule). */
  claimFreeCharacter(characterId: string): Promise<boolean>;
  /** Server-validated cosmetic unlock (account-only; server owns the price). */
  unlockCosmetic(cosmeticId: string): Promise<CosmeticUnlockResult>;
  isUnlocked(characterId: string): boolean;
  sendEmailCode(email: string, signUp: boolean): Promise<{ error?: string }>;
  verifyEmailCode(email: string, code: string): Promise<{ error?: string }>;
  signInWithGoogle(): Promise<{ error?: string }>;
  signInWithApple(): Promise<{ error?: string }>;
  claimUsername(name: string): Promise<ClaimNameResult>;
  signOut(): Promise<void>;
  /** Permanently delete the account + all server data, then sign out. */
  deleteAccount(): Promise<boolean>;
}

let initialized = false;

export type AdRewardClaimResult =
  | { status: 'claimed'; amount: number; balance: number; adStatus: AdRewardStatus }
  | { status: 'limit'; adStatus: AdRewardStatus }
  | { status: 'auth_required' }
  | { status: 'error'; message: string };

export type CosmeticUnlockResult =
  | { ok: true }
  | { ok: false; reason: UnlockRemoteErrorReason; message: string };

/**
 * A fresh copy of the default profile.
 *
 * NB: we deliberately do NOT use `structuredClone` here. It was added in Safari
 * 15.4, but this app ships to iOS with an `IPHONEOS_DEPLOYMENT_TARGET` of 14.0,
 * whose WKWebView (iOS 14.0–15.3) lacks it. Calling it at module-eval time threw
 * before React mounted, leaving a blank screen on those devices. The Profile is
 * plain JSON data, so a JSON round-trip is a correct, universally-supported clone.
 */
function freshProfile(): Profile {
  return JSON.parse(JSON.stringify(DEFAULT_PROFILE)) as Profile;
}

/** Reject after `ms` so a hung network call can never trap the app on boot. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Whether a Supabase auth session is persisted locally (the v2 client stores it
 * under `sb-<ref>-auth-token`). Used so a slow/failed getSession() on boot doesn't
 * flash the sign-in screen at an already-signed-in user — we keep the branded
 * splash and let onAuthChange (INITIAL_SESSION, read from that same storage) in.
 */
function hasPersistedSession(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = window.localStorage.getItem(k);
        if (v && v !== 'null' && v !== '[]') return true;
      }
    }
  } catch {
    /* storage unavailable (private mode / SSR) — treat as no session */
  }
  return false;
}

const EMPTY_REWARD: ProgressRewardBreakdown = {
  base: 0,
  winBonus: 0,
  securedBonus: 0,
  dominanceBonus: 0,
  streakBonus: 0,
  gameTotal: 0,
  dailyStreakBonus: 0,
  dailyStreakDay: 0,
  newlyCompletedAchievements: [],
  total: 0,
};

export const useProfile = create<ProfileStore>((set, get) => ({
  profile: freshProfile(),
  userId: null,
  guest: true,
  displayName: null,
  ready: false,
  accountChecked: false,
  lastReward: null,
  adRewardStatus: null,

  async init() {
    if (initialized) return;
    initialized = true;

    // Capture an invite code from ?ref= before anything else, then strip it from
    // the URL so it doesn't linger or get re-shared. Redeemed after sign-in.
    captureReferralFromUrl();

    // React to future sign-in/out (OAuth redirect, magic link) by reloading.
    onAuthChange((user: User | null) => {
      void hydrateForUser(user, set);
    });

    // Native only: catch the OAuth deep-link callback (cold + warm start) and set
    // the session, which fires onAuthChange above. Dynamically imports the plugin;
    // a no-op on web. Runs in init() so cold-start (app launched by the link) works.
    void initNativeAuthCallback();

    // Boot is gated on `ready`; it must NEVER hang. getSession() reads the session
    // from local storage (no mandatory network round-trip), so for a signed-in user
    // it resolves fast and hydrateForUser sets { guest:false, ready:true } together —
    // no sign-in flash. Both calls are timeout-bounded so flaky signal can't trap us.
    try {
      const session = await withTimeout(getSession(), 5000);
      await withTimeout(hydrateForUser(session?.user ?? null, set), 5000);
    } catch {
      /* auth/network unavailable or timed out — fall through to the guest guard */
    } finally {
      // Only declare a guest boot when auth is STILL unresolved AND no session is
      // persisted locally. A signed-in user whose getSession() stalled then keeps
      // seeing the branded splash (never the sign-in screen); the pending
      // onAuthChange (INITIAL_SESSION, from that same storage) hydrates them in. A
      // genuinely signed-out user has no token and falls through to guest as before.
      if (!get().ready && !hasPersistedSession()) {
        set({ userId: null, guest: true, displayName: null, profile: freshProfile(), ready: true, accountChecked: true, adRewardStatus: null });
      }
    }
  },

  async applyGameResult(result) {
    const { profile, userId } = get();

    // Re-engagement notifications (native only; no-op on web). Fire-and-forget so
    // it never blocks the reward flow; the daily-streak nudge is account-only, and
    // the OS permission prompt appears here — after a finished game, never on launch.
    void onGameFinishedNotifications({ signedIn: !!userId });

    // No guest economy: a signed-out player earns nothing and sees no reveal.
    if (!userId) {
      set({ lastReward: null });
      return { breakdown: EMPTY_REWARD, claimed: false };
    }

    const prevStreak = profile.stats.winStreak;
    const newStreak = result.won ? prevStreak + 1 : 0;

    const breakdown = computeReward({
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
    });
    const optimisticCounters = advanceCounters(profile.achievementCounters, result, newStreak);
    const newlyCompletedAchievements = diffNewlyCompleted(
      profile.achievementCounters,
      optimisticCounters,
      profile.claimedAchievements,
    );
    const optimisticBreakdown: ProgressRewardBreakdown = {
      ...breakdown,
      gameTotal: breakdown.total,
      dailyStreakBonus: 0,
      dailyStreakDay: 0,
      newlyCompletedAchievements,
      total: breakdown.total,
    };

    const nextStats: ProfileStats = {
      gamesPlayed: profile.stats.gamesPlayed + 1,
      gamesWon: profile.stats.gamesWon + (result.won ? 1 : 0),
      winStreak: newStreak,
      bestWinStreak: Math.max(profile.stats.bestWinStreak, newStreak),
      coalitionsDominated: profile.stats.coalitionsDominated + result.coalitionsDominated,
    };

    // Optimistic in-memory update so the reveal is instant.
    set({
      profile: {
        ...profile,
        campaignFunds: profile.campaignFunds + breakdown.total,
        stats: nextStats,
        achievementCounters: optimisticCounters,
      },
      lastReward: optimisticBreakdown,
    });

    // Server: authoritative, deduped completion. It owns funds, daily streaks,
    // stats, and achievement counters; the client only sends bounded context.
    const completion = await completeGameResultRemote({
      gameId: result.gameId,
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
      mode: result.mode,
      botDifficulty: result.botDifficulty,
      botCount: result.botCount,
      turns: result.turns,
      electoralVotes: result.electoralVotes,
      candidateId: result.candidateId,
      opponentCount: result.opponentCount,
    });
    if (completion) {
      // Any queued offline replay for this game is now satisfied.
      if (getPendingCompletion()?.gameId === result.gameId) setPendingCompletion(null);
      const serverBreakdown: ProgressRewardBreakdown = {
        ...breakdown,
        gameTotal: completion.gameReward,
        dailyStreakBonus: completion.dailyStreakReward,
        dailyStreakDay: completion.dailyStreakDay,
        newlyCompletedAchievements: completion.newlyCompletedAchievements,
        total: completion.gameReward + completion.dailyStreakReward,
      };
      set({
        profile: {
          ...get().profile,
          campaignFunds: completion.balance,
          stats: completion.stats,
          achievementCounters: completion.achievementCounters,
          claimedAchievements: completion.claimedAchievements,
          dailyStreak: completion.dailyStreak,
        },
        lastReward: serverBreakdown,
      });
      return { breakdown: serverBreakdown, claimed: true };
    }
    // Server unreachable after retries: queue this finish so the next launch replays
    // it against the idempotent RPC, rather than silently losing the funds + stats.
    setPendingCompletion({
      userId,
      gameId: result.gameId,
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
      mode: result.mode,
      botDifficulty: result.botDifficulty,
      botCount: result.botCount,
      turns: result.turns,
      electoralVotes: result.electoralVotes,
      candidateId: result.candidateId,
      opponentCount: result.opponentCount,
    });
    return { breakdown: optimisticBreakdown, claimed: false };
  },

  async claimDailyLoginBonus() {
    if (!get().userId) return 0;
    const res = await claimLoginBonusRemote();
    if (!res) return 0;
    if (res.amount > 0) {
      set({ profile: { ...get().profile, campaignFunds: res.balance } });
    }
    return res.amount;
  },

  async refresh() {
    const { userId } = get();
    if (!userId) return;
    const account = await fetchRemoteAccount(userId);
    if (account) {
      set({ profile: account.profile, displayName: account.displayName ?? get().displayName });
    }
  },

  clearLastReward() {
    set({ lastReward: null });
  },

  async claimAchievement(achievementId) {
    const { profile, userId } = get();
    if (!userId || profile.claimedAchievements.includes(achievementId)) return false;

    const result = await claimAchievementRewardRemote(achievementId);
    if (!result) return false;

    set({
      profile: {
        ...get().profile,
        campaignFunds: result.balance,
        claimedAchievements: result.claimedAchievements,
      },
    });
    return result.amount > 0;
  },

  async refreshAdRewardStatus() {
    if (!get().userId) {
      set({ adRewardStatus: null });
      return null;
    }
    const status = await fetchAdRewardStatusRemote();
    if (status) set({ adRewardStatus: status });
    return status;
  },

  async claimAdReward(args) {
    if (!get().userId) return { status: 'auth_required' };
    const result = await claimAdRewardRemote(args);
    if (!result) return { status: 'error', message: 'Ad rewards are not configured yet.' };

    const adStatus = adStatusFromClaim(result);
    set({
      profile: {
        ...get().profile,
        campaignFunds: result.balance,
      },
      adRewardStatus: adStatus,
    });

    if (result.status === 'claimed') {
      return { status: 'claimed', amount: result.amount, balance: result.balance, adStatus };
    }
    return { status: 'limit', adStatus };
  },

  async unlock(characterId) {
    const { profile, userId } = get();
    if (profile.unlockedCharacters.includes(characterId)) return true;
    if (!userId) return false; // unlocks are account-only

    const updated = await unlockCharacterRemote(characterId);
    if (updated) {
      set({ profile: updated });
      return true;
    }
    return false;
  },

  async claimFreeCharacter(characterId) {
    const { profile, userId } = get();
    if (profile.unlockedCharacters.includes(characterId)) return true;
    if (!userId) return false; // claims are account-only
    const updated = await claimFreeCharacterRemote(characterId);
    if (updated) {
      set({ profile: updated });
      return true;
    }
    return false;
  },

  async unlockCosmetic(cosmeticId) {
    const { profile, userId } = get();
    if (profile.unlockedCharacters.includes(`cosmetic:${cosmeticId}`)) return { ok: true };
    if (!userId) {
      return { ok: false, reason: 'auth', message: 'Sign in to unlock cosmetics.' };
    }

    const result = await unlockCosmeticRemote(cosmeticId);
    if (result.ok) {
      set({ profile: result.profile });
      return { ok: true };
    }
    return result;
  },

  isUnlocked(characterId) {
    return get().profile.unlockedCharacters.includes(characterId);
  },

  async sendEmailCode(email, signUp) {
    return authSendEmailCode(email, { signUp });
  },

  async verifyEmailCode(email, code) {
    return authVerifyEmailCode(email, code);
  },

  async signInWithGoogle() {
    return authSignInWithGoogle();
  },

  async signInWithApple() {
    return authSignInWithApple();
  },

  async claimUsername(name) {
    const result = await claimDisplayName(name);
    if (result === 'ok') set({ displayName: name.trim() });
    return result;
  },

  async signOut() {
    // Always clear local state, even if the network sign-out throws — otherwise a
    // failed call would leave the user stuck "signed in". Also drop any online-lobby
    // session so a stale lobby binding doesn't linger into the next account.
    try {
      await authSignOut();
    } finally {
      clearSession();
      set({ userId: null, guest: true, displayName: null, profile: freshProfile(), adRewardStatus: null });
    }
  },

  async deleteAccount() {
    if (!get().userId) return false;
    const ok = await deleteAccountRemote();
    if (!ok) return false;
    // Server row + auth user are gone — tear down the local session + state.
    try {
      await authSignOut();
    } finally {
      clearSession();
      set({ userId: null, guest: true, displayName: null, profile: freshProfile(), adRewardStatus: null });
    }
    return true;
  },
}));

function adStatusFromClaim(result: AdRewardClaimRemote): AdRewardStatus {
  return {
    watched: result.watched,
    remaining: result.remaining,
    limit: result.limit,
    windowHours: result.windowHours,
    nextResetAt: result.nextResetAt,
  };
}

function advanceCounters(
  current: AchievementCounters,
  result: GameResult,
  nextWinStreak: number,
): AchievementCounters {
  const c = normalizeAchievementCounters(current);
  const next: AchievementCounters = {
    ...c,
    gamesFinished: c.gamesFinished + 1,
    gamesWon: c.gamesWon + (result.won ? 1 : 0),
    bestWinStreak: Math.max(c.bestWinStreak, nextWinStreak),
    coalitionsDominated: c.coalitionsDominated + result.coalitionsDominated,
    securedStatesLifetime: c.securedStatesLifetime + result.securedStates,
    maxCoalitionsSingleGame: Math.max(c.maxCoalitionsSingleGame, result.coalitionsDominated),
    maxSecuredStatesSingleGame: Math.max(c.maxSecuredStatesSingleGame, result.securedStates),
  };

  if (result.won) {
    next.maxWinEv = Math.max(c.maxWinEv, result.electoralVotes);
    next.fastestWinTurn = c.fastestWinTurn == null
      ? result.turns
      : Math.min(c.fastestWinTurn, result.turns);
  }

  if (result.mode === 'online') {
    next.onlineFinished = c.onlineFinished + 1;
    next.onlineWon = c.onlineWon + (result.won ? 1 : 0);
  }

  if (result.won && result.mode === 'bot') {
    if (result.botDifficulty === 'easy') next.botEasyWins = c.botEasyWins + 1;
    if (result.botDifficulty === 'medium') next.botMediumWins = c.botMediumWins + 1;
    if (result.botDifficulty === 'hard' || result.botDifficulty === 'impossible') {
      next.botHardWins = c.botHardWins + 1;
      next.botThreeHardWins = c.botThreeHardWins + (result.botCount >= 3 ? 1 : 0);
      next.botHard350Wins = c.botHard350Wins + (result.electoralVotes >= 350 ? 1 : 0);
    }
  }

  return next;
}

function diffNewlyCompleted(
  before: AchievementCounters,
  after: AchievementCounters,
  claimedIds: readonly string[],
): string[] {
  const claimed = new Set(claimedIds);
  return ACHIEVEMENTS
    .filter((def) => !claimed.has(def.id))
    .filter((def) => !isAchievementComplete(def, before) && isAchievementComplete(def, after))
    .map((def) => def.id);
}

async function hydrateForUser(
  user: User | null,
  set: (p: Partial<ProfileStore>) => void,
): Promise<void> {
  if (!user) {
    set({ userId: null, guest: true, displayName: null, profile: freshProfile(), ready: true, accountChecked: true, adRewardStatus: null });
    return;
  }
  // Mark signed-in and ready up front so the UI boots even if the account fetch
  // is slow; funds/stats/displayName fill in when it returns. A failed/hung fetch
  // leaves a default profile rather than trapping the app on the splash.
  // accountChecked is reset to false here (re-armed per account, e.g. after an
  // account switch) and flipped true only once this account's fetch settles below,
  // so the username prompt never flashes before we know the username state.
  set({ userId: user.id, guest: false, ready: true, accountChecked: false, adRewardStatus: null });
  let account: Awaited<ReturnType<typeof fetchRemoteAccount>> = null;
  try {
    // Bound the fetch: on a black-holed network it must still settle so the
    // accountChecked gate below releases — otherwise a signed-in user with no
    // cached displayName would be trapped on the splash forever (the gate only
    // flips true after this await).
    account = await withTimeout(fetchRemoteAccount(user.id), 5000);
  } catch {
    /* account fetch failed or timed out — keep the default profile, stay signed in */
  }
  // ALWAYS flip accountChecked, even on failure/timeout, so the username gate
  // resolves: a real new account falls through to the (recoverable) claim screen,
  // never the unrecoverable splash.
  set({
    displayName: account?.displayName ?? null,
    profile: account?.profile ?? freshProfile(),
    accountChecked: true,
  });

  // Replay a reward that failed to sync at a previous game's end (offline). Safe
  // and idempotent server-side; a no-op when nothing is queued for this account.
  void replayPendingCompletion(user.id);

  // If this account arrived via an invite link, record the referrer once. The
  // server guards make this safe & idempotent (returns already_set/not_eligible
  // for existing players); the actual payout lands on the invitee's first game.
  const pendingRef = getPendingReferralCode();
  if (pendingRef) {
    const result = await setReferrer(pendingRef);
    if (result !== 'error') clearPendingReferralCode();
  }
}

/**
 * Replay a finished game whose server sync failed (offline at game end). The
 * complete_game_result RPC is idempotent on (user, game_id), so re-sending is
 * safe even if the original actually landed — it returns the current balance with
 * gameReward 0. Bound to the owning account so a different user never inherits it.
 */
async function replayPendingCompletion(userId: string): Promise<void> {
  const pending = getPendingCompletion();
  if (!pending || pending.userId !== userId) return;
  const completion = await completeGameResultRemote({
    gameId: pending.gameId,
    won: pending.won,
    securedStates: pending.securedStates,
    coalitionsDominated: pending.coalitionsDominated,
    winStreak: pending.winStreak,
    mode: pending.mode,
    botDifficulty: pending.botDifficulty as GameResult['botDifficulty'],
    botCount: pending.botCount,
    turns: pending.turns,
    electoralVotes: pending.electoralVotes,
    candidateId: pending.candidateId,
    opponentCount: pending.opponentCount,
  });
  if (!completion) return; // still unreachable — keep it queued for next launch
  setPendingCompletion(null);
  const cur = useProfile.getState();
  if (cur.userId !== userId) return; // account switched mid-flight — don't cross funds
  useProfile.setState({
    profile: {
      ...cur.profile,
      campaignFunds: completion.balance,
      stats: completion.stats,
      achievementCounters: completion.achievementCounters,
      claimedAchievements: completion.claimedAchievements,
      dailyStreak: completion.dailyStreak,
    },
  });
}

/** Read a ?ref= invite code from the URL into localPrefs, then strip it. */
function captureReferralFromUrl(): void {
  try {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;
    setPendingReferralCode(ref);
    params.delete('ref');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  } catch {
    /* URL parsing/history unavailable — ignore */
  }
}

export const selectFunds = (s: ProfileStore) => s.profile.campaignFunds;
export const selectIsSignedIn = (s: ProfileStore) => !s.guest;
export const selectDisplayName = (s: ProfileStore) => s.displayName;
