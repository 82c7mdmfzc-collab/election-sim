import { PREMIUM_CANDIDATES } from './candidates';

export const STREAK_REWARDS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100] as const;

export interface DailyStreakState {
  count: number;
  lastDate: string | null;
}

export interface AchievementCounters {
  gamesFinished: number;
  gamesWon: number;
  bestWinStreak: number;
  coalitionsDominated: number;
  securedStatesLifetime: number;
  botEasyWins: number;
  botMediumWins: number;
  botHardWins: number;
  botThreeHardWins: number;
  botHard350Wins: number;
  maxCoalitionsSingleGame: number;
  maxSecuredStatesSingleGame: number;
  maxWinEv: number;
  fastestWinTurn: number | null;
  onlineFinished: number;
  onlineWon: number;
  premiumUnlocks: number;
  referralsRedeemed: number;
}

export const DEFAULT_DAILY_STREAK: DailyStreakState = {
  count: 0,
  lastDate: null,
};

export const DEFAULT_ACHIEVEMENT_COUNTERS: AchievementCounters = {
  gamesFinished: 0,
  gamesWon: 0,
  bestWinStreak: 0,
  coalitionsDominated: 0,
  securedStatesLifetime: 0,
  botEasyWins: 0,
  botMediumWins: 0,
  botHardWins: 0,
  botThreeHardWins: 0,
  botHard350Wins: 0,
  maxCoalitionsSingleGame: 0,
  maxSecuredStatesSingleGame: 0,
  maxWinEv: 0,
  fastestWinTurn: null,
  onlineFinished: 0,
  onlineWon: 0,
  premiumUnlocks: 0,
  referralsRedeemed: 0,
};

export type AchievementTree =
  | 'Campaign Trail'
  | 'Solo Challenges'
  | 'Strategist'
  | 'Online'
  | 'Roster & Community';

export interface AchievementDef {
  id: string;
  tree: AchievementTree;
  title: string;
  description: string;
  reward: number;
  target: number;
  value(counters: AchievementCounters): number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'campaign_finish_first',
    tree: 'Campaign Trail',
    title: 'First Campaign',
    description: 'Finish your first game.',
    reward: 10,
    target: 1,
    value: (c) => c.gamesFinished,
  },
  {
    id: 'campaign_win_first',
    tree: 'Campaign Trail',
    title: 'First Victory',
    description: 'Win your first game.',
    reward: 25,
    target: 1,
    value: (c) => c.gamesWon,
  },
  {
    id: 'campaign_finish_10',
    tree: 'Campaign Trail',
    title: 'Campaign Regular',
    description: 'Finish 10 games.',
    reward: 40,
    target: 10,
    value: (c) => c.gamesFinished,
  },
  {
    id: 'campaign_win_25',
    tree: 'Campaign Trail',
    title: 'Electoral Fixture',
    description: 'Win 25 games.',
    reward: 75,
    target: 25,
    value: (c) => c.gamesWon,
  },
  {
    id: 'campaign_streak_5',
    tree: 'Campaign Trail',
    title: 'Momentum Run',
    description: 'Reach a 5-win streak.',
    reward: 100,
    target: 5,
    value: (c) => c.bestWinStreak,
  },
  {
    id: 'bot_beat_easy',
    tree: 'Solo Challenges',
    title: 'Opening Move',
    description: 'Win on Easy difficulty.',
    reward: 15,
    target: 1,
    value: (c) => c.botEasyWins,
  },
  {
    id: 'bot_beat_medium',
    tree: 'Solo Challenges',
    title: 'Map Operator',
    description: 'Win on Medium difficulty.',
    reward: 35,
    target: 1,
    value: (c) => c.botMediumWins,
  },
  {
    id: 'bot_beat_hard',
    tree: 'Solo Challenges',
    title: 'Hard Read',
    description: 'Win on Hard difficulty.',
    reward: 75,
    target: 1,
    value: (c) => c.botHardWins,
  },
  {
    id: 'bot_beat_3_hard',
    tree: 'Solo Challenges',
    title: 'Three-Seat Sweep',
    description: 'Win a 1v3 Hard solo campaign.',
    reward: 100,
    target: 1,
    value: (c) => c.botThreeHardWins,
  },
  {
    id: 'bot_hard_350_ev',
    tree: 'Solo Challenges',
    title: 'Hard Mode Mandate',
    description: 'Win on Hard with 350+ EV.',
    reward: 100,
    target: 1,
    value: (c) => c.botHard350Wins,
  },
  {
    id: 'strategy_secure_first',
    tree: 'Strategist',
    title: 'Locked In',
    description: 'Secure your first state.',
    reward: 15,
    target: 1,
    value: (c) => c.securedStatesLifetime,
  },
  {
    id: 'strategy_3_coalitions',
    tree: 'Strategist',
    title: 'Coalition Builder',
    description: 'Dominate 3 coalitions in one game.',
    reward: 40,
    target: 3,
    value: (c) => c.maxCoalitionsSingleGame,
  },
  {
    id: 'strategy_10_states',
    tree: 'Strategist',
    title: 'Map Lock',
    description: 'Secure 10 states in one game.',
    reward: 60,
    target: 10,
    value: (c) => c.maxSecuredStatesSingleGame,
  },
  {
    id: 'strategy_350_ev',
    tree: 'Strategist',
    title: 'Landslide',
    description: 'Win with 350+ EV.',
    reward: 80,
    target: 350,
    value: (c) => c.maxWinEv,
  },
  {
    id: 'strategy_fast_win',
    tree: 'Strategist',
    title: 'Early Projection',
    description: 'Win by turn 12 or earlier.',
    reward: 100,
    target: 1,
    value: (c) => (c.fastestWinTurn != null && c.fastestWinTurn <= 12 ? 1 : 0),
  },
  {
    id: 'online_finish_first',
    tree: 'Online',
    title: 'On the Air',
    description: 'Finish your first online game.',
    reward: 20,
    target: 1,
    value: (c) => c.onlineFinished,
  },
  {
    id: 'online_win_first',
    tree: 'Online',
    title: 'Live Win',
    description: 'Win your first online game.',
    reward: 50,
    target: 1,
    value: (c) => c.onlineWon,
  },
  {
    id: 'online_win_5',
    tree: 'Online',
    title: 'Prime-Time Player',
    description: 'Win 5 online games.',
    reward: 75,
    target: 5,
    value: (c) => c.onlineWon,
  },
  {
    id: 'online_win_10',
    tree: 'Online',
    title: 'Network Favorite',
    description: 'Win 10 online games.',
    reward: 100,
    target: 10,
    value: (c) => c.onlineWon,
  },
  {
    id: 'roster_unlock_first',
    tree: 'Roster & Community',
    title: 'Recruiter',
    description: 'Unlock your first premium candidate.',
    reward: 25,
    target: 1,
    value: (c) => c.premiumUnlocks,
  },
  {
    id: 'roster_unlock_all',
    tree: 'Roster & Community',
    title: 'Full Bench',
    description: 'Own all premium candidates.',
    reward: 100,
    target: PREMIUM_CANDIDATES.length,
    value: (c) => c.premiumUnlocks,
  },
  {
    id: 'community_referral_1',
    tree: 'Roster & Community',
    title: 'Field Office',
    description: 'Redeem one successful referral.',
    reward: 50,
    target: 1,
    value: (c) => c.referralsRedeemed,
  },
  {
    id: 'community_referral_3',
    tree: 'Roster & Community',
    title: 'Ground Game',
    description: 'Redeem three successful referrals.',
    reward: 100,
    target: 3,
    value: (c) => c.referralsRedeemed,
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const ACHIEVEMENT_TREES: readonly AchievementTree[] = [
  'Campaign Trail',
  'Solo Challenges',
  'Strategist',
  'Online',
  'Roster & Community',
];

export function normalizeAchievementCounters(input: Partial<AchievementCounters> | null | undefined): AchievementCounters {
  const source = input ?? {};
  return {
    ...DEFAULT_ACHIEVEMENT_COUNTERS,
    ...source,
    fastestWinTurn: typeof source.fastestWinTurn === 'number' ? source.fastestWinTurn : null,
  };
}

export function normalizeDailyStreak(input: Partial<DailyStreakState> | null | undefined): DailyStreakState {
  return {
    count: Math.max(0, Math.floor(input?.count ?? 0)),
    lastDate: typeof input?.lastDate === 'string' && input.lastDate ? input.lastDate : null,
  };
}

export function achievementValue(def: AchievementDef, counters: AchievementCounters): number {
  return Math.max(0, def.value(counters));
}

export function isAchievementComplete(def: AchievementDef, counters: AchievementCounters): boolean {
  return achievementValue(def, counters) >= def.target;
}

export function achievementPct(def: AchievementDef, counters: AchievementCounters): number {
  if (def.target <= 0) return 100;
  return Math.min(100, Math.round((achievementValue(def, counters) / def.target) * 100));
}

export function claimableAchievements(counters: AchievementCounters, claimedIds: readonly string[]): AchievementDef[] {
  const claimed = new Set(claimedIds);
  return ACHIEVEMENTS.filter((def) => isAchievementComplete(def, counters) && !claimed.has(def.id));
}

export function nextAchievement(counters: AchievementCounters, claimedIds: readonly string[]): AchievementDef | null {
  const claimed = new Set(claimedIds);
  return ACHIEVEMENTS.find((def) => !claimed.has(def.id) && !isAchievementComplete(def, counters)) ?? null;
}

export function streakRewardForDay(day: number): number {
  if (day <= 0) return 0;
  return STREAK_REWARDS[Math.min(day, STREAK_REWARDS.length) - 1] ?? 100;
}

export function premiumUnlockCount(unlocked: readonly string[]): number {
  const owned = new Set(unlocked);
  return PREMIUM_CANDIDATES.filter((c) => owned.has(c.id)).length;
}
