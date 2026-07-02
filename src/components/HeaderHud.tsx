/**
 * HeaderHud — the global player status bar (top of the tactical layout).
 *
 * Shows every active player side-by-side with a high-visibility portrait,
 * projected/secured Electoral Votes, and National Cash. The round number sits
 * on the left. Clicking a player's cash opens the segmented WalletDrawer.
 */

import { useEffect, useRef, useState } from 'react';
import { CANDIDATE_MAP } from '../game/candidates';
import { electionProbability } from '../game/config';
import {
  useElectoralResult,
  useGameStore,
  usePlayerColors,
  useSecuredEVs,
} from '../game/store';
import type { ResolvedColor } from '../game/colors';
import type { PlayerState } from '../game/types';
import type { TurnTimerState } from '../game/useTurnTimer';
import { AudioManager } from '../utils/audioManager';
import { WalletDrawer } from './WalletDrawer';
import { PlayerProfileModal } from './PlayerProfileModal';
import { HelpButton } from './HelpButton';
import { MuteButton } from './MuteButton';
import { Avatar } from './Avatar';
import { useProfile } from '../hooks/useProfile';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { CloseIcon } from './icons';

interface PlayerHudCardProps {
  player: PlayerState;
  isActive: boolean;
  isLeader: boolean;
  projectedEV: number;
  income: number;
  displayCash: number;
  reserves: number;
  color?: ResolvedColor;
  borderId: string;
  walletOpen: boolean;
  onToggleWallet: () => void;
  onClickName: () => void;
}

function PlayerHudCard({ player, isActive, isLeader, projectedEV, income, displayCash, reserves, color, borderId, walletOpen, onToggleWallet, onClickName }: PlayerHudCardProps) {
  const securedEV = useSecuredEVs(player.id);
  const portraitUrl = CANDIDATE_MAP[player.candidateId]?.portraitUrl ?? '';
  const fallback = player.name.slice(0, 2).toUpperCase();
  const animatedCash = useAnimatedNumber(displayCash);

  // Flash the cash chip when the balance drops (a purchase drew from it).
  const prevCash = useRef(displayCash);
  const [spendFlash, setSpendFlash] = useState(false);
  useEffect(() => {
    if (displayCash < prevCash.current) {
      setSpendFlash(true);
      const t = setTimeout(() => setSpendFlash(false), 500);
      prevCash.current = displayCash;
      return () => clearTimeout(t);
    }
    prevCash.current = displayCash;
  }, [displayCash]);

  return (
    <div
      className={[
        'hud-card',
        isActive ? 'hud-card--active' : '',
        isLeader ? 'hud-card--leader' : '',
        player.eliminated ? 'hud-card--out' : '',
        walletOpen ? 'hud-card--wallet-open' : '',
      ].filter(Boolean).join(' ')}
      style={{ ['--p-color' as string]: color?.hex ?? '#64748b' }}
    >
      <div className="hud-card__portrait">
        <Avatar src={portraitUrl} initials={fallback} name={player.name} borderId={borderId} className="cand-token" />
      </div>
      <div className="hud-card__body">
        <div
          className="hud-card__name"
          role="button"
          tabIndex={0}
          onClick={onClickName}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClickName(); }}
          title="View player profile"
        >
          {player.name}
          {isActive && <span className="hud-card__turn">YOUR TURN</span>}
          {player.eliminated && <span className="hud-card__turn hud-card__turn--out">OUT</span>}
        </div>
        <div className="hud-card__ev">
          <strong>{projectedEV}</strong><span className="hud-card__ev-target"> / 270 EV</span>
          {securedEV > 0 && <span className="hud-card__secured">⬛ {securedEV}</span>}
        </div>
        <div className="hud-card__ev-bar">
          <div
            className="hud-card__ev-fill"
            style={{ width: `${Math.min(projectedEV / 270 * 100, 100)}%`, background: color?.hex ?? 'var(--muted)' }}
          />
        </div>
        <button
          type="button"
          className={`hud-card__cash${spendFlash ? ' hud-card__cash--spend' : ''}`}
          onClick={onToggleWallet}
          title="Show State Group Wallets"
        >
          ${animatedCash.toFixed(0)}k
          {income !== 0 && (
            <span className={`hud-card__income ${income > 0 ? 'up' : 'down'}`}>
              {income > 0 ? '+' : ''}{income}k
            </span>
          )}
          {reserves > 0 && (
            <span
              className="hud-card__reserves"
              title="Coalition wallet reserves — extra cash this player can spend in those states. Tap for the breakdown."
            >
              +${reserves.toFixed(0)}k banked
              <span className="hud-card__reserves-info" aria-hidden>ⓘ</span>
            </span>
          )}
          <span className="hud-card__chev">{walletOpen ? '▴' : '▾'}</span>
        </button>
      </div>
    </div>
  );
}

export function HeaderHud({ timer }: { timer: TurnTimerState }) {
  const players = useGameStore((s) => s.players);
  const turn = useGameStore((s) => s.turn);
  const phase = useGameStore((s) => s.phase);
  const activeIndex = useGameStore((s) => s.activePlayerIndex);
  const hungColleges = useGameStore((s) => s.hungColleges);
  const electionScheduled = useGameStore((s) => s.electionScheduled);
  const lastIncome = useGameStore((s) => s.lastIncome);
  const workingCash = useGameStore((s) => s.workingCash);
  const abortGame = useGameStore((s) => s.abortGame);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const myBorder = useProfile((s) => s.profile.selectedBorder);
  const result = useElectoralResult();
  const colors = usePlayerColors();
  const [openWallet, setOpenWallet] = useState<string | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<string | null>(null);

  const active = players.filter((p) => !p.eliminated);
  const activePlayerId = active[activeIndex]?.id ?? null;

  let leaderId: string | null = null;
  let leaderEV = -1;
  for (const p of active) {
    const ev = result.evByPlayer[p.id] ?? 0;
    if (ev > leaderEV) { leaderEV = ev; leaderId = p.id; }
  }

  const showIncome = phase === 'RESOLUTION';
  const openColor = openWallet ? colors[openWallet] : undefined;

  // Coalition-wallet reserves per player (national cash is shown separately). This
  // surfaces an opponent's hidden war chest: cash banked in group wallets they can
  // still spend in those coalitions' states. Uses live working cash during planning.
  const reservesFor = (p: PlayerState): number => {
    const wallets =
      (phase === 'PLANNING' ? workingCash[p.id]?.groupWallets : undefined) ?? p.groupWallets;
    return Object.values(wallets ?? {}).reduce((a, b) => a + b, 0);
  };
  const electionPct = Math.round(electionProbability(turn, hungColleges) * 100);

  return (
    <header className="header-hud">
      <div className="header-hud__bar">
        <div className="header-hud__brand">
          <span className="header-hud__wordmark">Elect<span className="header-hud__wordmark-o">o</span>r</span>
          <span className="header-hud__round">
            Round {turn}
            {hungColleges > 0 && <span className="header-hud__hung"> · {hungColleges} hung</span>}
          </span>
        </div>
        <span className="header-hud__target" title="First to 270 electoral votes wins the election">
          Victory Target <strong>270 EV</strong>
        </span>
        {(electionScheduled || electionPct > 0) && (
          <span className={`hud__elect-pill${electionScheduled || electionPct >= 50 ? ' is-high' : ''}`}>
            ⚡ {electionScheduled ? 'Election after this round' : `Election roll ${electionPct}%`}
          </span>
        )}
        {timer.isActive && timer.display && (
          <div
            className={[
              'header-hud__timer',
              timer.isUrgent ? 'is-urgent' : '',
              timer.isPaused ? 'is-paused' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="header-hud__timer-clock">{timer.display}</span>
          </div>
        )}
        <div className="header-hud__players">
          {players.map((p) => (
            <PlayerHudCard
              key={p.id}
              player={p}
              isActive={phase === 'PLANNING' && p.id === activePlayerId}
              isLeader={p.id === leaderId && leaderEV > 0}
              projectedEV={result.evByPlayer[p.id] ?? 0}
              income={showIncome ? (lastIncome[p.id] ?? 0) : 0}
              displayCash={phase === 'PLANNING' ? (workingCash[p.id]?.nationalCash ?? p.nationalCash) : p.nationalCash}
              reserves={reservesFor(p)}
              color={colors[p.id]}
              borderId={p.id === localPlayerId ? myBorder : 'classic'}
              walletOpen={openWallet === p.id}
              onToggleWallet={() => { AudioManager.play('click'); setOpenWallet((cur) => (cur === p.id ? null : p.id)); }}
              onClickName={() => { AudioManager.play('click'); setProfilePlayer(p.id); }}
            />
          ))}
        </div>
        <MuteButton />
        <HelpButton />
        <button
          type="button"
          className="header-hud__abort"
          onClick={() => { AudioManager.play('confirm'); abortGame(); }}
          title="Abort game and return to menu"
        >
          <CloseIcon size={14} /> Abort
        </button>
      </div>

      {openWallet && (
        <WalletDrawer
          playerId={openWallet}
          color={openColor}
          onClose={() => setOpenWallet(null)}
        />
      )}

      {profilePlayer && (
        <PlayerProfileModal
          playerId={profilePlayer}
          onClose={() => setProfilePlayer(null)}
        />
      )}
    </header>
  );
}
