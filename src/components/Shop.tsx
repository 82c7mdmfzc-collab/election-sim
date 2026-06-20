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

import { useEffect, useState } from 'react';
import { PREMIUM_CANDIDATES, PLAYER_COLORS } from '../game/candidates';
import { VICTORY_MESSAGES } from '../game/victoryMessages';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { FUNDS_BUNDLES, iapPlatform, nativeIapAvailable, purchase } from '../utils/iap';
import { getSelectedVictoryMessage, setSelectedVictoryMessage } from '../utils/localPrefs';
import { track } from '../utils/analytics';
import { InviteFriend } from './InviteFriend';
import { ModifierSheet } from './ModifierSheet';
import { Portrait } from './Portrait';

interface ShopProps {
  source?: 'menu' | 'locked_candidate' | 'victory' | 'account';
  onBack: () => void;
}

function priceValue(priceLabel: string): number {
  const n = Number(priceLabel.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function Shop({ source = 'menu', onBack }: ShopProps) {
  const funds = useProfile((s) => s.profile.campaignFunds);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const unlock = useProfile((s) => s.unlock);
  const guest = useProfile((s) => s.guest);
  const refresh = useProfile((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [buyingSku, setBuyingSku] = useState<string | null>(null);
  const [equippedVM, setEquippedVM] = useState(getSelectedVictoryMessage);
  // Initial purchase status is read from the Stripe return URL (?purchase=…).
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search).get('purchase');
    return p === 'success' ? 'Purchase complete — Campaign Funds added.'
      : p === 'cancel' ? 'Checkout cancelled.'
        : null;
  });
  const billingPlatform = iapPlatform();
  const hasNativeBilling = nativeIapAvailable();
  const showPaidFunds = billingPlatform === 'web' || hasNativeBilling;
  const nativeBillingHeld = (billingPlatform === 'ios' || billingPlatform === 'android') && !hasNativeBilling;

  useEffect(() => {
    track('shop_opened', {
      source,
      platform: billingPlatform,
      native_billing_available: hasNativeBilling,
    });
  }, [billingPlatform, hasNativeBilling, source]);

  // On open, refresh the balance (picks up funds the Stripe webhook credited
  // after returning from checkout) and strip the ?purchase marker from the URL.
  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    if (!params.get('purchase')) return;
    params.delete('purchase');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [refresh]);

  async function buy(id: string) {
    const candidate = PREMIUM_CANDIDATES.find((c) => c.id === id);
    setBusy(id);
    AudioManager.play('click');
    const ok = await unlock(id);
    if (ok) {
      AudioManager.play('victory');
      track('item_unlocked', {
        item_id: id,
        item_type: 'candidate',
        price_funds: candidate?.unlockCost ?? 0,
      });
    }
    setBusy(null);
  }

  async function buyFunds(sku: string) {
    const bundle = FUNDS_BUNDLES.find((b) => b.sku === sku);
    if (guest) { setPurchaseMsg('Sign in to buy Campaign Funds.'); return; }
    if (nativeBillingHeld) { setPurchaseMsg('Campaign Funds purchases are not available in this build.'); return; }
    setBuyingSku(sku);
    AudioManager.play('click');
    track('checkout_started', {
      product_id: sku,
      product_type: 'funds',
      value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
      platform: billingPlatform,
    });
    const result = await purchase(sku);
    if (result.status === 'fulfilled') {
      AudioManager.play('victory');
      setPurchaseMsg('Purchase complete — Campaign Funds added.');
      track('checkout_result', {
        product_id: sku,
        product_type: 'funds',
        status: 'completed',
        value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
        platform: billingPlatform,
      });
      await refresh();
    } else if (result.status === 'unsupported') {
      setPurchaseMsg('Purchases aren’t available on this device yet.');
      track('checkout_result', {
        product_id: sku,
        product_type: 'funds',
        status: 'failed',
        reason_category: 'unsupported',
        value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
        platform: billingPlatform,
      });
    } else if (result.status === 'error') {
      setPurchaseMsg(result.message);
      track('checkout_result', {
        product_id: sku,
        product_type: 'funds',
        status: 'failed',
        reason_category: 'provider_error',
        value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
        platform: billingPlatform,
      });
    } else {
      track('checkout_result', {
        product_id: sku,
        product_type: 'funds',
        status: 'redirected',
        value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
        platform: billingPlatform,
      });
    }
    // 'redirect' → the browser is navigating to Stripe; leave state as-is.
    setBuyingSku(null);
  }

  return (
    <div className="shop">
      <div className="shop__header">
        <h1 className="shop__title">Campaign Shop</h1>
        <span className="shop__balance">
          <span className="coin-inline" aria-hidden />
          {funds.toLocaleString()} Funds
        </span>
      </div>
      <p className="shop__sub">Win games to earn Campaign Funds, then recruit new candidates to your roster.</p>

      {showPaidFunds && (
        <>
          <h2 className="shop__section" style={{ marginTop: '0.5rem' }}>Buy Campaign Funds</h2>
          <p className="shop__sub">Top up instantly to recruit candidates faster.</p>
        </>
      )}
      {purchaseMsg && <div className="shop__purchase-msg">{purchaseMsg}</div>}
      {showPaidFunds ? (
        <div className="funds-grid">
          {FUNDS_BUNDLES.map((b) => (
            <div key={b.sku} className="funds-card">
              {b.badge && <span className="funds-card__badge">{b.badge}</span>}
              <img
                className="funds-card__img"
                src={b.imageUrl}
                alt=""
                draggable={false}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <div className="funds-card__amount">
                <span className="coin-inline coin-inline--large" aria-hidden />
                {b.funds.toLocaleString()}
              </div>
              <div className="funds-card__label">Campaign Funds</div>
              <button
                type="button"
                className="funds-card__buy"
                disabled={buyingSku === b.sku}
                onClick={() => buyFunds(b.sku)}
              >
                {buyingSku === b.sku ? 'Processing…' : b.priceLabel}
              </button>
            </div>
          ))}
        </div>
      ) : nativeBillingHeld ? null : null}

      <h2 className="shop__section">Recruit Candidates</h2>
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
                          ? `Unlock — ${c.unlockCost.toLocaleString()} Funds`
                          : `${funds.toLocaleString()} / ${c.unlockCost.toLocaleString()} Funds`}
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

      <InviteFriend />

      <h2 className="shop__section">Victory Messages</h2>
      <p className="shop__sub">Choose the speech your winner delivers on the victory screen.</p>
      <div className="shop__vm-list">
        {VICTORY_MESSAGES.map((m) => {
          const equipped = equippedVM === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={`vm-card${equipped ? ' is-equipped' : ''}`}
              onClick={() => { AudioManager.play('click'); setSelectedVictoryMessage(m.id); setEquippedVM(m.id); }}
            >
              <span className="vm-card__label">
                {m.label}
                {equipped && <span className="vm-card__badge">Equipped</span>}
              </span>
              <span className="vm-card__text">“{m.text}”</span>
            </button>
          );
        })}
      </div>

      <div className="setup__foot" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="mp-back" onClick={onBack}>← Back to Menu</button>
      </div>
    </div>
  );
}
