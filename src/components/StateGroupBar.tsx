/**
 * StateGroupBar — persistent full-width strip below the header HUD.
 *
 * Clicking a chip highlights that group's states on the map (toggle).
 * The ⓘ button opens a non-breaking detail panel via React portal.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { STATE_GROUPS } from '../game/config';
import { groupImageUrl } from '../game/candidates';
import { InfoIcon } from './icons';
import {
  useActivePlayer,
  useActiveGroupWallet,
  useDominance,
  usePlayerColors,
} from '../game/store';
import type { StateGroup } from '../game/types';
import { StateGroupDetailPanel } from './StateGroupDetailPanel';
import { AudioManager } from '../utils/audioManager';

interface ChipProps {
  group: StateGroup;
  isHighlighted: boolean;
  onHighlight: () => void;
  onInfo: () => void;
}

function StateGroupChip({ group, isHighlighted, onHighlight, onInfo }: ChipProps) {
  const balance = useActiveGroupWallet(group.id);
  const dominantId = useDominance(group.id);
  const activePlayer = useActivePlayer();
  const colors = usePlayerColors();

  const activeIsDominant = !!activePlayer && dominantId === activePlayer.id;
  const dominantColor = dominantId ? (colors[dominantId]?.hex ?? null) : null;

  return (
    <div
      className={[
        'sg-chip',
        activeIsDominant ? 'sg-chip--dominant' : '',
        isHighlighted ? 'sg-chip--highlighted' : '',
      ].filter(Boolean).join(' ')}
      style={activeIsDominant ? { ['--p-color' as string]: dominantColor ?? 'var(--muted)' } : undefined}
    >
      <button
        type="button"
        className="sg-chip__main"
        onClick={() => { AudioManager.play('click'); onHighlight(); }}
        title={`${group.id} — click to highlight states on map`}
      >
        <img
          className="sg-chip__icon"
          src={groupImageUrl('state', group.id)}
          alt={group.id}
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <span className="sg-chip__name">{group.id}</span>
        <span className="sg-chip__bal">${balance.toFixed(0)}k</span>
        {dominantId && (
          <span
            className="sg-chip__dot"
            style={{ background: dominantColor ?? 'var(--muted)' }}
          />
        )}
      </button>
      <button
        type="button"
        className="sg-chip__info"
        onClick={(e) => { e.stopPropagation(); AudioManager.play('click'); onInfo(); }}
        title="View group details"
        aria-label={`${group.id} details`}
      >
        <InfoIcon size={15} />
      </button>
    </div>
  );
}

interface StateGroupBarProps {
  highlightedGroupId: string | null;
  onHighlight: (id: string | null) => void;
}

export function StateGroupBar({ highlightedGroupId, onHighlight }: StateGroupBarProps) {
  const [detailGroup, setDetailGroup] = useState<StateGroup | null>(null);

  return (
    <>
      <nav className="sg-bar" aria-label="State Groups">
        {STATE_GROUPS.map((g) => (
          <StateGroupChip
            key={g.id}
            group={g}
            isHighlighted={highlightedGroupId === g.id}
            onHighlight={() => onHighlight(highlightedGroupId === g.id ? null : g.id)}
            onInfo={() => setDetailGroup(g)}
          />
        ))}
      </nav>

      {detailGroup && createPortal(
        <StateGroupDetailPanel
          group={detailGroup}
          onClose={() => setDetailGroup(null)}
        />,
        document.body,
      )}
    </>
  );
}
