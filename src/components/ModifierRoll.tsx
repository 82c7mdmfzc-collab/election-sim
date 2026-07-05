/**
 * ModifierRoll — the slot-machine reveal shown at game start when modifiers were
 * rolled (see store.modifierRevealPending). The reel spins through modifier names,
 * eases to a stop, and lands on each rolled id in turn (twice for Crazy Mode), with
 * a ticking SFX that slows toward the landing. Purely a REVEAL — the result is
 * already decided (store.activeModifierIds); this just dramatizes it for all seats.
 *
 * Auto-advances when the animation finishes (clearModifierReveal). Reduced-motion
 * shows the result immediately.
 */

import { useEffect, useState } from 'react';
import { useGameStore } from '../game/store';
import { MODIFIERS, MODIFIER_MAP } from '../game/modifiers';
import { AudioManager } from '../utils/audioManager';
import { isReducedMotion } from '../utils/localPrefs';

const TICKS = 24;      // reel steps before a landing
const LAND_HOLD = 950; // pause on a landing before the next reel / exit

export function ModifierRoll() {
  const ids = useGameStore((s) => s.activeModifierIds);
  const clearModifierReveal = useGameStore((s) => s.clearModifierReveal);
  const rolled = ids ?? [];
  const isCrazy = rolled.length >= 2;

  const [reelIdx, setReelIdx] = useState(0);       // pool index currently on the reel
  const [landed, setLanded] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(true);

  useEffect(() => {
    if (rolled.length === 0) { clearModifierReveal(); return; }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };

    if (isReducedMotion()) {
      at(0, () => { setLanded([...rolled]); setSpinning(false); });
      at(1300, clearModifierReveal);
      return () => { cancelled = true; timers.forEach(clearTimeout); };
    }

    const spinSlot = (slot: number) => {
      setSpinning(true);
      const target = rolled[slot];
      let tick = 0;
      const step = () => {
        if (cancelled) return;
        tick++;
        if (tick >= TICKS) {
          setReelIdx(Math.max(0, MODIFIERS.findIndex((m) => m.id === target)));
          setSpinning(false);
          AudioManager.play('dominate');
          setLanded((prev) => [...prev, target]);
          if (slot + 1 < rolled.length) at(LAND_HOLD, () => spinSlot(slot + 1));
          else at(LAND_HOLD + 300, clearModifierReveal);
          return;
        }
        setReelIdx((prev) => (prev + 1) % MODIFIERS.length);
        AudioManager.play('click');
        // Ease-out: each tick waits a little longer, so the reel visibly slows.
        at(40 + Math.pow(tick / TICKS, 3) * 300, step);
      };
      step();
    };
    at(0, () => spinSlot(0));

    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // rolled is derived from the store once at game start; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearModifierReveal]);

  if (rolled.length === 0) return null;
  const reel = MODIFIERS[reelIdx];

  return (
    <div className="modroll" onClick={clearModifierReveal} role="presentation">
      <div className="modroll__scene">
        <div className="modroll__label">{isCrazy ? 'Crazy Mode' : 'Wild Card'}</div>

        {spinning ? (
          <div className="modroll__reel">
            <div className="modroll__reel-name">{reel.name}</div>
          </div>
        ) : (
          <div className="modroll__reel modroll__reel--landed">
            <div className="modroll__reel-name">{MODIFIER_MAP[landed[landed.length - 1] ?? '']?.name ?? ''}</div>
          </div>
        )}

        <div className="modroll__landed">
          {landed.map((id) => {
            const m = MODIFIER_MAP[id];
            if (!m) return null;
            return (
              <div key={id} className={`modroll__card${m.isNewMechanic ? ' modroll__card--new' : ''}`}>
                <div className="modroll__card-name">{m.name}{m.isNewMechanic && <span className="modroll__new">NEW</span>}</div>
                <div className="modroll__card-desc">{m.description}</div>
              </div>
            );
          })}
        </div>

        <div className="modroll__hint">Tap to continue</div>
      </div>
    </div>
  );
}
