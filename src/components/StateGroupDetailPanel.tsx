/**
 * StateGroupDetailPanel — modal showing progress toward dominating a State Group.
 *
 * Each player gets a progress bar (EV they lead in the group) with a threshold
 * marker at 50% of the group's total EV — i.e. "where you need to be" to dominate.
 * A compact member-state list sits below for the underlying detail.
 */

import { minRungsForDominance } from '../game/config';
import { groupDominanceProgress } from '../game/engine';
import { groupImageUrl } from '../game/candidates';
import { ALL_STATES } from '../game/statesData';
import { useGameStore, usePlayerColors, useActivePlayer } from '../game/store';
import type { StateGroup } from '../game/types';

interface Props {
  group: StateGroup;
  onClose: () => void;
}

export function StateGroupDetailPanel({ group, onClose }: Props) {
  // NOTE: select raw store slices only — never return a freshly-built array/object
  // from a selector (e.g. `.filter(...)`), or useSyncExternalStore loops forever.
  const allPlayers = useGameStore((s) => s.players);
  const rungs = useGameStore((s) => s.rungs);
  const reachSeq = useGameStore((s) => s.reachSeq);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const colors = usePlayerColors();
  const activePlayer = useActivePlayer();

  const players = allPlayers.filter((p) => !p.eliminated);
  const dominantId = dominance[group.id] ?? null;
  const myBalance = activePlayer?.groupWallets[group.id] ?? 0;

  const { evByPlayer, totalEV, threshold } = groupDominanceProgress(group, rungs, reachSeq, players);
  const needToDominate = Math.floor(totalEV / 2) + 1; // strictly > half

  // Highest current EV in this group → sort bars leader-first.
  const ranked = [...players].sort(
    (a, b) => (evByPlayer[b.id] ?? 0) - (evByPlayer[a.id] ?? 0),
  );

  const memberStates = group.members
    .map((id) => ALL_STATES.find((s) => s.id === id))
    .filter((s): s is (typeof ALL_STATES)[number] => Boolean(s))
    .sort((a, b) => b.electoralVotes - a.electoralVotes);

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
            loading="lazy"
            decoding="async"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="sg-detail__title-block">
            <div className="sg-detail__title">{group.id}</div>
            <div className="sg-detail__meta">
              {group.members.length} states · {totalEV} total EV · +${group.bonusPayout}k/turn bonus
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

        {/* ── Dominance progress bars ─────────────────────────────────────── */}
        <div className="sg-progress">
          <div className="sg-progress__caption">
            Lead a state (≥ min rungs) to bank its EV. Pass the line — <strong>{needToDominate} EV</strong> — to dominate.
          </div>
          {ranked.map((p) => {
            const ev = evByPlayer[p.id] ?? 0;
            const pct = totalEV > 0 ? Math.min(100, (ev / totalEV) * 100) : 0;
            const hex = colors[p.id]?.hex ?? 'var(--muted)';
            const isMe = !!activePlayer && p.id === activePlayer.id;
            const isDom = ev > threshold;
            return (
              <div
                key={p.id}
                className={`sg-progress__row${isMe ? ' sg-progress__row--me' : ''}`}
              >
                <span className="sg-progress__name" style={{ color: hex }}>
                  {p.name.split(' ')[0]}{isMe ? ' (you)' : ''}
                </span>
                <div className="sg-progress__track">
                  <div
                    className="sg-progress__fill"
                    style={{ width: `${pct}%`, background: hex }}
                  />
                  {/* threshold marker — 50% of total EV */}
                  <div className="sg-progress__threshold" style={{ left: '50%' }} />
                  {isDom && <span className="sg-progress__crown" aria-label="dominant">👑</span>}
                </div>
                <span className="sg-progress__ev">{ev}<span className="sg-progress__ev-total">/{totalEV}</span></span>
              </div>
            );
          })}
          <div className="sg-progress__legend">
            <span className="sg-progress__legend-line" /> Dominance line ({needToDominate} EV)
          </div>
        </div>

        {/* ── Member states (compact) ─────────────────────────────────────── */}
        <div className="sg-members">
          {memberStates.map((state) => {
            const minR = minRungsForDominance(state.id, state.electoralVotes);
            const myR = activePlayer ? (rungs[state.id]?.[activePlayer.id] ?? 0) : 0;
            const qualifies = myR >= minR;
            return (
              <div key={state.id} className={`sg-member${qualifies ? ' sg-member--ok' : ''}`}>
                <span className="sg-member__abbr">{state.id}</span>
                <span className="sg-member__name">{state.name}</span>
                <span className="sg-member__ev">{state.electoralVotes} EV</span>
                {activePlayer && (
                  <span className="sg-member__rungs" title={`You: Campaign Level ${myR} of ${minR} needed`}>
                    {myR}/{minR}{qualifies ? ' ✓' : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
