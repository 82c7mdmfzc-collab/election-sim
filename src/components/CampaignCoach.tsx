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
  let body: string;
  let accent: string;

  if (electionChance > 0 && projectedEV >= 220) {
    title = 'Election Clock';
    body = 'The vote can fire now. Call your best states and keep enough War Chest for a tiebreak if nobody reaches 270.';
    accent = `${Math.round(electionChance * 100)}% election`;
  } else if (turn >= ELECTION_START_TURN - 1 && projectedEV >= 160) {
    title = 'Line Up 270';
    body = 'Election Night starts soon. Map the states that close your gap and stop spending on lanes that do not matter.';
    accent = `${projectedEV}/270 EV`;
  } else if (pendingRungs > 0) {
    title = 'Turn Ready';
    body = `${pendingRungs} Campaign Influence queued across ${hasStatePending && hasNationalPending ? 'states and network tracks' : hasNationalPending ? 'network tracks' : 'states'}. Resolve, then watch collisions, income, and new leads.`;
    accent = 'Resolve';
  } else if (turn === 1) {
    body = 'Tap a state to build influence — each level costs more as you climb. Reach full influence alone and that state is CALLED for good. Establish a foothold in a state and a network for flexible War Chest funds.';
    accent = 'State + national';
  } else if (dominatedGroups.length === 0 && turn > 1) {
    title = 'Build Coalition Income';
    body = 'Lead enough EV inside one Coalition to control it. That Coalition Reserve pays every turn and funds the same lanes later.';
    accent = 'State group';
  } else if (earningNationalGroups.length === 0 && turn > 1) {
    title = 'Claim War Chest Funds';
    body = 'Network tracks are side battles. Lead one with 4+ Campaign Influence to earn War Chest funds that spend anywhere.';
    accent = 'National group';
  } else if (projectedEV < 180) {
    title = 'Convert Income Into EV';
    body = `Use Coalition Reserves for their states and network funds for flexible attacks. Election Night pressure starts on Turn ${ELECTION_START_TURN}.`;
    accent = `${projectedEV}/270 EV`;
  } else {
    title = 'Close The Map';
    body = 'You have a path. Call key states, protect your Coalitions, and keep War Chest for the Election Night tiebreak.';
    accent = `${projectedEV}/270 EV`;
  }

  const goals = [
    { label: 'Queue influence', done: pendingRungs > 0 || turn > 1 },
    { label: 'Lead a Coalition', done: dominatedGroups.length > 0 },
    { label: 'Earn network funds', done: earningNationalGroups.length > 0 },
    { label: 'Call a state', done: securedStates > 0 },
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
