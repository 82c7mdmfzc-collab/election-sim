import { useEffect, useMemo, useState } from 'react';
import { NATIONAL_GROUPS } from '../game/config';
import { CANDIDATE_MAP } from '../game/candidates';
import { ALL_STATES } from '../game/statesData';
import { useGameStore, usePlayerColors } from '../game/store';
import { STRATEGY_TIPS } from '../game/tips';
import { Avatar } from './Avatar';
import { RotatingTip } from './RotatingTip';
import { AudioManager } from '../utils/audioManager';

const STATE_NAME: Record<string, string> = Object.fromEntries(
  ALL_STATES.map((s) => [s.id, s.name]),
);
const NAT_NAME: Record<string, string> = Object.fromEntries(
  NATIONAL_GROUPS.map((g) => [g.id, g.id]),
);

export function RoundResolution() {
  const phase     = useGameStore((s) => s.phase);
  const done      = useGameStore((s) => s.resolutionTickerDone);
  const purchases = useGameStore((s) => s.lastRoundPurchases);
  const players   = useGameStore((s) => s.players);
  const turn      = useGameStore((s) => s.turn);
  const dismiss   = useGameStore((s) => s.dismissResolutionTicker);
  const colors    = usePlayerColors();

  const [visibleCount, setVisibleCount] = useState(0);
  const [shownTurn, setShownTurn] = useState(turn);

  // Reset counter each time a new RESOLUTION phase begins (render-time adjustment,
  // avoids an extra effect-driven render pass).
  if (turn !== shownTurn) {
    setShownTurn(turn);
    setVisibleCount(0);
  }

  // Group purchases by (playerId, kind, targetId), summing rungs and cost
  const grouped = useMemo(() => {
    const map = new Map<string, typeof purchases[number]>();
    for (const p of purchases) {
      const key = `${p.playerId}::${p.kind}::${p.targetId}`;
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, rungsBought: existing.rungsBought + p.rungsBought, cost: existing.cost + p.cost });
      } else {
        map.set(key, { ...p });
      }
    }
    return Array.from(map.values());
  }, [purchases]);

  useEffect(() => {
    if (phase !== 'RESOLUTION' || done) return;
    if (grouped.length === 0) { dismiss(); return; }
    if (visibleCount >= grouped.length) {
      const t = window.setTimeout(dismiss, 900);
      return () => clearTimeout(t);
    }
    const t = window.setTimeout(() => setVisibleCount((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [visibleCount, grouped.length, done, phase, dismiss]);

  if (phase !== 'RESOLUTION' || done) return null;

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  return (
    <div className="round-resolution" role="status" aria-live="polite">
      <div className="round-resolution__hdr">
        <span className="round-resolution__title">Turn {turn} — Campaign Activity</span>
        <button
          type="button"
          className="phase-btn res-skip-btn"
          onClick={() => { AudioManager.play('click'); dismiss(); }}
        >
          Skip →
        </button>
      </div>

      <div className="round-resolution__feed">
        {grouped.length === 0 && (
          <div className="res-card res-card--empty">No campaigns this round</div>
        )}
        {grouped.slice(0, visibleCount).map((p, i) => {
          const player = playerMap[p.playerId];
          const cand   = CANDIDATE_MAP[p.candidateId];
          const hex    = colors[p.playerId]?.hex ?? '#64748b';
          const target = p.kind === 'state'
            ? `${STATE_NAME[p.targetId] ?? p.targetId} (${p.targetId})`
            : (NAT_NAME[p.targetId] ?? p.targetId);
          return (
            <div
              key={i}
              className="res-card"
              style={{ ['--p-color' as string]: hex }}
            >
              <span className="res-card__token">
                <Avatar
                  src={cand?.portraitUrl ?? ''}
                  initials={(player?.name ?? '?')[0]}
                  name={player?.name ?? p.playerId}
                  className="cand-token"
                />
              </span>
              <div className="res-card__body">
                <span className="res-card__name">{player?.name ?? p.playerId}</span>
                <span className="res-card__action">
                  +{p.rungsBought} rung{p.rungsBought !== 1 ? 's' : ''} in {target}
                </span>
              </div>
              <span className="res-card__cost">${p.cost.toFixed(0)}k</span>
            </div>
          );
        })}
      </div>

      {grouped.length > 0 && (
        <div className="round-resolution__progress">
          {Math.min(visibleCount, grouped.length)} / {grouped.length}
        </div>
      )}

      <RotatingTip tips={STRATEGY_TIPS} className="round-resolution__tip" />
    </div>
  );
}
