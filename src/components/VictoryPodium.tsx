import { useEffect, useMemo } from 'react';
import { useGameStore, usePlayerColors } from '../game/store';
import { AudioManager } from '../utils/audioManager';
import { ALL_STATES } from '../game/statesData';
import { CANDIDATE_MAP } from '../game/candidates';
import { RewardReveal } from './RewardReveal';
import { Avatar } from './Avatar';

const CONFETTI_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#f59e0b', // amber
  '#14b8a6', // teal
  '#facc15', // yellow
  '#ffffff', // white
];

// 40 confetti particles with seeded random-ish values for deterministic render
const CONFETTI_PARTICLES = Array.from({ length: 40 }, (_, i) => {
  const seed = (i * 7 + 13) % 100;
  const seed2 = (i * 11 + 5) % 100;
  const seed3 = (i * 3 + 17) % 100;
  return {
    x: `${((seed - 50) * 0.6).toFixed(1)}vw`,
    delay: `${(seed2 / 100) * 1.5}s`,
    dur: `${2.5 + (seed3 / 100) * 1.5}s`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    spin: `${((i % 4) + 1) * 90}deg`,
    size: `${6 + (i % 5)}px`,
    left: `${10 + (i / 40) * 80}%`,
  };
});

const RANK_LABELS = ['1st', '2nd', '3rd', '4th'];

export function VictoryPodium() {
  const electionResult = useGameStore((s) => s.electionResult);
  const players = useGameStore((s) => s.players);
  const securedBy = useGameStore((s) => s.securedBy);
  const stateGroupDominance = useGameStore((s) => s.stateGroupDominance);
  const reset = useGameStore((s) => s.reset);
  const returnToMenu = useGameStore((s) => s.returnToMenu);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const colors = usePlayerColors();

  useEffect(() => {
    AudioManager.stop('tick');
    AudioManager.play('victory');
  }, []);

  const winner = electionResult?.winner
    ? players.find((p) => p.id === electionResult.winner)
    : null;
  const winnerEVs = winner ? (electionResult?.evByPlayer[winner.id] ?? 0) : 0;
  const winnerColor = winner ? (colors[winner.id]?.hex ?? '#facc15') : '#facc15';

  // Rank players by EVs descending
  const ranked = useMemo(() => {
    return [...players].sort(
      (a, b) => (electionResult?.evByPlayer[b.id] ?? 0) - (electionResult?.evByPlayer[a.id] ?? 0),
    );
  }, [players, electionResult]);

  // Count secured states per player
  const securedCountByPlayer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sid of Object.keys(securedBy)) {
      const pid = securedBy[sid];
      if (pid) counts[pid] = (counts[pid] ?? 0) + 1;
    }
    return counts;
  }, [securedBy]);

  // Count group dominance per player
  const dominanceCountByPlayer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const pid of Object.values(stateGroupDominance)) {
      if (pid) counts[pid] = (counts[pid] ?? 0) + 1;
    }
    return counts;
  }, [stateGroupDominance]);

  // Compute total EV secured per player (states locked × their EV)
  const securedEVByPlayer = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const state of ALL_STATES) {
      const pid = securedBy[state.id];
      if (pid) totals[pid] = (totals[pid] ?? 0) + state.electoralVotes;
    }
    return totals;
  }, [securedBy]);

  return (
    <div className="victory-podium">
      {/* Confetti layer */}
      <div className="confetti-layer" aria-hidden>
        {CONFETTI_PARTICLES.map((p, i) => (
          <div
            key={i}
            className="confetti-particle"
            style={{
              ['--x' as string]: p.x,
              ['--delay' as string]: p.delay,
              ['--dur' as string]: p.dur,
              ['--color' as string]: p.color,
              ['--spin' as string]: p.spin,
              ['--size' as string]: p.size,
              left: p.left,
            }}
          />
        ))}
      </div>

      {/* Winner hero */}
      <div
        className="victory-main"
        style={{ ['--p-color' as string]: winnerColor }}
      >
        <div className="victory-sunburst" aria-hidden />
        <div className="victory-label">ELECTOR PROJECTS</div>
        <div className="victory-portrait">
          {winner ? (
            <Avatar
              src={CANDIDATE_MAP[winner.candidateId]?.tokenUrl ?? ''}
              initials={winner.name.slice(0, 2).toUpperCase()}
              name={winner.name}
              className="cand-token"
            />
          ) : '??'}
        </div>
        <h1 className="victory-headline">
          {winner ? winner.name : 'Election Complete'}
        </h1>
        <div className="victory-ev-label">
          {winner
            ? `${winnerEVs} Electoral Votes — Victory`
            : 'No majority reached'}
        </div>
      </div>

      {/* Campaign Funds payout */}
      <RewardReveal />

      {/* Leaderboard */}
      <div className="victory-board">
        {ranked.map((p, i) => {
          const ev = electionResult?.evByPlayer[p.id] ?? 0;
          const securedStates = securedCountByPlayer[p.id] ?? 0;
          const securedEV = securedEVByPlayer[p.id] ?? 0;
          const groupsWon = dominanceCountByPlayer[p.id] ?? 0;
          const isWinner = p.id === winner?.id;
          const color = colors[p.id];

          return (
            <div
              key={p.id}
              className={[
                'victory-row',
                isWinner ? 'victory-row--winner' : '',
                p.eliminated ? 'victory-row--eliminated' : '',
              ].filter(Boolean).join(' ')}
              style={{ ['--p-color' as string]: color?.hex ?? '#888' }}
            >
              <span className="victory-rank">{RANK_LABELS[i] ?? `#${i + 1}`}</span>
              <div className="victory-portrait-sm">
                <Avatar
                  src={CANDIDATE_MAP[p.candidateId]?.tokenUrl ?? ''}
                  initials={p.name.slice(0, 2).toUpperCase()}
                  name={p.name}
                  className="cand-token"
                />
              </div>
              <div className="victory-info">
                <span className="victory-row-name">
                  {p.name}
                  {p.eliminated && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.7rem' }}> — eliminated</span>}
                </span>
                <div className="victory-stats">
                  <span><strong>{ev}</strong> EV total</span>
                  {securedStates > 0 && (
                    <span><strong>{securedStates}</strong> states locked ({securedEV} EV)</span>
                  )}
                  <span><strong>${p.nationalCash.toFixed(0)}k</strong> cash remaining</span>
                  {groupsWon > 0 && (
                    <span><strong>{groupsWon}</strong> group{groupsWon !== 1 ? 's' : ''} dominant</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="victory-cta">
        <button type="button" onClick={() => { AudioManager.play('click'); reset(); }}>
          Play Again
        </button>
        {multiplayerMode === 'online' && (
          <button
            type="button"
            style={{ marginLeft: '0.75rem', background: 'var(--panel-2)', color: 'var(--text)' }}
            onClick={() => { AudioManager.play('click'); returnToMenu(); }}
          >
            Return to Menu
          </button>
        )}
      </div>
    </div>
  );
}
