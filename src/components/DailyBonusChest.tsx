/**
 * DailyBonusChest — the once-per-day login reward moment.
 *
 * A tap-to-open chest: the gift bursts into a coin fan and the amount counts up.
 * Replaces the old silent toast so the daily bonus reads as an event. Reduced
 * motion collapses it to a static "claimed" card. One tap (or the button)
 * dismisses. Amount is already claimed server-side before this shows.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { useModalClose } from './ui/modalCloseContext';
import { GiftIcon } from './icons';
import { AudioManager } from '../utils/audioManager';
import { haptic } from '../utils/haptics';
import { isReducedMotion } from '../utils/localPrefs';

// Rendered inside Modal so useModalClose() sees the provider: the collect tap
// clicks immediately, then dismisses through the modal's exit animation.
function CollectButton() {
  const requestClose = useModalClose();
  return (
    <button type="button" className="btn-cta daily-chest__collect" onClick={() => { AudioManager.play('click'); requestClose(); }}>
      Collect
    </button>
  );
}

export function DailyBonusChest({ amount, onClose }: { amount: number; onClose: () => void }) {
  const reduced = isReducedMotion();
  const [opened, setOpened] = useState(reduced);
  const [shown, setShown] = useState(reduced ? amount : 0);
  const raf = useRef<number | undefined>(undefined);

  // The chest appears without a user tap — announce it with a light tap.
  useEffect(() => { haptic('light'); }, []);

  // Count the amount up once the chest is opened.
  useEffect(() => {
    if (!opened || reduced) return;
    AudioManager.play('income');
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(eased * amount));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else haptic('success'); // count-up landed on the full amount
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [opened, reduced, amount]);

  function open() {
    if (opened) return;
    AudioManager.play('confirm');
    setOpened(true);
  }

  return (
    <Modal label="Daily bonus" panelClassName="daily-chest" onClose={onClose}>
      <p className="daily-chest__eyebrow">Daily Bonus</p>
      <button
        type="button"
        className={`daily-chest__lid${opened ? ' is-open' : ''}`}
        onClick={open}
        aria-label={opened ? 'Daily bonus opened' : 'Tap to open your daily bonus'}
      >
        {opened && !reduced && (
          <span className="daily-chest__burst" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="daily-chest__coin" style={{ ['--i' as string]: i }} />
            ))}
          </span>
        )}
        <span className="daily-chest__gift"><GiftIcon size={64} /></span>
      </button>

      {opened ? (
        <>
          <div className="daily-chest__amount">
            <span className="gold-pill__coin" aria-hidden />
            +{shown.toLocaleString()}
          </div>
          <div className="daily-chest__label">Campaign Funds</div>
          <CollectButton />
        </>
      ) : (
        <div className="daily-chest__hint">Tap the chest to open</div>
      )}
    </Modal>
  );
}
