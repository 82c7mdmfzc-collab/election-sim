/**
 * Onboarding step script for the guided first game.
 *
 * Each step spotlights a live DOM anchor (by `data-tut` attribute) and advances
 * when its `done` predicate becomes true against the real game state — the
 * overlay never intercepts taps, so the player always drives. `cta` steps show
 * a Continue button instead (informational). Selectors are the contract, so UI
 * refactors that keep the `data-tut` hooks won't break the flow.
 *
 * Lives under components/ (not game/) because it references the DOM — game/ is
 * vendored into an edge function and must stay DOM-free.
 */

import { useGameStore } from '../../game/store';

type GameSnapshot = ReturnType<typeof useGameStore.getState>;

export interface OnboardingStep {
  readonly id: string;
  /** `data-tut` value of the element to spotlight; null centers the card. */
  readonly anchor: string | null;
  readonly title: string;
  readonly body: string;
  /** Informational step: show this button label; tapping it advances. */
  readonly cta?: string;
  /** Auto-advance when this returns true (checked on a light poll). */
  readonly done?: (s: GameSnapshot) => boolean;
  /** Show a Skip link that ends the whole guide. Defaults true from step 2 on. */
  readonly skippable?: boolean;
}

/** Sum of Campaign Influence the human has queued in states this turn. */
export function humanPendingStateRungs(s: GameSnapshot): number {
  const human = s.players.find((p) => !p.isBot);
  if (!human) return 0;
  const pending = s.pendingByPlayer[human.id] ?? [];
  return pending.filter((p) => p.kind === 'state').reduce((sum, p) => sum + p.rungs, 0);
}

const stateCardOpen = () =>
  typeof document !== 'undefined' && !!document.querySelector('.state-card--pinned');
const sheetOpen = () =>
  typeof document !== 'undefined' && !!document.querySelector('.native-game-sheet');

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'welcome',
    anchor: null,
    title: 'Welcome, Candidate',
    body: 'This is your first campaign — a friendly race to 270 electoral votes. I\'ll guide you through your first few moves.',
    cta: 'Let\'s go',
    skippable: false,
  },
  {
    id: 'tap-state',
    anchor: 'map',
    title: 'Pick a state',
    body: 'Tap any state on the map to open it and start campaigning there. Bigger states are worth more electoral votes.',
    done: () => stateCardOpen() || humanPendingStateRungs(useGameStore.getState()) > 0,
  },
  {
    id: 'build',
    anchor: 'build',
    title: 'Build influence',
    body: 'Tap BUILD a few times to spend funds and stack up Campaign Influence. Each level strengthens your lead here.',
    done: (s) => humanPendingStateRungs(s) >= 3,
  },
  {
    id: 'end-turn',
    anchor: 'end-turn',
    title: 'End your turn',
    body: 'Locked in? Tap END to resolve the round and see everyone\'s moves play out.',
    done: (s) => s.phase !== 'PLANNING' || s.turn >= 2,
  },
  {
    id: 'recap',
    anchor: null,
    title: 'Nice work',
    body: 'That\'s the core loop: campaign in states, then resolve. Keep building toward 270 — lead Coalitions and National networks to earn income each turn.',
    cta: 'Keep playing',
    done: (s) => s.turn >= 2 && s.phase === 'PLANNING',
  },
  {
    id: 'explore',
    anchor: 'explore',
    title: 'Earn income',
    body: 'Open National and Coalitions any time to lead networks and earn funds that buy more influence. You\'ve got this!',
    cta: 'Finish',
    done: () => sheetOpen(),
  },
];
