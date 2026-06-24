/**
 * Interactive SVG US map — pass-and-play hot-seat mode (2–4 players).
 *
 * Architecture:
 *   ElectionMap     → renders the SVG map + hover/pinned StateHoverCard
 *   StateGeo        → memo'd; subscribes ONLY to rungs[stateId] + securedBy[stateId] + pending
 *   StateHoverCard  → contextual overlay: name, base cost, EV, size-tier RungTrack, click-to-buy
 *   ElectionOverlay → shown when phase === 'ELECTION'
 *
 * Color model (N players):
 *   Secured        → solid owner color
 *   Contested      → neutral lerped toward the leader's color ∝ rung margin
 *   Empty          → slate gray
 *   Active pending → handled inside RungTrack (dashed/pulsing active color)
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import usAtlas from 'us-atlas/states-10m.json';
import { WIN_THRESHOLD, bestAffinityForState } from '../game/engine';
import { ALL_STATES } from '../game/statesData';
import { STATE_GROUPS_BY_STATE, minRungsForDominance } from '../game/config';
import { NEUTRAL_RGB, lerp, rgbStr, type ResolvedColor } from '../game/colors';
import {
  useGameStore,
  usePendingRungs,
  useActivePlayer,
  usePlayerColors,
  useAffordability,
} from '../game/store';
import type { StateId, US_State } from '../game/types';
import { AudioManager } from '../utils/audioManager';
import { notifyOnce } from '../utils/toast';
import { RungTrack } from './RungTrack';

// ── Module-level stable lookups ───────────────────────────────────────────────

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

function stateColor(
  rungs: Record<string, number>,
  securedById: string | null | undefined,
  maxRungs: number,
  colors: Record<string, ResolvedColor>,
): string {
  if (securedById && colors[securedById]) return colors[securedById].hex;

  let leader: string | null = null;
  let lead = 0;
  let second = 0;
  for (const [pid, r] of Object.entries(rungs)) {
    if (r > lead) { second = lead; lead = r; leader = pid; }
    else if (r > second) second = r;
  }
  if (!leader || lead === 0) return rgbStr(NEUTRAL_RGB);

  // Stronger contrast than before: a clear lead now reads at a glance instead of
  // washing out near neutral. Floor lifted to 0.4, slope steepened.
  const margin = (lead - second) / maxRungs;
  const intensity = Math.min(0.4 + margin * 1.9, 1);
  const c = colors[leader]?.rgb ?? NEUTRAL_RGB;
  return rgbStr([
    lerp(NEUTRAL_RGB[0], c[0], intensity),
    lerp(NEUTRAL_RGB[1], c[1], intensity),
    lerp(NEUTRAL_RGB[2], c[2], intensity),
  ]);
}

/** Top two campaign-level counts in a state (for the "heavily contested" cue). */
function leadMargin(rungs: Record<string, number>): { lead: number; second: number } {
  let lead = 0;
  let second = 0;
  for (const r of Object.values(rungs)) {
    if (r > lead) { second = lead; lead = r; }
    else if (r > second) second = r;
  }
  return { lead, second };
}

// ── Per-state path ────────────────────────────────────────────────────────────

interface StateGeoProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geo: any;
  stateId: StateId;
  isInteractive: boolean;
  colors: Record<string, ResolvedColor>;
  activePlayerHex: string;
  onHover: (id: StateId, x: number, y: number) => void;
  onLeave: () => void;
  onSelect: (id: StateId, x: number, y: number) => void;
  tallyActiveStateId?: string | null;
  tallyRevealedIds?: Set<string>;
  isGroupHighlighted?: boolean;
  isGroupDimmed?: boolean;
  isSelected?: boolean;
}

const StateGeo = memo(function StateGeo({
  geo, stateId, isInteractive, colors, activePlayerHex, onHover, onLeave, onSelect,
  tallyActiveStateId, tallyRevealedIds, isGroupHighlighted, isGroupDimmed, isSelected,
}: StateGeoProps) {
  const rungs = useGameStore((s) => s.rungs[stateId] ?? {});
  const securedById = useGameStore((s) => s.securedBy[stateId]);
  const pendingRungs = usePendingRungs('state', stateId);
  const clashing = useGameStore(
    (s) => s.phase === 'RESOLUTION' && (s.lastTurnReport?.clashedStates.includes(stateId) ?? false),
  );
  // A state that just locked in this turn gets a one-shot "recently changed" pulse.
  const recentlySecured = useGameStore(
    (s) => s.phase === 'RESOLUTION'
      && (s.lastTurnReport?.newlySecured.some((e) => e.kind === 'state' && e.targetId === stateId) ?? false),
  );

  const usState = STATES_BY_ID.get(stateId);
  const maxRungs = usState?.maxRungs ?? 8;
  const fill = stateColor(rungs, securedById, maxRungs, colors);
  const hasPending = pendingRungs > 0;
  const { lead, second } = leadMargin(rungs);
  const contested = !securedById && lead > 0 && second > 0 && lead - second <= 1;

  const isTallyActive = tallyActiveStateId === stateId;
  const isTallyRevealed = !isTallyActive && (tallyRevealedIds?.has(stateId) ?? false);
  const className = [
    clashing ? 'state-geo--clash' : '',
    recentlySecured ? 'state-geo--recent' : '',
    isSelected ? 'state-geo--selected' : '',
    contested && !isSelected ? 'state-geo--contested' : '',
    isTallyActive ? 'state-geo--tally-active' : '',
    isTallyRevealed ? 'state-geo--tally-revealed' : '',
    isGroupHighlighted ? 'state-geo--group-highlight' : '',
    isGroupDimmed ? 'state-geo--group-dim' : '',
  ].filter(Boolean).join(' ') || undefined;

  const stroke = isSelected
    ? 'var(--brand)'
    : isGroupHighlighted
      ? '#facc15'
      : hasPending
        ? activePlayerHex
        : '#0f172a';
  const strokeWidth = isSelected ? 2.4 : isGroupHighlighted ? 2.5 : hasPending ? 1.6 : 0.5;
  const opacity = isGroupDimmed ? 0.3 : 1;
  // Glow filter is applied ONLY to the selected state (≤1 path) — never the whole map.
  const filter = isSelected ? 'url(#sel-glow)' : undefined;

  return (
    <Geography
      geography={geo}
      className={className}
      onClick={isInteractive ? (e: React.MouseEvent) => onSelect(stateId, e.clientX, e.clientY) : undefined}
      onMouseEnter={(e: React.MouseEvent) => onHover(stateId, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{
        default: {
          fill,
          stroke,
          strokeWidth,
          opacity,
          filter,
          outline: 'none',
          cursor: isInteractive ? 'pointer' : 'default',
        },
        hover: {
          fill,
          stroke: isSelected ? 'var(--brand)' : isGroupHighlighted ? '#facc15' : '#ffffff',
          strokeWidth: isSelected ? 2.4 : isGroupHighlighted ? 2.5 : 1.5,
          outline: 'none',
          opacity: isGroupDimmed ? 0.5 : 0.9,
          filter,
          cursor: isInteractive ? 'pointer' : 'default',
        },
        pressed: { fill, stroke: '#ffffff', strokeWidth: 2, outline: 'none', opacity: 0.9 },
      }}
    />
  );
});

// ── State hover / action card ─────────────────────────────────────────────────

interface StateHoverCardProps {
  stateId: StateId;
  x: number;
  y: number;
  interactive: boolean;
  onClose: () => void;
}

function StateHoverCard({ stateId, x, y, interactive, onClose }: StateHoverCardProps) {
  const usState = STATES_BY_ID.get(stateId);
  const rungs = useGameStore((s) => s.rungs[stateId] ?? {});
  const securedById = useGameStore((s) => s.securedBy[stateId]);
  const players = useGameStore((s) => s.players);
  const allocate = useGameStore((s) => s.allocate);
  const retractLastAllocation = useGameStore((s) => s.retractLastAllocation);
  const phase = useGameStore((s) => s.phase);
  const activePlayer = useActivePlayer();
  const colors = usePlayerColors();
  const pendingRungs = usePendingRungs('state', stateId);
  const aff = useAffordability('state', stateId);
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    if (!interactive) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive, onClose]);

  useEffect(() => {
    if (!nudge) return;
    const t = window.setTimeout(() => setNudge(false), 450);
    return () => window.clearTimeout(t);
  }, [nudge]);

  if (!usState) return null;

  const maxRungs = usState.maxRungs;
  const tier = maxRungs === 16 ? 'Megastate' : maxRungs === 8 ? 'Small' : 'Mid-Tier';
  const canBuy = interactive && phase === 'PLANNING' && !!activePlayer && !securedById;
  const discount = activePlayer ? bestAffinityForState(activePlayer, stateId) : 0;

  // Who currently leads this state (by settled campaign levels)?
  const live = players.filter((p) => !p.eliminated);
  let leaderId: string | null = null;
  let lead = 0;
  let tied = false;
  for (const p of live) {
    const r = rungs[p.id] ?? 0;
    if (r > lead) { lead = r; leaderId = p.id; tied = false; }
    else if (r === lead && r > 0) { tied = true; }
  }
  const leaderIsYou = !securedById && !!leaderId && leaderId === activePlayer?.id && !tied;
  const securedName = securedById
    ? players.find((p) => p.id === securedById)?.name ?? securedById
    : null;
  const leaderName = leaderId ? players.find((p) => p.id === leaderId)?.name ?? leaderId : null;

  const cardX = Math.max(8, Math.min(x + 16, window.innerWidth - 300));
  const cardY = Math.max(y - 20, 8);

  // Single funding path: only allocate when the action is genuinely affordable;
  // otherwise nudge + one (deduped) toast so rapid taps never stack warnings.
  const tryFund = () => {
    if (aff.affordable) {
      AudioManager.play('buy');
      const ok = allocate('state', stateId, 1);
      if (!ok) { setNudge(true); notifyOnce('error', 'Not enough campaign funds'); }
    } else {
      setNudge(true);
      if (aff.reason) notifyOnce('error', aff.reason);
    }
  };

  return (
    <>
      {interactive && <div className="popover-backdrop" onClick={onClose} />}
      <div
        className={`state-card${interactive ? ' state-card--pinned' : ''}`}
        style={{ left: cardX, top: cardY }}
      >
        <div className="state-card__header">
          <span className="state-card__name">{usState.name}</span>
          <span className="state-card__ev">{usState.electoralVotes} EV</span>
          {interactive && (
            <button type="button" className="state-card__close" onClick={onClose}>×</button>
          )}
        </div>

        <div className="state-card__leader">
          {securedName ? (
            <span className="state-card__leader-tag is-secured">🔒 Secured by {securedName}</span>
          ) : leaderIsYou ? (
            <span className="state-card__leader-tag is-you">You're leading</span>
          ) : leaderName && !tied ? (
            <span className="state-card__leader-tag is-opp">{leaderName} leading</span>
          ) : lead > 0 ? (
            <span className="state-card__leader-tag is-contested">Contested — too close to call</span>
          ) : (
            <span className="state-card__leader-tag is-neutral">Neutral — not yet contested</span>
          )}
        </div>

        <div className="state-card__standings">
          {live.map((p) => {
            const isActive = p.id === activePlayer?.id;
            const r = rungs[p.id] ?? 0;
            const pen = isActive ? pendingRungs : 0;
            const pct = Math.min((r / maxRungs) * 100, 100);
            const pendPct = Math.min(((r + pen) / maxRungs) * 100, 100);
            return (
              <div key={p.id} className={`sc-standing${isActive ? ' sc-standing--you' : ''}`}>
                <span className="sc-standing__name" style={{ color: colors[p.id]?.hex }}>
                  {isActive ? 'You' : p.name}
                </span>
                <div className="sc-standing__bar-wrap">
                  {pen > 0 && (
                    <div
                      className="sc-standing__bar sc-standing__bar--pending"
                      style={{ width: `${pendPct}%`, background: colors[p.id]?.hex }}
                    />
                  )}
                  <div
                    className="sc-standing__bar"
                    style={{ width: `${pct}%`, background: colors[p.id]?.hex }}
                  />
                </div>
                <span className="sc-standing__count">Lvl {r}{pen > 0 ? `+${pen}` : ''}/{maxRungs}</span>
              </div>
            );
          })}
        </div>

        <RungTrack
          maxRungs={maxRungs}
          settledByPlayer={rungs}
          pendingRungs={activePlayer ? pendingRungs : 0}
          activePlayerId={activePlayer?.id ?? null}
          colors={colors}
          securedBy={securedById}
          nextAffordable={aff.affordable}
          onBuyNext={canBuy ? () => allocate('state', stateId, 1) : undefined}
          onRetractLast={canBuy && pendingRungs > 0 ? () => retractLastAllocation('state', stateId) : undefined}
        />

        {canBuy && (
          <div className={`state-card__buy${nudge ? ' state-card__buy--nudge' : ''}`}>
            <span className="state-card__cost">
              {aff.atMax ? (
                <span className="state-card__cost-max">Maxed out</span>
              ) : (
                <>
                  Next level{' '}
                  <strong className={aff.reason?.startsWith('Need') ? 'is-short' : undefined}>
                    ${aff.nextCost}k
                  </strong>
                  {discount > 0 && <span className="state-card__disc"> (−{Math.round(discount * 100)}%)</span>}
                  {discount < 0 && <span className="state-card__pen"> (+{Math.round(-discount * 100)}%)</span>}
                </>
              )}
            </span>
            <div className="state-card__buy-actions">
              {pendingRungs > 0 && (
                <button
                  type="button"
                  className="state-card__undo-btn"
                  onClick={() => { AudioManager.play('quit'); retractLastAllocation('state', stateId); }}
                  title="Undo the last campaign level queued this turn"
                >
                  ↩ Undo
                </button>
              )}
              <button
                type="button"
                className={`state-card__buy-btn${aff.affordable ? '' : ' is-disabled'}`}
                aria-disabled={!aff.affordable}
                onClick={tryFund}
              >
                {aff.affordable ? 'Fund Campaign →' : aff.reason ?? 'Unavailable'}
              </button>
            </div>
          </div>
        )}

        {interactive && (
          <p className="state-card__explainer">
            Campaign Level = your standing here. The highest level on election day wins the state.
          </p>
        )}

        <div className="state-card__groups">
          <span className="state-card__tier">{tier} · max Lvl {maxRungs}</span>
          {(STATE_GROUPS_BY_STATE[stateId] ?? []).map((g) => {
            const minR = minRungsForDominance(stateId, usState.electoralVotes);
            const myR = activePlayer ? ((rungs[activePlayer.id] ?? 0) + pendingRungs) : 0;
            const qualifies = myR >= minR;
            return (
              <span key={g} className={`state-card__tag${qualifies ? ' state-card__tag--ok' : ''}`}>
                {g}
                <span className="state-card__tag-min"> {qualifies ? '✓' : `${myR}/${minR}`}</span>
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Election overlay ──────────────────────────────────────────────────────────

export function ElectionOverlay() {
  const electionResult = useGameStore((s) => s.electionResult);
  const players = useGameStore((s) => s.players);
  const turn = useGameStore((s) => s.turn);
  const resolveElection = useGameStore((s) => s.resolveElection);
  const colors = usePlayerColors();

  if (!electionResult) return null;

  const active = players.filter((p) => !p.eliminated);
  const ranked = [...active].sort(
    (a, b) => (electionResult.evByPlayer[b.id] ?? 0) - (electionResult.evByPlayer[a.id] ?? 0),
  );

  const winner = electionResult.winner
    ? players.find((p) => p.id === electionResult.winner)
    : null;

  let eliminatedId: string | null = null;
  if (!winner && active.length > 2) {
    let lowestEV = Infinity;
    for (const p of active) {
      const ev = electionResult.evByPlayer[p.id] ?? 0;
      if (ev < lowestEV) { lowestEV = ev; eliminatedId = p.id; }
    }
  }

  return (
    <div className="election-overlay">
      <div className="election-overlay__panel">
        <div className="election-overlay__label">ELECTION</div>
        <h2 className="election-overlay__title">Turn {turn} Results</h2>

        <div className="election-overlay__results">
          {ranked.map((p) => {
            const evs = electionResult.evByPlayer[p.id] ?? 0;
            const isWinner = p.id === electionResult.winner;
            const isEliminated = p.id === eliminatedId;
            return (
              <div
                key={p.id}
                className={[
                  'election-overlay__candidate',
                  isWinner ? 'election-overlay__candidate--winner' : '',
                  isEliminated ? 'election-overlay__candidate--eliminated' : '',
                ].filter(Boolean).join(' ')}
                style={{ ['--p-color' as string]: colors[p.id]?.hex }}
              >
                <span className="election-overlay__cname">{p.name}</span>
                <span className="election-overlay__ev">{evs} EV</span>
                {isWinner && <span className="election-overlay__badge election-overlay__badge--win">WINNER</span>}
                {isEliminated && <span className="election-overlay__badge election-overlay__badge--out">ELIMINATED</span>}
              </div>
            );
          })}
        </div>

        {winner ? (
          <div className="election-overlay__outcome election-overlay__outcome--win">
            {winner.name} reaches {electionResult.evByPlayer[winner.id]} electoral votes!
          </div>
        ) : (
          <div className="election-overlay__outcome">
            <p>No candidate reached {WIN_THRESHOLD} electoral votes.</p>
            {eliminatedId && (
              <p>
                <strong>{players.find((p) => p.id === eliminatedId)?.name}</strong> is eliminated.
                Their campaign levels are wiped and states revert to contest.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          className="election-overlay__btn"
          onClick={() => { AudioManager.play(winner ? 'victory' : 'confirm'); resolveElection(); }}
        >
          {winner ? 'View Final Results →' : 'Continue Campaign →'}
        </button>
      </div>
    </div>
  );
}

// ── Main map ──────────────────────────────────────────────────────────────────

interface CardState { stateId: StateId; x: number; y: number; }

interface MapPosition { coordinates: [number, number]; zoom: number; }

// Contiguous-US centroid. Used as the zoom/pan center so the geoAlbersUsa
// projection never inverts an out-of-bounds point (which returns null).
const US_CENTER: [number, number] = [-97, 38];

interface ElectionMapProps {
  tallyActiveStateId?: string | null;
  tallyRevealedIds?: Set<string>;
  highlightedStateIds?: Set<string> | null;
}

export function ElectionMap({ tallyActiveStateId, tallyRevealedIds, highlightedStateIds }: ElectionMapProps = {}) {
  const phase = useGameStore((s) => s.phase);
  const activePlayer = useActivePlayer();
  const colors = usePlayerColors();
  const [hover, setHover] = useState<CardState | null>(null);
  const [pinned, setPinned] = useState<CardState | null>(null);

  const isInteractive = phase === 'PLANNING';
  const activeHex = activePlayer ? (colors[activePlayer.id]?.hex ?? '#facc15') : '#facc15';

  // Pinch-zoom / pan state.
  const [position, setPosition] = useState<MapPosition>({ coordinates: US_CENTER, zoom: 1 });
  const handleMoveEnd = useCallback((pos: MapPosition) => setPosition(pos), []);
  const zoomIn = useCallback(() => setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.5, 8) })), []);
  const zoomOut = useCallback(() => setPosition((p) => {
    const zoom = Math.max(p.zoom / 1.5, 1);
    return zoom <= 1 ? { coordinates: US_CENTER, zoom: 1 } : { ...p, zoom };
  }), []);
  const resetZoom = useCallback(() => setPosition({ coordinates: US_CENTER, zoom: 1 }), []);

  const handleHover = useCallback((id: StateId, x: number, y: number) => {
    if (!pinned) setHover({ stateId: id, x, y });
  }, [pinned]);

  const handleLeave = useCallback(() => { setHover(null); }, []);

  const handleSelect = useCallback((id: StateId, x: number, y: number) => {
    setHover(null);
    setPinned({ stateId: id, x, y });
  }, []);

  const closePinned = useCallback(() => { setPinned(null); }, []);

  return (
    <div className="election-map-wrap">
      <div className="election-map-container">
        <ComposableMap
          projection="geoAlbersUsa"
          width={800}
          height={500}
          style={{ width: '100%', height: '100%' }}
        >
          <defs>
            {/* Brand-orange glow, applied only to the selected state (perf-safe). */}
            <filter id="sel-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#f59022" floodOpacity="0.95" />
            </filter>
          </defs>
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates}
            minZoom={1}
            maxZoom={8}
            translateExtent={[[0, 0], [800, 500]]}
            onMoveEnd={handleMoveEnd}
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
                      colors={colors}
                      activePlayerHex={activeHex}
                      onHover={handleHover}
                      onLeave={handleLeave}
                      onSelect={handleSelect}
                      tallyActiveStateId={tallyActiveStateId}
                      tallyRevealedIds={tallyRevealedIds}
                      isGroupHighlighted={!!highlightedStateIds?.has(stateId)}
                      isGroupDimmed={!!highlightedStateIds && !highlightedStateIds.has(stateId)}
                      isSelected={pinned?.stateId === stateId}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        <div className="map-zoom-controls">
          <button type="button" className="map-zoom-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">＋</button>
          <button type="button" className="map-zoom-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">－</button>
          <button type="button" className="map-zoom-btn" onClick={resetZoom} aria-label="Reset view" title="Reset view">⤢</button>
        </div>

        {hover && !pinned && (
          <StateHoverCard
            stateId={hover.stateId}
            x={hover.x}
            y={hover.y}
            interactive={false}
            onClose={() => setHover(null)}
          />
        )}
      </div>

      {pinned && (
        <StateHoverCard
          stateId={pinned.stateId}
          x={pinned.x}
          y={pinned.y}
          interactive
          onClose={closePinned}
        />
      )}
    </div>
  );
}
