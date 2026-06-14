/**
 * PlayerProfileModal — overlay showing a player's candidate perks and profile stats.
 *
 * Triggered by clicking any player name in the HUD or sidebar.
 * - For bot players: shows perks + bot badge, no profile stats.
 * - For human players: shows perks + lifetime stats from useProfile().
 * Badges section is a placeholder for a future feature.
 */

import { CANDIDATE_MAP } from '../game/candidates';
import { useGameStore, usePlayerColors } from '../game/store';
import { useProfile } from '../hooks/useProfile';

interface Props {
  playerId: string;
  onClose: () => void;
}

function fmt(val: number): string {
  return Math.round(Math.abs(val) * 100) + '%';
}

export function PlayerProfileModal({ playerId, onClose }: Props) {
  const player = useGameStore((s) => s.players.find((p) => p.id === playerId));
  const colors = usePlayerColors();
  const { profile } = useProfile();

  if (!player) return null;

  const cand = CANDIDATE_MAP[player.candidateId];
  const color = colors[playerId];
  const isBot = !!player.isBot;

  const affinityEntries = Object.entries(cand?.affinities ?? {}).filter(([, v]) => v !== 0);
  const payoutEntries = Object.entries(cand?.payoutModifiers ?? {}).filter(([, v]) => v !== 0);
  const hasPerks = affinityEntries.length > 0 || payoutEntries.length > 0;

  return (
    <div
      className="profile-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="profile-modal"
        style={{ ['--p-color' as string]: color?.hex ?? '#64748b' }}
      >
        {/* Header */}
        <div className="profile-modal__head">
          <div className="profile-modal__portrait">
            {cand?.tokenUrl ? (
              <img
                className="cand-token"
                src={cand.tokenUrl}
                alt={player.name}
                draggable={false}
              />
            ) : (
              player.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="profile-modal__info">
            <div className="profile-modal__name">{player.name}</div>
            {cand?.tagline && (
              <div className="profile-modal__tagline">{cand.tagline}</div>
            )}
            {isBot && (
              <div className="profile-bot-badge">
                Bot{player.botDifficulty ? ` — ${player.botDifficulty}` : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            className="profile-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Candidate Perks */}
        {hasPerks ? (
          <div className="profile-modal__section">
            <div className="profile-modal__section-title">Candidate Perks</div>
            {affinityEntries.length > 0 && (
              <>
                <div className="profile-perk-subhead">Rung Cost</div>
                {affinityEntries.map(([key, val]) => (
                  <div key={key} className="profile-perk-row">
                    <span className="profile-perk-row__key">{key}</span>
                    <span className={`profile-perk-row__val ${val > 0 ? 'positive' : 'negative'}`}>
                      {val > 0 ? `−${fmt(val)}` : `+${fmt(val)}`}
                    </span>
                  </div>
                ))}
              </>
            )}
            {payoutEntries.length > 0 && (
              <>
                <div className="profile-perk-subhead">Income</div>
                {payoutEntries.map(([key, val]) => (
                  <div key={key} className="profile-perk-row">
                    <span className="profile-perk-row__key">{key}</span>
                    <span className={`profile-perk-row__val ${val > 0 ? 'positive' : 'negative'}`}>
                      {val > 0 ? `+${fmt(val)}` : `−${fmt(val)}`}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : cand ? (
          <div className="profile-modal__section">
            <div className="profile-modal__section-title">Candidate Perks</div>
            <div className="profile-badge-placeholder">No special perks — completely neutral.</div>
          </div>
        ) : null}

        {/* Profile Stats — human players only */}
        {!isBot && (
          <div className="profile-modal__section">
            <div className="profile-modal__section-title">Career Stats</div>
            <div className="profile-stat-grid">
              <div className="profile-stat">
                <div className="profile-stat__label">Played</div>
                <div className="profile-stat__value">{profile.stats.gamesPlayed}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">Won</div>
                <div className="profile-stat__value">{profile.stats.gamesWon}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">Win Streak</div>
                <div className="profile-stat__value">{profile.stats.winStreak}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">Best Streak</div>
                <div className="profile-stat__value">{profile.stats.bestWinStreak}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">Coalitions Led</div>
                <div className="profile-stat__value">{profile.stats.coalitionsDominated}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">Member Since</div>
                <div className="profile-stat__value profile-stat__value--sm">—</div>
              </div>
            </div>
          </div>
        )}

        {/* Badges — placeholder */}
        <div className="profile-modal__section">
          <div className="profile-modal__section-title">Badges</div>
          <div className="profile-badge-placeholder">Coming soon</div>
        </div>
      </div>
    </div>
  );
}
