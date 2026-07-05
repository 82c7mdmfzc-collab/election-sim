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
import { PREMIUM_CANDIDATES } from '../game/candidates';
import { candidateMasteryTrainingOffer, normalizeCandidateMasteryEntry } from '../game/candidateMastery';
import { playerColorHex } from '../game/playerColors';
import { isCandidateFreeClaimAvailable } from '../game/promos';
import { VICTORY_MESSAGES, isVictoryMessageAvailable, type VictoryMessage } from '../game/victoryMessages';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { FUNDS_BUNDLES, displayFundsPrice, getFundsPrices, iapPlatform, nativeIapAvailable, purchase, recoverAndroidPurchases, type PurchaseResult } from '../utils/iap';
import { getSelectedVictoryMessage, setSelectedVictoryMessage, getSelectedShareFrame, setSelectedShareFrame, getSelectedMapTheme, setSelectedMapTheme } from '../utils/localPrefs';
import { cosmeticsByCategory, purchasableCosmetics, isCosmeticAvailable, type CosmeticDef } from '../game/cosmetics';
import { applyAppearancePrefs } from '../utils/appearance';
import { ProfileBanner } from './ProfileBanner';
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
import { CandidateStatsModal } from './CandidateStatsModal';
import { Portrait } from './Portrait';

interface ShopProps {
  source?: 'menu' | 'locked_candidate' | 'victory' | 'account';
  onBack: () => void;
  /** Open the sign-in modal — invoked when a guest tries to buy or unlock. */
  onSignIn?: () => void;
}

type ShopTab = 'funds' | 'recruit' | 'earn' | 'messages' | 'cosmetics';
type MessageToneFilter = 'all' | NonNullable<VictoryMessage['tone']>;

const MESSAGE_FILTERS: Array<{ id: MessageToneFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'statesman', label: 'Statesman' },
  { id: 'hype', label: 'Hype' },
  { id: 'meme', label: 'Meme' },
];

function priceValue(priceLabel: string): number {
  const n = Number(priceLabel.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** A funds-pack's coin artwork, falling back to the always-renderable CSS coin
 *  (a pure gradient, no asset) if the image is missing or fails to load — so a
 *  pack card never renders blank, even on a build that predates the art. */
function CoinArt({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="coin-inline funds-card__coin-fallback" aria-hidden />;
  return (
    <img
      className="funds-card__img"
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
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
      setMessage(`+${result.amount} Campaign Funds added.`);
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
    setMessage('Ad cancelled. No Campaign Funds claimed.');
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

export function Shop({ source = 'menu', onBack, onSignIn }: ShopProps) {
  const funds = useProfile((s) => s.profile.campaignFunds);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const mastery = useProfile((s) => s.profile.candidateMastery);
  const unlock = useProfile((s) => s.unlock);
  const claimFreeCharacter = useProfile((s) => s.claimFreeCharacter);
  const trainCandidate = useProfile((s) => s.trainCandidate);
  const unlockCosmetic = useProfile((s) => s.unlockCosmetic);
  const equipBanner = useProfile((s) => s.equipBanner);
  const equippedBanner = useProfile((s) => s.profile.equippedBanner);
  const guest = useProfile((s) => s.guest);
  const refresh = useProfile((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [trainingBusy, setTrainingBusy] = useState<string | null>(null);
  const [buyingSku, setBuyingSku] = useState<string | null>(null);
  const [cosmeticBusy, setCosmeticBusy] = useState<string | null>(null);
  const [cosmeticMsg, setCosmeticMsg] = useState<string | null>(null);
  const [equippedVM, setEquippedVM] = useState(getSelectedVictoryMessage);
  const [equippedFrame, setEquippedFrame] = useState(getSelectedShareFrame);
  const [equippedTheme, setEquippedTheme] = useState(getSelectedMapTheme);
  const [messageFilter, setMessageFilter] = useState<MessageToneFilter>('all');
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(null);
  const [recruitMsg, setRecruitMsg] = useState<string | null>(null);
  const [nativePrices, setNativePrices] = useState<Record<string, string>>({});
  const billingPlatform = iapPlatform();
  const hasNativeBilling = nativeIapAvailable();
  const showPaidFunds = hasNativeBilling; // native StoreKit only — no web billing
  const nativeBillingHeld = (billingPlatform === 'ios' || billingPlatform === 'android') && !hasNativeBilling;
  const showAdRewards = rewardedAdBridgeAvailable() || inlineRewardedAdsEnabled();
  // Open on the funds store so buying Campaign Funds is the first thing players see.
  const [tab, setTab] = useState<ShopTab>('funds');
  // Recruit candidate whose "click to see stats" popup is open (null = closed).
  const [statsModalId, setStatsModalId] = useState<string | null>(null);
  const statsCandidate = statsModalId
    ? PREMIUM_CANDIDATES.find((c) => c.id === statsModalId) ?? null
    : null;
  const selectedMessagePreview = VICTORY_MESSAGES.find((m) => m.id === equippedVM) ?? VICTORY_MESSAGES[0];
  const visibleVictoryMessages = useMemo(
    () => messageFilter === 'all'
      ? VICTORY_MESSAGES
      : VICTORY_MESSAGES.filter((m) => m.tone === messageFilter),
    [messageFilter],
  );

  useEffect(() => {
    track('shop_opened', {
      source,
      platform: billingPlatform,
      native_billing_available: hasNativeBilling,
    });
  }, [billingPlatform, hasNativeBilling, source]);

  // On open, refresh the balance (picks up funds credited by a recent purchase).
  // On Android, also sweep for owned-but-unconsumed packs (purchase interrupted
  // before consume, or a PENDING payment that has since completed) and refresh
  // again if anything was credited.
  useEffect(() => {
    void refresh();
    void recoverAndroidPurchases().then((n) => { if (n > 0) void refresh(); });
  }, [refresh]);

  // Native: load the store's localized prices for the funds packs. getFundsPrices
  // retries until the catalog resolves, so this may settle a beat after mount.
  useEffect(() => {
    if (!nativeIapAvailable()) return;
    let cancelled = false;
    void getFundsPrices().then((prices) => {
      if (cancelled) return;
      setNativePrices(prices);
    });
    return () => { cancelled = true; };
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

  function equipVictoryMessage(id: string) {
    AudioManager.play('click');
    setSelectedVictoryMessage(id);
    setEquippedVM(id);
    setCosmeticMsg(null);
    track('cosmetic_previewed', { cosmetic_id: id, category: 'victory_message' });
  }

  async function unlockOrEquipFrame(c: CosmeticDef) {
    if (isCosmeticAvailable(c.id, unlocked)) { equipFrame(c.id); return; }
    if (guest) { setCosmeticMsg('Sign in to unlock cosmetics.'); onSignIn?.(); return; }
    if (funds < c.unlockCost) {
      setCosmeticMsg(`Earn ${(c.unlockCost - funds).toLocaleString()} more Campaign Funds to unlock ${c.name}.`);
      return;
    }
    setCosmeticBusy(c.id);
    setCosmeticMsg(null);
    AudioManager.play('click');
    const result = await unlockCosmetic(c.id);
    if (result.ok) {
      AudioManager.play('victory');
      setSelectedShareFrame(c.id);
      setEquippedFrame(c.id);
      setCosmeticMsg(`Unlocked ${c.name} — equipped.`);
      track('cosmetic_unlocked', { cosmetic_id: c.id, category: c.category, price_funds: c.unlockCost });
    } else {
      setCosmeticMsg(result.message);
    }
    setCosmeticBusy(null);
  }

  async function unlockOrEquipVictoryMessage(m: VictoryMessage) {
    if (isVictoryMessageAvailable(m.id, unlocked)) { equipVictoryMessage(m.id); return; }
    if (guest) { setCosmeticMsg('Sign in to unlock cosmetics.'); onSignIn?.(); return; }
    if (funds < m.unlockCost) {
      setCosmeticMsg(`Earn ${(m.unlockCost - funds).toLocaleString()} more Campaign Funds to unlock ${m.label}.`);
      return;
    }
    setCosmeticBusy(m.id);
    setCosmeticMsg(null);
    AudioManager.play('click');
    const result = await unlockCosmetic(m.id);
    if (result.ok) {
      AudioManager.play('victory');
      setSelectedVictoryMessage(m.id);
      setEquippedVM(m.id);
      setCosmeticMsg(`Unlocked ${m.label} — equipped.`);
      track('cosmetic_unlocked', { cosmetic_id: m.id, category: 'victory_message', price_funds: m.unlockCost });
    } else {
      setCosmeticMsg(result.message);
    }
    setCosmeticBusy(null);
  }

  function equipMapTheme(id: string) {
    AudioManager.play('click');
    setSelectedMapTheme(id);
    setEquippedTheme(id);
    applyAppearancePrefs(); // recolor the board immediately
    setCosmeticMsg(null);
    track('cosmetic_previewed', { cosmetic_id: id, category: 'map_theme' });
  }

  async function unlockOrEquipMapTheme(c: CosmeticDef) {
    if (isCosmeticAvailable(c.id, unlocked)) { equipMapTheme(c.id); return; }
    if (guest) { setCosmeticMsg('Sign in to unlock cosmetics.'); onSignIn?.(); return; }
    if (funds < c.unlockCost) {
      setCosmeticMsg(`Earn ${(c.unlockCost - funds).toLocaleString()} more Campaign Funds to unlock ${c.name}.`);
      return;
    }
    setCosmeticBusy(c.id);
    setCosmeticMsg(null);
    AudioManager.play('click');
    const result = await unlockCosmetic(c.id);
    if (result.ok) {
      AudioManager.play('victory');
      equipMapTheme(c.id);
      setCosmeticMsg(`Unlocked ${c.name} — equipped.`);
      track('cosmetic_unlocked', { cosmetic_id: c.id, category: c.category, price_funds: c.unlockCost });
    } else {
      setCosmeticMsg(result.message);
    }
    setCosmeticBusy(null);
  }

  async function equipProfileBanner(id: string) {
    // Toggle off if the equipped banner is tapped again.
    const next = equippedBanner === id ? '' : id;
    AudioManager.play('click');
    setCosmeticMsg(null);
    const ok = await equipBanner(next);
    if (!ok && !guest) setCosmeticMsg('Could not update your banner. Try again.');
    else track('cosmetic_previewed', { cosmetic_id: next || 'none', category: 'profile_banner' });
  }

  async function unlockOrEquipBanner(c: CosmeticDef) {
    if (isCosmeticAvailable(c.id, unlocked)) { void equipProfileBanner(c.id); return; }
    if (guest) { setCosmeticMsg('Sign in to unlock cosmetics.'); onSignIn?.(); return; }
    if (funds < c.unlockCost) {
      setCosmeticMsg(`Earn ${(c.unlockCost - funds).toLocaleString()} more Campaign Funds to unlock ${c.name}.`);
      return;
    }
    setCosmeticBusy(c.id);
    setCosmeticMsg(null);
    AudioManager.play('click');
    const result = await unlockCosmetic(c.id);
    if (result.ok) {
      AudioManager.play('victory');
      await equipBanner(c.id);
      setCosmeticMsg(`Unlocked ${c.name} — equipped.`);
      track('cosmetic_unlocked', { cosmetic_id: c.id, category: c.category, price_funds: c.unlockCost });
    } else {
      setCosmeticMsg(result.message);
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
    return ok;
  }

  async function train(id: string) {
    const candidate = PREMIUM_CANDIDATES.find((c) => c.id === id);
    if (!candidate) return false;
    const offer = candidateMasteryTrainingOffer(candidate, mastery);
    if (!offer) return false;
    if (guest) { setRecruitMsg('Sign in to train candidates.'); onSignIn?.(); return false; }
    if (funds < offer.cost) {
      setRecruitMsg(`Earn ${(offer.cost - funds).toLocaleString()} more Campaign Funds to train ${candidate.name}.`);
      return false;
    }
    setTrainingBusy(id);
    setRecruitMsg(null);
    AudioManager.play('click');
    const ok = await trainCandidate(id);
    if (ok) {
      AudioManager.play('victory');
      setRecruitMsg(`${candidate.name} trained to Level ${offer.nextLevel}.`);
      track('candidate_mastery_trained', {
        item_id: id,
        next_level: offer.nextLevel,
        price_funds: offer.cost,
      });
    } else {
      setRecruitMsg('Could not train this candidate. Please try again.');
    }
    setTrainingBusy(null);
    return ok;
  }

  // Free-claim path (e.g. George Washington in July): zero-cost, server-validated.
  async function claim(id: string) {
    setBusy(id);
    AudioManager.play('click');
    const ok = await claimFreeCharacter(id);
    if (ok) {
      AudioManager.play('victory');
      track('item_unlocked', { item_id: id, item_type: 'candidate', price_funds: 0 });
    }
    setBusy(null);
    return ok;
  }

  async function buyFunds(sku: string) {
    const bundle = FUNDS_BUNDLES.find((b) => b.sku === sku);
    if (guest) { setPurchaseMsg('Sign in to buy Campaign Funds.'); onSignIn?.(); return; }
    if (nativeBillingHeld) { setPurchaseMsg('Campaign Funds purchases are not available in this build.'); return; }
    setBuyingSku(sku);
    AudioManager.play('click');
    track('checkout_started', {
      product_id: sku,
      product_type: 'funds',
      value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
      platform: billingPlatform,
    });
    // Play Billing never settles the purchase promise for PENDING payment methods
    // (slow test card, cash top-ups) — don't leave the button on "Processing…"
    // forever. The recovery sweep credits the purchase when it completes.
    const pendingTimeout: PurchaseResult = {
      status: 'error',
      message: 'Purchase pending — Campaign Funds will be added once your payment completes.',
    };
    const result = await Promise.race([
      purchase(sku),
      new Promise<PurchaseResult>((resolve) => { window.setTimeout(() => resolve(pendingTimeout), 90_000); }),
    ]);
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
        reason_category: result === pendingTimeout ? 'pending_timeout' : 'provider_error',
        value_usd: bundle ? priceValue(bundle.priceLabel) : 0,
        platform: billingPlatform,
      });
    }
    setBuyingSku(null);
  }

  // Stats popup for a recruit candidate: the CTA mirrors the unlock/claim/owned state.
  function renderStatsModal() {
    if (!statsCandidate) return null;
    const c = statsCandidate;
    const close = () => setStatsModalId(null);
    const owned = unlocked.includes(c.id);
    const freeClaim = !owned && isCandidateFreeClaimAvailable(c.id);
    const affordable = funds >= c.unlockCost;
    const working = busy === c.id;
    const trainingOffer = owned ? candidateMasteryTrainingOffer(c, mastery) : null;
    const trainingWorking = trainingBusy === c.id;
    const canAffordTraining = trainingOffer ? funds >= trainingOffer.cost : false;

    let actionLabel: string;
    let actionDisabled: boolean;
    let onAction = close;
    let subtext: string | undefined;
    let secondaryActionLabel: string | undefined;
    let secondaryActionDisabled: boolean | undefined;
    let onSecondaryAction: (() => void) | undefined;
    let secondarySubtext: string | undefined;

    if (owned) {
      actionLabel = 'Owned ✓';
      actionDisabled = true;
      if (trainingOffer) {
        secondaryActionLabel = trainingWorking
          ? 'Training...'
          : canAffordTraining
            ? `Train to Level ${trainingOffer.nextLevel} — ${trainingOffer.cost.toLocaleString()} Campaign Funds`
            : `Need ${(trainingOffer.cost - funds).toLocaleString()} more to train`;
        secondaryActionDisabled = trainingWorking || !canAffordTraining;
        onSecondaryAction = () => { void train(c.id); };
        secondarySubtext = `${trainingOffer.xpNeeded.toLocaleString()} XP or ${trainingOffer.cost.toLocaleString()} Campaign Funds to Level ${trainingOffer.nextLevel}.`;
      } else {
        secondarySubtext = 'Max level reached.';
      }
    } else if (freeClaim) {
      actionLabel = working ? 'Claiming…' : 'Claim Free';
      actionDisabled = working;
      onAction = () => { void claim(c.id).then((ok) => { if (ok) close(); }); };
      subtext = 'Free to claim this month.';
    } else if (guest) {
      actionLabel = 'Sign in to unlock';
      actionDisabled = !onSignIn;
      onAction = () => { close(); onSignIn?.(); };
    } else if (affordable) {
      actionLabel = working ? 'Unlocking…' : `Unlock — ${c.unlockCost.toLocaleString()} Campaign Funds`;
      actionDisabled = working;
      onAction = () => { void buy(c.id).then((ok) => { if (ok) close(); }); };
    } else {
      actionLabel = `Need ${(c.unlockCost - funds).toLocaleString()} more`;
      actionDisabled = true;
      subtext = `${funds.toLocaleString()} / ${c.unlockCost.toLocaleString()} Campaign Funds`;
    }

    return (
      <CandidateStatsModal
        candidate={c}
        actionLabel={actionLabel}
        actionDisabled={actionDisabled}
        onAction={onAction}
        onClose={close}
        subtext={subtext}
        secondaryActionLabel={secondaryActionLabel}
        secondaryActionDisabled={secondaryActionDisabled}
        onSecondaryAction={onSecondaryAction}
        secondarySubtext={secondarySubtext}
      />
    );
  }

  return (
    <div className="shop native-screen">
      <div className="shop__header">
        <button type="button" className="mp-back native-only" onClick={onBack}>← Back</button>
        <h1 className="shop__title">Campaign Store</h1>
        <span className="shop__balance">
          <span className="coin-inline" aria-hidden />
          {funds.toLocaleString()} Campaign Funds
        </span>
      </div>

      <div className="shop__tabs native-only" role="tablist" aria-label="Store sections">
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

        <section className={`shop__pane shop__pane--funds${tab === 'funds' ? ' is-active' : ''}${purchaseMsg ? ' has-purchase-message' : ''}`}>
          <h2 className="shop__section" style={{ marginTop: '0.5rem' }}>Buy Campaign Funds</h2>
          <p className="shop__sub">
            {showPaidFunds
              ? 'Top up Campaign Funds instantly to recruit new candidates faster.'
              : 'Top up Campaign Funds instantly in the Elector app.'}
          </p>
          {purchaseMsg && <div className="shop__purchase-msg">{purchaseMsg}</div>}
          {showPaidFunds ? (
            <div className="funds-grid shop-rail">
              {FUNDS_BUNDLES.map((b) => {
                const nativePrice = nativePrices[b.sku];
                // StoreKit's localized price when it resolves, with a UK guard for
                // sandbox/TestFlight returning USD despite a UK device context.
                const displayPrice = displayFundsPrice(b, nativePrice);
                return (
                  <div key={b.sku} className="funds-card">
                    {b.badge && <span className="funds-card__badge">{b.badge}</span>}
                    <CoinArt src={b.imageUrl} />
                    <div className="funds-card__details">
                      <div className="funds-card__amount">
                        <span className="coin-inline coin-inline--large" aria-hidden />
                        {b.funds.toLocaleString()}
                      </div>
                      <div className="funds-card__label">Campaign Funds</div>
                      <div className="funds-card__price">{displayPrice}</div>
                    </div>
                    <button
                      type="button"
                      className="funds-card__buy"
                      disabled={buyingSku === b.sku}
                      onClick={() => buyFunds(b.sku)}
                    >
                      {buyingSku === b.sku ? 'Processing…' : 'Buy'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="funds-web-note">
              <span className="coin-inline coin-inline--large" aria-hidden />
              <div className="funds-web-note__body">
                <strong>
                  {nativeBillingHeld ? 'Campaign Funds purchases are unavailable in this build' : 'Buy Campaign Funds in the app'}
                </strong>
                <p>
                  {nativeBillingHeld
                    ? 'In-app purchases aren’t configured for this build yet.'
                    : 'Campaign Funds top-ups are available in the Elector app for iPhone and Android. On the web you can still earn Campaign Funds by winning games, watching ads, and inviting friends.'}
                </p>
              </div>
            </div>
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
          <p className="shop__sub">Tap a candidate to see their bonuses &amp; penalties, then recruit with Campaign Funds.</p>
          {recruitMsg && <div className="shop__purchase-msg">{recruitMsg}</div>}
          <div className="shop__grid shop-rail">
            {PREMIUM_CANDIDATES.map((c) => {
              const owned = unlocked.includes(c.id);
              const freeClaim = !owned && isCandidateFreeClaimAvailable(c.id);
              const affordable = funds >= c.unlockCost;
              const pct = Math.min(100, Math.round((funds / c.unlockCost) * 100));
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`shop-card${owned ? ' is-owned' : ''}`}
                  style={{ ['--p-color' as string]: playerColorHex(c.color) }}
                  onClick={() => { AudioManager.play('click'); setStatsModalId(c.id); }}
                >
                  <div className="shop-card__top">
                    <Portrait className="shop-card__portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                    <div>
                      <span className="shop-card__name">{c.name}</span>
                      <span className="shop-card__tag">{c.tagline}</span>
                    </div>
                  </div>

                  <div className="shop-card__foot">
                    <span className="shop-card__level">Level {normalizeCandidateMasteryEntry(mastery[c.id], c).level}</span>
                    {owned ? (
                      <div className="shop-card__owned">Owned ✓</div>
                    ) : freeClaim ? (
                      <span className="shop-card__price shop-card__price--free">Free in July</span>
                    ) : (
                      <>
                        <span className="shop-card__price">{c.unlockCost.toLocaleString()} Campaign Funds</span>
                        {!affordable && (
                          <div className="shop-card__progress"><span style={{ width: `${pct}%` }} /></div>
                        )}
                      </>
                    )}
                    <span className="shop-card__stats-hint">View stats ›</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`shop__pane shop__pane--messages${tab === 'messages' ? ' is-active' : ''}`}>
          <h2 className="shop__section">Victory Messages</h2>
          <p className="shop__sub">Choose the speech your winner delivers on the victory screen and share card.</p>
          {cosmeticMsg && <div className="shop__purchase-msg">{cosmeticMsg}</div>}
          <div className="shop__vm-preview">
            <span className="shop__vm-preview-label">Equipped</span>
            <strong>{selectedMessagePreview.label}</strong>
            <p>“{selectedMessagePreview.text}”</p>
          </div>
          <div className="shop__vm-filters" role="tablist" aria-label="Victory message tones">
            {MESSAGE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`shop__vm-filter${messageFilter === filter.id ? ' is-active' : ''}`}
                role="tab"
                aria-selected={messageFilter === filter.id}
                onClick={() => setMessageFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="shop__vm-list shop-rail">
            {visibleVictoryMessages.map((m) => {
              const owned = isVictoryMessageAvailable(m.id, unlocked);
              const equipped = owned && equippedVM === m.id;
              const affordable = funds >= m.unlockCost;
              const foot = owned
                ? (equipped ? 'Equipped' : 'Equip')
                : cosmeticBusy === m.id
                  ? 'Unlocking…'
                  : guest
                    ? 'Sign in to unlock'
                    : `Unlock — ${m.unlockCost.toLocaleString()} Campaign Funds`;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`vm-card${equipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}`}
                  disabled={cosmeticBusy !== null}
                  onClick={() => unlockOrEquipVictoryMessage(m)}
                >
                  <span className="vm-card__label">
                    {m.label}
                    {equipped && <span className="vm-card__badge">Equipped</span>}
                    {m.tone && <span className={`vm-card__tone vm-card__tone--${m.tone}`}>{m.tone}</span>}
                  </span>
                  <span className="vm-card__text">“{m.text}”</span>
                  {!owned && (
                    <span className="vm-card__lock">
                      {affordable && !guest ? 'Ready to unlock' : `${m.unlockCost.toLocaleString()} Campaign Funds`}
                    </span>
                  )}
                  <span className={`vm-card__foot${!owned && !affordable && !guest ? ' is-dim' : ''}`}>{foot}</span>
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
                    : `Unlock — ${c.unlockCost.toLocaleString()} Campaign Funds`;
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

          <h2 className="shop__section">Board Map Themes</h2>
          <p className="shop__sub">Recolor your election map. Only you see your board — purely cosmetic.</p>
          <div className="shop__cosmetics shop-rail">
            {purchasableCosmetics('map_theme').map((c) => {
              const owned = isCosmeticAvailable(c.id, unlocked);
              const equipped = equippedTheme === c.id;
              const affordable = funds >= c.unlockCost;
              const foot = owned
                ? (equipped ? 'Equipped' : 'Equip')
                : cosmeticBusy === c.id
                  ? 'Unlocking…'
                  : guest
                    ? 'Sign in to unlock'
                    : `Unlock — ${c.unlockCost.toLocaleString()} Campaign Funds`;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cosmetic-card cosmetic-card--theme cosmetic-card--${c.id}${equipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}`}
                  disabled={cosmeticBusy !== null}
                  onClick={() => unlockOrEquipMapTheme(c)}
                >
                  <span className="cosmetic-card__swatch" aria-hidden="true" />
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

          <h2 className="shop__section">Profile Banners</h2>
          <p className="shop__sub">Show your colors on the leaderboard and your profile. Tap again to remove.</p>
          <div className="shop__cosmetics shop-rail">
            {purchasableCosmetics('profile_banner').map((c) => {
              const owned = isCosmeticAvailable(c.id, unlocked);
              const equipped = equippedBanner === c.id;
              const affordable = funds >= c.unlockCost;
              const foot = owned
                ? (equipped ? 'Equipped — tap to remove' : 'Equip')
                : cosmeticBusy === c.id
                  ? 'Unlocking…'
                  : guest
                    ? 'Sign in to unlock'
                    : `Unlock — ${c.unlockCost.toLocaleString()} Campaign Funds`;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cosmetic-card cosmetic-card--banner${equipped ? ' is-equipped' : ''}${owned ? '' : ' is-locked'}`}
                  disabled={cosmeticBusy !== null}
                  onClick={() => unlockOrEquipBanner(c)}
                >
                  <ProfileBanner bannerId={c.id} variant="strip" className="cosmetic-card__banner-preview" />
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
        </section>
      </div>

      <div className="setup__foot" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="mp-back" onClick={onBack}>← Back to Menu</button>
      </div>

      {renderStatsModal()}
    </div>
  );
}
