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
    body: 'States decide the election. Lead a state when the election fires and its EV goes to you. Your job is to build enough map leads to reach 270.',
  },
  {
    id: 'rungs',
    art: 'LVL',
    title: 'Fund Your Campaign',
    body: 'Click a state to fund your campaign and raise your Campaign Level there. A higher level means a stronger lead, and climbing to the top alone SECURES the state permanently.',
  },
  {
    id: 'coalitions',
    art: 'EV',
    title: 'State Groups Build Engines',
    body: 'States also belong to groups like Swing States, High Tech, and Agriculture. Lead enough EV inside a group to DOMINATE it and earn that group’s wallet every turn.',
  },
  {
    id: 'national',
    art: '$',
    title: 'National Groups Pay Flexible Cash',
    body: 'The national ladders are side battles. Lead groups like Gun Lobby, Youth Vote, or Women’s Vote to Level 4+ to earn national cash that spends anywhere.',
  },
  {
    id: 'wallets',
    art: '$',
    title: 'Two Kinds of Money',
    body: 'State-group wallets are earmarked and only spend inside that group’s states. National cash is flexible. Strong campaigns use both: group wallets for lanes, national cash for pivots.',
  },
  {
    id: 'clash',
    art: '!',
    title: 'Beware the Clash',
    body: 'Everyone allocates secretly and at the same time. If two players land on the exact same Campaign Level in a state, BOTH lose those levels AND the cash spent. Read your opponent — clashing by accident is the costliest mistake in the game.',
  },
  {
    id: 'election',
    art: '270',
    title: 'Election Night',
    body: 'From round 11 on, an election can fire each turn with rising odds. EV is tallied and the first to 270 wins. No winner means a hung Electoral College — and the odds climb for next time. Have your path to 270 ready before the gavel falls.',
  },
  {
    id: 'go',
    art: 'GO',
    title: 'You’re Ready, Candidate',
    body: 'Your first campaign will coach the next move live: open a state lane, claim income from state groups and national groups, then convert that engine into 270.',
    cta: true,
  },
];
