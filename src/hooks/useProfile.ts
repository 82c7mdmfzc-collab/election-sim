/**
 * useProfile — Zustand store for the player's meta-progression account.
 *
 * The economy (Campaign Funds, unlocks, lifetime stats) and the permanent
 * username are ACCOUNT-ONLY: they exist only while signed in and live entirely
 * in Supabase. A signed-out "guest" has the DEFAULT_PROFILE (all zeros), no
 * username, and cannot earn funds, unlock characters, or play online — but can
 * still play vs-bot and pass-and-play.
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
  DEFAULT_PROFILE,
  fetchRemoteAccount,
  pushRemoteStats,
  claimGameRewardRemote,
  unlockCharacterRemote,
} from '../game/profile';
import { computeReward, type RewardBreakdown } from '../game/rewards';
import {
  getUser,
  onAuthChange,
  sendMagicLink,
  signInWithGoogle as authSignInWithGoogle,
  signInWithApple as authSignInWithApple,
  claimDisplayName,
  type ClaimNameResult,
  signOut as authSignOut,
  type User,
} from '../utils/authClient';

export interface GameResult {
  /** Unique id of the finished game — used for server-side reward dedup. */
  gameId: string;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
}

interface ProfileStore {
  profile: Profile;
  userId: string | null;
  /** True when there is no signed-in account (guest). */
  guest: boolean;
  /** The account's permanent username, or null if signed-out / not yet claimed. */
  displayName: string | null;
  ready: boolean;
  /** The most recent award breakdown, for the victory-screen reveal. */
  lastReward: RewardBreakdown | null;

  init(): Promise<void>;
  applyGameResult(result: GameResult): Promise<RewardBreakdown>;
  clearLastReward(): void;
  unlock(characterId: string): Promise<boolean>;
  isUnlocked(characterId: string): boolean;
  signInWithEmail(email: string): Promise<{ error?: string }>;
  signInWithGoogle(): Promise<{ error?: string }>;
  signInWithApple(): Promise<{ error?: string }>;
  claimUsername(name: string): Promise<ClaimNameResult>;
  signOut(): Promise<void>;
}

let initialized = false;

const EMPTY_REWARD: RewardBreakdown = {
  base: 0,
  winBonus: 0,
  securedBonus: 0,
  dominanceBonus: 0,
  streakBonus: 0,
  total: 0,
};

export const useProfile = create<ProfileStore>((set, get) => ({
  profile: structuredClone(DEFAULT_PROFILE),
  userId: null,
  guest: true,
  displayName: null,
  ready: false,
  lastReward: null,

  async init() {
    if (initialized) return;
    initialized = true;

    // React to future sign-in/out (OAuth redirect, magic link) by reloading.
    onAuthChange((user: User | null) => {
      void hydrateForUser(user, set);
    });

    const user = await getUser();
    await hydrateForUser(user, set);
  },

  async applyGameResult(result) {
    const { profile, userId } = get();

    // No guest economy: a signed-out player earns nothing and sees no reveal.
    if (!userId) {
      set({ lastReward: null });
      return EMPTY_REWARD;
    }

    const prevStreak = profile.stats.winStreak;
    const newStreak = result.won ? prevStreak + 1 : 0;

    const breakdown = computeReward({
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
    });

    const nextStats: ProfileStats = {
      gamesPlayed: profile.stats.gamesPlayed + 1,
      gamesWon: profile.stats.gamesWon + (result.won ? 1 : 0),
      winStreak: newStreak,
      bestWinStreak: Math.max(profile.stats.bestWinStreak, newStreak),
      coalitionsDominated: profile.stats.coalitionsDominated + result.coalitionsDominated,
    };

    // Optimistic in-memory update so the reveal is instant.
    set({
      profile: { ...profile, campaignFunds: profile.campaignFunds + breakdown.total, stats: nextStats },
      lastReward: breakdown,
    });

    // Server: authoritative, deduped funds claim + stats sync. The server owns
    // the amount; we send only the (range-checked) outcome and the gameId.
    const newBalance = await claimGameRewardRemote({
      gameId: result.gameId,
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
    });
    void pushRemoteStats(userId, nextStats);
    if (newBalance != null) {
      set({ profile: { ...get().profile, campaignFunds: newBalance, stats: nextStats } });
    }
    return breakdown;
  },

  clearLastReward() {
    set({ lastReward: null });
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

  isUnlocked(characterId) {
    return get().profile.unlockedCharacters.includes(characterId);
  },

  async signInWithEmail(email) {
    return sendMagicLink(email);
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
    await authSignOut();
    set({ userId: null, guest: true, displayName: null, profile: structuredClone(DEFAULT_PROFILE) });
  },
}));

async function hydrateForUser(
  user: User | null,
  set: (p: Partial<ProfileStore>) => void,
): Promise<void> {
  if (!user) {
    set({ userId: null, guest: true, displayName: null, profile: structuredClone(DEFAULT_PROFILE), ready: true });
    return;
  }
  const account = await fetchRemoteAccount(user.id);
  set({
    userId: user.id,
    guest: false,
    displayName: account?.displayName ?? null,
    profile: account?.profile ?? structuredClone(DEFAULT_PROFILE),
    ready: true,
  });
}

export const selectFunds = (s: ProfileStore) => s.profile.campaignFunds;
export const selectIsSignedIn = (s: ProfileStore) => !s.guest;
export const selectDisplayName = (s: ProfileStore) => s.displayName;
