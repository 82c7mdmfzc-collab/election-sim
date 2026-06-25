/**
 * InviteFriend — referral invite surface (lives in the Shop).
 *
 * Shows the signed-in player's invite link. When a friend signs up via the link
 * and FINISHES their first game, both earn REFERRAL_BONUS Campaign Funds — the
 * payout is server-side (see supabase/referrals.sql); this UI only shares the link.
 */
import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { getMyReferralCode, referralLink, REFERRAL_RANGE } from '../game/referral';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';

export function InviteFriend() {
  const guest = useProfile((s) => s.guest);
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (guest) return;
    let cancelled = false;
    // setState happens only in the async callback (never synchronously in the
    // effect body) to satisfy react-hooks/set-state-in-effect.
    void getMyReferralCode().then((c) => {
      if (cancelled) return;
      if (c) setCode(c);
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [guest]);

  const link = code ? referralLink(code) : '';

  async function copy() {
    if (!link) return;
    AudioManager.play('click');
    track('share_started', { surface: 'referral', share_type: 'invite', method: 'copy_link' });
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      track('share_completed', { surface: 'referral', share_type: 'invite', method: 'copy_link' });
    } catch {
      track('share_failed', { surface: 'referral', share_type: 'invite', method: 'copy_link', reason_category: 'clipboard_unavailable' });
    }
  }

  async function share() {
    if (!link) return;
    AudioManager.play('click');
    const text = `Play Elector with me — we both earn up to 750 Campaign Funds when you finish your first game!`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      track('share_started', { surface: 'referral', share_type: 'invite', method: 'native_share' });
      try {
        await nav.share({ title: 'Elector', text, url: link });
        track('share_completed', { surface: 'referral', share_type: 'invite', method: 'native_share' });
        return;
      } catch {
        track('share_failed', { surface: 'referral', share_type: 'invite', method: 'native_share', reason_category: 'dismissed_or_unavailable' });
      }
    }
    void copy();
  }

  return (
    <div className="invite">
      <h2 className="shop__section">Invite Friends</h2>
      <p className="shop__sub">
        Share your link. When a friend signs up and <strong>finishes their first game</strong>, you{' '}
        <em>both</em> earn {REFERRAL_RANGE} Campaign Funds.
      </p>

      {guest ? (
        <div className="invite__note">Sign in to get your personal invite link.</div>
      ) : code ? (
        <div className="invite__row">
          <input
            className="invite__link"
            type="text"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Your invite link"
          />
          <button type="button" className="invite__btn" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button type="button" className="invite__btn invite__btn--primary" onClick={share}>
            Share
          </button>
        </div>
      ) : failed ? (
        <div className="invite__note">Couldn’t load your invite link. Try again later.</div>
      ) : (
        <div className="invite__note">Loading your invite link…</div>
      )}
    </div>
  );
}
