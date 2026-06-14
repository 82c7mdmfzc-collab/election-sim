/**
 * GameShell — the tactical layout grid:
 *
 *   ┌───────────────────────────────────────────┐
 *   │  HeaderHud (+ WalletDrawer)                │
 *   ├──────────────────────────────┬────────────┤
 *   │  MapStage (centered map)      │  Sidebar   │
 *   ├──────────────────────────────┴────────────┤
 *   │  PhaseFooter                               │
 *   └───────────────────────────────────────────┘
 *
 * ElectionOverlay and the blind HandoffCurtain float above the grid.
 */

import { useState } from 'react';
import { ElectionMap, ElectionOverlay } from './ElectionMap';
import { HeaderHud } from './HeaderHud';
import { StateGroupBar } from './StateGroupBar';
import { Sidebar } from './Sidebar';
import { PhaseFooter } from './PhaseFooter';
import { HandoffCurtain } from './HandoffCurtain';
import { RoundResolution } from './RoundResolution';
import { SecuredToast } from './SecuredToast';
import { WaitingOnPlayers } from './WaitingOnPlayers';
import { useActivePlayer, useGameStore } from '../game/store';
import { useTurnTimer } from '../game/useTurnTimer';
import { useMultiplayerSync } from '../hooks/useMultiplayerSync';
import { useBotDriver } from '../hooks/useBotDriver';
import { STATE_GROUPS } from '../game/config';
import { AudioManager } from '../utils/audioManager';

// Null-render wrapper so useMultiplayerSync respects rules-of-hooks
// (hooks cannot be called conditionally, so we conditionally render this component).
function MultiplayerSyncEffect() {
  useMultiplayerSync();
  return null;
}

export function GameShell() {
  const phase = useGameStore((s) => s.phase);
  const reset = useGameStore((s) => s.reset);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const activePlayer = useActivePlayer();
  const timer = useTurnTimer();
  useBotDriver();
  const stageKey = `${phase}:${activePlayer?.id ?? 'none'}`;

  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);

  const highlightedStateIds = highlightedGroupId
    ? new Set(STATE_GROUPS.find((g) => g.id === highlightedGroupId)?.members ?? [])
    : null;

  return (
    <div className="shell">
      {multiplayerMode === 'online' && <MultiplayerSyncEffect />}

      <div className="shell__top">
        <HeaderHud timer={timer} />
        <StateGroupBar
          highlightedGroupId={highlightedGroupId}
          onHighlight={setHighlightedGroupId}
        />
      </div>

      <main className="shell__main" key={stageKey}>
        <div className="shell__stage">
          {phase === 'ELECTION'
            ? <ElectionOverlay />
            : <ElectionMap highlightedStateIds={highlightedStateIds} />}
        </div>
        <Sidebar />
      </main>

      <PhaseFooter />

      <button
        type="button"
        className="shell__reset"
        onClick={() => { AudioManager.play('click'); reset(); }}
        title="New game"
      >
        ⟲
      </button>

      <WaitingOnPlayers />
      <RoundResolution />
      <SecuredToast />
      <HandoffCurtain />
    </div>
  );
}
