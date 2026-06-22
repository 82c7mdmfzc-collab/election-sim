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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PREMIUM_CANDIDATES, PLAYER_COLORS } from '../game/candidates';
import { VICTORY_MESSAGES } from '../game/victoryMessages';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { FUNDS_BUNDLES, getFundsPrices, iapPlatform, nativeIapAvailable, purchase } from '../utils/iap';
import { getSelectedVictoryMessage, setSelectedVictoryMessage, getSelectedShareFrame, setSelectedShareFrame } from '../utils/localPrefs';
import { cosmeticsByCategory, isCosmeticAvailable, type CosmeticDef } from '../game/cosmetics';
import {
  AD_REWARD_LIMIT,
  AD_REWARD_MAX,
  AD_REWARD_MIN,
  INLINE_AD_SECONDS,
  getLocalAdRewardStatus,
  inlineRewardedAdsEnabled,
  mergeAdRewardStatus,
  recordLocalAdReward,
  rewardedAdBridgeAvailable,
  showRewardedAd,
  type AdRewardStatus,
} from '../utils/rewardedAds';
import { track } from '../utils/analytics';
import { InviteFriend } from './InviteFriend';
import { ModifierSheet } from './ModifierSheet';
import { Portrait } from './Portrait';

interface ShopProps {
  source?: 'menu' | 'locked_candidate' | 'victory' | 'account';
  onBack: () => void;
}

type ShopTab = 'funds' | 'recruit' | 'earn' | 'messages' | 'cosmetics';

function priceValue(priceLabel: string): number {
  const n = Number(priceLabel.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatReset(nextResetAt: string | null): string {
  if (!nextResetAt) return 'soon';
  const ms = Date.parse(nextResetAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'soon';
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function RewardedAdCard() {
  const userId = useProfile((s) => s.userId);
  const guest = useProfile((s) => s.guest);
  const remoteStatus = useProfile((s) => s.adRewardStatus);
  const refreshAdRewardStatus = useProfile((s) => s.refreshAdRewardStatus);
  const claimAdReward = useProfile((s) => s.claimAdReward);
  const [localSnapshot, setLocalSnapshot] = useState<{ userId: string | null; status: AdRewardStatus } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'watching' | 'claiming'>('idle');
  const [secondsLeft, setSecondsLeft] = useState(INLINE_AD_SECONDS);
  const [message, setMessage] = useState<string | null>(null);
  const [lastReward, setLastReward] = useState<number | null>(null);
  const claimStarted = useRef(false);
  const watchedMeta = useRef<{ provider?: string | null; adUnit?: string | null }>({});

  const localStatus = localSnapshot?.userId === userId
    ? localSnapshot.status
    : getLocalAdRewardStatus(userId);
  const status = useMemo(
    () => mergeAdRewardStatus(remoteStatus, localStatus),
    [localStatus, remoteStatus],
  );
  const bridgeReady = rewardedAdBridgeAvailable();
  const inlineReady = inlineRewardedAdsEnabled();
  const unavailable = !bridgeReady && !inlineReady;
  const limitReached = !guest && status.remaining <= 0;
  const progress = phase === 'watching'
    ? Math.round(((INLINE_AD_SECONDS - secondsLeft) / INLINE_AD_SECONDS) * 100)
    : 0;

  useEffect(() => {
    if (guest) return;
    void refreshAdRewardStatus().then((next) => {
      if (next) setLocalSnapshot({ userId, status: next });
    });
  }, [guest, refreshAdRewardStatus, userId]);

  const claimWatchedAd = useCallback(async (provider?: string | null, adUnit?: string | null) => {
    setPhase('claiming');
    const result = await claimAdReward({ placement: 'shop', provider, adUnit });
    if (result.status === 'claimed') {
      if (userId) recordLocalAdReward(userId);
      setLocalSnapshot({ userId, status: result.adStatus });
      setLastReward(result.amount);
      setMessage(`+${result.amount} Funds added.`);
      AudioManager.play('victory');
      track('rewarded_ad_claimed', {
        placement: 'shop',
        amount: result.amount,
        remaining: result.adStatus.remaining,
        provider: provider ?? 'unknown',
      });
    } else if (result.status === 'limit') {
      setLocalSnapshot({ userId, status: result.adStatus });
      setLastReward(null);
      setMessage(`Ad limit reached. Next ad in ${formatReset(result.adStatus.nextResetAt)}.`);
      track('rewarded_ad_limited', {
        placement: 'shop',
        remaining: result.adStatus.remaining,
      });
    } else if (result.status === 'auth_required') {
      setLastReward(null);
      setMessage('Sign in to earn Campaign Funds from ads.');
    } else {
      setLastReward(null);
      setMessage(result.message);
      track('rewarded_ad_claim_failed', {
        placement: 'shop',
        reason_category: 'claim_error',
      });
    }
    claimStarted.current = false;
    watchedMeta.current = {};
    setPhase('idle');
  }, [claimAdReward, userId]);

  useEffect(() => {
    if (phase !== 'watching') return;
    if (secondsLeft > 0) {
      const timer = window.setTimeout(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);
      return () => window.clearTimeout(timer);
    }
    if (claimStarted.current) return;
    claimStarted.current = true;
    void claimWatchedAd(
      watchedMeta.current.provider ?? 'inline_sponsor',
      watchedMeta.current.adUnit ?? 'shop-inline',
    );
  }, [claimWatchedAd, phase, secondsLeft]);

  async function beginAd() {
    if (guest || !userId) {
      setMessage('Sign in to earn Campaign Funds from ads.');
      return;
    }
    if (limitReached) {
      setMessage(`Ad limit reached. Next ad in ${formatReset(status.nextResetAt)}.`);
      return;
    }
    if (unavailable) {
      setMessage('Rewarded ads are not available in this build.');
      return;
    }

    AudioManager.play('click');
    setMessage(null);
    setLastReward(null);
    track('rewarded_ad_started', {
      placement: 'shop',
      provider: bridgeReady ? 'bridge' : 'inline_sponsor',
    });

    if (bridgeReady) {
      setPhase('claiming');
      const result = await showRewardedAd('shop');
      if (!result.completed) {
        setPhase('idle');
        setMessage(result.error ?? 'Ad closed before the reward.');
        track('rewarded_ad_cancelled', {
          placement: 'shop',
          provider: result.provider ?? 'bridge',
        });
        return;
      }
      await claimWatchedAd(result.provider ?? 'bridge', result.adUnit ?? null);
      return;
    }

    watchedMeta.current = { provider: 'inline_sponsor', adUnit: 'shop-inline' };
    claimStarted.current = false;
    setSecondsLeft(INLINE_AD_SECONDS);
    setPhase('watching');
  }

  function cancelInlineAd() {
    claimStarted.current = false;
    watchedMeta.current = {};
    setPhase('idle');
    setMessage('Ad cancelled. No Funds claimed.');
    track('rewarded_ad_cancelled', {
      placement: 'shop',
      provider: 'inline_sponsor',
    });
  }

  const buttonLabel = phase === 'watching'
    ? `Watching ${secondsLeft}s`
    : phase === 'claiming'
      ? 'Claiming...'
      : guest
        ? 'Sign in to earn'
        : limitReached
          ? 'Ad limit reached'
          : 'Watch ad';

  return (
    <div className={`rewarded-ad${phase !== 'idle' ? ' is-active' : ''}`}>
      <div className="rewarded-ad__main">
        <div>
          <h3 className="rewarded-ad__title">Watch an ad</h3>
          <p className="rewarded-ad__copy">
            Earn {AD_REWARD_MIN}-{AD_REWARD_MAX} Campaign Funds.
          </p>
        </div>
        <span className="rewarded-ad__quota">
          {guest ? `${AD_REWARD_LIMIT}/${AD_REWARD_LIMIT} left` : `${status.remaining}/${status.limit} left`}
        </span>
      </div>

      {phase === 'watching' && (
        <div className="rewarded-ad__watch">
          <div className="rewarded-ad__watch-head">
            <span>Sponsored message</span>
            <span>{secondsLeft}s</span>
          </div>
          <div className="rewarded-ad__bar" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>Campaign ads keep fresh challengers on the trail.</p>
          <button type="button" className="rewarded-ad__cancel" onClick={cancelInlineAd}>
            Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        className="rewarded-ad__button"
        disabled={phase !== 'idle' || limitReached}
        onClick={beginAd}
      >
        {buttonLabel}
      </button>
      {limitReached && status.nextResetAt && (
        <div className="rewarded-ad__meta">Next ad in {formatReset(status.nextResetAt)}</div>
      )}
      {message && (
        <div className={`rewarded-ad__message${lastReward != null ? ' rewarded-ad__message--success' : ''}`}>
          {message}
        </div>
      )}
    </div>
  );
}

export function Shop({ source = 'menu', onBack }: ShopProps) {
  const funds = useProfile((s) => s.profile.campaignFunds);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const unlock = useProfile((s) => s.unlock);
  const unlockCosmetic = useProfile((s) => s.unlockCosmetic);
  const guest = useProfile((s) => s.guest);
  const refresh = useProfile((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [buyingSku, setBuyingSku] = useState<string | null>(null);
  const [cosmeticBusy, setCosmeticBusy] = useState<string | null>(null);
  const [cosmeticMsg, setCosmeticMsg] = useState<string | null>(null);
  const [equippedVM, setEquippedVM] = useState(getSelectedVictoryMessage);
  const [equippedFrame, setEquippedFrame] = useState(getSelectedShareFrame);
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(null);
  const [nativePrices, setNativePrices] = useState<Record<string, string>>({});
  const billingPlatform = iapPlatform();
  const hasNativeBilling = nativeIapAvailable();
  const showPaidFunds = hasNativeBilling; // native StoreKit only — no web billing
  const nativeBillingHeld = (billingPlatform === 'ios' || billingPlatform === 'android') && !hasNativeBilling;
  const showAdRewards = rewardedAdBridgeAvailable() || inlineRewardedAdsEnabled();
  const [tab, setTab] = useState<ShopTab>('recruit');

  useEffect(() => {
    track('shop_opened', {
      source,
      platform: billingPlatform,
      native_billing_available: hasNativeBilling,
    });
  }, [billingPlatform, hasNativeBilling, source]);

  // On open, refresh the balance (picks up funds credited by a recent purchase).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Native (iOS): load StoreKit's localized prices for the funds packs.
  useEffect(() => {
    void getFundsPrices().then(setNativePrices);
  }, []);

  function selectTab(next: ShopTab) {
    if (next === 'cosmetics') track('cosmetic_shop_opened', { source });
    setTab(next);
  }

  function equipFrame(id: string) {
    AudioManager.play('click');
    setSelectedShareFrame(id);
    setEquippedFrame(id);
    setCosmeticMsg(null);
    track('cosmetic_previewed', { cosmetic_id: id, category: 'share_frame' });
  }

  async function unlockOrEquipFrame(c: CosmeticDef) {
    if (isCosmeticAvailable(c.id, unlocked)) { equipFrame(c.id); return; }
    if (guest) { setCosmeticMsg('Sign in to unlock cosmetics.'); return; }
    if (funds < c.unlockCost) {
      setCosmeticMsg(`Earn ${(c.unlockCost - funds).toLocaleString()} more Funds to unlock ${c.name}.`);
      return;
    }
    setCosmeticBusy(c.id);
    setCosmeticMsg(null);
    AudioManager.play('click');
    const ok = await unlockCosmetic(c.id);
    if (ok) {
      AudioManager.play('victory');
      setSelectedShareFrame(c.id);
      setEquippedFrame(c.id);
      setCosmeticMsg(`Unlocked ${c.name} — equipped.`);
      track('cosmetic_unlocked', { cosmetic_id: c.id, category: c.category, price_funds: c.unlockCost });
    } else {
      setCosmeticMsg('Could not unlock — please try again.');
    }
    setCosmeticBusy(null);
  }

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
    }
    setBuyingSku(null);
  }

  return (
    <div className="shop native-screen">
      <div className="shop__header">
        <button type="button" className="mp-back native-only" onClick={onBack}>← Back</button>
        <h1 className="shop__title">Campaign Shop</h1>
        <span className="shop__balance">
          <span className="coin-inline" aria-hidden />
          {funds.toLocaleString()} Funds
        </span>
      </div>

      <div className="shop__tabs native-only" role="tablist" aria-label="Shop sections">
        {[
          ['funds', 'Funds'],
          ['recruit', 'Recruit'],
          ['cosmetics', 'Cosmetics'],
          ['earn', 'Earn'],
          ['messages', 'Messages'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`shop__tab${tab === id ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id as ShopTab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="shop__body">
        <p className="shop__sub">Win games to earn Campaign Funds, then recruit new candidates to your roster.</p>

        <section className={`shop__pane shop__pane--funds${tab === 'funds' ? ' is-active' : ''}`}>
          {showPaidFunds && (
            <>
              <h2 className="shop__section" style={{ marginTop: '0.5rem' }}>Buy Campaign Funds</h2>
              <p className="shop__sub">Top up instantly to recruit candidates faster.</p>
            </>
          )}
          {purchaseMsg && <div className="shop__purchase-msg">{purchaseMsg}</div>}
          {showPaidFunds ? (
            <div className="funds-grid shop-rail">
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
                    {buyingSku === b.sku ? 'Processing…' : (nativePrices[b.sku] ?? b.priceLabel)}
                  </button>
                </div>
              ))}
            </div>
          ) : nativeBillingHeld ? (
            <p className="shop__sub">Campaign Funds purchases are not available in this build.</p>
          ) : (
            <p className="shop__sub">Campaign Funds purchases are available in the native app build.</p>
          )}
        </section>

        <section className={`shop__pane shop__pane--earn${tab === 'earn' ? ' is-active' : ''}`}>
          {showAdRewards && (
            <>
              <h2 className="shop__section">Earn Campaign Funds</h2>
              <RewardedAdCard />
            </>
          )}
          <InviteFriend />
        </section>

        <section className={`shop__pane shop__pane--recruit${tab === 'recruit' ? ' is-active' : ''}`}>
          <h2 className="shop__section">Recruit Candidates</h2>
          <div className="shop__grid shop-rail">
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
        </section>

        <section className={`shop__pane shop__pane--messages${tab === 'messages' ? ' is-active' : ''}`}>
          <h2 className="shop__section">Victory Messages</h2>
          <p className="shop__sub">Choose the speech your winner delivers on the victory screen.</p>
          <div className="shop__vm-list shop-rail">
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
        </section>

        <section className={`shop__pane shop__pane--cosmetics${tab === 'cosmetics' ? ' is-active' : ''}`}>
          <h2 className="shop__section">Result Card Frames</h2>
          <p className="shop__sub">Pick the look of your end-game share card. Purely cosmetic — no gameplay effect.</p>
          {cosmeticMsg && <div className="shop__purchase-msg">{cosmeticMsg}</div>}
          <div className="shop__cosmetics shop-rail">
            {cosmeticsByCategory('share_frame').map((c) => {
              const owned = isCosmeticAvailable(c.id, unlocked);
              const equipped = equippedFrame === c.id;
              const affordable = funds >= c.unlockCost;
              const foot = owned
                ? (equipped ? 'Equipped' : 'Equip')
                : cosmeticBusy === c.id
                  ? 'Unlocking…'
                  : guest
                    ? 'Sign in to unlock'
                    : `Unlock — ${c.unlockCost.toLocaleString()} Funds`;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cosmetic-card${equipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}`}
                  disabled={cosmeticBusy !== null}
                  onClick={() => unlockOrEquipFrame(c)}
                >
                  <span className="cosmetic-card__name">
                    {c.name}
                    {equipped && <span className="cosmetic-card__badge">Equipped</span>}
                  </span>
                  <span className="cosmetic-card__desc">{c.description}</span>
                  <span className={`cosmetic-card__foot${!owned && !affordable && !guest ? ' is-dim' : ''}`}>{foot}</span>
                </button>
              );
            })}
          </div>

          <h2 className="shop__section">More Cosmetics</h2>
          <p className="shop__sub">Map themes and profile banners are on the way.</p>
          <div className="shop__cosmetics shop-rail">
            {[...cosmeticsByCategory('map_theme'), ...cosmeticsByCategory('profile_banner')].map((c) => (
              <div key={c.id} className="cosmetic-card is-soon">
                <span className="cosmetic-card__name">{c.name}</span>
                <span className="cosmetic-card__desc">{c.description}</span>
                <span className="cosmetic-card__foot">Coming soon</span>
              </div>
            ))}
          </div>
          {/* Priced share-frame unlocks are now server-validated via the `unlock_cosmetic` RPC
              (supabase/cosmetics.sql), which grants a `cosmetic:<id>` token. The map_theme /
              profile_banner categories above remain `comingSoon` placeholders until their render
              surfaces exist; extend the cosmetics.sql price catalog when they ship. */}
        </section>
      </div>

      <div className="setup__foot" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="mp-back" onClick={onBack}>← Back to Menu</button>
      </div>
    </div>
  );
}
