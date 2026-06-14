/**
 * HandoffCurtain — the blind pass-and-play interstitial.
 *
 * Because allocations are simultaneous and hidden, when the device passes to the
 * next player we drop an opaque curtain. The previous player's pending is already
 * scrubbed from the board (every pending visual reads ONLY the active player's
 * pending), so the curtain enforces the physical hand-off: the new player taps
 * "I'm ready" to reveal their clean board.
 */

import { useGameStore, useHandoffAckKey, usePlayerColors } from '../game/store';
import { tipsFor } from '../game/tips';
import { RotatingTip } from './RotatingTip';

export function HandoffCurtain() {
  const phase = useGameStore((s) => s.phase);
  const turn = useGameStore((s) => s.turn);
  const activeIndex = useGameStore((s) => s.activePlayerIndex);
  const players = useGameStore((s) => s.players);
  const ackKey = useHandoffAckKey();
  const acknowledgeHandoff = useGameStore((s) => s.acknowledgeHandoff);
  const colors = usePlayerColors();

  const active = players.filter((p) => !p.eliminated);
  const activePlayer = active[activeIndex];
  const key = `${turn}:${activeIndex}`;

  const multiplayerMode = useGameStore((s) => s.multiplayerMode);

  // First player of each turn (index 0) doesn't need a curtain — the public
  // resolution board was already visible to everyone. The `${turn}:${index}` key
  // is unique per turn, so a stale acknowledgement never matches the next turn.
  // The ack key is shared with useTurnTimer: while the curtain is up the timer
  // is paused, and acknowledging re-arms a fresh full-duration deadline.
  // In online mode all players allocate simultaneously — no curtain is ever needed.
  const needCurtain =
    phase === 'PLANNING' &&
    multiplayerMode === 'single' &&
    activeIndex > 0 &&
    !activePlayer?.isBot && // AI seats play automatically — no pass-and-play screen
    ackKey !== key;

  if (!needCurtain || !activePlayer) return null;

  return (
    <div className="handoff" style={{ ['--p-color' as string]: colors[activePlayer.id]?.hex }}>
      <div className="handoff__panel">
        <span className="handoff__icon" aria-hidden>▊ ▊ ▊</span>
        <div className="handoff__pass">Handoff — pass device to</div>
        <div className="handoff__name">{activePlayer.name}</div>
        <div className="handoff__note">Allocations are blind. Don&apos;t let the previous player see.</div>
        <button type="button" className="handoff__btn" onClick={() => acknowledgeHandoff()}>
          Ready to Play →
        </button>
        <RotatingTip
          tips={tipsFor('tempo', 'clash', 'economy')}
          label="While you wait"
          className="handoff__tip"
        />
      </div>
    </div>
  );
}
