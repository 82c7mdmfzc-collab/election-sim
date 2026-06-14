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
  onBuyNext?: () => void;
  clashing?: boolean;
  size?: 'sm' | 'md';
}

export function RungTrack({
  maxRungs,
  settledByPlayer,
  pendingRungs,
  activePlayerId,
  colors,
  securedBy = null,
  onBuyNext,
  clashing = false,
  size = 'md',
}: RungTrackProps) {
  const activeSettled = activePlayerId ? (settledByPlayer[activePlayerId] ?? 0) : 0;
  const activeColor = activePlayerId ? colors[activePlayerId]?.hex : undefined;
  const nextIndex = activeSettled + pendingRungs + 1;
  const canBuy = !!onBuyNext && !securedBy && nextIndex <= maxRungs;

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
            <button
              key={idx}
              type="button"
              className={[
                'rung-pip',
                `rung-pip--${state}`,
                isSecuredPip ? 'rung-pip--secured' : '',
              ].filter(Boolean).join(' ')}
              disabled={state !== 'next'}
              onClick={state === 'next' ? () => { AudioManager.play('buy'); onBuyNext?.(); } : undefined}
              title={state === 'next' ? `Buy rung ${idx}` : `Rung ${idx}`}
              aria-label={`Rung ${idx} of ${maxRungs}`}
            />
          );
        })}
      </div>

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
