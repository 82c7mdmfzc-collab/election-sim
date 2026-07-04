import { useEffect, useMemo, useRef } from 'react';
import {
  useElectoralResult,
  useGameStore,
} from '../game/store';
import { NATIONAL_GROUPS, STATE_GROUPS } from '../game/config';
import { track } from '../utils/analytics';

const OBJECTIVES = [
  { id: 'queue_influence', label: 'Queue influence' },
  { id: 'lead_coalition', label: 'Lead a coalition' },
  { id: 'earn_national', label: 'Earn national funds' },
  { id: 'call_state', label: 'Call a state' },
  { id: 'reach_270', label: 'Reach 270 EV' },
] as const;

export function OpeningCampaignMissions() {
  const isOpeningCampaign = useGameStore((s) => s.isOpeningCampaign);
  const securedBy = useGameStore((s) => s.securedBy);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const natRungs = useGameStore((s) => s.natRungs);
  const pendingByPlayer = useGameStore((s) => s.pendingByPlayer);
  const phase = useGameStore((s) => s.phase);
  const playerId = useGameStore((s) => s.players.find((p) => !p.isBot)?.id ?? null);
  const result = useElectoralResult();
  const tracked = useRef<Set<string>>(new Set());

  const pending = playerId ? pendingByPlayer[playerId] ?? [] : [];
  const projectedEV = playerId ? result.evByPlayer[playerId] ?? 0 : 0;
  const queued = pending.reduce((sum, p) => sum + p.rungs, 0) > 0;
  const coalition = playerId ? STATE_GROUPS.some((g) => dominance[g.id] === playerId) : false;
  const national = playerId ? NATIONAL_GROUPS.some((g) => {
    const mine = natRungs[g.id]?.[playerId] ?? 0;
    const top = Math.max(0, ...Object.values(natRungs[g.id] ?? {}));
    return mine >= 4 && mine === top;
  }) : false;
  const called = playerId ? Object.values(securedBy).some((pid) => pid === playerId) : false;
  const reached270 = projectedEV >= 270;

  const done = useMemo<Record<typeof OBJECTIVES[number]['id'], boolean>>(() => ({
    queue_influence: queued || phase !== 'PLANNING',
    lead_coalition: coalition,
    earn_national: national,
    call_state: called,
    reach_270: reached270,
  }), [called, coalition, national, phase, queued, reached270]);

  useEffect(() => {
    if (!isOpeningCampaign) return;
    for (const objective of OBJECTIVES) {
      if (!done[objective.id] || tracked.current.has(objective.id)) continue;
      tracked.current.add(objective.id);
      track('first_mission_objective_completed', { objective_id: objective.id });
    }
  }, [done, isOpeningCampaign]);

  if (!isOpeningCampaign || !playerId) return null;

  const completed = OBJECTIVES.filter((objective) => done[objective.id]).length;

  return (
    <aside className="opening-missions" aria-label="Opening Campaign objectives">
      <div className="opening-missions__head">
        <span>Opening Campaign</span>
        <strong>{completed}/{OBJECTIVES.length}</strong>
      </div>
      <div className="opening-missions__list">
        {OBJECTIVES.map((objective) => (
          <span
            key={objective.id}
            className={`opening-missions__item${done[objective.id] ? ' is-done' : ''}`}
          >
            {objective.label}
          </span>
        ))}
      </div>
    </aside>
  );
}
