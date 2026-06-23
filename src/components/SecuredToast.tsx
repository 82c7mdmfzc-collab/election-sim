/**
 * SecuredToast — floating badges announcing newly secured states/groups during
 * RESOLUTION. Each badge fades in, holds, then fades out via CSS animation.
 */

import { useEffect } from 'react';
import { ALL_STATES } from '../game/statesData';
import { useGameStore, usePlayerColors } from '../game/store';
import { AudioManager } from '../utils/audioManager';

const STATE_NAME: Record<string, string> = Object.fromEntries(
  ALL_STATES.map((s) => [s.id, s.name]),
);

export function SecuredToast() {
  const phase = useGameStore((s) => s.phase);
  const report = useGameStore((s) => s.lastTurnReport);
  const players = useGameStore((s) => s.players);
  const colors = usePlayerColors();

  const events = phase === 'RESOLUTION' ? (report?.newlySecured ?? []) : [];

  useEffect(() => {
    if (events.length === 0) return;
    const timers = events.map((_, i) =>
      window.setTimeout(() => AudioManager.play('confirm'), i * 400),
    );
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, phase]);

  if (events.length === 0) return null;

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  return (
    <div className="secured-toast">
      {events.map((e, i) => {
        const player = playerMap[e.playerId];
        const target = e.kind === 'state' ? (STATE_NAME[e.targetId] ?? e.targetId) : e.targetId;
        return (
          <div
            key={`${e.kind}-${e.targetId}`}
            className="toast-chip"
            style={{
              ['--p-color' as string]: colors[e.playerId]?.hex ?? 'var(--muted)',
              animationDelay: `${i * 0.3}s`,
            }}
          >
            🔒 {player?.name ?? e.playerId} called {target}!
          </div>
        );
      })}
    </div>
  );
}
