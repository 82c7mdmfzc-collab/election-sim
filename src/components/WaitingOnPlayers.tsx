import { useGameStore, usePlayerColors } from '../game/store';
import { STRATEGY_TIPS } from '../game/tips';
import { RotatingTip } from './RotatingTip';

export function WaitingOnPlayers() {
  const phase               = useGameStore((s) => s.phase);
  const multiplayerMode     = useGameStore((s) => s.multiplayerMode);
  const hasSubmitted        = useGameStore((s) => s.hasSubmittedLocalTurn);
  const players             = useGameStore((s) => s.players);
  const submittedPlayers    = useGameStore((s) => s.submittedPlayers);
  const colors              = usePlayerColors();

  if (multiplayerMode !== 'online' || phase !== 'PLANNING' || !hasSubmitted) return null;

  const active = players.filter((p) => !p.eliminated);

  return (
    <div className="waiting-players" role="status" aria-live="polite">
      <div className="waiting-players__panel">
        <div className="waiting-players__title">Waiting for opponents…</div>

        <ul className="waiting-players__list">
          {active.map((p) => {
            const ready = submittedPlayers.includes(p.id);
            const hex   = colors[p.id]?.hex ?? '#64748b';
            return (
              <li
                key={p.id}
                className={`waiting-players__row ${ready ? 'waiting-players__row--ready' : ''}`}
                style={{ ['--p-color' as string]: hex }}
              >
                <span className="waiting-players__dot" aria-hidden />
                <span className="waiting-players__name">{p.name}</span>
                <span className="waiting-players__badge">
                  {ready ? 'Ready ✓' : 'Thinking…'}
                </span>
              </li>
            );
          })}
        </ul>

        <RotatingTip tips={STRATEGY_TIPS} />
      </div>
    </div>
  );
}
