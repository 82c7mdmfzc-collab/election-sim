/**
 * Tutorial script — the ordered steps of the first-run walkthrough.
 *
 * Kept as data (not JSX) so the flow is easy to reorder/extend and could later
 * be reused for a localized or voiced version. Tutorial.tsx renders these.
 *
 * `art` is a compact display badge rendered by Tutorial.tsx. `cta` (last step)
 * flips the primary button to "start a game".
 */

export interface TutorialStep {
  readonly id: string;
  readonly art: string;
  readonly title: string;
  readonly body: string;
  /** When true this is the closing step; the primary button starts a practice game. */
  readonly cta?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'goal',
    art: '270',
    title: 'Win 270 Electoral Votes',
    body: 'States decide the election. Lead a state when Election Night fires and its EV goes to you. Your job is to build enough map influence to reach 270.',
  },
  {
    id: 'rungs',
    art: 'IL',
    title: 'Build Influence On The Map',
    body: 'Click a state to build Influence Levels. More Influence Levels means a stronger lead — and reaching full influence alone CALLS that state permanently.',
  },
  {
    id: 'coalitions',
    art: 'EV',
    title: 'Coalitions Build Engines',
    body: 'States belong to Coalitions like Swing States, High Tech, and Agriculture. Lead enough EV inside a Coalition to control it and earn that Coalition\'s Reserve every turn.',
  },
  {
    id: 'national',
    art: '$',
    title: 'National Networks Pay Flexible Cash',
    body: 'The national network tracks are side battles. Lead networks like Gun Lobby, Youth Vote, or Women\'s Vote with 4+ Influence Levels to earn War Chest funds that spend anywhere.',
  },
  {
    id: 'wallets',
    art: '$',
    title: 'Two Kinds of Money',
    body: 'Coalition Reserves are earmarked and only spend inside that Coalition\'s states. Your National War Chest is flexible. Strong campaigns use both: Coalition Reserves for lanes, War Chest for pivots.',
  },
  {
    id: 'clash',
    art: '!',
    title: 'Campaign Collisions',
    body: 'Everyone submits their operation plan secretly and at the same time. If two campaigns land on the exact same Influence Level in a state, BOTH campaigns burn those Influence Levels AND the spend. Read your opponent — a collision is the costliest mistake in the game.',
  },
  {
    id: 'election',
    art: '270',
    title: 'Election Night',
    body: 'From Turn 11 on, Election Night pressure fires each turn with rising Projection Pressure. EV is tallied and the first to 270 wins. No winner means a Deadlocked Election — and the odds climb for next time. Have your path to 270 ready before Election Night.',
  },
  {
    id: 'go',
    art: 'GO',
    title: "You're Ready, Candidate",
    body: 'Your first campaign will coach the next move live: establish a foothold in a state, claim Coalition backing and network funds, then convert that engine into 270.',
    cta: true,
  },
];
