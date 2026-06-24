/**
 * Right-hand interactive sidebar.
 *
 *   NationalGroupsTracker  → the 5 standalone 10-rung ladders (leader, rungs,
 *                            active turn payout) with click-to-buy.
 *   GroupDominanceSummary  → % of total State-Group EVs each player controls,
 *                            signalling who is close to a State Group bonus.
 */

import { useState } from 'react';
import { NATIONAL_GROUPS, STATE_GROUPS } from '../game/config';
import { CANDIDATE_MAP, groupImageUrl } from '../game/candidates';
import {
  useActivePlayer,
  useGameStore,
  usePlayerColors,
  usePendingRungs,
  useAffordability,
} from '../game/store';
import type { NationalGroup } from '../game/types';
import { isPlayerBlocked } from '../utils/localPrefs';
import { RungTrack } from './RungTrack';
import { PlayerProfileModal } from './PlayerProfileModal';

const TOTAL_GROUP_EV = STATE_GROUPS.reduce((s, g) => s + g.totalEV, 0);

function NationalLadder({ group, onPlayerClick }: { group: NationalGroup; onPlayerClick: (id: string) => void }) {
  const natRungs = useGameStore((s) => s.natRungs[group.id] ?? {});
  const natReachSeq = useGameStore((s) => s.natReachSeq[group.id] ?? {});
  const securedBy = useGameStore((s) => s.natSecuredBy[group.id]);
  const players = useGameStore((s) => s.players);
  const phase = useGameStore((s) => s.phase);
  const allocate = useGameStore((s) => s.allocate);
  const retractLastAllocation = useGameStore((s) => s.retractLastAllocation);
  const activePlayer = useActivePlayer();
  const colors = usePlayerColors();
  const pending = usePendingRungs('national', group.id);
  const aff = useAffordability('national', group.id);

  // Leader = most rungs (tie → reached first).
  let leaderId: string | null = null;
  let leaderRungs = 0;
  let leaderSeq = Infinity;
  for (const p of players) {
    if (p.eliminated) continue;
    const r = natRungs[p.id] ?? 0;
    const seq = natReachSeq[p.id] ?? 0;
    if (r > leaderRungs || (r === leaderRungs && r > 0 && seq < leaderSeq)) {
      leaderId = p.id; leaderRungs = r; leaderSeq = seq;
    }
  }

  const leader = leaderId ? players.find((p) => p.id === leaderId) : null;
  const earns = leaderRungs >= 4; // ≥4 rungs to draw the turn bonus
  const payoutMod = leader ? (leader.payoutModifiers[group.id] ?? 0) : 0;
  const payout = Math.round(group.turnBonus * (1 + payoutMod));
  const canBuy = phase === 'PLANNING' && !!activePlayer && !securedBy;

  return (
    <div className="nat-ladder">
      <div className="nat-ladder__head">
        <img
          className="group-icon group-icon--sm"
          src={groupImageUrl('national', group.id)}
          alt={group.id}
          draggable={false}
          loading="lazy"
          decoding="async"
        />
        <span className="nat-ladder__name">{group.id}</span>
        {canBuy ? (
          <span className={`nat-ladder__next${aff.affordable ? '' : ' is-blocked'}`}>
            {aff.atMax ? 'Maxed' : aff.affordable ? `Next $${aff.nextCost}k` : aff.reason}
          </span>
        ) : (
          <span className="nat-ladder__bonus">${group.turnBonus}k/turn</span>
        )}
      </div>

      <RungTrack
        size="sm"
        maxRungs={group.maxRungs}
        settledByPlayer={natRungs}
        pendingRungs={activePlayer ? pending : 0}
        activePlayerId={activePlayer?.id ?? null}
        colors={colors}
        securedBy={securedBy}
        nextAffordable={aff.affordable}
        onBuyNext={canBuy ? () => allocate('national', group.id, 1) : undefined}
        onRetractLast={canBuy && pending > 0 ? () => retractLastAllocation('national', group.id) : undefined}
      />

      <div className="nat-ladder__foot">
        {leader ? (
          <span
            className="nat-ladder__leader"
            role="button"
            tabIndex={0}
            onClick={() => onPlayerClick(leader.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlayerClick(leader.id); }}
            title="View player profile"
          >
            <span className="dot" style={{ background: colors[leader.id]?.hex }} />
            {(leader.isBot ? leader.name : isPlayerBlocked(leader.name) ? 'Blocked player' : leader.name)} · {leaderRungs}/{group.maxRungs}
            {earns && <span className="nat-ladder__pay"> → +${payout}k</span>}
          </span>
        ) : (
          <span className="nat-ladder__leader nat-ladder__leader--none">Unclaimed</span>
        )}
        {securedBy && <span className="nat-ladder__locked">🔒</span>}
      </div>
    </div>
  );
}

function GroupDominanceSummary() {
  const players = useGameStore((s) => s.players);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const colors = usePlayerColors();

  const evByPlayer: Record<string, number> = {};
  for (const g of STATE_GROUPS) {
    const dom = dominance[g.id];
    if (dom) evByPlayer[dom] = (evByPlayer[dom] ?? 0) + g.totalEV;
  }

  const active = players.filter((p) => !p.eliminated);

  return (
    <div className="dominance-summary">
      {active.map((p) => {
        const ev = evByPlayer[p.id] ?? 0;
        const pct = Math.round((ev / TOTAL_GROUP_EV) * 100);
        return (
          <div key={p.id} className="dominance-row">
            <span className="dominance-row__name">
              <span className="dot" style={{ background: colors[p.id]?.hex }} />
              {CANDIDATE_MAP[p.candidateId]?.portrait ?? p.name.slice(0, 2)}
            </span>
            <div className="dominance-row__track">
              <div
                className="dominance-row__fill"
                style={{ width: `${pct}%`, background: colors[p.id]?.hex }}
              />
            </div>
            <span className="dominance-row__pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const [profilePlayer, setProfilePlayer] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      <section className="sidebar__section">
        <h3 className="sidebar__title">National Groups</h3>
        <div className="sidebar__ladders">
          {NATIONAL_GROUPS.map((g) => (
            <NationalLadder key={g.id} group={g} onPlayerClick={setProfilePlayer} />
          ))}
        </div>
      </section>

      <section className="sidebar__section">
        <h3 className="sidebar__title">Group Dominance</h3>
        <GroupDominanceSummary />
      </section>

      {profilePlayer && (
        <PlayerProfileModal
          playerId={profilePlayer}
          onClose={() => setProfilePlayer(null)}
        />
      )}
    </aside>
  );
}
