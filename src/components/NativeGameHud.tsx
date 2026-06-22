import { useEffect, useMemo, useState } from 'react';
import { CANDIDATE_MAP } from '../game/candidates';
import { STATE_GROUPS } from '../game/config';
import {
  useActiveNationalCash,
  useActivePending,
  useActivePlayer,
  useElectoralResult,
  useGameStore,
  usePlayerColors,
} from '../game/store';
import type { TurnTimerState } from '../game/useTurnTimer';
import { AudioManager } from '../utils/audioManager';
import { CampaignCoach } from './CampaignCoach';
import { HelpButton } from './HelpButton';
import { MuteButton } from './MuteButton';
import { Portrait } from './Portrait';
import { Sidebar } from './Sidebar';
import { StateGroupBar } from './StateGroupBar';
import { CloseIcon, HelpIcon } from './icons';

type NativeSheet = 'coach' | 'national' | 'state' | 'options' | null;

interface NativeGameHudProps {
  timer: TurnTimerState;
  highlightedGroupId: string | null;
  onHighlightGroup: (id: string | null) => void;
}

function useResolutionReady(): boolean {
  const phase = useGameStore((s) => s.phase);
  const turn = useGameStore((s) => s.turn);
  const report = useGameStore((s) => s.lastTurnReport);
  const clashCount = (report?.clashedStates.length ?? 0) + (report?.clashedNational.length ?? 0);
  const readyKey = phase === 'RESOLUTION' ? `${turn}:${clashCount}` : null;
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    if (!readyKey) return;
    const t = window.setTimeout(() => setSettledKey(readyKey), clashCount > 0 ? 2700 : 1700);
    return () => window.clearTimeout(t);
  }, [readyKey, clashCount]);

  return !readyKey || settledKey === readyKey;
}

function NativeTurnButton({ ready }: { ready: boolean }) {
  const phase = useGameStore((s) => s.phase);
  const players = useGameStore((s) => s.players);
  const activeIndex = useGameStore((s) => s.activePlayerIndex);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const submittedPlayers = useGameStore((s) => s.submittedPlayers);
  const submitTurn = useGameStore((s) => s.submitTurn);
  const confirmResolution = useGameStore((s) => s.confirmResolution);

  const active = players.filter((p) => !p.eliminated);
  const isLast = activeIndex >= active.length - 1;
  const alreadySubmitted =
    multiplayerMode === 'online' &&
    !!localPlayerId &&
    submittedPlayers.includes(localPlayerId);
  const isHostOrSingle = multiplayerMode === 'single' || localPlayerId === hostPlayerId;

  if (phase === 'RESOLUTION') {
    return (
      <button
        type="button"
        className="native-turn-button"
        disabled={!ready || !isHostOrSingle}
        onClick={() => {
          if (!ready || !isHostOrSingle) return;
          AudioManager.play('confirm');
          confirmResolution();
        }}
      >
        {isHostOrSingle ? (ready ? 'Next' : 'Wait') : 'Host'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="native-turn-button"
      disabled={alreadySubmitted}
      onClick={() => {
        if (alreadySubmitted) return;
        AudioManager.play('confirm');
        submitTurn();
      }}
    >
      {multiplayerMode === 'online'
        ? (alreadySubmitted ? 'Wait' : 'End')
        : (isLast ? 'Resolve' : 'End')}
    </button>
  );
}

function NativeTopRibbon({ timer, ready, onOptions }: {
  timer: TurnTimerState;
  ready: boolean;
  onOptions: () => void;
}) {
  const turn = useGameStore((s) => s.turn);
  const phase = useGameStore((s) => s.phase);
  const hungColleges = useGameStore((s) => s.hungColleges);
  const abortGame = useGameStore((s) => s.abortGame);
  const result = useElectoralResult();

  const leaderEV = Math.max(0, ...Object.values(result.evByPlayer));
  const instruction =
    phase === 'RESOLUTION'
      ? 'Resolving campaign moves'
      : phase === 'PLANNING'
        ? 'Choose states to spend your funds'
        : 'Election in progress';

  return (
    <>
      <button
        type="button"
        className="native-corner native-corner--left"
        onClick={() => { AudioManager.play('confirm'); abortGame(); }}
      >
        Exit
      </button>
      <button
        type="button"
        className="native-corner native-corner--right"
        onClick={onOptions}
      >
        Options
      </button>

      <div className="native-game-ribbon">
        <div className="native-game-ribbon__wing native-game-ribbon__wing--left">
          <span />
          <span className="is-blue" />
          <span />
        </div>
        <div className="native-game-ribbon__center">
          <span className="native-game-ribbon__turn">Turn {turn}</span>
          <span className="native-game-ribbon__clock">
            {timer.display ?? `${leaderEV}`.padStart(3, '0')}
          </span>
          {hungColleges > 0 && <span className="native-game-ribbon__hung">{hungColleges} hung</span>}
        </div>
        <div className="native-game-ribbon__wing native-game-ribbon__wing--right">
          <span />
          <span className="is-blue" />
          <span />
        </div>
      </div>
      <NativeTurnButton ready={ready} />
      <div className="native-game-instruction">{instruction}</div>
    </>
  );
}

function NativeActionStack({ onOpen }: { onOpen: (sheet: NativeSheet) => void }) {
  return (
    <div className="native-action-stack" aria-label="Game menus">
      <button type="button" className="native-round-action native-round-action--gold" onClick={() => onOpen('coach')}>
        <span>Debate</span>
      </button>
      <button type="button" className="native-round-action" onClick={() => onOpen('national')}>
        <span>National<br />Groups</span>
      </button>
      <button type="button" className="native-round-action" onClick={() => onOpen('state')}>
        <span>State<br />Groups</span>
      </button>
    </div>
  );
}

function NativePlayerTray() {
  const players = useGameStore((s) => s.players);
  const activePlayer = useActivePlayer();
  const pending = useActivePending();
  const cash = useActiveNationalCash();
  const result = useElectoralResult();
  const colors = usePlayerColors();
  const cancelAllocation = useGameStore((s) => s.cancelAllocation);

  const active = players.filter((p) => !p.eliminated);
  const opponents = active.filter((p) => p.id !== activePlayer?.id);
  const candidate = activePlayer ? CANDIDATE_MAP[activePlayer.candidateId] : null;
  const totalCommitted = pending.reduce((s, p) => s + p.cost, 0);
  const chips = useMemo(
    () => Object.entries(pending.reduce<Record<string, { kind: 'state' | 'national'; rungs: number; cost: number }>>(
      (acc, p) => {
        if (!acc[p.targetId]) acc[p.targetId] = { kind: p.kind, rungs: 0, cost: 0 };
        acc[p.targetId].rungs += p.rungs;
        acc[p.targetId].cost += p.cost;
        return acc;
      },
      {},
    )),
    [pending],
  );

  if (!activePlayer || !candidate) return null;

  return (
    <div className="native-player-dock">
      <div className="native-opponent-chips">
        {opponents.map((p) => {
          const c = CANDIDATE_MAP[p.candidateId];
          return (
            <div
              key={p.id}
              className="native-opponent-chip"
              style={{ ['--p-color' as string]: colors[p.id]?.hex }}
            >
              <span>{result.evByPlayer[p.id] ?? 0}</span>
              <strong>${p.nationalCash.toFixed(0)}k</strong>
              <Portrait
                className="native-opponent-chip__portrait"
                src={c?.portraitUrl ?? ''}
                initials={c?.portrait ?? p.name.slice(0, 2)}
                name={p.name}
              />
            </div>
          );
        })}
      </div>

      <div
        className="native-active-tray"
        style={{ ['--p-color' as string]: colors[activePlayer.id]?.hex }}
      >
        <div className="native-active-tray__score">
          <strong>{result.evByPlayer[activePlayer.id] ?? 0}</strong>
          <span>Electors</span>
        </div>
        <div className="native-active-tray__portrait">
          <Portrait
            className="native-active-tray__img"
            src={candidate.portraitUrl}
            initials={candidate.portrait}
            name={activePlayer.name}
          />
        </div>
        <div className="native-active-tray__cash">
          <span>{activePlayer.name}</span>
          <strong>${cash.toFixed(0)}k</strong>
          {totalCommitted > 0 && <em>${totalCommitted.toFixed(0)}k queued</em>}
        </div>
      </div>

      <div className="native-alloc-rail" aria-label="Queued allocations">
        {chips.length === 0 ? (
          <span className="native-alloc-empty">Tap a state to campaign</span>
        ) : (
          chips.map(([tid, item]) => (
            <button
              key={tid}
              type="button"
              className="native-alloc-chip"
              onClick={() => { AudioManager.play('quit'); cancelAllocation(item.kind, tid); }}
              title={`Cancel ${tid}`}
            >
              {tid} +{item.rungs} · ${item.cost.toFixed(0)}k
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function NativeGameSheet({
  sheet,
  onClose,
  highlightedGroupId,
  onHighlightGroup,
}: {
  sheet: NativeSheet;
  onClose: () => void;
  highlightedGroupId: string | null;
  onHighlightGroup: (id: string | null) => void;
}) {
  const abortGame = useGameStore((s) => s.abortGame);

  if (!sheet) return null;

  const title = {
    coach: 'Debate Room',
    national: 'National Groups',
    state: 'State Groups',
    options: 'Options',
  }[sheet];

  return (
    <>
      <div className="native-game-sheet-backdrop" onClick={onClose} />
      <section className={`native-game-sheet native-game-sheet--${sheet}`} aria-label={title}>
        <div className="native-game-sheet__header">
          <h2>{title}</h2>
          <button type="button" className="native-game-sheet__close" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        {sheet === 'coach' && (
          <div className="native-game-sheet__body native-game-sheet__body--coach">
            <CampaignCoach />
          </div>
        )}

        {sheet === 'national' && (
          <div className="native-game-sheet__body">
            <Sidebar />
          </div>
        )}

        {sheet === 'state' && (
          <div className="native-game-sheet__body native-game-sheet__body--state">
            <p className="native-game-sheet__hint">
              Highlight a region, then tap states on the map. Dominance pays from group wallets.
            </p>
            <StateGroupBar
              highlightedGroupId={highlightedGroupId}
              onHighlight={(id) => {
                AudioManager.play('click');
                onHighlightGroup(id);
              }}
            />
            <div className="native-state-summary">
              {STATE_GROUPS.map((g) => (
                <span key={g.id}>
                  <strong>{g.id}</strong>
                  {g.totalEV} EV · ${g.bonusPayout}k
                </span>
              ))}
            </div>
          </div>
        )}

        {sheet === 'options' && (
          <div className="native-game-sheet__body native-game-options">
            <div className="native-game-options__row">
              <MuteButton />
              <HelpButton />
              <button type="button" className="native-game-options__button" onClick={() => { AudioManager.play('confirm'); abortGame(); }}>
                <CloseIcon size={16} /> Exit Game
              </button>
            </div>
            <div className="native-game-options__hint">
              <HelpIcon size={16} /> Open groups only when you need them to keep the map clear.
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export function NativeGameHud({ timer, highlightedGroupId, onHighlightGroup }: NativeGameHudProps) {
  const [sheet, setSheet] = useState<NativeSheet>(null);
  const ready = useResolutionReady();

  function openSheet(next: NativeSheet) {
    AudioManager.play('click');
    setSheet((current) => (current === next ? null : next));
  }

  return (
    <div className="native-game-hud native-only">
      <NativeTopRibbon timer={timer} ready={ready} onOptions={() => openSheet('options')} />
      <NativeActionStack onOpen={openSheet} />
      <NativePlayerTray />
      <NativeGameSheet
        sheet={sheet}
        onClose={() => { AudioManager.play('quit'); setSheet(null); }}
        highlightedGroupId={highlightedGroupId}
        onHighlightGroup={onHighlightGroup}
      />
    </div>
  );
}
