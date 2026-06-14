/**
 * Strategy tips & how-to-play copy — the single source for every "downtime"
 * surface (online wait, hot-seat handoff, resolution ticker, loading splash).
 *
 * Previously these lived inline in WaitingOnPlayers.tsx; they're centralized here
 * so every wait screen teaches the same lessons and the set is easy to grow.
 *
 * Categories let a surface pull a focused subset (e.g. the handoff curtain leans
 * on `tempo` + `clash`), while STRATEGY_TIPS is the full shuffled rotation.
 */

export type TipCategory = 'map' | 'economy' | 'clash' | 'tempo' | 'endgame';

export interface Tip {
  readonly category: TipCategory;
  readonly text: string;
}

export const TIPS: readonly Tip[] = [
  // ── Map hubs ──────────────────────────────────────────────────────────────
  { category: 'map', text: 'California, Florida, New York, Texas, and North Carolina each anchor 5 coalition groups — dominating one unlocks five income streams at once.' },
  { category: 'map', text: 'Florida sits where African American, Agriculture, Export Driven, Latino, and Swing States all meet. A true 5-way hub.' },
  { category: 'map', text: 'Pennsylvania anchors three groups: High Tech, Manufacturing Base, and Swing States.' },
  { category: 'map', text: 'Arizona packs African American, Latino, Swing States, and Town and Gown into one cheap state — just 46k per rung early.' },
  { category: 'map', text: 'A state pays its electoral votes to whoever holds the most rungs there. Secure it and the EV is locked for good.' },
  { category: 'map', text: 'Big prizes draw big fights. California is worth the most EV — and invites the most expensive clashes.' },

  // ── Economy ───────────────────────────────────────────────────────────────
  { category: 'economy', text: 'Group wallets are earmarked: a coalition bonus only pays for states inside that group. Plan your spending lanes.' },
  { category: 'economy', text: "National groups (Gun Lobby, Women's Vote…) pay flexible nationalCash — far more spendable than earmarked group wallets." },
  { category: 'economy', text: 'Every player draws a flat +250k national income each turn. Your edge comes from coalition bonuses on top of it.' },
  { category: 'economy', text: 'Dominate a state group (over half its EV) and you collect that group’s payout every single turn it stays yours.' },
  { category: 'economy', text: 'Your candidate’s affinities make some states cheaper. Build where you have a discount and your money goes further.' },
  { category: 'economy', text: 'Payout modifiers boost income from your strong coalitions. Lean into them — that compounding wins games.' },

  // ── Clash / denial ────────────────────────────────────────────────────────
  { category: 'clash', text: 'Clashing on a state forfeits the rungs AND the cash for BOTH players. Reading your opponent avoids costly collisions.' },
  { category: 'clash', text: 'Losing coalition dominance triggers the Evaporation Penalty: that group wallet drops to $0 instantly. Defend your leads.' },
  { category: 'clash', text: 'You can clash on purpose to deny a rival a state they need — but you pay for it too. Spend denial only where it counts.' },
  { category: 'clash', text: 'If a rival is one rung from securing a state, matching them forces a clash and resets the race. Sometimes worth it.' },

  // ── Tempo / timing ────────────────────────────────────────────────────────
  { category: 'tempo', text: 'Early rungs are capped per turn. Open many fronts early, then sprint the ones that matter as the cap lifts.' },
  { category: 'tempo', text: 'Spreading thin builds income; concentrating wins states. Shift from breadth to depth as the election clock ticks.' },
  { category: 'tempo', text: 'Bank cash when you’re ahead. A late war chest lets you buy boss-rungs nobody else can afford.' },
  { category: 'tempo', text: 'Watch what your opponent secured last turn — it tells you where they’ll spend next.' },

  // ── Endgame / the 270 push ────────────────────────────────────────────────
  { category: 'endgame', text: 'Elections can fire from turn 11 onward. With hung colleges stacking, the odds spike — have 270 lined up before then.' },
  { category: 'endgame', text: '270 wins it. Count your projected EV every turn and know exactly which states close the gap.' },
  { category: 'endgame', text: 'Secured states can’t be flipped. Lock your path to 270 first, then expand for the tiebreakers.' },
  { category: 'endgame', text: 'A hung Electoral College raises the next election’s chance. If you can’t win the count, deny everyone else 270.' },
  { category: 'endgame', text: 'In a tie on EV, cash on hand breaks it. Don’t bankrupt yourself the turn before the election fires.' },
];

/** Flat list of tip strings, in declaration order. */
export const STRATEGY_TIPS: readonly string[] = TIPS.map((t) => t.text);

/** Tips filtered to one or more categories (falls back to all). */
export function tipsFor(...categories: TipCategory[]): string[] {
  if (categories.length === 0) return [...STRATEGY_TIPS];
  const set = new Set(categories);
  return TIPS.filter((t) => set.has(t.category)).map((t) => t.text);
}

/**
 * Concise rules reference for the in-game "?" help and the tutorial recap.
 * Ordered as a first read-through of how a turn works.
 */
export interface HelpSection {
  readonly title: string;
  readonly body: string;
}

export const HOW_TO_PLAY: readonly HelpSection[] = [
  {
    title: 'Goal',
    body: 'Reach 270 electoral votes. Each state awards its EV to whoever holds the most campaign rungs there when the election fires.',
  },
  {
    title: 'Campaign (the rungs)',
    body: 'On your turn, click a state or a national ladder to buy rungs. Rungs cost cash and rise in price as you climb. Whoever leads a state on election day takes its EV; lead it alone to the top and you SECURE it permanently.',
  },
  {
    title: 'Coalitions & income',
    body: 'States belong to coalition groups. Control over half of a group’s EV and you DOMINATE it, earning that group’s payout every turn. National ladders (Gun Lobby, Women’s Vote…) pay flexible cash. This income funds your next push.',
  },
  {
    title: 'Wallets',
    body: 'You hold a flexible national cash pool plus earmarked group wallets. Group wallets can only be spent on states inside that group — national cash spends anywhere.',
  },
  {
    title: 'Clashes',
    body: 'Allocations are simultaneous and hidden. If two players reach the same rung count on the same state, BOTH lose those rungs and the cash. Read your opponent before you commit.',
  },
  {
    title: 'Evaporation',
    body: 'Lose dominance of a coalition and its group wallet instantly drops to $0. Defend the leads that pay you.',
  },
  {
    title: 'Election',
    body: 'From turn 11 on, an election can fire each round with rising odds. EV is tallied; first to 270 wins. No winner means a hung college — odds climb for next time.',
  },
];
