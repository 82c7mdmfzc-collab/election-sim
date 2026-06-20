import { useState } from 'react';
import { ELECTION_START_TURN, NATIONAL_GROUPS, STATE_GROUPS, electionProbability } from '../game/config';
import {
  useActivePending,
  useActivePlayer,
  useElectoralResult,
  useGameStore,
} from '../game/store';
import {
  isFirstRunCoachDismissed,
  markFirstRunCoachDismissed,
} from '../utils/localPrefs';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';

function useDismissedCoach(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => isFirstRunCoachDismissed());

  function dismiss() {
    AudioManager.play('quit');
    markFirstRunCoachDismissed();
    setDismissed(true);
  }

  return [dismissed, dismiss];
}

export function CampaignCoach() {
  const [dismissed, dismiss] = useDismissedCoach();
  const turn = useGameStore((s) => s.turn);
  const hungColleges = useGameStore((s) => s.hungColleges);
  const phase = useGameStore((s) => s.phase);
  const securedBy = useGameStore((s) => s.securedBy);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const natRungs = useGameStore((s) => s.natRungs);
  const activePlayer = useActivePlayer();
  const pending = useActivePending();
  const result = useElectoralResult();

  if (dismissed || phase !== 'PLANNING' || !activePlayer) return null;

  const pendingRungs = pending.reduce((sum, p) => sum + p.rungs, 0);
  const projectedEV = result.evByPlayer[activePlayer.id] ?? 0;
  const dominatedGroups = STATE_GROUPS.filter((g) => dominance[g.id] === activePlayer.id);
  const securedStates = Object.values(securedBy).filter((pid) => pid === activePlayer.id).length;
  const electionChance = electionProbability(turn, hungColleges);
  const ledNationalGroups = NATIONAL_GROUPS.filter((g) => {
    const rungs = natRungs[g.id] ?? {};
    const myRungs = rungs[activePlayer.id] ?? 0;
    const topRungs = Math.max(0, ...Object.values(rungs));
    return myRungs > 0 && myRungs === topRungs;
  });
  const earningNationalGroups = ledNationalGroups.filter((g) => (natRungs[g.id]?.[activePlayer.id] ?? 0) >= 4);
  const hasStatePending = pending.some((p) => p.kind === 'state');
  const hasNationalPending = pending.some((p) => p.kind === 'national');

  let title = 'Opening Objective';
  let body = 'Open one state lane for EV and one national ladder for flexible cash. Arizona, Pennsylvania, Florida, Gun Lobby, and Youth Vote are all useful first clicks.';
  let accent: string;

  if (electionChance > 0 && projectedEV >= 220) {
    title = 'Election Clock';
    body = 'The vote can fire now. Secure your best states and keep enough cash for a tiebreak if nobody reaches 270.';
    accent = `${Math.round(electionChance * 100)}% election`;
  } else if (turn >= ELECTION_START_TURN - 1 && projectedEV >= 160) {
    title = 'Line Up 270';
    body = 'Election night starts soon. Count the states that close your gap and stop spending on lanes that do not matter.';
    accent = `${projectedEV}/270 EV`;
  } else if (pendingRungs > 0) {
    title = 'Turn Ready';
    body = `${pendingRungs} rung${pendingRungs === 1 ? '' : 's'} queued across ${hasStatePending && hasNationalPending ? 'states and national groups' : hasNationalPending ? 'national groups' : 'states'}. Resolve, then watch clashes, income, and new leads.`;
    accent = 'Resolve';
  } else if (turn === 1) {
    accent = 'State + national';
  } else if (dominatedGroups.length === 0 && turn > 1) {
    title = 'Build State-Group Income';
    body = 'Lead enough EV inside one state group to dominate it. That earmarked wallet pays every turn and funds the same group later.';
    accent = 'State group';
  } else if (earningNationalGroups.length === 0 && turn > 1) {
    title = 'Claim Flexible Cash';
    body = 'National groups are side ladders. Lead one with 4+ rungs to earn flexible national cash that spends anywhere.';
    accent = 'National group';
  } else if (projectedEV < 180) {
    title = 'Convert Income Into EV';
    body = 'Use state-group wallets for their states and national-group cash for flexible attacks. The election clock starts on turn 11.';
    accent = `${projectedEV}/270 EV`;
  } else {
    title = 'Close The Map';
    body = 'You have a path. Secure states, protect income, and keep cash for the election tiebreak.';
    accent = `${projectedEV}/270 EV`;
  }

  const goals = [
    { label: 'Queue rungs', done: pendingRungs > 0 || turn > 1 },
    { label: 'Dominate state group', done: dominatedGroups.length > 0 },
    { label: 'Earn national cash', done: earningNationalGroups.length > 0 },
    { label: 'Secure a state', done: securedStates > 0 },
    { label: 'Reach 270', done: projectedEV >= 270 },
  ];

  return (
    <aside className="campaign-coach" aria-label="First campaign objectives">
      <div className="campaign-coach__top">
        <span className="campaign-coach__label">Coach</span>
        <strong>{title}</strong>
        <button
          type="button"
          className="campaign-coach__dismiss"
          onClick={() => {
            track('coach_dismissed', { turn_number: turn, coach_title: title });
            dismiss();
          }}
          aria-label="Dismiss coach"
        >
          ×
        </button>
      </div>
      <p className="campaign-coach__body">{body}</p>
      <div className="campaign-coach__goals">
        <span className="campaign-coach__accent">{accent}</span>
        {goals.map((goal) => (
          <span key={goal.label} className={`campaign-coach__goal${goal.done ? ' is-done' : ''}`}>
            {goal.label}
          </span>
        ))}
      </div>
    </aside>
  );
}
