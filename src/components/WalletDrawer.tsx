/**
 * WalletDrawer — segmented sub-panel of the Header HUD.
 *
 * Reveals a player's per-State-Group treasuries ("State Group Wallets"). When a
 * group wallet is wiped to $0 by the Evaporation Penalty (the player lost
 * dominance this turn), it plays a punishing fade/drain animation.
 */

import { useEffect, useRef, useState } from 'react';
import { STATE_GROUPS } from '../game/config';
import { groupImageUrl } from '../game/candidates';
import { useGameStore } from '../game/store';
import type { ResolvedColor } from '../game/colors';
import { AudioManager } from '../utils/audioManager';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

interface WalletDrawerProps {
  playerId: string;
  color?: ResolvedColor;
  onClose: () => void;
}

/** A single wallet balance that tweens on change and flashes when it drains. */
function WalletBalance({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  const prev = useRef(value);
  const [drain, setDrain] = useState(false);
  useEffect(() => {
    if (value < prev.current) {
      setDrain(true);
      const t = setTimeout(() => setDrain(false), 500);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return (
    <span className={`wallet-cell__bal${drain ? ' wallet-cell__bal--drain' : ''}`}>
      ${animated.toFixed(0)}k
    </span>
  );
}

export function WalletDrawer({ playerId, color, onClose }: WalletDrawerProps) {
  const player = useGameStore((s) => s.players.find((p) => p.id === playerId));
  const phase = useGameStore((s) => s.phase);
  const workingCash = useGameStore((s) => s.workingCash[playerId]);
  const prevDominance = useGameStore((s) => s.prevDominance);
  const dominance = useGameStore((s) => s.stateGroupDominance);

  const displayNational = phase === 'PLANNING'
    ? (workingCash?.nationalCash ?? player?.nationalCash ?? 0)
    : (player?.nationalCash ?? 0);
  // War Chest = spend-anywhere national cash PLUS every coalition reserve below,
  // so the headline reflects the player's true total spending power (not just
  // national, which read as misleadingly low while wallets held large reserves).
  const groupReserves = STATE_GROUPS.reduce((sum, g) => {
    const bal = phase === 'PLANNING'
      ? (workingCash?.groupWallets[g.id] ?? player?.groupWallets[g.id] ?? 0)
      : (player?.groupWallets[g.id] ?? 0);
    return sum + bal;
  }, 0);
  const animatedNational = useAnimatedNumber(displayNational);
  const animatedWarChest = useAnimatedNumber(displayNational + groupReserves);

  if (!player) return null;

  return (
    <div className="wallet-drawer" style={{ ['--p-color' as string]: color?.hex ?? '#64748b' }}>
      <div className="wallet-drawer__head">
        <span className="wallet-drawer__title">{player.name} — Coalition Reserves</span>
        <span className="wallet-drawer__total">
          War Chest ${animatedWarChest.toFixed(0)}k
          <span className="wallet-drawer__total-sub"> · ${animatedNational.toFixed(0)}k national</span>
        </span>
        <button type="button" className="wallet-drawer__close" onClick={() => { AudioManager.play('click'); onClose(); }}>×</button>
      </div>

      <div className="wallet-drawer__grid">
        {STATE_GROUPS.map((g) => {
          const bal = phase === 'PLANNING'
            ? (workingCash?.groupWallets[g.id] ?? player.groupWallets[g.id] ?? 0)
            : (player.groupWallets[g.id] ?? 0);
          const isDominant = dominance[g.id] === playerId;
          // Evaporated this turn: was dominant last turn, now isn't, and wallet is empty.
          const evaporated =
            phase === 'RESOLUTION' &&
            prevDominance[g.id] === playerId &&
            dominance[g.id] !== playerId;
          return (
            <div
              key={g.id}
              className={[
                'wallet-cell',
                bal <= 0 ? 'wallet-cell--empty' : '',
                isDominant ? 'wallet-cell--dominant' : '',
                evaporated ? 'wallet-cell--evaporated' : '',
              ].filter(Boolean).join(' ')}
            >
              <img
                className="group-icon group-icon--sm"
                src={groupImageUrl('state', g.id)}
                alt={g.id}
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <span className="wallet-cell__name">{g.id}</span>
              <WalletBalance value={bal} />
              {isDominant && <span className="wallet-cell__tag">+${g.bonusPayout}k/turn</span>}
              {evaporated && <span className="wallet-cell__evap">Reserve collapsed</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
