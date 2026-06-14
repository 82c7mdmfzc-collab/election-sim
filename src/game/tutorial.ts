/**
 * Tutorial script — the ordered steps of the first-run walkthrough.
 *
 * Kept as data (not JSX) so the flow is easy to reorder/extend and could later
 * be reused for a localized or voiced version. Tutorial.tsx renders these.
 *
 * `art` is a big emoji/glyph used as a lightweight illustration — no new image
 * assets required. `cta` (last step) flips the primary button to "start a game".
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
    art: '🎯',
    title: 'Win 270 Electoral Votes',
    body: 'The map is the United States. Every state is worth electoral votes (EV). Be the player holding the most campaign presence in a state when the election fires, and you take its EV. First to 270 wins the presidency.',
  },
  {
    id: 'rungs',
    art: '🪜',
    title: 'Campaign by Buying Rungs',
    body: 'On your turn, click a state to buy "rungs" — your campaign strength there. Each rung costs cash, and they get pricier as you climb. Whoever has the most rungs in a state leads it. Climb to the top alone and you SECURE it: that EV is yours for good.',
  },
  {
    id: 'coalitions',
    art: '🤝',
    title: 'Coalitions Pay You Income',
    body: 'States belong to coalition groups (like Swing States or High Tech). Control more than half of a group’s EV and you DOMINATE it — earning that coalition’s payout every single turn. National ladders on the right (Gun Lobby, Women’s Vote…) pay flexible cash. Income funds your next push.',
  },
  {
    id: 'wallets',
    art: '💰',
    title: 'Two Kinds of Money',
    body: 'You hold a flexible national cash pool plus earmarked coalition wallets. Coalition wallets can ONLY be spent inside their own group of states — national cash spends anywhere. Watch which wallet a purchase draws from.',
  },
  {
    id: 'clash',
    art: '⚔️',
    title: 'Beware the Clash',
    body: 'Everyone allocates secretly and at the same time. If two players land on the exact same rung count in a state, BOTH lose those rungs AND the cash spent. Read your opponent — clashing by accident is the costliest mistake in the game.',
  },
  {
    id: 'election',
    art: '🗳️',
    title: 'Election Night',
    body: 'From round 11 on, an election can fire each turn with rising odds. EV is tallied and the first to 270 wins. No winner means a hung Electoral College — and the odds climb for next time. Have your path to 270 ready before the gavel falls.',
  },
  {
    id: 'go',
    art: '🇺🇸',
    title: 'You’re Ready, Candidate',
    body: 'Pick a candidate, study their strengths, and build a coalition to 270. Tips rotate on every waiting screen, and the “?” in the top bar reopens these rules any time. Now go win the White House.',
    cta: true,
  },
];
