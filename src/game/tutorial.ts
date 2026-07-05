/**
 * Tutorial script — a short 3-card primer shown once before a new player's
 * first game. The full rulebook lives in HOW_TO_PLAY (tips.ts, reachable from
 * the Home "Campaign Guide"); the mechanics are taught hands-on by the guided
 * first game (components/onboarding). This primer only sets the goal and the
 * two core ideas so the guided game has context.
 *
 * Kept as data (not JSX) so the flow is easy to reorder and could later be
 * localized. Tutorial.tsx renders these. `art` is a compact display badge;
 * `cta` (last step) flips the primary button to "start a game".
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
    title: 'Race to 270',
    body: 'States decide the election. Lead a state on Election Night and its electoral votes are yours. Win 270 and you win the presidency.',
  },
  {
    id: 'rungs',
    art: 'IL',
    title: 'Campaign in States',
    body: 'Tap a state to spend funds and build Campaign Influence there. The more you build, the stronger your lead — reach full influence alone and that state is CALLED for good.',
  },
  {
    id: 'wallets',
    art: '$',
    title: 'Fund Your Campaign',
    body: 'Leading Coalitions and National networks pays you every turn. That income buys more influence. Your first game will walk you through it — let\'s go.',
    cta: true,
  },
];
