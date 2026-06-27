import { useEffect, useRef, useState, useMemo } from 'react';
import { useGameStore, usePlayerColors } from '../game/store';
import { ALL_STATES } from '../game/statesData';
import { ElectionMap } from './ElectionMap';
import type { StateId } from '../game/types';

// States sorted EV-ascending: small states first, megastates last (max dramatic tension)
const TALLY_ORDER = [...ALL_STATES].sort((a, b) => a.electoralVotes - b.electoralVotes);

// Election-night pacing: the long tail of small states zips by, while the last
// few megastates (TALLY_ORDER is EV-ascending) get a dramatic beat. The whole
// sequence lands in ~8s — comfortably under the 10s cap — and the Skip button can
// end it instantly. Inner offsets are derived as fractions of each slot.
const SLOT_FAST_MS = 90;     // small / mid states
const SLOT_DRAMA_MS = 560;   // the closing megastates
const DRAMA_TAIL = 6;        // how many trailing (highest-EV) states get the slow beat
const T_DONE_DELAY = 300;
const T_COMPLETE_DELAY = 750;

/** Per-slot duration: fast for the tail of small states, slow for the finish. */
function slotDurationFor(idx: number): number {
  return TALLY_ORDER.length - idx <= DRAMA_TAIL ? SLOT_DRAMA_MS : SLOT_FAST_MS;
}

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
  const completedRef = useRef(false);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function addTimer(fn: () => void, delay: number) {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }

  // Fire completeTally EXACTLY once — whether reached via the natural timeline or
  // the Skip button. Guards the victory screen against a missed/double transition.
  function finish() {
    if (completedRef.current) return;
    completedRef.current = true;
    completeTally();
  }

  // Skip straight to the result: reveal every state, bank all EVs, end now.
  function skip() {
    clearTimers();
    setRevealedIds(new Set(TALLY_ORDER.map((s) => s.id)));
    const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
    for (const st of TALLY_ORDER) {
      const w = electionResult?.stateLeaders?.[st.id];
      if (w) totals[w] = (totals[w] ?? 0) + st.electoralVotes;
    }
    setAccumEVs(totals);
    setIsDone(true);
    finish();
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
    const dur = slotDurationFor(currentIdx);
    const popMs = Math.min(350, Math.max(120, dur * 0.9));

    // Winner flash
    addTimer(() => setShowFlash(true), dur * 0.35);

    // EV chip flies up
    addTimer(() => setShowFly(true), dur * 0.55);

    // Accumulate EVs + pop counter + reveal on the map
    addTimer(() => {
      const winnerId = electionResult?.stateLeaders?.[state.id] ?? null;
      if (winnerId) {
        setAccumEVs((prev) => ({
          ...prev,
          [winnerId]: (prev[winnerId] ?? 0) + state.electoralVotes,
        }));
        setPoppingPlayer(winnerId);
        addTimer(() => setPoppingPlayer(null), popMs);
      }
      setRevealedIds((prev) => {
        const next = new Set(prev);
        next.add(state.id);
        return next;
      });
    }, dur * 0.7);

    // Card exits and advance to the next state
    addTimer(() => {
      setCardExiting(true);
      addTimer(() => {
        setCardVisible(false);
        if (currentIdx < TALLY_ORDER.length - 1) {
          setCurrentIdx((i) => i + 1);
        } else {
          // Final state done
          addTimer(() => setIsDone(true), T_DONE_DELAY);
          addTimer(finish, T_COMPLETE_DELAY);
        }
      }, Math.min(40, dur * 0.15));
    }, dur);

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  return { currentIdx, cardVisible, cardExiting, showFlash, showFly, accumEVs, poppingPlayer, revealedIds, isDone, skip };
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
    isDone,
    skip,
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
      {!isDone && (
        <button type="button" className="tally-skip-btn" onClick={skip}>
          Skip to results →
        </button>
      )}
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
