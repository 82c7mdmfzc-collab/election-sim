/**
 * ActiveModifierChip — a compact in-game indicator of the modifiers in effect.
 *
 * Mounted once at the app root; self-gates to show only while a board is on screen
 * (not menus / intros) and only when modifiers were rolled. Tap toggles a popover
 * that lists each active modifier with its description, so players can always see
 * (and understand) the twist.
 */

import { useState } from 'react';
import { useGameStore } from '../game/store';
import { MODIFIER_MAP } from '../game/modifiers';
import { AudioManager } from '../utils/audioManager';
import { DiceIcon } from './icons';

export function ActiveModifierChip() {
  const ids = useGameStore((s) => s.activeModifierIds);
  const phase = useGameStore((s) => s.phase);
  const viewingGame = useGameStore((s) => s.viewingGame);
  const versusPending = useGameStore((s) => s.versusPending);
  const modifierRevealPending = useGameStore((s) => s.modifierRevealPending);
  const [open, setOpen] = useState(false);

  const active = ids ?? [];
  const inGame = viewingGame && phase !== 'SETUP' && phase !== 'MENU' && !versusPending && !modifierRevealPending;
  if (!inGame || active.length === 0) return null;

  return (
    <div className="modchip-wrap">
      <button
        type="button"
        className="modchip"
        onClick={() => { AudioManager.play('click'); setOpen((v) => !v); }}
        aria-label="Active modifiers"
      >
        <span className="modchip__icon" aria-hidden><DiceIcon size={16} /></span>
        <span className="modchip__count">{active.length === 1 ? MODIFIER_MAP[active[0]]?.name ?? 'Modifier' : `${active.length} Modifiers`}</span>
      </button>
      {open && (
        <div className="modchip__pop" role="dialog">
          {active.map((id) => {
            const m = MODIFIER_MAP[id];
            if (!m) return null;
            return (
              <div key={id} className="modchip__item">
                <div className="modchip__item-name">{m.name}{m.isNewMechanic && <span className="modchip__new">NEW</span>}</div>
                <div className="modchip__item-desc">{m.description}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
