/**
 * SeasonPass — the Campaign Trail screen (Season 1).
 *
 * Renders the server-owned catalog (useProfile.season) as a horizontal tier rail
 * (premium lane above free lane), a Roster Objectives strip, an XP header, and the
 * 4,000-Funds premium-unlock CTA. Every reward amount comes from the server; this
 * screen only displays + fires claim RPCs.
 *
 * Landscape / short-viewport safe: the tier rail reuses the `shop-rail` horizontal
 * scroll pattern so tall content never forces the page to scroll.
 */

import { useEffect, useMemo, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { CheckIcon, LockIcon } from './icons';
import { CANDIDATES, CANDIDATE_MAP } from '../game/candidates';
import { COSMETIC_MAP } from '../game/cosmetics';
import {
  seasonHeaderProgress,
  seasonCountdown,
  isTierClaimed,
  isTierClaimable,
  isObjectiveClaimed,
  currentTierNumber,
  OBJECTIVE_META,
  type SeasonTier,
  type SeasonTierReward,
  type SeasonObjective,
} from '../game/season';
import { AudioManager } from '../utils/audioManager';
import { BackButton } from './BackButton';
import { ConfirmDialog } from './ConfirmDialog';
import { track } from '../utils/analytics';

function rewardChips(reward: SeasonTierReward): { key: string; label: string; kind: string }[] {
  const chips: { key: string; label: string; kind: string }[] = [];
  if (reward.funds) chips.push({ key: 'f', label: `${reward.funds.toLocaleString()} Funds`, kind: 'funds' });
  if (reward.cosmetic) {
    const name = COSMETIC_MAP[reward.cosmetic]?.name ?? reward.cosmetic;
    chips.push({ key: 'c', label: name, kind: 'cosmetic' });
  }
  if (reward.masteryXp) chips.push({ key: 'm', label: `${reward.masteryXp} Mastery XP`, kind: 'mastery' });
  return chips;
}

export function SeasonPass({ onBack }: { onBack: () => void }) {
  const season = useProfile((s) => s.season);
  const refreshSeason = useProfile((s) => s.refreshSeason);
  const unlockSeasonPass = useProfile((s) => s.unlockSeasonPass);
  const claimSeasonTier = useProfile((s) => s.claimSeasonTier);
  const claimSeasonObjective = useProfile((s) => s.claimSeasonObjective);
  const funds = useProfile((s) => s.profile.campaignFunds);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  // Captured once via a lazy initializer (Date.now() is banned in the render body).
  const [nowMs] = useState(() => Date.now());
  // A pending mastery-tome claim awaiting candidate choice: { tier, track }.
  const [tomeClaim, setTomeClaim] = useState<{ tier: number; track: 'free' | 'premium' } | null>(null);

  useEffect(() => {
    void refreshSeason();
    track('season_viewed', {});
  }, [refreshSeason]);

  const cat = season?.season ?? null;
  const progress = season?.progress ?? { xp: 0, premium: false, candidatesWon: [] };
  const header = useMemo(
    () => (cat ? seasonHeaderProgress(cat.tiers, progress.xp) : null),
    [cat, progress.xp],
  );

  const ownedCandidates = useMemo(
    () => CANDIDATES.filter((c) => c.unlockCost === 0 || unlocked.includes(c.id)),
    [unlocked],
  );

  if (!cat || !header || !season) {
    return (
      <div className="setup native-screen season-screen">
        <div className="setup__header"><h1 className="setup__title">Campaign Trail</h1></div>
        <div className="season-empty">No active season right now — check back soon.</div>
        <div className="setup__foot">
          <BackButton onClick={onBack} label="Back to Menu" />
        </div>
      </div>
    );
  }

  const currentTier = currentTierNumber(cat.tiers, progress.xp);

  async function doUnlock() {
    setConfirmUnlock(false);
    setBusy('unlock');
    setMsg(null);
    const res = await unlockSeasonPass();
    if (res.ok) { AudioManager.play('victory'); setMsg('Premium track unlocked!'); track('season_pass_purchased', { price_funds: cat?.premiumCost ?? 0 }); }
    else setMsg(res.message ?? 'Could not unlock.');
    setBusy(null);
  }

  async function claimTier(t: SeasonTier, tr: 'free' | 'premium') {
    const reward = t[tr];
    if (reward.masteryXp) { setTomeClaim({ tier: t.tier, track: tr }); return; }
    setBusy(`${tr}:${t.tier}`);
    setMsg(null);
    const res = await claimSeasonTier(t.tier, tr);
    if (res.ok) { AudioManager.play('confirm'); track('season_tier_claimed', { tier: t.tier, track: tr }); }
    else setMsg(res.message ?? 'Could not claim.');
    setBusy(null);
  }

  async function claimTome(candidateId: string) {
    if (!tomeClaim) return;
    const { tier, track: tr } = tomeClaim;
    setTomeClaim(null);
    setBusy(`${tr}:${tier}`);
    setMsg(null);
    const res = await claimSeasonTier(tier, tr, candidateId);
    if (res.ok) { AudioManager.play('confirm'); track('season_tier_claimed', { tier, track: tr, tome: candidateId }); }
    else setMsg(res.message ?? 'Could not claim.');
    setBusy(null);
  }

  async function claimObjective(o: SeasonObjective) {
    setBusy(`obj:${o.id}`);
    setMsg(null);
    const res = await claimSeasonObjective(o.id);
    if (res.ok) { AudioManager.play('victory'); track('season_objective_claimed', { objective: o.id }); }
    else setMsg(res.message ?? 'Could not claim.');
    setBusy(null);
  }

  return (
    <div className="setup native-screen season-screen">
      <div className="setup__header">
        <h1 className="setup__title">Season</h1>
        <p className="setup__sub">{cat.title}</p>
        {nowMs > 0 && <span className="season-countdown">{seasonCountdown(cat.endsAt, nowMs)}</span>}
      </div>

      <div className="season-body">
      {/* XP header */}
      <div className="season-header">
        <div className="season-header__row">
          <span className="season-header__tier">Tier {header.tier}</span>
          <span className="season-header__xp">
            {header.isMax ? 'Track complete' : `${header.xpToNext} XP to Tier ${header.tier + 1}`}
          </span>
        </div>
        <div className="season-header__bar"><div className="season-header__fill" style={{ width: `${header.pct}%` }} /></div>
        {!progress.premium && !cat.ended && (
          <button
            type="button"
            className="btn-cta season-unlock"
            disabled={busy === 'unlock'}
            onClick={() => { AudioManager.play('click'); setConfirmUnlock(true); }}
          >
            {busy === 'unlock' ? 'Unlocking…' : `Unlock Campaign Trail — ${cat.premiumCost.toLocaleString()} Funds`}
          </button>
        )}
        {progress.premium && <div className="season-premium-badge">★ Premium unlocked</div>}
      </div>

      {msg && <div className="season-msg">{msg}</div>}

      {/* Roster Objectives */}
      <div className="season-objectives">
        <h2 className="season-subhead">Roster Objectives — win with different candidates</h2>
        <div className="season-obj-row">
          {cat.objectives.map((o) => {
            const have = progress.candidatesWon.length;
            const met = have >= o.threshold;
            const claimed = isObjectiveClaimed(season.claims, o.id);
            const meta = OBJECTIVE_META[o.id] ?? { name: o.id, description: '' };
            return (
              <div key={o.id} className={`season-obj-card${claimed ? ' is-claimed' : ''}`}>
                <div className="season-obj-card__name">{meta.name}</div>
                <div className="season-obj-card__desc">{meta.description}</div>
                <div className="season-obj-card__prog">{Math.min(have, o.threshold)} / {o.threshold}</div>
                <div className="season-obj-card__reward">
                  +{o.xp} XP{o.funds ? ` · ${o.funds.toLocaleString()} Funds` : ''}
                  {o.cosmetic ? ` · ${COSMETIC_MAP[o.cosmetic]?.name ?? o.cosmetic}` : ''}
                </div>
                {claimed ? (
                  <div className="season-obj-card__done">Claimed ✓</div>
                ) : (
                  <button
                    type="button"
                    className="season-claim-btn"
                    disabled={!met || busy === `obj:${o.id}`}
                    onClick={() => claimObjective(o)}
                  >
                    {met ? (busy === `obj:${o.id}` ? 'Claiming…' : 'Claim') : 'Locked'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tier rail */}
      <div className="season-rail-wrap">
        <div className="season-rail shop-rail">
          {cat.tiers.map((t) => {
            const reached = progress.xp >= t.cumXp;
            const isCurrent = t.tier === currentTier + 1;
            return (
              <div key={t.tier} className={`season-tier${reached ? ' is-reached' : ''}${isCurrent ? ' is-current' : ''}`}>
                <div className="season-tier__num">{t.tier}</div>
                <TierLane reward={t.premium} track="premium" tier={t} status={season} busy={busy}
                  locked={!progress.premium} onClaim={() => claimTier(t, 'premium')} />
                <TierLane reward={t.free} track="free" tier={t} status={season} busy={busy}
                  locked={false} onClaim={() => claimTier(t, 'free')} />
              </div>
            );
          })}
        </div>
      </div>
      </div>

      <div className="setup__foot">
        <BackButton onClick={onBack} label="Back to Menu" />
      </div>

      {confirmUnlock && (
        <ConfirmDialog
          message={`Unlock the premium Campaign Trail for ${cat.premiumCost.toLocaleString()} Campaign Funds? You have ${funds.toLocaleString()}.`}
          confirmLabel="Unlock"
          cancelLabel="Cancel"
          onConfirm={doUnlock}
          onCancel={() => setConfirmUnlock(false)}
        />
      )}

      {tomeClaim && (
        <div className="help-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setTomeClaim(null); }}>
          <div className="help-overlay__panel season-tome-picker">
            <h3>Apply the Mastery Tome</h3>
            <p className="season-tome-picker__sub">Choose a candidate to gain the XP.</p>
            <div className="season-tome-picker__grid">
              {ownedCandidates.map((c) => (
                <button key={c.id} type="button" className="season-tome-picker__btn" onClick={() => claimTome(c.id)}>
                  {CANDIDATE_MAP[c.id]?.name ?? c.id}
                </button>
              ))}
            </div>
            <button type="button" className="mp-back" onClick={() => setTomeClaim(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TierLane({ reward, track, tier, status, busy, locked, onClaim }: {
  reward: SeasonTierReward;
  track: 'free' | 'premium';
  tier: SeasonTier;
  status: import('../game/season').SeasonStatus;
  busy: string | null;
  locked: boolean;
  onClaim: () => void;
}) {
  const chips = rewardChips(reward);
  if (chips.length === 0) return <div className={`season-lane season-lane--${track} is-empty`} />;
  const claimed = isTierClaimed(status.claims, tier.tier, track);
  const claimable = isTierClaimable(tier, track, status);
  const busyKey = `${track}:${tier.tier}`;
  return (
    <div className={`season-lane season-lane--${track}${claimed ? ' is-claimed' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="season-lane__chips">
        {chips.map((ch) => (
          <span key={ch.key} className={`season-chip season-chip--${ch.kind}`}>{ch.label}</span>
        ))}
      </div>
      {claimed ? (
        <span className="season-lane__done"><CheckIcon size={14} /></span>
      ) : locked ? (
        <span className="season-lane__lock"><LockIcon size={14} /></span>
      ) : (
        <button type="button" className="season-claim-btn" disabled={!claimable || busy === busyKey} onClick={onClaim}>
          {claimable ? (busy === busyKey ? '…' : 'Claim') : 'Locked'}
        </button>
      )}
    </div>
  );
}
