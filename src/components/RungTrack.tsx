/**
 * RungTrack — the discrete "pip ladder" primitive shared by geographic states
 * (8/12/16 rungs) and national group ladders (10 rungs).
 *
 * Rendered from the ACTIVE player's perspective:
 *   • settled pips  → solid in the active player's color (authoritative)
 *   • pending pips  → dashed + pulsing in the active player's color (this turn,
 *                     strictly local — see the hidden-planning isolation in the store)
 *   • next pip      → clickable to buy one more rung (click-to-buy)
 *   • opponents     → small ticks beneath the pip they've reached, in their color
 *
 * Pending visuals come only from the caller's `pendingRungs` (the active player's
 * own pending), so an opponent's pending is never shown.
 */

import type { ResolvedColor } from '../game/colors';
import { AudioManager } from '../utils/audioManager';

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
  clashing = false,
  size = 'md',
  unlockAt,
  unlockLabel,
}: RungTrackProps) {
  const activeSettled = activePlayerId ? (settledByPlayer[activePlayerId] ?? 0) : 0;
  const activeColor = activePlayerId ? colors[activePlayerId]?.hex : undefined;
  const nextIndex = activeSettled + pendingRungs + 1;
  const canBuy = !!onBuyNext && !securedBy && nextIndex <= maxRungs;
  // The topmost pending pip is click-to-retract (rung-by-rung undo).
  const topPendingIndex = pendingRungs > 0 ? activeSettled + pendingRungs : -1;

  // Unlock-threshold flag: marks the pip that earns this track's reward.
  const showUnlock = unlockAt != null && unlockAt >= 1 && unlockAt <= maxRungs;
  const reachedUnlock = unlockAt != null && activeSettled + pendingRungs >= unlockAt;

  const opponents = Object.entries(settledByPlayer)
    .filter(([id, r]) => id !== activePlayerId && r > 0)
    .map(([id, r]) => ({ id, r, hex: colors[id]?.hex ?? '#94a3b8' }));

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
          const isRetractable = !!onRetractLast && idx === topPendingIndex;

          const handleClick = state === 'next'
            ? () => { const ok = onBuyNext?.(); if (ok === false) AudioManager.play('clash'); else AudioManager.play('buy'); }
            : isRetractable
              ? () => { AudioManager.play('quit'); onRetractLast?.(); }
              : undefined;

          return (
            <button
              key={idx}
              type="button"
              className={[
                'rung-pip',
                `rung-pip--${state}`,
                isSecuredPip ? 'rung-pip--secured' : '',
                isRetractable ? 'rung-pip--retract' : '',
                showUnlock && idx === unlockAt ? 'rung-pip--threshold' : '',
                showUnlock && idx === unlockAt && reachedUnlock ? 'rung-pip--threshold-met' : '',
              ].filter(Boolean).join(' ')}
              disabled={!handleClick}
              onClick={handleClick}
              title={state === 'next' ? `Build Campaign Influence ${idx}` : isRetractable ? `Undo Campaign Influence ${idx}` : `Campaign Influence ${idx}`}
              aria-label={state === 'next' ? `Build Campaign Influence ${idx} of ${maxRungs}` : isRetractable ? `Undo Campaign Influence ${idx}` : `Campaign Influence ${idx} of ${maxRungs}`}
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
          <span className="rung-track__flag-glyph" aria-hidden="true">{reachedUnlock ? '✓' : '⚑'}</span>
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
    </div>
  );
}
