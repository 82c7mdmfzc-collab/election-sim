/**
 * Interactive SVG US map — pass-and-play multiplayer mode.
 *
 * Architecture:
 *   ElectionMap   → subscribes to phase; renders map + PhasePanel
 *   StateGeo      → memo'd; subscribes ONLY to investment[stateId] + securedBy[stateId] + pending
 *   StatePopover  → full action panel (click a state during active turn)
 *   PhasePanel    → subscribes to pending spends + budget for its own renders
 *   ElectionOverlay → shown when phase === 'ELECTION'
 *
 * Investment color model:
 *   Secured by P1 → solid blue
 *   Secured by P2 → solid red
 *   Contested      → gradient toward the leader's color, intensity ∝ margin / secureAt
 *   Empty          → slate gray
 *   Pending alloc  → gold border
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import usAtlas from 'us-atlas/states-10m.json';
import { WIN_THRESHOLD } from '../game/engine';
import { ALL_CANDIDATES, ALL_STATES } from '../game/statesData';
import {
  ELECTION_CHANCE,
  ELECTION_START_TURN,
  useActivePendingSpends,
  useAvailableBudget,
  useElectoralResult,
  useGameStore,
  useStatePendingAmount,
} from '../game/store';
import type { CandidateId, InterestGroup, StateId, US_State } from '../game/types';

// ── Module-level stable lookups ───────────────────────────────────────────────

const P1_ID = ALL_CANDIDATES[0].id;
const P2_ID = ALL_CANDIDATES[1].id;
const P1_NAME = ALL_CANDIDATES[0].name;
const P2_NAME = ALL_CANDIDATES[1].name;

const STATES_BY_ID = new Map<StateId, US_State>(ALL_STATES.map((s) => [s.id, s]));

const FIPS_TO_STATE: Record<string, StateId> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

// ── Color shading ─────────────────────────────────────────────────────────────

const NEUTRAL: [number, number, number] = [100, 116, 139]; // slate-500
const P1_COLOR: [number, number, number] = [37, 99, 235];  // blue-600
const P2_COLOR: [number, number, number] = [220, 38, 38];  // red-600

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function stateColor(
  inv: Record<CandidateId, number>,
  securedById: CandidateId | null | undefined,
  secureAt: number,
): string {
  if (securedById === P1_ID) return `rgb(${P1_COLOR.join(',')})`;
  if (securedById === P2_ID) return `rgb(${P2_COLOR.join(',')})`;

  const inv1 = inv[P1_ID] ?? 0;
  const inv2 = inv[P2_ID] ?? 0;

  if (inv1 === 0 && inv2 === 0) return `rgb(${NEUTRAL.join(',')})`;

  const prog1 = Math.min(inv1 / secureAt, 1);
  const prog2 = Math.min(inv2 / secureAt, 1);
  const margin = prog1 - prog2; // positive = P1 leading
  const intensity = Math.min(Math.abs(margin) * 2, 1);
  const [cr, cg, cb] = margin >= 0 ? P1_COLOR : P2_COLOR;
  return `rgb(${Math.round(lerp(NEUTRAL[0], cr, intensity))},${Math.round(lerp(NEUTRAL[1], cg, intensity))},${Math.round(lerp(NEUTRAL[2], cb, intensity))})`;
}

// ── Per-state path ────────────────────────────────────────────────────────────

interface StateGeoProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geo: any;
  stateId: StateId;
  isInteractive: boolean;
  onHover: (id: StateId, x: number, y: number) => void;
  onLeave: () => void;
  onSelect: (id: StateId, x: number, y: number) => void;
}

const StateGeo = memo(function StateGeo({
  geo,
  stateId,
  isInteractive,
  onHover,
  onLeave,
  onSelect,
}: StateGeoProps) {
  const inv = useGameStore((s) => s.investment[stateId] ?? {});
  const securedById = useGameStore((s) => s.securedBy[stateId]);
  const pendingAmount = useStatePendingAmount(stateId);

  const usState = STATES_BY_ID.get(stateId);
  const secureAt = (usState?.baseCampaignCost ?? 1) * 100;

  const fill = stateColor(inv, securedById, secureAt);
  const hasPending = pendingAmount > 0;

  return (
    <Geography
      geography={geo}
      onClick={
        isInteractive
          ? (e: React.MouseEvent) => onSelect(stateId, e.clientX, e.clientY)
          : undefined
      }
      onMouseEnter={(e: React.MouseEvent) => onHover(stateId, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{
        default: {
          fill,
          stroke: hasPending ? '#facc15' : '#1e293b',
          strokeWidth: hasPending ? 1.5 : 0.5,
          outline: 'none',
          cursor: isInteractive ? 'pointer' : 'default',
        },
        hover: {
          fill,
          stroke: '#ffffff',
          strokeWidth: 1.5,
          outline: 'none',
          opacity: 0.85,
          cursor: isInteractive ? 'pointer' : 'default',
        },
        pressed: {
          fill,
          stroke: '#ffffff',
          strokeWidth: 2,
          outline: 'none',
          opacity: 0.9,
        },
      }}
    />
  );
});

// ── Hover tooltip ─────────────────────────────────────────────────────────────

function TooltipPanel({ stateId }: { stateId: StateId }) {
  const usState = STATES_BY_ID.get(stateId);
  const inv = useGameStore((s) => s.investment[stateId] ?? {});
  const securedById = useGameStore((s) => s.securedBy[stateId]);
  const candidates = useGameStore((s) => s.candidates);

  if (!usState) return null;

  const secureAt = usState.baseCampaignCost * 100;
  const securedName = securedById
    ? (candidates.find((c) => c.id === securedById)?.name ?? securedById)
    : null;

  return (
    <div className="state-tooltip">
      <div className="state-tooltip__name">
        {usState.name}
        <span className="state-tooltip__ev">{usState.electoralVotes} EV</span>
      </div>

      {securedName && (
        <div className="state-tooltip__locked">🔒 Secured by {securedName}</div>
      )}

      <div className="state-tooltip__threshold">
        Secure at: ${secureAt.toLocaleString()}
      </div>

      <div className="state-tooltip__bars">
        {candidates.map((c) => {
          const amount = inv[c.id] ?? 0;
          const pct = Math.min((amount / secureAt) * 100, 100);
          const isP1 = c.id === P1_ID;
          return (
            <div key={c.id} className="state-tooltip__bar-row">
              <span className="state-tooltip__bar-name">{c.name}</span>
              <div className="state-tooltip__bar-track">
                <div
                  className={`state-tooltip__bar-fill${isP1 ? ' state-tooltip__bar-fill--p1' : ' state-tooltip__bar-fill--p2'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="state-tooltip__bar-amount">
                ${amount.toFixed(0)} / ${secureAt.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="state-tooltip__groups">
        {usState.interestGroups.map((g) => (
          <span key={g} className="state-tooltip__tag">{g}</span>
        ))}
      </div>
    </div>
  );
}

// ── State action popover ──────────────────────────────────────────────────────

const SPEND_PRESETS = [50, 100, 250, 500] as const;

interface StatePopoverProps {
  stateId: StateId;
  x: number;
  y: number;
  onClose: () => void;
}

function StatePopover({ stateId, x, y, onClose }: StatePopoverProps) {
  const usState = STATES_BY_ID.get(stateId);
  const inv = useGameStore((s) => s.investment[stateId] ?? {});
  const securedById = useGameStore((s) => s.securedBy[stateId]);
  const candidates = useGameStore((s) => s.candidates);
  const activeId = useGameStore((s) => s.activePlayerId);
  const allocateSpend = useGameStore((s) => s.allocateSpend);
  const phase = useGameStore((s) => s.phase);

  const [selectedGroup, setSelectedGroup] = useState<InterestGroup | undefined>(undefined);
  const [selectedAmount, setSelectedAmount] = useState<number>(100);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!usState) return null;

  const secureAt = usState.baseCampaignCost * 100;
  const activeCandidate = candidates.find((c) => c.id === activeId);
  const isActivePhase = phase === 'P1_TURN' || phase === 'P2_TURN';

  const affinityBonus =
    activeCandidate && selectedGroup ? (activeCandidate.affinities[selectedGroup] ?? 0) : 0;
  const effectiveAmount = selectedAmount * (1 + affinityBonus);

  const handleAllocate = () => {
    allocateSpend(stateId, selectedAmount, selectedGroup);
    onClose();
  };

  // Position relative to viewport, clamped inside window
  const popX = Math.min(x + 16, window.innerWidth - 320);
  const popY = Math.max(y - 20, 8);

  return (
    <>
      {/* Click-outside backdrop */}
      <div className="popover-backdrop" onClick={onClose} />

      <div className="state-popover" style={{ left: popX, top: popY }}>
        <div className="state-popover__header">
          <span className="state-popover__name">{usState.name}</span>
          <span className="state-popover__ev">{usState.electoralVotes} EV</span>
          <button type="button" className="state-popover__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="state-popover__threshold">
          Secure threshold: <strong>${secureAt.toLocaleString()}</strong>
        </div>

        {securedById && (
          <div className={`state-popover__locked${securedById === activeId ? ' state-popover__locked--own' : ''}`}>
            {securedById === activeId
              ? '🔒 You secured this state'
              : `🔒 Secured by ${candidates.find((c) => c.id === securedById)?.name ?? securedById}`}
          </div>
        )}

        <div className="state-popover__bars">
          {candidates.map((c) => {
            const amount = inv[c.id] ?? 0;
            const pct = Math.min((amount / secureAt) * 100, 100);
            const isP1 = c.id === P1_ID;
            return (
              <div key={c.id} className="state-popover__bar-row">
                <span className={`state-popover__bar-name${isP1 ? ' state-popover__bar-name--p1' : ' state-popover__bar-name--p2'}`}>
                  {c.name}
                </span>
                <div className="state-popover__bar-track">
                  <div
                    className={`state-popover__bar-fill${isP1 ? ' state-popover__bar-fill--p1' : ' state-popover__bar-fill--p2'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="state-popover__bar-amount">
                  ${amount.toFixed(0)} / ${secureAt.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>

        {isActivePhase && (
          <div className="state-popover__actions">
            {usState.interestGroups.length > 0 && (
              <div className="state-popover__section-label">Interest group (affinity bonus):</div>
            )}
            <div className="state-popover__groups">
              <button
                type="button"
                className={`state-popover__group-btn${!selectedGroup ? ' state-popover__group-btn--active' : ''}`}
                onClick={() => setSelectedGroup(undefined)}
              >
                No group
              </button>
              {usState.interestGroups.map((g) => {
                const bonus = activeCandidate?.affinities[g] ?? 0;
                return (
                  <button
                    key={g}
                    type="button"
                    className={`state-popover__group-btn${selectedGroup === g ? ' state-popover__group-btn--active' : ''}`}
                    onClick={() => setSelectedGroup(g)}
                  >
                    {g}
                    {bonus > 0 && (
                      <span className="state-popover__bonus"> +{Math.round(bonus * 100)}%</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="state-popover__section-label">Amount:</div>
            <div className="state-popover__amounts">
              {SPEND_PRESETS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`state-popover__amount-btn${selectedAmount === amt ? ' state-popover__amount-btn--active' : ''}`}
                  onClick={() => setSelectedAmount(amt)}
                >
                  ${amt}
                </button>
              ))}
            </div>

            {affinityBonus > 0 && (
              <div className="state-popover__effective">
                Effective investment: ${effectiveAmount.toFixed(0)}{' '}
                <span className="state-popover__multiplier">
                  ×{(1 + affinityBonus).toFixed(2)} bonus
                </span>
              </div>
            )}

            <button type="button" className="state-popover__allocate-btn" onClick={handleAllocate}>
              Allocate ${selectedAmount}
              {affinityBonus > 0 ? ` (eff. $${effectiveAmount.toFixed(0)})` : ''}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Phase panel ───────────────────────────────────────────────────────────────

function PhasePanel() {
  const phase = useGameStore((s) => s.phase);
  const activeId = useGameStore((s) => s.activePlayerId);
  const turn = useGameStore((s) => s.turn);
  const candidates = useGameStore((s) => s.candidates);
  const lastIncome = useGameStore((s) => s.lastIncome);
  const pendingSpends = useActivePendingSpends();
  const budget = useAvailableBudget();
  const result = useElectoralResult();

  const submitTurn = useGameStore((s) => s.submitTurn);
  const confirmResolution = useGameStore((s) => s.confirmResolution);
  const cancelAllocation = useGameStore((s) => s.cancelAllocation);

  const activeName = activeId === P1_ID ? P1_NAME : P2_NAME;
  const playerNum = activeId === P1_ID ? 1 : 2;

  if (phase === 'RESOLUTION') {
    const electionPossible = turn >= ELECTION_START_TURN;
    return (
      <div className="phase-panel phase-panel--resolution">
        <div className="phase-panel__title">Resolution — Turn {turn}</div>
        <div className="phase-panel__income-row">
          {candidates.map((c) => {
            const evs = result.evByCandidate[c.id] ?? 0;
            const is270 = evs >= WIN_THRESHOLD;
            return (
              <div key={c.id} className="phase-panel__income-card">
                <div className="phase-panel__income-name">{c.name}</div>
                <div className="phase-panel__income-ev">
                  {evs} EV
                  {is270 && <span className="phase-panel__270-badge"> 270+</span>}
                </div>
                <div className="phase-panel__income-amount">
                  +${lastIncome[c.id] ?? 0} income
                </div>
                <div className="phase-panel__income-cash">${c.cash.toFixed(0)}</div>
              </div>
            );
          })}
        </div>
        <div className="phase-panel__election-info">
          {electionPossible
            ? `${Math.round(ELECTION_CHANCE * 100)}% chance an election is called this turn`
            : `Election can be called from turn ${ELECTION_START_TURN}`}
        </div>
        <button type="button" className="phase-panel__btn" onClick={confirmResolution}>
          Start Turn {turn + 1} →
        </button>
      </div>
    );
  }

  return (
    <div className={`phase-panel phase-panel--p${playerNum}`}>
      <div className="phase-panel__header">
        <div className="phase-panel__title">
          Player {playerNum}: {activeName}
        </div>
        <div className="phase-panel__budget">
          Budget remaining: <strong>${budget.toFixed(0)}</strong>
          <span className="phase-panel__hint"> (click a state to invest)</span>
        </div>
      </div>

      {pendingSpends.length > 0 ? (
        <div className="phase-panel__allocations">
          <div className="phase-panel__alloc-label">This turn&apos;s allocations:</div>
          <div className="phase-panel__alloc-list">
            {Object.entries(
              pendingSpends.reduce<Record<StateId, number>>((acc, p) => {
                acc[p.stateId] = (acc[p.stateId] ?? 0) + p.amount;
                return acc;
              }, {}),
            ).map(([sid, total]) => (
              <span key={sid} className="phase-panel__alloc-chip">
                {sid} ${total}
                <button
                  type="button"
                  className="phase-panel__cancel"
                  onClick={() => cancelAllocation(sid)}
                  title={`Cancel ${sid} allocation`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="phase-panel__empty">No allocations yet — click states on the map.</div>
      )}

      <button type="button" className="phase-panel__btn" onClick={submitTurn}>
        {phase === 'P1_TURN' ? `Hand to ${P2_NAME} →` : 'Resolve Turn →'}
      </button>
    </div>
  );
}

// ── Election overlay ──────────────────────────────────────────────────────────

export function ElectionOverlay() {
  const electionResult = useGameStore((s) => s.electionResult);
  const candidates = useGameStore((s) => s.candidates);
  const eliminatedCandidates = useGameStore((s) => s.eliminatedCandidates);
  const turn = useGameStore((s) => s.turn);
  const resolveElection = useGameStore((s) => s.resolveElection);

  if (!electionResult) return null;

  const active = candidates.filter((c) => !eliminatedCandidates.includes(c.id));
  const ranked = [...active].sort(
    (a, b) => (electionResult.evByCandidate[b.id] ?? 0) - (electionResult.evByCandidate[a.id] ?? 0),
  );

  const winner = electionResult.winner
    ? candidates.find((c) => c.id === electionResult.winner)
    : null;

  // Find lowest-EV candidate (who will be eliminated)
  let lowestId: CandidateId | null = null;
  if (!winner && active.length > 1) {
    let lowestEV = Infinity;
    for (const c of active) {
      const ev = electionResult.evByCandidate[c.id] ?? 0;
      if (ev < lowestEV) {
        lowestEV = ev;
        lowestId = c.id;
      }
    }
  }

  return (
    <div className="election-overlay">
      <div className="election-overlay__panel">
        <div className="election-overlay__label">ELECTION</div>
        <h2 className="election-overlay__title">Turn {turn} Results</h2>

        <div className="election-overlay__results">
          {ranked.map((c) => {
            const evs = electionResult.evByCandidate[c.id] ?? 0;
            const isWinner = c.id === electionResult.winner;
            const isEliminated = c.id === lowestId;
            return (
              <div
                key={c.id}
                className={[
                  'election-overlay__candidate',
                  isWinner ? 'election-overlay__candidate--winner' : '',
                  isEliminated ? 'election-overlay__candidate--eliminated' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="election-overlay__cname">{c.name}</span>
                <span className="election-overlay__ev">{evs} EV</span>
                {isWinner && <span className="election-overlay__badge election-overlay__badge--win">WINNER</span>}
                {isEliminated && <span className="election-overlay__badge election-overlay__badge--out">ELIMINATED</span>}
              </div>
            );
          })}
        </div>

        {winner ? (
          <div className="election-overlay__outcome election-overlay__outcome--win">
            {winner.name} reaches {electionResult.evByCandidate[winner.id]} electoral votes!
          </div>
        ) : (
          <div className="election-overlay__outcome">
            <p>No candidate reached {WIN_THRESHOLD} electoral votes.</p>
            {lowestId && (
              <p>
                <strong>{candidates.find((c) => c.id === lowestId)?.name}</strong> is eliminated.
                Their secured states return to contest, but investment is preserved.
              </p>
            )}
          </div>
        )}

        <button type="button" className="election-overlay__btn" onClick={resolveElection}>
          {winner ? 'View Final Results →' : 'Continue Campaign →'}
        </button>
      </div>
    </div>
  );
}

// ── Main map ──────────────────────────────────────────────────────────────────

interface TooltipState {
  stateId: StateId;
  x: number;
  y: number;
}

interface PopoverState {
  stateId: StateId;
  x: number;
  y: number;
}

export function ElectionMap() {
  const phase = useGameStore((s) => s.phase);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const isInteractive = phase === 'P1_TURN' || phase === 'P2_TURN';

  const handleHover = useCallback((id: StateId, x: number, y: number) => {
    if (!popover) setTooltip({ stateId: id, x, y });
  }, [popover]);

  const handleLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleSelect = useCallback((id: StateId, x: number, y: number) => {
    setTooltip(null);
    setPopover({ stateId: id, x, y });
  }, []);

  const closePopover = useCallback(() => {
    setPopover(null);
  }, []);

  return (
    <div className="election-map-wrap">
      <div className="election-map-container">
        <ComposableMap
          projection="geoAlbersUsa"
          width={800}
          height={500}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={usAtlas as Record<string, unknown>}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const fips = String((geo as Record<string, unknown>).id ?? '').padStart(2, '0');
                const stateId = FIPS_TO_STATE[fips];
                if (!stateId) return null;
                return (
                  <StateGeo
                    key={String((geo as Record<string, unknown>).rsmKey ?? fips)}
                    geo={geo}
                    stateId={stateId}
                    isInteractive={isInteractive}
                    onHover={handleHover}
                    onLeave={handleLeave}
                    onSelect={handleSelect}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {tooltip && !popover && (
          <div
            className="state-tooltip-wrap"
            style={{
              left: Math.min(tooltip.x + 14, window.innerWidth - 260),
              top: Math.max(tooltip.y - 160, 8),
            }}
          >
            <TooltipPanel stateId={tooltip.stateId} />
          </div>
        )}
      </div>

      {popover && (
        <StatePopover
          stateId={popover.stateId}
          x={popover.x}
          y={popover.y}
          onClose={closePopover}
        />
      )}

      {phase !== 'ELECTION' && <PhasePanel />}
    </div>
  );
}
