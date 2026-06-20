import { useEffect, useMemo, useState } from 'react';
import { useGameStore, usePlayerColors } from '../game/store';
import { AudioManager } from '../utils/audioManager';
import { ALL_STATES } from '../game/statesData';
import { CANDIDATE_MAP } from '../game/candidates';
import { victoryMessageText } from '../game/victoryMessages';
import { getSelectedVictoryMessage } from '../utils/localPrefs';
import { renderShareCardSvg, svgToPngBlob, sharePng, shareLine } from '../utils/shareImage';
import { track } from '../utils/analytics';
import { RewardReveal } from './RewardReveal';
import { Avatar } from './Avatar';
import { NextChallengeHint, ProgressPanel } from './ProgressPanel';

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
  const startGame = useGameStore((s) => s.startGame);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const turnTimeLimit = useGameStore((s) => s.turnTimeLimit);
  const colors = usePlayerColors();

  useEffect(() => {
    AudioManager.stop('tick');
    AudioManager.play('victory');
  }, []);

  const [sharing, setSharing] = useState(false);

  const winner = electionResult?.winner
    ? players.find((p) => p.id === electionResult.winner)
    : null;
  const winnerEVs = winner ? (electionResult?.evByPlayer[winner.id] ?? 0) : 0;
  const winnerColor = winner ? (colors[winner.id]?.hex ?? '#facc15') : '#facc15';

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    try {
      AudioManager.play('click');
      track('share_started', {
        surface: 'victory',
        share_type: 'result_card',
        result: winner ? 'win' : 'hung',
      });
      const stateColors: Record<string, string> = {};
      for (const st of ALL_STATES) {
        const pid = securedBy[st.id];
        if (pid && colors[pid]) stateColors[st.id] = colors[pid].hex;
      }
      const svg = renderShareCardSvg({
        winnerName: winner ? winner.name : null,
        winnerEV: winnerEVs,
        line: shareLine(winner?.name ?? null, winnerEVs),
        stateColors,
      });
      const blob = await svgToPngBlob(svg);
      const outcome = await sharePng({
        blob,
        filename: 'elector-result.png',
        title: 'Elector',
        text: winner
          ? `${winner.name} just won my Elector game with ${winnerEVs} EV!`
          : 'My Elector game ended in a hung Electoral College!',
        url: 'https://playelector.com',
      });
      track('share_completed', {
        surface: 'victory',
        share_type: 'result_card',
        method: outcome === 'shared' ? 'native_share' : 'download',
        result: winner ? 'win' : 'hung',
      });
    } catch (err) {
      console.error('share-card failed', err);
      track('share_failed', {
        surface: 'victory',
        share_type: 'result_card',
        reason_category: 'render_or_share_error',
      });
    } finally {
      setSharing(false);
    }
  }

  function runItBack() {
    AudioManager.play('confirm');
    if (multiplayerMode === 'online') {
      returnToMenu();
      return;
    }

    const chosen = players.map((p) => CANDIDATE_MAP[p.candidateId]).filter(Boolean);
    if (chosen.length < 2) {
      reset();
      return;
    }

    const botSeats: Record<string, NonNullable<(typeof players)[number]['botDifficulty']>> = {};
    for (const p of players) {
      if (p.isBot && p.botDifficulty) botSeats[p.candidateId] = p.botDifficulty;
    }
    startGame(chosen, turnTimeLimit, botSeats);
  }

  function tryNextChallenge() {
    AudioManager.play('click');
    if (multiplayerMode === 'online') {
      returnToMenu();
      return;
    }
    reset();
  }

  // Per-winner background art (slug derived from the candidate's portrait file)
  // and the equipped victory-message cosmetic shown in the speech box.
  const winnerCand = winner ? CANDIDATE_MAP[winner.candidateId] : null;
  const victorySlug = winnerCand?.portraitUrl.split('/').pop()?.replace(/\.\w+$/, '') ?? '';
  const victoryBg = victorySlug ? `/assets/victory/${victorySlug}.jpg` : '';
  const victorySpeech = victoryMessageText(getSelectedVictoryMessage());

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
      {/* Per-winner background art (hidden if the asset is absent → gradient shows) */}
      {victoryBg && (
        <img
          className="victory-bg"
          src={victoryBg}
          alt=""
          aria-hidden
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}

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
        {winner && (
          <p className="victory-speech">“{victorySpeech}”</p>
        )}
      </div>

      {/* Campaign Funds payout */}
      <RewardReveal />
      <ProgressPanel compact showAll={false} />
      <NextChallengeHint context="victory" />

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
        <button type="button" onClick={runItBack}>
          {multiplayerMode === 'online' ? 'New Lobby' : 'Run It Back'}
        </button>
        <button type="button" className="victory-challenge-btn" onClick={tryNextChallenge}>
          Try Next Challenge
        </button>
        <button
          type="button"
          className="victory-share-btn"
          onClick={handleShare}
          disabled={sharing}
        >
          {sharing ? 'Preparing…' : 'Share Result'}
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
