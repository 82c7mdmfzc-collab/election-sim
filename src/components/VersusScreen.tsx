/**
 * VersusScreen — the pre-game matchup intro.
 *
 * Shown once when a game starts (set by store.versusPending), before the board.
 * A clean, in-UI composition (navy gradient + framed circular portraits in each
 * player's accent colour + a central VS for duels), auto-advancing after a beat —
 * or on tap. Covers Solo/bot, pass-and-play, and online (all funnel through
 * startGame/initOnlineGame). Supports 2–4 players; other counts skip straight through.
 */
import { Fragment, useEffect } from 'react';
import { useGameStore, usePlayerColors } from '../game/store';
import { CANDIDATE_MAP, PARTY_LABEL } from '../game/candidates';

const AUTO_ADVANCE_MS = 3000;

export function VersusScreen() {
  const players = useGameStore((s) => s.players);
  const clearVersus = useGameStore((s) => s.clearVersus);
  const colors = usePlayerColors();

  const seats = players.slice(0, 4);
  const supported = seats.length >= 2;
  const isDuel = seats.length === 2;

  // Auto-advance after a beat; unsupported counts skip straight through.
  useEffect(() => {
    if (!supported) { clearVersus(); return; }
    const t = setTimeout(clearVersus, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [supported, clearVersus]);

  if (!supported) return null;

  return (
    <div className="versus" onClick={clearVersus} role="presentation">
      <div className="versus__scene">
        <div className="versus__label">Matchup</div>

        <div className={`versus__cards${isDuel ? ' versus__cards--duel' : ''}`}>
          {seats.map((p, i) => {
            const c = CANDIDATE_MAP[p.candidateId];
            const hex = colors[p.id]?.hex ?? '#64748b';
            const initials = p.name.slice(0, 2).toUpperCase();
            return (
              <Fragment key={p.id}>
                {isDuel && i === 1 && <div className="versus__vs" aria-hidden="true">VS</div>}
                <div className="versus__card" style={{ ['--accent' as string]: hex }}>
                  <div className="versus__frame">
                    {/* Initials sit behind the portrait, so a missing/broken image
                        degrades to a clean monogram instead of an empty circle. */}
                    <span className="versus__initials">{initials}</span>
                    {c?.portraitUrl && (
                      <img
                        className="versus__avatar"
                        src={c.portraitUrl}
                        alt=""
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                      />
                    )}
                  </div>
                  <div className="versus__name">{p.name}</div>
                  {c?.party && <div className="versus__role">{PARTY_LABEL[c.party]}</div>}
                </div>
              </Fragment>
            );
          })}
        </div>

        <div className="versus__footer">Race to 270 EV</div>
        <div className="versus__hint">Tap to continue</div>
      </div>
    </div>
  );
}
