/**
 * FirstWinSocialModal — a one-off invite shown after the player's FIRST win.
 *
 * useProfile.applyGameResult sets `firstWinPrompt` when the server confirms
 * gamesWon === 1; App renders this once the victory screen is dismissed. Either
 * action marks the localPrefs flag so it never reappears.
 */

import { AudioManager } from '../utils/audioManager';
import { openExternal, SOCIAL_DISCORD_URL } from '../utils/openExternal';
import { markFirstWinSocialSeen } from '../utils/localPrefs';
import { DiscordIcon } from './icons';
import { Modal } from './ui/Modal';

export function FirstWinSocialModal({ onClose }: { onClose: () => void }) {
  const dismiss = () => {
    markFirstWinSocialSeen();
    onClose();
  };

  return (
    <Modal
      label="You won your first campaign"
      className="first-win-social"
      panelClassName="first-win-social__panel"
      onClose={() => { AudioManager.play('quit'); dismiss(); }}
    >
      <span className="first-win-social__icon" aria-hidden><DiscordIcon size={30} /></span>
      <h2 className="first-win-social__title">First win — welcome aboard!</h2>
      <p className="first-win-social__msg">
        Join the Elector community on Discord to swap strategies, shape what's next,
        and challenge other campaigners.
      </p>
      <div className="first-win-social__actions">
        <button
          type="button"
          className="btn-ghost first-win-social__btn"
          onClick={() => { AudioManager.play('quit'); dismiss(); }}
        >
          Maybe later
        </button>
        <button
          type="button"
          className="btn-cta first-win-social__btn"
          onClick={() => {
            AudioManager.play('confirm');
            void openExternal(SOCIAL_DISCORD_URL);
            dismiss();
          }}
        >
          Join Discord
        </button>
      </div>
    </Modal>
  );
}
