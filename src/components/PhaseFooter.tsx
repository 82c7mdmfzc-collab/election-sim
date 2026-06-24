/**
 * PhaseFooter — bottom bar of the tactical layout.
 *
 *   PLANNING   → PlanningControls: budget, this-turn allocations (cancellable),
 *                and the "Hand to next →" / "Resolve Turn →" submit button.
 *   RESOLUTION → ResolutionView: an un-skippable, timed sequence that reveals
 *                settled rungs, dramatizes clashes (cash forfeit), then ticks
 *                income — the continue button is gated until the sequence ends.
 */

import { useEffect, useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { ELECTION_START_TURN, STATE_GROUPS, electionProbability } from '../game/config';
import { WIN_THRESHOLD } from '../game/engine';
import {
  useActiveNationalCash,
  useActivePending,
  useActivePlayer,
  useElectoralResult,
  useGameStore,
  usePlayerColors,
} from '../game/store';
import { CampaignCoach } from './CampaignCoach';

// ── Host-only resolution continue button ─────────────────────────────────────
// In online mode, only the host drives the phase transition out of RESOLUTION.
// Guests see "Waiting for host…" instead.
function HostOnlyResolutionButton({
  ready,
  turn,
  onConfirm,
}: {
  ready: boolean;
  turn: number;
  onConfirm: () => void;
}) {
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const localPlayerId   = useGameStore((s) => s.localPlayerId);
  const hostPlayerId    = useGameStore((s) => s.hostPlayerId);

  const isHostOrSingle = multiplayerMode === 'single' || localPlayerId === hostPlayerId;

  if (!isHostOrSingle) {
    return (
      <button type="button" className="phase-btn" disabled>
        Waiting for host…
      </button>
    );
  }

  return (
    <button
      type="button"
      className="phase-btn phase-btn--primary"
      disabled={!ready}
      onClick={() => { AudioManager.play('confirm'); onConfirm(); }}
    >
      {ready ? `Start Turn ${turn + 1} →` : 'Resolving…'}
    </button>
  );
}

// ── Resolution timing ─────────────────────────────────────────────────────────

type Stage = 'reveal' | 'clash' | 'income' | 'done';

// ResolutionView remounts each time the turn resolves, so `stage` starts fresh
// at 'reveal'; the effect only schedules the forward transitions (no synchronous
// setState in the effect body).
function useResolutionStage(hasClash: boolean): Stage {
  const [stage, setStage] = useState<Stage>('reveal');
  useEffect(() => {
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setStage(hasClash ? 'clash' : 'income'), 800));
    timers.push(window.setTimeout(() => setStage('income'), hasClash ? 2000 : 900));
    timers.push(window.setTimeout(() => setStage('done'), hasClash ? 2700 : 1600));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [hasClash]);
  return stage;
}

export function ResolutionRecap({ className }: { className?: string }) {
  const turn = useGameStore((s) => s.turn);
  const hungColleges = useGameStore((s) => s.hungColleges);
  const players = useGameStore((s) => s.players);
  const lastIncome = useGameStore((s) => s.lastIncome);
  const report = useGameStore((s) => s.lastTurnReport);
  const confirmResolution = useGameStore((s) => s.confirmResolution);
  const colors = usePlayerColors();
  const result = useElectoralResult();
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const prevDominance = useGameStore((s) => s.prevDominance);

  const clashes = [
    ...(report?.clashedStates ?? []),
    ...(report?.clashedNational ?? []),
  ];
  const stage = useResolutionStage(clashes.length > 0);
  const ready = stage === 'done';

  useEffect(() => {
    if (stage === 'clash') AudioManager.play('clash');
    if (stage === 'income') AudioManager.play('income');
  }, [stage]);

  // Fires once per new RESOLUTION (component remounts each turn).
  useEffect(() => {
    const anyGained = STATE_GROUPS.some(
      (g) => dominance[g.id] !== null && dominance[g.id] !== prevDominance[g.id],
    );
    if (anyGained) AudioManager.play('dominate');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const electionChance = electionProbability(turn, hungColleges);
  const active = players.filter((p) => !p.eliminated);

  return (
    <div className={['resolution', className].filter(Boolean).join(' ')}>
      <div className="resolution__title">Turn {turn} results</div>

      {clashes.length > 0 && (stage === 'clash' || stage === 'income' || stage === 'done') && (
        <div className={`resolution__clash${stage === 'clash' ? ' is-active' : ''}`}>
          <span className="resolution__clash-label">Collision</span>
          {clashes.map((c) => (
            <span key={c} className="clash-chip">{c} — spend burned</span>
          ))}
        </div>
      )}

      <div className="resolution__income">
        {active.map((p) => {
          const ev = result.evByPlayer[p.id] ?? 0;
          const inc = lastIncome[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className="resolution__card"
              style={{ ['--p-color' as string]: colors[p.id]?.hex }}
            >
              <span className="resolution__name">{p.name}</span>
              <span className="resolution__ev">
                {ev} EV{ev >= WIN_THRESHOLD && <span className="resolution__270"> 270+</span>}
              </span>
              <span className={`resolution__delta ${inc >= 0 ? 'up' : 'down'}`}>
                {stage === 'income' || stage === 'done' ? `${inc >= 0 ? '+' : ''}${inc}k` : '…'}
              </span>
              <span className="resolution__cash">${p.nationalCash.toFixed(0)}k</span>
            </div>
          );
        })}
      </div>

      <div className="resolution__foot">
        <span className="resolution__chance">
          {electionChance > 0
            ? `Election chance: ${Math.round(electionChance * 100)}%`
            : `Election Night from Turn ${ELECTION_START_TURN}`}
        </span>
        <HostOnlyResolutionButton ready={ready} turn={turn} onConfirm={confirmResolution} />
      </div>
    </div>
  );
}

function ResolutionView() {
  return <ResolutionRecap />;
}

function PlanningControls() {
  const players          = useGameStore((s) => s.players);
  const activeIndex      = useGameStore((s) => s.activePlayerIndex);
  const submitTurn       = useGameStore((s) => s.submitTurn);
  const cancelAllocation = useGameStore((s) => s.cancelAllocation);
  const multiplayerMode  = useGameStore((s) => s.multiplayerMode);
  const localPlayerId    = useGameStore((s) => s.localPlayerId);
  const submittedPlayers = useGameStore((s) => s.submittedPlayers);
  const activePlayer     = useActivePlayer();
  const pending          = useActivePending();
  const cash             = useActiveNationalCash();

  const active = players.filter((p) => !p.eliminated);
  const isLast = activeIndex >= active.length - 1;
  const nextPlayer = !isLast ? active[activeIndex + 1] : null;

  // Online mode: disable submit once this player has already submitted this turn
  const alreadySubmitted =
    multiplayerMode === 'online' &&
    !!localPlayerId &&
    submittedPlayers.includes(localPlayerId);

  if (!activePlayer) return null;

  // Collapse pending into one chip per target.
  const byTarget = pending.reduce<Record<string, { kind: 'state' | 'national'; rungs: number; cost: number }>>(
    (acc, p) => {
      if (!acc[p.targetId]) acc[p.targetId] = { kind: p.kind, rungs: 0, cost: 0 };
      acc[p.targetId].rungs += p.rungs;
      acc[p.targetId].cost += p.cost;
      return acc;
    },
    {},
  );
  const chips = Object.entries(byTarget);
  const totalCommitted = pending.reduce((s, p) => s + p.cost, 0);

  return (
    <div className="planning">
      <CampaignCoach />
      <div className="planning__head">
        <span className="planning__who">{activePlayer.name}&apos;s turn</span>
        <span className="planning__budget">National ${cash.toFixed(0)}k</span>
        {totalCommitted > 0 && (
          <span className="footer__committed">Committed: ${totalCommitted.toFixed(0)}k</span>
        )}
        <span className="planning__hint">Click a state or network track to build influence</span>
      </div>

      <div className="planning__chips">
        {chips.length === 0 ? (
          <span className="planning__empty">No operation plan yet</span>
        ) : (
          chips.map(([tid, { kind, rungs, cost }]) => (
            <span key={tid} className="alloc-chip">
              {tid}: {rungs} Influence Level{rungs === 1 ? '' : 's'} (${cost.toFixed(0)}k)
              <button
                type="button"
                className="alloc-chip__x"
                onClick={() => { AudioManager.play('click'); cancelAllocation(kind, tid); }}
                title={`Cancel ${tid}`}
              >×</button>
            </span>
          ))
        )}
      </div>

      <button
        type="button"
        className="phase-btn phase-btn--primary"
        disabled={alreadySubmitted}
        onClick={() => { if (!alreadySubmitted) { AudioManager.play('confirm'); submitTurn(); } }}
      >
        {multiplayerMode === 'online'
          ? (alreadySubmitted ? 'Waiting for others…' : 'Submit Plan →')
          : (nextPlayer ? `Hand to ${nextPlayer.name} →` : 'Resolve Turn →')}
      </button>
    </div>
  );
}

export function PhaseFooter() {
  const phase = useGameStore((s) => s.phase);
  if (phase === 'RESOLUTION') return <footer className="phase-footer"><ResolutionView /></footer>;
  if (phase === 'PLANNING') return <footer className="phase-footer"><PlanningControls /></footer>;
  return null;
}
