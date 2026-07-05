import { useMemo, useState } from 'react';
import { CANDIDATE_MAP, groupImageUrl } from '../game/candidates';
import { STATE_GROUPS, groupDisplayName } from '../game/config';
import { groupDominanceProgress } from '../game/engine';
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
import { ConfirmDialog } from './ConfirmDialog';
import { HelpButton } from './HelpButton';
import { SfxVolumeBar, MusicVolumeBar } from './MuteButton';
import { PlayerProfileModal } from './PlayerProfileModal';
import { Portrait } from './Portrait';
import { ResolutionRecap } from './PhaseFooter';
import { Sidebar } from './Sidebar';
import { WalletDrawer } from './WalletDrawer';
import { CloseIcon } from './icons';
import { Sheet } from './ui/Sheet';

type NativeSheet = 'national' | 'state' | 'options' | 'wallet' | null;

interface NativeGameHudProps {
  timer: TurnTimerState;
  highlightedGroupId: string | null;
  onHighlightGroup: (id: string | null) => void;
}

function phaseLabel(phase: string): string {
  if (phase === 'PLANNING') return 'Your turn';
  if (phase === 'RESOLUTION') return 'Turn results';
  if (phase === 'ELECTION') return 'Election';
  return phase;
}

function NativeTurnButton() {
  const phase = useGameStore((s) => s.phase);
  const players = useGameStore((s) => s.players);
  const activeIndex = useGameStore((s) => s.activePlayerIndex);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const submittedPlayers = useGameStore((s) => s.submittedPlayers);
  const submitTurn = useGameStore((s) => s.submitTurn);
  const pending = useActivePending();
  const [confirming, setConfirming] = useState(false);

  const active = players.filter((p) => !p.eliminated);
  const isLast = activeIndex >= active.length - 1;
  const alreadySubmitted =
    multiplayerMode === 'online' &&
    !!localPlayerId &&
    submittedPlayers.includes(localPlayerId);

  function doSubmit() {
    setConfirming(false);
    AudioManager.play('confirm');
    submitTurn();
  }

  // Guard a fat-finger: confirm only when ending a turn with no moves queued.
  function attempt() {
    if (alreadySubmitted) return;
    if (pending.length === 0) { setConfirming(true); return; }
    doSubmit();
  }

  if (phase === 'RESOLUTION') return null;

  return (
    <>
      <button
        type="button"
        className={`native-turn-button${pending.length > 0 ? ' native-turn-button--armed' : ''}`}
        data-tut="end-turn"
        disabled={alreadySubmitted}
        onClick={attempt}
      >
        <span className="native-turn-button__label">
          {multiplayerMode === 'online'
            ? (alreadySubmitted ? 'Wait' : 'End')
            : (isLast ? 'Resolve' : 'End')}
        </span>
        {pending.length > 0 && (
          <span className="native-turn-button__count" aria-label={`${pending.length} moves queued`}>
            {pending.length}
          </span>
        )}
      </button>
      {confirming && (
        <ConfirmDialog
          message="End your turn without campaigning? You still have funds to spend."
          confirmLabel="End turn"
          cancelLabel="Keep planning"
          onConfirm={doSubmit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function NativeTopRibbon({ timer, onOptions }: {
  timer: TurnTimerState;
  onOptions: () => void;
}) {
  const turn = useGameStore((s) => s.turn);
  const phase = useGameStore((s) => s.phase);
  const hungColleges = useGameStore((s) => s.hungColleges);
  const electionScheduled = useGameStore((s) => s.electionScheduled);
  const tickerDone = useGameStore((s) => s.resolutionTickerDone);
  const abortGame = useGameStore((s) => s.abortGame);
  const result = useElectoralResult();
  const pending = useActivePending();

  const leaderEV = Math.max(0, ...Object.values(result.evByPlayer));
  // The "tap a state" prompt guides only until the first move is queued; after
  // that the queued chips in the dock carry the state, so drop the extra layer.
  const showInstruction =
    (phase === 'PLANNING' && pending.length === 0) || (phase === 'RESOLUTION' && !tickerDone);
  const instruction =
    phase === 'RESOLUTION'
      ? 'Reviewing moves'
      : phase === 'PLANNING'
        ? 'Tap a state to spend funds'
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

      <div className="native-game-ribbon" aria-label="Turn status">
        <div className="native-game-ribbon__brand">
          <strong>Elector</strong>
          <span>270 to win</span>
        </div>
        <div className="native-game-ribbon__center">
          <span className="native-game-ribbon__turn">Turn {turn}</span>
          <span className="native-game-ribbon__clock">
            {timer.display ?? `${leaderEV}`.padStart(3, '0')}
          </span>
          {hungColleges > 0 && <span className="native-game-ribbon__hung">{hungColleges} hung</span>}
        </div>
        <div className="native-game-ribbon__phase">
          {electionScheduled && phase === 'PLANNING' ? 'Election after this round' : phaseLabel(phase)}
        </div>
      </div>
      <NativeTurnButton />
      {showInstruction && (
        <div className="native-game-instruction">{instruction}</div>
      )}
    </>
  );
}

function NativeActionStack({ onOpen }: { onOpen: (sheet: NativeSheet) => void }) {
  return (
    <div className="native-action-stack" data-tut="explore" aria-label="Game menus">
      <button type="button" className="native-round-action" onClick={() => onOpen('national')}>
        <span>National</span>
      </button>
      <button type="button" className="native-round-action" onClick={() => onOpen('state')}>
        <span>Coalitions</span>
      </button>
    </div>
  );
}

function NativePlayerTray({
  onOpenProfile,
  onOpenWallet,
}: {
  onOpenProfile: (playerId: string) => void;
  onOpenWallet: () => void;
}) {
  const phase = useGameStore((s) => s.phase);
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

  if (!activePlayer || !candidate || phase !== 'PLANNING') return null;

  return (
    <div className="native-player-dock">
      <div className="native-opponent-chips">
        {opponents.map((p) => {
          const c = CANDIDATE_MAP[p.candidateId];
          return (
            <button
              type="button"
              key={p.id}
              className="native-opponent-chip native-opponent-chip--avatar"
              style={{ ['--p-color' as string]: colors[p.id]?.hex }}
              onClick={() => { AudioManager.play('click'); onOpenProfile(p.id); }}
              title={`${p.name} · ${result.evByPlayer[p.id] ?? 0} EV`}
              aria-label={`View ${p.name}`}
            >
              <Portrait
                className="native-opponent-chip__portrait"
                src={c?.portraitUrl ?? ''}
                initials={c?.portrait ?? p.name.slice(0, 2)}
                name={p.name}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="native-active-tray"
        style={{ ['--p-color' as string]: colors[activePlayer.id]?.hex }}
        onClick={(e) => {
          AudioManager.play('click');
          if ((e.target as HTMLElement).closest('.native-active-tray__cash')) {
            onOpenWallet();
          } else {
            onOpenProfile(activePlayer.id);
          }
        }}
        title={`View ${activePlayer.name}`}
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
        <div
          className="native-active-tray__cash"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            AudioManager.play('click');
            onOpenWallet();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              AudioManager.play('click');
              onOpenWallet();
            }
          }}
        >
          <span>{activePlayer.name}</span>
          <strong>${cash.toFixed(0)}k</strong>
          {totalCommitted > 0 && <em>${totalCommitted.toFixed(0)}k queued</em>}
        </div>
      </button>

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
              title={`Tap to clear ${tid}`}
            >
              <span className="native-alloc-chip__x" aria-hidden>×</span>
              {tid} +{item.rungs} · ${item.cost.toFixed(0)}k
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function NativeStateGroupProgressList({
  highlightedGroupId,
  onHighlightGroup,
}: {
  highlightedGroupId: string | null;
  onHighlightGroup: (id: string | null) => void;
}) {
  const allPlayers = useGameStore((s) => s.players);
  const rungs = useGameStore((s) => s.rungs);
  const reachSeq = useGameStore((s) => s.reachSeq);
  const dominance = useGameStore((s) => s.stateGroupDominance);
  const activePlayer = useActivePlayer();
  const colors = usePlayerColors();
  const groupWallets = useGameStore((s) =>
    activePlayer
      ? (s.workingCash[activePlayer.id]?.groupWallets ?? activePlayer.groupWallets)
      : null,
  );

  const activePlayers = allPlayers.filter((p) => !p.eliminated);

  return (
    <div className="native-sg-progress-list">
      {STATE_GROUPS.map((group) => {
        const { evByPlayer, totalEV } = groupDominanceProgress(group, rungs, reachSeq, activePlayers);
        const neededEV = Math.floor(totalEV / 2) + 1;
        const dominantId = dominance[group.id] ?? null;
        const topEV = Math.max(0, ...activePlayers.map((player) => evByPlayer[player.id] ?? 0));
        const active = highlightedGroupId === group.id;
        const displayName = groupDisplayName(group);

        return (
          <button
            key={group.id}
            type="button"
            className={`native-sg-row${active ? ' is-active' : ''}`}
            onClick={() => onHighlightGroup(active ? null : group.id)}
          >
            <span className="native-sg-row__icon-wrap" aria-hidden>
              <img
                className="native-sg-row__icon"
                src={groupImageUrl('state', group.id)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.removeAttribute('hidden');
                }}
              />
              <span className="native-sg-row__icon-fallback" hidden>{group.id.slice(0, 2).toUpperCase()}</span>
            </span>
            <span className="native-sg-row__name">{displayName}</span>
            <span className="native-sg-row__cash">+${group.bonusPayout}k/turn</span>
            <strong className="native-sg-row__wallet">${(groupWallets?.[group.id] ?? 0).toFixed(0)}k</strong>
            <span className="native-sg-row__track" aria-hidden>
              {activePlayers.map((player) => {
                const ev = evByPlayer[player.id] ?? 0;
                const pct = neededEV > 0 ? Math.min(100, (ev / neededEV) * 100) : 0;
                const hex = colors[player.id]?.hex ?? 'var(--muted)';
                return (
                  <span
                    key={player.id}
                    className="native-sg-row__player-bar"
                    title={`${player.name}: ${ev}/${neededEV} EV`}
                  >
                    <span
                      className="native-sg-row__player-fill"
                      style={{ width: `${pct}%`, background: hex }}
                    />
                  </span>
                );
              })}
            </span>
            <span className="native-sg-row__ev">
              {dominantId ? 'Dominant' : `${topEV}/${neededEV} EV`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NativeGameSheet({
  sheet,
  onClose,
  highlightedGroupId,
  onHighlightGroup,
  walletPlayerId,
}: {
  sheet: NativeSheet;
  onClose: () => void;
  highlightedGroupId: string | null;
  onHighlightGroup: (id: string | null) => void;
  walletPlayerId: string | null;
}) {
  const abortGame = useGameStore((s) => s.abortGame);
  const colors = usePlayerColors();

  if (!sheet) return null;

  const title = {
    national: 'National Groups',
    state: 'State Coalitions',
    options: 'Options',
    wallet: 'Coalition Reserves',
  }[sheet];

  return (
    <Sheet
      side="bottom"
      onClose={onClose}
      label={title}
      className={`native-game-sheet native-game-sheet--${sheet}`}
      backdropClassName="native-game-sheet-backdrop"
    >
      <div className="native-game-sheet__header">
        <h2>{title}</h2>
        <button type="button" className="native-game-sheet__close" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </div>

        {sheet === 'national' && (
          <div className="native-game-sheet__body">
            <Sidebar />
          </div>
        )}

        {sheet === 'state' && (
          <div className="native-game-sheet__body native-game-sheet__body--state">
            <NativeStateGroupProgressList
              highlightedGroupId={highlightedGroupId}
              onHighlightGroup={(id) => {
                AudioManager.play('click');
                onHighlightGroup(id);
              }}
            />
          </div>
        )}

        {sheet === 'wallet' && walletPlayerId && (
          <div className="native-game-sheet__body native-game-sheet__body--wallet">
            <WalletDrawer
              playerId={walletPlayerId}
              color={colors[walletPlayerId]}
              onClose={onClose}
            />
          </div>
        )}

        {sheet === 'options' && (
          <div className="native-game-sheet__body native-game-options">
            <SfxVolumeBar />
            <MusicVolumeBar />
            <div className="native-game-options__row">
              <HelpButton />
              <button type="button" className="native-game-options__button" onClick={() => { AudioManager.play('confirm'); abortGame(); }}>
                <CloseIcon size={16} /> Exit Game
              </button>
            </div>
          </div>
        )}
    </Sheet>
  );
}

function NativeResolutionSheet() {
  const phase = useGameStore((s) => s.phase);
  const tickerDone = useGameStore((s) => s.resolutionTickerDone);

  if (phase !== 'RESOLUTION' || !tickerDone) return null;

  return (
    <>
      <div className="native-resolution-backdrop" aria-hidden />
      <section className="native-resolution-sheet" aria-label="Turn results">
        <ResolutionRecap className="resolution--native-sheet" />
      </section>
    </>
  );
}

export function NativeGameHud({ timer, highlightedGroupId, onHighlightGroup }: NativeGameHudProps) {
  const phase = useGameStore((s) => s.phase);
  const isOpeningCampaign = useGameStore((s) => s.isOpeningCampaign);
  const activePlayer = useActivePlayer();
  const [sheet, setSheet] = useState<NativeSheet>(null);
  const [profilePlayerId, setProfilePlayerId] = useState<string | null>(null);

  // Background music is owned globally (started on app launch in App), so the
  // in-game HUD no longer starts/stops it — it just plays continuously and is
  // controlled via the Music dial in the options sheet.

  function openSheet(next: NativeSheet) {
    AudioManager.play('click');
    setSheet((current) => (current === next ? null : next));
  }

  function closeSheet() {
    AudioManager.play('quit');
    setSheet(null);
  }

  return (
    <div className="native-game-hud native-only">
      <NativeTopRibbon timer={timer} onOptions={() => openSheet('options')} />
      {phase === 'PLANNING' && (
        <>
          {!isOpeningCampaign && (
            <div className="native-coach-banner">
              <CampaignCoach />
            </div>
          )}
          <NativeActionStack onOpen={openSheet} />
          <NativePlayerTray
            onOpenProfile={setProfilePlayerId}
            onOpenWallet={() => openSheet('wallet')}
          />
        </>
      )}
      <NativeResolutionSheet />
      <NativeGameSheet
        sheet={sheet}
        onClose={closeSheet}
        highlightedGroupId={highlightedGroupId}
        onHighlightGroup={onHighlightGroup}
        walletPlayerId={activePlayer?.id ?? null}
      />
      {profilePlayerId && (
        <PlayerProfileModal
          playerId={profilePlayerId}
          onClose={() => setProfilePlayerId(null)}
        />
      )}
    </div>
  );
}
