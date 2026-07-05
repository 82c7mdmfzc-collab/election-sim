/**
 * AvatarPicker — choose a free profile picture (country flag, US state, or pattern).
 *
 * Opens from the account panel. Selections go through useProfile.equipAvatar, which
 * is optimistic + server-owned (mirrors the banner flow), so other players see the
 * choice on the leaderboard / in multiplayer. Tapping the equipped avatar again, or
 * "Use initials", clears it back to the initials monogram.
 */

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { AudioManager } from '../utils/audioManager';
import { Avatar } from './Avatar';
import {
  AVATAR_CATEGORIES,
  avatarsByCategory,
  avatarImageUrl,
  avatarLabel,
  type AvatarCategory,
} from '../game/avatars';

export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const currentAvatar = useProfile((s) => s.profile.avatar);
  const displayName = useProfile((s) => s.displayName) ?? 'Player';
  const equipAvatar = useProfile((s) => s.equipAvatar);
  const [cat, setCat] = useState<AvatarCategory>('flag');
  const [busy, setBusy] = useState(false);

  function close() { AudioManager.play('quit'); onClose(); }
  useAndroidBack(close);

  async function pick(id: string) {
    if (busy) return;
    AudioManager.play('click');
    setBusy(true);
    // Tap the equipped one again to clear back to initials.
    await equipAvatar(currentAvatar === id ? '' : id);
    setBusy(false);
  }

  const initials = displayName.slice(0, 2).toUpperCase();
  const tiles = avatarsByCategory(cat);

  return (
    <div className="help-overlay avatar-picker" role="dialog" aria-modal="true" onClick={close}>
      <div className="help-overlay__panel avatar-picker__panel" onClick={(e) => e.stopPropagation()}>
        <div className="howto__head">
          <h2 className="howto__title">Profile Picture</h2>
          <button type="button" className="howto__close" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="avatar-picker__current">
          <Avatar
            src={avatarImageUrl(currentAvatar)}
            initials={initials}
            name={displayName}
            borderId={null}
            wrapperClassName="avatar-picker__current-av"
            className="avatar-picker__current-token"
          />
          <div className="avatar-picker__current-info">
            <strong>{avatarLabel(currentAvatar) || 'Initials'}</strong>
            <button
              type="button"
              className="avatar-picker__clear"
              disabled={currentAvatar === '' || busy}
              onClick={() => void pick(currentAvatar)}
            >
              Use initials
            </button>
          </div>
        </div>

        <div className="avatar-picker__tabs" role="tablist" aria-label="Avatar categories">
          {AVATAR_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={cat === c.key}
              className={`avatar-picker__tab${cat === c.key ? ' is-active' : ''}`}
              onClick={() => { AudioManager.play('click'); setCat(c.key); }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="avatar-picker__grid">
          {tiles.map((a) => {
            const equipped = currentAvatar === a.id;
            return (
              <button
                key={a.id}
                type="button"
                className={`avatar-picker__tile${equipped ? ' is-equipped' : ''}`}
                disabled={busy}
                aria-pressed={equipped}
                title={a.label}
                onClick={() => void pick(a.id)}
              >
                <Avatar
                  src={avatarImageUrl(a.id)}
                  initials={initials}
                  name={a.label}
                  borderId={null}
                  wrapperClassName="avatar-picker__tile-av"
                  className="avatar-picker__tile-token"
                />
                <span className="avatar-picker__tile-label">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
