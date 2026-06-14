import { useEffect, useRef, useState, useMemo } from 'react';
import { useGameStore, usePlayerColors } from '../game/store';
import { ALL_STATES } from '../game/statesData';
import { ElectionMap } from './ElectionMap';
import type { StateId } from '../game/types';

// States sorted EV-ascending: small states first, megastates last (max dramatic tension)
const TALLY_ORDER = [...ALL_STATES].sort((a, b) => a.electoralVotes - b.electoralVotes);

const STATE_DURATION_MS = 1500;

// ── Timing offsets within each 1500ms state slot ──────────────────────────────
const T_FLASH = 750;
const T_FLY = 1050;
const T_ACCUM = 1200;
const T_DONE_DELAY = 800;
const T_COMPLETE_DELAY = 1400;

// ── useElectionTallySequence ──────────────────────────────────────────────────

function useElectionTallySequence() {
  const completeTally = useGameStore((s) => s.completeTally);
  const electionResult = useGameStore((s) => s.electionResult);
  const players = useGameStore((s) => s.players);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(0);
  const [cardVisible, setCardVisible] = useState(true);
  const [cardExiting, setCardExiting] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showFly, setShowFly] = useState(false);
  const [accumEVs, setAccumEVs] = useState<Record<string, number>>(() =>
    Object.fromEntries(players.map((p) => [p.id, 0])),
  );
  const [poppingPlayer, setPoppingPlayer] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<StateId>>(new Set());

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function addTimer(fn: () => void, delay: number) {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }

  // Reset per-card UI state when the active card changes (render-time
  // adjustment, avoids an extra effect-driven render pass).
  if (currentIdx !== prevIdx) {
    setPrevIdx(currentIdx);
    setCardExiting(false);
    setShowFlash(false);
    setShowFly(false);
    setCardVisible(true);
  }

  useEffect(() => {
    if (isDone) return;

    const state = TALLY_ORDER[currentIdx];
    if (!state) return;

    clearTimers();

    // T+750ms — winner flash
    addTimer(() => setShowFlash(true), T_FLASH);

    // T+1050ms — EV chip flies up
    addTimer(() => setShowFly(true), T_FLY);

    // T+1200ms — accumulate EVs + pop counter
    addTimer(() => {
      const winnerId = electionResult?.stateLeaders?.[state.id] ?? null;
      if (winnerId) {
        setAccumEVs((prev) => ({
          ...prev,
          [winnerId]: (prev[winnerId] ?? 0) + state.electoralVotes,
        }));
        setPoppingPlayer(winnerId);
        addTimer(() => setPoppingPlayer(null), 350);
      }
      setRevealedIds((prev) => {
        const next = new Set(prev);
        next.add(state.id);
        return next;
      });
    }, T_ACCUM);

    // T+1500ms — card exits and advance
    addTimer(() => {
      setCardExiting(true);
      addTimer(() => {
        setCardVisible(false);
        if (currentIdx < TALLY_ORDER.length - 1) {
          setCurrentIdx((i) => i + 1);
        } else {
          // Final state done
          addTimer(() => setIsDone(true), T_DONE_DELAY);
          addTimer(() => completeTally(), T_COMPLETE_DELAY);
        }
      }, 200);
    }, STATE_DURATION_MS);

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  return { currentIdx, cardVisible, cardExiting, showFlash, showFly, accumEVs, poppingPlayer, revealedIds };
}

// ── TallyHud ──────────────────────────────────────────────────────────────────

function TallyHud({
  accumEVs,
  poppingPlayer,
}: {
  accumEVs: Record<string, number>;
  poppingPlayer: string | null;
}) {
  const players = useGameStore((s) => s.players);
  const colors = usePlayerColors();
  const totalEV = 538;

  return (
    <div className="tally-hud">
      <span className="tally-hud__title">ELECTORAL ROLL-CALL</span>
      {players.filter((p) => !p.eliminated).map((p) => {
        const ev = accumEVs[p.id] ?? 0;
        const color = colors[p.id];
        const pct = Math.min((ev / totalEV) * 100, 100);
        return (
          <div
            key={p.id}
            className="tally-hud__player"
            style={{ ['--p-color' as string]: color?.hex ?? '#888' }}
          >
            <div className="tally-hud__top">
              <span className="tally-hud__portrait">{p.name.slice(0, 2).toUpperCase()}</span>
              <span className="tally-hud__name">{p.name}</span>
            </div>
            <span className={`tally-hud__ev${poppingPlayer === p.id ? ' tally-hud__ev--popping' : ''}`}>
              {ev} EV
            </span>
            <div className="tally-hud__bar">
              <div className="tally-hud__bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── StateTallyCard ────────────────────────────────────────────────────────────

function StateTallyCard({
  stateIdx,
  showFlash,
  exiting,
}: {
  stateIdx: number;
  showFlash: boolean;
  exiting: boolean;
}) {
  const state = TALLY_ORDER[stateIdx];
  const rungs = useGameStore((s) => (state ? s.rungs[state.id] ?? {} : {}));
  const electionResult = useGameStore((s) => s.electionResult);
  const players = useGameStore((s) => s.players);
  const colors = usePlayerColors();

  if (!state) return null;

  const winnerId = electionResult?.stateLeaders?.[state.id] ?? null;
  const winnerPlayer = winnerId ? players.find((p) => p.id === winnerId) : null;
  const winnerColor = winnerId ? colors[winnerId]?.hex : undefined;
  const activePlayers = players.filter((p) => !p.eliminated);

  return (
    <div className={`tally-card${exiting ? ' tally-card--exiting' : ''}`}>
      <div className="tally-card__header">
        <span className="tally-card__state-name">{state.name}</span>
        <span className="tally-card__ev-badge">{state.electoralVotes} EV</span>
      </div>

      {activePlayers.map((p) => {
        const r = rungs[p.id] ?? 0;
        const pct = state.maxRungs > 0 ? (r / state.maxRungs) * 100 : 0;
        return (
          <div
            key={p.id}
            className="tally-card__rungs-row"
            style={{ ['--p-color' as string]: colors[p.id]?.hex ?? '#888' }}
          >
            <span className="tally-card__rung-label">{p.name}</span>
            <div className="tally-card__rung-bar-wrap">
              <div className="tally-card__rung-bar" style={{ width: `${pct}%` }} />
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', minWidth: '2.5rem', textAlign: 'right' }}>
              {r}/{state.maxRungs}
            </span>
          </div>
        );
      })}

      {winnerPlayer ? (
        <div
          className="tally-card__winner-label"
          style={{ ['--p-color' as string]: winnerColor ?? 'var(--yellow)' }}
        >
          {winnerPlayer.name.toUpperCase()} WINS +{state.electoralVotes} EV
        </div>
      ) : (
        <div className="tally-card__no-contest">No majority — no EVs awarded</div>
      )}

      {showFlash && winnerPlayer && (
        <div
          className="tally-card__flash"
          style={{ ['--p-color' as string]: winnerColor ?? 'var(--yellow)' }}
        />
      )}
    </div>
  );
}

// ── EvFlyChip ─────────────────────────────────────────────────────────────────

function EvFlyChip({ stateIdx }: { stateIdx: number }) {
  const state = TALLY_ORDER[stateIdx];
  const electionResult = useGameStore((s) => s.electionResult);
  const colors = usePlayerColors();

  if (!state) return null;
  const winnerId = electionResult?.stateLeaders?.[state.id] ?? null;
  if (!winnerId) return null;

  const winnerColor = colors[winnerId]?.hex ?? 'var(--yellow)';

  return (
    <div
      className="ev-fly-chip"
      style={{ ['--p-color' as string]: winnerColor }}
    >
      +{state.electoralVotes} EV
    </div>
  );
}

// ── ElectionTallyView ─────────────────────────────────────────────────────────

export function ElectionTallyView() {
  const {
    currentIdx,
    cardVisible,
    cardExiting,
    showFlash,
    showFly,
    accumEVs,
    poppingPlayer,
    revealedIds,
  } = useElectionTallySequence();

  // Stable key on currentIdx so tally-card-in re-fires for each new state
  const cardKey = `card-${currentIdx}`;
  const flyKey = `fly-${currentIdx}`;

  // Build active state id for map highlight
  const activeStateId = TALLY_ORDER[currentIdx]?.id ?? null;

  // Memoize the revealed set to avoid unnecessary re-renders on ElectionMap
  const revealedSet = useMemo(() => revealedIds, [revealedIds]);

  return (
    <div className="tally-view">
      <TallyHud accumEVs={accumEVs} poppingPlayer={poppingPlayer} />

      <div className="tally-stage">
        <div className="tally-map-wrap">
          <ElectionMap
            tallyActiveStateId={activeStateId}
            tallyRevealedIds={revealedSet}
          />
        </div>

        {cardVisible && (
          <StateTallyCard
            key={cardKey}
            stateIdx={currentIdx}
            showFlash={showFlash}
            exiting={cardExiting}
          />
        )}

        {showFly && (
          <EvFlyChip key={flyKey} stateIdx={currentIdx} />
        )}
      </div>
    </div>
  );
}
