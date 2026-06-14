/**
 * StateGroupDetailPanel — modal showing all states in a selected State Group
 * with per-player rung counts, EV leader, and group-contribution status.
 */

import { minRungsForDominance } from '../game/config';
import { groupImageUrl } from '../game/candidates';
import { ALL_STATES } from '../game/statesData';
import {
  useGameStore,
  useElectoralResult,
  usePlayerColors,
  useActivePlayer,
} from '../game/store';
import type { StateGroup } from '../game/types';

interface Props {
  group: StateGroup;
  onClose: () => void;
}

export function StateGroupDetailPanel({ group, onClose }: Props) {
  const players = useGameStore((s) => s.players.filter((p) => !p.eliminated));
  const rungs = useGameStore((s) => s.rungs);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const result = useElectoralResult();
  const colors = usePlayerColors();
  const activePlayer = useActivePlayer();

  const dominantId = dominance[group.id] ?? null;
  const myBalance = activePlayer?.groupWallets[group.id] ?? 0;

  const memberStates = group.members
    .map((id) => ALL_STATES.find((s) => s.id === id))
    .filter(Boolean)
    .sort((a, b) => b!.electoralVotes - a!.electoralVotes) as typeof ALL_STATES;

  return (
    <div
      className="sg-detail-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sg-detail">
        <div className="sg-detail__head">
          <img
            className="group-icon group-icon--sm"
            src={groupImageUrl('state', group.id)}
            alt={group.id}
            draggable={false}
          />
          <div className="sg-detail__title-block">
            <div className="sg-detail__title">{group.id}</div>
            <div className="sg-detail__meta">
              {group.members.length} states · {group.totalEV} total EV · +${group.bonusPayout}k/turn bonus
            </div>
          </div>
          <button type="button" className="sg-detail__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sg-detail__info-row">
          {activePlayer && (
            <span className="sg-detail__balance">
              My wallet: <strong>${myBalance.toFixed(0)}k</strong>
            </span>
          )}
          {dominantId ? (
            <span
              className="sg-detail__dom-badge"
              style={{ background: colors[dominantId]?.hex ?? 'var(--muted)' }}
            >
              {players.find((p) => p.id === dominantId)?.name ?? '?'} dominant
            </span>
          ) : (
            <span className="sg-detail__dom-badge sg-detail__dom-badge--none">No dominant player</span>
          )}
        </div>

        <table className="sg-state-table">
          <thead>
            <tr>
              <th>State</th>
              <th className="sg-col-ev">EV</th>
              {players.map((p) => (
                <th key={p.id} style={{ color: colors[p.id]?.hex }}>
                  {p.name.split(' ')[0]}
                </th>
              ))}
              <th>EV Lead</th>
            </tr>
          </thead>
          <tbody>
            {memberStates.map((state) => {
              const minR = minRungsForDominance(state.id, state.electoralVotes);
              const evLeaderId = result.stateLeaders[state.id] ?? null;
              return (
                <tr key={state.id}>
                  <td className="sg-state-name">
                    <span className="sg-state-abbr">{state.id}</span>
                    <span className="sg-state-full">{state.name}</span>
                    <span className="sg-state-min" title={`≥${minR} rungs needed for group contribution`}>
                      min {minR}r
                    </span>
                  </td>
                  <td className="sg-col-ev sg-state-ev">{state.electoralVotes}</td>
                  {players.map((p) => {
                    const r = rungs[state.id]?.[p.id] ?? 0;
                    const qualifies = r >= minR;
                    return (
                      <td
                        key={p.id}
                        className={qualifies ? 'sg-rung-cell sg-rung-cell--qualifies' : 'sg-rung-cell'}
                        style={{ color: r > 0 ? colors[p.id]?.hex : undefined }}
                      >
                        {r > 0 ? r : <span className="sg-rung-empty">—</span>}
                        {qualifies && <span className="sg-rung-star">✓</span>}
                      </td>
                    );
                  })}
                  <td className="sg-ev-lead">
                    {evLeaderId ? (
                      <span
                        className="sg-ev-lead__name"
                        style={{ color: colors[evLeaderId]?.hex }}
                      >
                        {players.find((p) => p.id === evLeaderId)?.name.split(' ')[0] ?? '?'}
                      </span>
                    ) : (
                      <span className="sg-ev-lead__none">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
