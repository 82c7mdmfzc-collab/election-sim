/**
 * useProfile — Zustand store for the player's meta-progression account.
 *
 * Responsibilities:
 *   • On init: ensure a session (guest is fine), load the remote profile, merge
 *     it with the local mirror, and keep both in sync.
 *   • applyGameResult(): the single entry point used at game end — updates stats,
 *     computes the Campaign Funds award (pure rewards.ts), writes through to the
 *     server RPC, and stashes the breakdown for the victory reveal.
 *   • unlock(): server-validated character purchase.
 *
 * Everything degrades to localStorage-only when Supabase isn't configured, so
 * guest/offline play never breaks.
 */

import { create } from 'zustand';
import {
  type Profile,
  type ProfileStats,
  loadLocalProfile,
  saveLocalProfile,
  fetchRemoteProfile,
  pushRemoteStats,
  claimGameRewardRemote,
  unlockCharacterRemote,
  mergeProfiles,
} from '../game/profile';
import { computeReward, type RewardBreakdown } from '../game/rewards';
import {
  ensureSession,
  isGuest as authIsGuest,
  onAuthChange,
  sendMagicLink,
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
  guest: boolean;
  ready: boolean;
  /** The most recent award breakdown, for the victory-screen reveal. */
  lastReward: RewardBreakdown | null;

  init(): Promise<void>;
  applyGameResult(result: GameResult): Promise<RewardBreakdown>;
  clearLastReward(): void;
  unlock(characterId: string): Promise<boolean>;
  isUnlocked(characterId: string): boolean;
  signInWithEmail(email: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
}

let initialized = false;

export const useProfile = create<ProfileStore>((set, get) => ({
  profile: loadLocalProfile(),
  userId: null,
  guest: true,
  ready: false,
  lastReward: null,

  async init() {
    if (initialized) return;
    initialized = true;

    // React to future sign-in/out (e.g. magic-link upgrade) by reloading.
    onAuthChange((user: User | null) => {
      void hydrateForUser(user, set, get);
    });

    const user = await ensureSession();
    await hydrateForUser(user, set, get);
  },

  async applyGameResult(result) {
    const { profile } = get();
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

    // Optimistic local update so the reveal is instant.
    const optimistic: Profile = {
      ...profile,
      campaignFunds: profile.campaignFunds + breakdown.total,
      stats: nextStats,
    };
    persist(optimistic, set);
    set({ lastReward: breakdown });

    // Server: authoritative, deduped funds claim + stats sync. The server owns
    // the amount; we send only the (range-checked) outcome and the gameId.
    const userId = get().userId;
    const newBalance = await claimGameRewardRemote({
      gameId: result.gameId,
      won: result.won,
      securedStates: result.securedStates,
      coalitionsDominated: result.coalitionsDominated,
      winStreak: newStreak,
    });
    if (userId) void pushRemoteStats(userId, nextStats);
    if (newBalance != null) {
      const reconciled: Profile = { ...get().profile, campaignFunds: newBalance, stats: nextStats };
      persist(reconciled, set);
    }
    return breakdown;
  },

  clearLastReward() {
    set({ lastReward: null });
  },

  async unlock(characterId) {
    const { profile } = get();
    if (profile.unlockedCharacters.includes(characterId)) return true;

    const updated = await unlockCharacterRemote(characterId);
    if (updated) {
      persist(updated, set);
      return true;
    }
    // Offline/guest fallback: enforce the catalog cost locally.
    const cost = LOCAL_UNLOCK_COSTS[characterId];
    if (cost == null || profile.campaignFunds < cost) return false;
    const next: Profile = {
      ...profile,
      campaignFunds: profile.campaignFunds - cost,
      unlockedCharacters: [...profile.unlockedCharacters, characterId],
    };
    persist(next, set);
    return true;
  },

  isUnlocked(characterId) {
    return get().profile.unlockedCharacters.includes(characterId);
  },

  async signInWithEmail(email) {
    return sendMagicLink(email);
  },

  async signOut() {
    await authSignOut();
    set({ userId: null, guest: true });
  },
}));

/** Local fallback catalog (kept in sync with supabase/profiles.sql). */
const LOCAL_UNLOCK_COSTS: Record<string, number> = {
  joe_biden: 1500,
  ronald_reagan: 1500,
};

function persist(profile: Profile, set: (p: Partial<ProfileStore>) => void): void {
  saveLocalProfile(profile);
  set({ profile });
}

async function hydrateForUser(
  user: User | null,
  set: (p: Partial<ProfileStore>) => void,
  get: () => ProfileStore,
): Promise<void> {
  const local = get().profile;
  if (!user) {
    set({ userId: null, guest: true, ready: true });
    return;
  }
  const remote = await fetchRemoteProfile(user.id);
  const merged = remote ? mergeProfiles(local, remote) : local;
  persist(merged, set as (p: Partial<ProfileStore>) => void);
  set({ userId: user.id, guest: authIsGuest(user), ready: true });
}

export const selectFunds = (s: ProfileStore) => s.profile.campaignFunds;
