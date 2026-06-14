/**
 * RewardReveal — the animated "+N Campaign Funds" payout shown on the victory
 * screen. Reads the breakdown the profile store stashed in applyGameResult and
 * counts the total up for a satisfying reward moment.
 */

import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';

export function RewardReveal() {
  const lastReward = useProfile((s) => s.lastReward);
  const [shown, setShown] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  const total = lastReward?.total ?? 0;

  useEffect(() => {
    if (!total) return;
    AudioManager.play('confirm');
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setShown(Math.round(eased * total));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [total]);

  if (!lastReward || total === 0) return null;

  const lines: [string, number][] = [
    ['Finished campaign', lastReward.base],
    ['Won the presidency', lastReward.winBonus],
    ['States secured', lastReward.securedBonus],
    ['Coalitions dominated', lastReward.dominanceBonus],
    ['Win streak', lastReward.streakBonus],
  ];

  return (
    <div className="reward-reveal">
      <div className="reward-reveal__amount">+{shown.toLocaleString()}</div>
      <div className="reward-reveal__label">Campaign Funds Earned</div>
      <ul className="reward-reveal__lines">
        {lines.filter(([, v]) => v > 0).map(([label, v]) => (
          <li key={label} className="reward-reveal__line">
            <span>{label}</span>
            <span>+{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
