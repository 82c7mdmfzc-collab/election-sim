/**
 * HomePlayerCard — the player identity card on Home (left column on native).
 *
 * Shows the equipped banner, avatar frame, username, Campaign Funds, and the
 * season-tier progress bar; the whole card is one tap target that opens the
 * account panel (AuthGate), where the full progress/achievements view lives.
 * Guests see a sign-in hook instead of season progress.
 */

import { useProfile, selectFunds, selectIsSignedIn } from '../hooks/useProfile';
import { seasonHeaderProgress } from '../game/season';
import { avatarImageUrl } from '../game/avatars';
import { AudioManager } from '../utils/audioManager';
import { Avatar } from './Avatar';
import { ProfileBanner } from './ProfileBanner';

export function HomePlayerCard({ onOpen }: { onOpen: () => void }) {
  const signedIn = useProfile(selectIsSignedIn);
  const displayName = useProfile((s) => s.displayName);
  const funds = useProfile(selectFunds);
  const bannerId = useProfile((s) => s.profile.equippedBanner);
  const avatarId = useProfile((s) => s.profile.avatar);
  const season = useProfile((s) => s.season);

  const name = signedIn ? (displayName ?? 'Player') : 'Guest';
  const prog = signedIn && season?.season
    ? seasonHeaderProgress(season.season.tiers, season.progress.xp)
    : null;

  return (
    <button
      type="button"
      className="player-card pressable"
      onClick={() => { AudioManager.play('click'); onOpen(); }}
      aria-label={signedIn
        ? `Your account — ${name}, ${funds.toLocaleString()} Campaign Funds`
        : 'Sign in to your account'}
    >
      {bannerId && <ProfileBanner bannerId={bannerId} variant="chip" className="player-card__banner" />}
      <Avatar
        src={signedIn ? avatarImageUrl(avatarId) : ''}
        initials={name.slice(0, 2).toUpperCase()}
        name={name}
        wrapperClassName="player-card__avatar"
        className="player-card__token"
      />
      <span className="player-card__info">
        <span className="player-card__name">{name}</span>
        {prog ? (
          <span className="player-card__season" aria-label={`Season tier ${prog.tier}`}>
            <span className="player-card__tier">Tier {prog.tier}</span>
            <span className="player-card__bar" aria-hidden>
              <span className="player-card__bar-fill" style={{ width: `${prog.pct}%` }} />
            </span>
          </span>
        ) : (
          <span className="player-card__hint">
            {signedIn ? 'View progress & rewards' : 'Sign in to save progress'}
          </span>
        )}
        <span className="player-card__funds">
          <span className="gold-pill__coin" aria-hidden />
          {funds.toLocaleString()}
        </span>
      </span>
    </button>
  );
}
