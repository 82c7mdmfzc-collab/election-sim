/**
 * Shop — spend Campaign Funds to unlock premium characters.
 *
 * Lists every PREMIUM_CANDIDATES entry with its asymmetric trade-offs (reusing
 * ModifierSheet) so the purchase is informed. Owned characters show a badge;
 * locked ones show their price and a progress bar toward affording it.
 *
 * Purchases go through useProfile.unlock(), which is server-validated (the server
 * owns the price) and falls back to a local check when offline/guest.
 */

import { useState } from 'react';
import { PREMIUM_CANDIDATES, PLAYER_COLORS } from '../game/candidates';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { ModifierSheet } from './ModifierSheet';
import { Portrait } from './Portrait';

interface ShopProps {
  onBack: () => void;
}

export function Shop({ onBack }: ShopProps) {
  const funds = useProfile((s) => s.profile.campaignFunds);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const unlock = useProfile((s) => s.unlock);
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(id: string) {
    setBusy(id);
    AudioManager.play('click');
    const ok = await unlock(id);
    if (ok) AudioManager.play('victory');
    setBusy(null);
  }

  return (
    <div className="shop">
      <div className="shop__header">
        <h1 className="shop__title">Campaign Shop</h1>
        <span className="shop__balance">💰 {funds.toLocaleString()} Funds</span>
      </div>
      <p className="shop__sub">Win games to earn Campaign Funds, then recruit new candidates to your roster.</p>

      <div className="shop__grid">
        {PREMIUM_CANDIDATES.map((c) => {
          const owned = unlocked.includes(c.id);
          const affordable = funds >= c.unlockCost;
          const pct = Math.min(100, Math.round((funds / c.unlockCost) * 100));
          return (
            <div
              key={c.id}
              className={`shop-card${owned ? ' is-owned' : ''}`}
              style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
            >
              <div className="shop-card__top">
                <Portrait className="shop-card__portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                <div>
                  <span className="shop-card__name">{c.name}</span>
                  <span className="shop-card__tag">{c.tagline}</span>
                </div>
              </div>
              <div className="shop-card__cash">${c.startingCash}k starting cash</div>
              <ModifierSheet affinities={c.affinities} payoutModifiers={c.payoutModifiers} compact />

              <div className="shop-card__foot">
                {owned ? (
                  <div className="shop-card__owned">Owned ✓</div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="shop-card__unlock"
                      disabled={!affordable || busy === c.id}
                      onClick={() => buy(c.id)}
                    >
                      {busy === c.id
                        ? 'Unlocking…'
                        : affordable
                          ? `Unlock — ${c.unlockCost.toLocaleString()} 💰`
                          : `${funds.toLocaleString()} / ${c.unlockCost.toLocaleString()} 💰`}
                    </button>
                    {!affordable && (
                      <div className="shop-card__progress"><span style={{ width: `${pct}%` }} /></div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="setup__foot" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="mp-back" onClick={onBack}>← Back to Menu</button>
      </div>
    </div>
  );
}
