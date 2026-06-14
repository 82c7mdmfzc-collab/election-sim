/**
 * WalletDrawer — segmented sub-panel of the Header HUD.
 *
 * Reveals a player's per-State-Group treasuries ("State Group Wallets"). When a
 * group wallet is wiped to $0 by the Evaporation Penalty (the player lost
 * dominance this turn), it plays a punishing fade/drain animation.
 */

import { STATE_GROUPS } from '../game/config';
import { groupImageUrl } from '../game/candidates';
import { useGameStore } from '../game/store';
import type { ResolvedColor } from '../game/colors';
import { AudioManager } from '../utils/audioManager';

interface WalletDrawerProps {
  playerId: string;
  color?: ResolvedColor;
  onClose: () => void;
}

export function WalletDrawer({ playerId, color, onClose }: WalletDrawerProps) {
  const player = useGameStore((s) => s.players.find((p) => p.id === playerId));
  const phase = useGameStore((s) => s.phase);
  const workingCash = useGameStore((s) => s.workingCash[playerId]);
  const prevDominance = useGameStore((s) => s.prevDominance);
  const dominance = useGameStore((s) => s.stateGroupDominance);

  if (!player) return null;

  const displayNational = phase === 'PLANNING'
    ? (workingCash?.nationalCash ?? player.nationalCash)
    : player.nationalCash;

  return (
    <div className="wallet-drawer" style={{ ['--p-color' as string]: color?.hex ?? '#64748b' }}>
      <div className="wallet-drawer__head">
        <span className="wallet-drawer__title">{player.name} — State Group Wallets</span>
        <span className="wallet-drawer__total">
          National ${displayNational.toFixed(0)}k
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
              />
              <span className="wallet-cell__name">{g.id}</span>
              <span className="wallet-cell__bal">${bal.toFixed(0)}k</span>
              {isDominant && <span className="wallet-cell__tag">+${g.bonusPayout}k/turn</span>}
              {evaporated && <span className="wallet-cell__evap">EVAPORATED</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
