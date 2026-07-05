/**
 * RungTrack — the discrete "pip ladder" primitive shared by geographic states
 * (8/12/16 rungs) and national group ladders (10 rungs).
 *
 * Rendered from the ACTIVE player's perspective:
 *   • settled pips  → solid in the active player's color (authoritative)
 *   • pending pips  → dashed + pulsing in the active player's color (this turn,
 *                     strictly local — see the hidden-planning isolation in the store)
 *   • opponents     → small ticks beneath the pip they've reached, in their color
 *
 * The pips are a display-only meter. Buying is done through the built-in stepper
 * row (UNDO / BUILD) — a single thumb-sized verb that works identically for
 * states and national ladders — rendered whenever `onBuyNext` is supplied.
 *
 * Pending visuals come only from the caller's `pendingRungs` (the active player's
 * own pending), so an opponent's pending is never shown.
 */

import type { ReactNode } from 'react';
import type { ResolvedColor } from '../game/colors';
import { AudioManager } from '../utils/audioManager';
import { PlusIcon, UndoIcon, FlagIcon, CheckIcon, LockIcon } from './icons';

interface RungTrackProps {
  maxRungs: number;
  settledByPlayer: Record<string, number>;
  pendingRungs: number;
  activePlayerId: string | null;
  colors: Record<string, ResolvedColor>;
  securedBy?: string | null;
  onBuyNext?: () => boolean | void;
  /** Retract the most-recently queued (top pending) rung. */
  onRetractLast?: () => void;
  /** Cost of the next rung in $k, shown on the BUILD button. */
  nextCost?: number;
  /** Affinity applied to the next rung (>0 discount, <0 penalty) — shown as a badge. */
  discount?: number;
  /** Name of the player who has called/secured this track (renders a status chip). */
  securedName?: string | null;
  clashing?: boolean;
  size?: 'sm' | 'md';
  /**
   * Rung index (1-based) that "unlocks" this track's reward — banking EV for a
   * state's coalitions, or earning a national group's turn bonus. When set, a
   * gold flag marks that pip and flips to a check once the active player reaches
   * it (settled + pending ≥ unlockAt).
   */
  unlockAt?: number;
  /** Short phrase naming the reward, e.g. "bank this state's EV" — used in the marker tooltip. */
  unlockLabel?: string;
}

export function RungTrack({
  maxRungs,
  settledByPlayer,
  pendingRungs,
  activePlayerId,
  colors,
  securedBy = null,
  onBuyNext,
  onRetractLast,
  nextCost,
  discount = 0,
  securedName = null,
  clashing = false,
  size = 'md',
  unlockAt,
  unlockLabel,
}: RungTrackProps) {
  const activeSettled = activePlayerId ? (settledByPlayer[activePlayerId] ?? 0) : 0;
  const activeColor = activePlayerId ? colors[activePlayerId]?.hex : undefined;
  const nextIndex = activeSettled + pendingRungs + 1;
  const canBuy = !!onBuyNext && !securedBy && nextIndex <= maxRungs;
  const maxed = !securedBy && nextIndex > maxRungs;
  const canRetract = !!onRetractLast && pendingRungs > 0;

  // Unlock-threshold flag: marks the pip that earns this track's reward.
  const showUnlock = unlockAt != null && unlockAt >= 1 && unlockAt <= maxRungs;
  const reachedUnlock = unlockAt != null && activeSettled + pendingRungs >= unlockAt;

  const opponents = Object.entries(settledByPlayer)
    .filter(([id, r]) => id !== activePlayerId && r > 0)
    .map(([id, r]) => ({ id, r, hex: colors[id]?.hex ?? '#94a3b8' }));

  function build() {
    const ok = onBuyNext?.();
    AudioManager.play(ok === false ? 'clash' : 'buy');
  }
  function undo() {
    AudioManager.play('quit');
    onRetractLast?.();
  }

  let costBadge: ReactNode = null;
  if (discount > 0) costBadge = <span className="rung-buy__disc">−{Math.round(discount * 100)}%</span>;
  else if (discount < 0) costBadge = <span className="rung-buy__pen">+{Math.round(-discount * 100)}%</span>;

  return (
    <div
      className={[
        'rung-track',
        `rung-track--${size}`,
        clashing ? 'rung-track--clash' : '',
        securedBy ? 'rung-track--secured' : '',
        showUnlock ? 'rung-track--flagged' : '',
      ].filter(Boolean).join(' ')}
      style={{ ['--rt-color' as string]: activeColor ?? '#64748b' }}
    >
      <div className="rung-track__pips">
        {Array.from({ length: maxRungs }).map((_, i) => {
          const idx = i + 1;
          let state: 'settled' | 'pending' | 'next' | 'empty' = 'empty';
          if (idx <= activeSettled) state = 'settled';
          else if (idx <= activeSettled + pendingRungs) state = 'pending';
          else if (idx === nextIndex && canBuy) state = 'next';

          const isSecuredPip = !!securedBy && securedBy === activePlayerId && idx <= activeSettled;

          return (
            <span
              key={idx}
              role="img"
              className={[
                'rung-pip',
                `rung-pip--${state}`,
                isSecuredPip ? 'rung-pip--secured' : '',
                showUnlock && idx === unlockAt ? 'rung-pip--threshold' : '',
                showUnlock && idx === unlockAt && reachedUnlock ? 'rung-pip--threshold-met' : '',
              ].filter(Boolean).join(' ')}
              aria-label={`Campaign Influence ${idx} of ${maxRungs}${state === 'settled' ? ' — held' : state === 'pending' ? ' — queued' : ''}`}
            />
          );
        })}
      </div>

      {unlockAt != null && unlockAt >= 1 && unlockAt <= maxRungs && (
        <div
          className={['rung-track__flag', reachedUnlock ? 'rung-track__flag--met' : ''].filter(Boolean).join(' ')}
          style={{ left: `${((unlockAt - 0.5) / maxRungs) * 100}%` }}
          title={
            reachedUnlock
              ? `Reached${unlockLabel ? ` — ${unlockLabel}` : ''}`
              : `Reach Campaign Influence ${unlockAt}${unlockLabel ? ` to ${unlockLabel}` : ''}`
          }
        >
          <span className="rung-track__flag-glyph" aria-hidden="true">
            {reachedUnlock ? <CheckIcon size={13} /> : <FlagIcon size={13} />}
          </span>
        </div>
      )}

      {opponents.length > 0 && (
        <div className="rung-track__markers">
          {opponents.map((o) => (
            <span
              key={o.id}
              className="rung-marker"
              style={{
                left: `${((o.r - 0.5) / maxRungs) * 100}%`,
                background: o.hex,
              }}
              title={`${o.id}: ${o.r}/${maxRungs}`}
            />
          ))}
        </div>
      )}

      {/* Buy stepper — the one purchase verb, ≥44pt. Renders whenever this track
          is buyable in principle (active player's turn); collapses to a status
          chip when the track is called or fully climbed. */}
      {onBuyNext && (securedBy ? (
        <div className="rung-buy rung-buy--status rung-buy--called">
          <LockIcon size={15} /> Called{securedName ? ` for ${securedName}` : ''}
        </div>
      ) : maxed ? (
        <div className="rung-buy rung-buy--status rung-buy--max">
          <CheckIcon size={15} /> Maxed out
        </div>
      ) : (
        <div className="rung-buy">
          <button
            type="button"
            className="rung-buy__undo"
            disabled={!canRetract}
            onClick={undo}
            aria-label="Undo the last Campaign Influence queued this turn"
          >
            <UndoIcon size={16} /> Undo
          </button>
          <button
            type="button"
            className="rung-buy__build btn-cta"
            data-tut="build"
            onClick={build}
            aria-label={nextCost != null ? `Build Campaign Influence for $${nextCost}k` : 'Build Campaign Influence'}
          >
            <PlusIcon size={16} />
            <span className="rung-buy__label">Build</span>
            {nextCost != null && (
              <span className="rung-buy__cost">${nextCost}k{costBadge}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
