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
  { category: 'map', text: 'California, Florida, New York, Texas, and North Carolina each anchor 5 Coalitions — leading one unlocks five income streams at once.' },
  { category: 'map', text: 'Florida sits where African American, Agriculture, Export Driven, Latino, and Swing States all meet. A true 5-way hub.' },
  { category: 'map', text: 'Pennsylvania anchors three Coalitions: High Tech, Manufacturing Base, and Swing States.' },
  { category: 'map', text: 'Arizona packs African American, Latino, Swing States, and Town and Gown into one cheap state — just 46k per Influence Level early.' },
  { category: 'map', text: 'A state pays its EV to whoever holds the most Influence Levels there. Call it and the EV is locked for good.' },
  { category: 'map', text: 'Big prizes draw big fights. California is worth the most EV — and invites the most expensive campaign collisions.' },

  // ── Economy ───────────────────────────────────────────────────────────────
  { category: 'economy', text: 'Coalition Reserves are earmarked: a coalition bonus only pays for states inside that Coalition. Plan your spending lanes.' },
  { category: 'economy', text: "National Networks (Gun Lobby, Women's Vote…) pay flexible War Chest funds — far more spendable than earmarked Coalition Reserves." },
  { category: 'economy', text: 'Every campaign draws a flat +240k War Chest income each turn. Your edge comes from coalition backing on top of it.' },
  { category: 'economy', text: 'Lead a Coalition (over half its EV) and you collect that Coalition\'s Reserve every single turn it stays yours.' },
  { category: 'economy', text: 'Your candidate\'s affinities make some states cheaper. Build where you have a discount and your money goes further.' },
  { category: 'economy', text: 'Payout modifiers boost backing from your strong Coalitions. Lean into them — that compounding wins games.' },

  // ── Clash / denial ────────────────────────────────────────────────────────
  { category: 'clash', text: 'A Campaign Collision burns Influence Levels AND spend for BOTH campaigns. Reading your opponent avoids it.' },
  { category: 'clash', text: 'Losing coalition control triggers a Reserve Collapse: that Coalition Reserve drops to $0 instantly. Defend your leads.' },
  { category: 'clash', text: 'You can force a Campaign Collision to deny a rival a state — but you pay for it too. Spend denial only where it counts.' },
  { category: 'clash', text: 'If a rival is one Influence Level from calling a state, matching them forces a Campaign Collision and resets the race. Sometimes worth it.' },

  // ── Tempo / timing ────────────────────────────────────────────────────────
  { category: 'tempo', text: 'Early Influence Levels are capped per turn. Open many fronts early, then sprint the ones that matter as the cap lifts.' },
  { category: 'tempo', text: 'Spreading thin builds income; concentrating calls states. Shift from breadth to depth as the Election Night clock ticks.' },
  { category: 'tempo', text: 'Bank cash when you\'re ahead. A late War Chest lets you buy boss-level Influence that nobody else can afford.' },
  { category: 'tempo', text: 'Watch what your opponent called last turn — it tells you where they\'ll spend next.' },

  // ── Endgame / the 270 push ────────────────────────────────────────────────
  { category: 'endgame', text: 'Election Night pressure fires from Turn 11. With Deadlocked Elections stacking, Projection Pressure spikes — have 270 lined up before then.' },
  { category: 'endgame', text: '270 wins it. Count your projected EV every turn and know exactly which states close the gap.' },
  { category: 'endgame', text: 'Called states can\'t be flipped. Lock your path to 270 first, then expand for the tiebreakers.' },
  { category: 'endgame', text: 'A Deadlocked Election raises the next Projection Pressure. If you can\'t win the count, deny everyone else 270.' },
  { category: 'endgame', text: 'In a tie on EV, cash on hand breaks it. Don\'t bankrupt yourself the turn before Election Night fires.' },
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
    body: 'Reach 270 electoral votes. Each state awards its EV to whoever holds the most Influence Levels there when Election Night fires.',
  },
  {
    title: 'Influence Levels',
    body: 'On your turn, click a state or a national network to build Influence Levels. Costs rise as you climb. Whoever leads a state when the election fires takes its EV; reach full influence alone and that state is CALLED permanently.',
  },
  {
    title: 'Coalitions & income',
    body: 'States belong to Coalitions like Swing States, High Tech, and Agriculture. Control over half of a Coalition\'s EV and you lead it, earning that Coalition\'s Reserve every turn.',
  },
  {
    title: 'National Networks',
    body: 'Network tracks like Gun Lobby, Youth Vote, and Women\'s Vote are side battles. Lead one with 4+ Influence Levels to earn War Chest funds that can be spent anywhere.',
  },
  {
    title: 'War Chest & Reserves',
    body: 'You hold a flexible National War Chest plus earmarked Coalition Reserves. Coalition Reserves can only be spent on states inside that Coalition — War Chest funds spend anywhere.',
  },
  {
    title: 'Campaign Collisions',
    body: 'Operation plans are simultaneous and hidden. If two campaigns reach the same Influence Level on the same state, BOTH burn those Influence Levels and the spend. Read your opponent before you commit.',
  },
  {
    title: 'Reserve Collapse',
    body: 'Lose coalition control and its Reserve instantly collapses to $0. Protect your Coalitions — if control flips, the Reserve is gone.',
  },
  {
    title: 'Election',
    body: 'From Turn 11 on, Election Night can fire each round with rising Projection Pressure. EV is tallied; first to 270 wins. No winner means a Deadlocked Election — Projection Pressure climbs for next time.',
  },
];
