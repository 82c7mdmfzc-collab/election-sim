/**
 * MultiplayerMenu — online lobby: create or join a game.
 *
 * Screens:
 *   main         → two big buttons: Create / Join
 *   creating     → host picks ONE candidate + display name + player count
 *   waiting-host → host sees room code + live player list + Start Game button
 *   joining      → guest enters 4-digit room code
 *   picking      → guest picks an available candidate + display name
 *   waiting-guest → guest sees live player list; auto-routes when host starts
 *
 * The Zustand store is NOT touched until the host clicks "Start Game".
 * Until then, all state lives in local React state inside this component.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CANDIDATE_MAP,
  CANDIDATES,
  PLAYER_COLORS,
  isCandidateAvailable,
  type CandidateDef,
} from '../game/candidates';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { notifyError } from '../utils/toast';
import { sanitizeName } from '../utils/sanitize';
import { track } from '../utils/analytics';
import { Portrait } from './Portrait';
import { Avatar } from './Avatar';
import { CandidateStatsModal } from './CandidateStatsModal';
import {
  supabase,
  rpcJoinLobbyPlayer,
  rpcCreateLobby,
  rpcStartGame,
  rpcFindLobbyByCode,
  rpcListPublicLobbies,
  rpcSetLobbyBots,
  type LobbyRow,
} from '../utils/supabaseClient';
import type { BotDifficulty, LobbyGameState, WaitingLobbyState, WaitingPlayer } from '../game/types';

type Screen =
  | 'main'
  | 'creating'
  | 'waiting-host'
  | 'joining'
  | 'picking'
  | 'waiting-guest';

function generateRoomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * A unique-enough player id. Avoids `crypto.randomUUID()`, which only exists in
 * Safari 15.4+ and throws in the iOS 14.0–15.3 WKWebView this app still targets.
 * Uses the random UUID when available, otherwise a timestamp + random fallback.
 */
function randomId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const BOT_DIFFICULTIES: { id: BotDifficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'impossible', label: 'Impossible' },
];

const TIME_OPTIONS: { label: string; value: number | null }[] = [
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '2:00', value: 120 },
  { label: 'Unlimited', value: null },
];

// ── Waiting-room player list (host + guest share this) ───────────────────
function WaitingRoomPlayerList({
  hostId,
  waitingPlayers,
  playerCount,
}: {
  hostId: string;
  waitingPlayers: WaitingPlayer[];
  playerCount: number;
}) {
  return (
    <div className="mp-players">
      {waitingPlayers.map((p) => {
        const cand = CANDIDATE_MAP[p.candidateId];
        return (
          <div key={p.id} className="mp-player-row">
            <span className="mp-player-token">
              <Avatar
                src={cand?.portraitUrl ?? ''}
                initials={p.name.slice(0, 2).toUpperCase()}
                name={cand?.name ?? p.name}
                className="cand-token"
              />
            </span>
            <span className="mp-player-name">{p.name}</span>
            <span className="mp-player-cand">{cand?.name ?? p.candidateId}</span>
            {p.id === hostId && <span className="mp-player-badge">Host</span>}
            {p.isBot && <span className="mp-player-badge">Computer{p.botDifficulty ? ` · ${p.botDifficulty}` : ''}</span>}
          </div>
        );
      })}
      {Array.from({ length: Math.max(0, playerCount - waitingPlayers.length) }).map((_, i) => (
        <div key={`empty-${i}`} className="mp-player-row mp-player-row--empty">
          Open seat
        </div>
      ))}
    </div>
  );
}

interface Props {
  onBack: () => void;
  onOpenAccount: () => void;
}

export function MultiplayerMenu({ onBack, onOpenAccount }: Props) {
  const setMultiplayerMeta = useGameStore((s) => s.setMultiplayerMeta);
  const syncFromPayload    = useGameStore((s) => s.syncFromPayload);
  // Live game entry — flip viewingGame so App.tsx routes to the board now. (Cold-boot
  // reconnect goes through useSessionRestore, which intentionally does NOT, so a
  // refreshed player lands on Home with an explicit Resume instead.)
  const resumeGame         = useGameStore((s) => s.resumeGame);

  // Online play requires a signed-in account with a claimed permanent username;
  // the username is used as this player's display name in the lobby.
  const guest       = useProfile((s) => s.guest);
  const displayName = useProfile((s) => s.displayName);

  // This device can only field candidates it owns (founding roster + unlocks).
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const availableCandidates = useMemo(
    () => CANDIDATES.filter((c) => isCandidateAvailable(c, unlocked)),
    [unlocked],
  );

  const [screen, setScreen]                 = useState<Screen>('main');
  const [errorMsg, setErrorMsg]             = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);

  // ── Create-flow state ──────────────────────────────────────────────────────
  const [playerCount, setPlayerCount]       = useState(2);
  const [myCandidate, setMyCandidate]       = useState<CandidateDef | null>(null);
  const [botDifficulty, setBotDifficulty]   = useState<BotDifficulty>('medium');
  const [turnTimeLimit, setTurnTimeLimit]   = useState<number | null>(null);

  // Candidate whose "click to see stats" popup is open (null = closed). Mirrors the
  // Shop / Solo / Daily pickers: tap a card → CandidateStatsModal → Choose.
  const [statsModalId, setStatsModalId]     = useState<string | null>(null);

  // ── Shared lobby state (set after create or join) ─────────────────────────
  const [lobby, setLobby]                   = useState<LobbyRow | null>(null);
  const [myPlayerId, setMyPlayerId]         = useState<string | null>(null);
  const [waitingPlayers, setWaitingPlayers] = useState<WaitingPlayer[]>([]);

  // ── Join-flow state ────────────────────────────────────────────────────────
  const [codeInput, setCodeInput]           = useState('');
  const [foundLobby, setFoundLobby]         = useState<LobbyRow | null>(null);
  const [guestCandidate, setGuestCandidate] = useState<CandidateDef | null>(null);
  const [publicLobbies, setPublicLobbies]   = useState<LobbyRow[]>([]);
  const [loadingPublic, setLoadingPublic]   = useState(false);

  // Stable ref to screen for use inside Realtime callbacks
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // ── Realtime: shared for both waiting screens ─────────────────────────────
  useEffect(() => {
    if (!lobby || (screen !== 'waiting-host' && screen !== 'waiting-guest')) return;

    const channel = supabase
      .channel(`lobby-wait:${lobby.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lobbies',
          filter: `id=eq.${lobby.id}`,
        },
        (payload) => {
          const row = payload.new as LobbyRow;

          // Update the live player list for both host and guest
          const gs = row.game_state as WaitingLobbyState | null;
          if (gs?.players) {
            setWaitingPlayers(gs.players);
            setPlayerCount(gs.playerCount);
          }

          // Guest: when game starts, sync payload → App.tsx routes to GameShell
          if (
            row.status === 'in_progress' &&
            row.game_state &&
            screenRef.current === 'waiting-guest' &&
            myPlayerId
          ) {
            const fullGs = row.game_state as LobbyGameState;
            setMultiplayerMeta({
              lobbyId: row.id,
              localPlayerId: myPlayerId,
              hostPlayerId: fullGs.hostPlayerId,
            });
            syncFromPayload(fullGs);
            resumeGame();
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobby?.id, screen]);

  // ── CREATE: insert waiting lobby ──────────────────────────────────────────
  async function createRoom(isPublic: boolean) {
    if (!myCandidate || !displayName) return;
    setLoading(true);
    setErrorMsg(null);

    const hostId = randomId();
    const hostPlayer: WaitingPlayer = {
      id: hostId,
      candidateId: myCandidate.id,
      name: sanitizeName(displayName),
      isHost: true,
    };
    const waitingState: WaitingLobbyState = {
      playerCount,
      hostPlayerId: hostId,
      players: [hostPlayer],
    };

    let data: LobbyRow;
    try {
      data = await rpcCreateLobby({
        roomCode: generateRoomCode(),
        isPublic,
        playerCount,
        gameState: waitingState,
      });
    } catch (e) {
      setLoading(false);
      setErrorMsg(`Could not create room: ${(e as Error)?.message ?? 'unknown error'}`);
      track('online_match_failed', { reason: 'create_lobby', visibility: isPublic ? 'public' : 'private' });
      return;
    }

    setLoading(false);

    AudioManager.play('confirm');
    track('lobby_created', {
      visibility: isPublic ? 'public' : 'private',
      player_count: playerCount,
      candidate_id: myCandidate.id,
    });
    setMyPlayerId(hostId);
    setLobby(data);
    setWaitingPlayers([hostPlayer]);
    setMultiplayerMeta({
      lobbyId: data.id,
      localPlayerId: hostId,
      hostPlayerId: hostId,
    });
    setScreen('waiting-host');
  }

  // ── HOST: start the game ──────────────────────────────────────────────────
  async function startGame() {
    if (!lobby || !myPlayerId) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const gameState = await rpcStartGame(lobby.id, turnTimeLimit);
      syncFromPayload(gameState);
      resumeGame();
    } catch (e) {
      setLoading(false);
      setErrorMsg(`Could not start game: ${(e as Error).message}`);
      track('online_match_failed', { reason: 'start_game' });
      return;
    }

    setLoading(false);
    AudioManager.play('confirm');
    // App.tsx detects phase='PLANNING' and routes to GameShell
  }

  // ── JOIN: look up lobby by room code ──────────────────────────────────────
  async function findRoom() {
    const code = codeInput.trim();
    if (code.length !== 4) return;
    setLoading(true);
    setErrorMsg(null);

    let data: LobbyRow | null;
    try {
      data = await rpcFindLobbyByCode(code);
    } catch {
      setLoading(false);
      setErrorMsg('Room not found or game already started.');
      track('online_match_failed', { reason: 'find_lobby' });
      return;
    }
    setLoading(false);

    if (!data) {
      setErrorMsg('Room not found or game already started.');
      track('online_match_failed', { reason: 'find_lobby_empty' });
      return;
    }

    AudioManager.play('click');
    setFoundLobby(data);
    setScreen('picking');
  }

  // ── JOIN: list open public games ──────────────────────────────────────────
  async function loadPublicLobbies() {
    setLoadingPublic(true);
    try {
      const data = await rpcListPublicLobbies();
      setPublicLobbies(data);
    } catch {
      track('online_match_failed', { reason: 'list_public_lobbies' });
      notifyError('Could not load public games. Check your connection and try again.');
    } finally {
      setLoadingPublic(false);
    }
  }

  // Auto-load the public list whenever the join screen opens. Deferred to a
  // macrotask so the load's setState doesn't run synchronously inside the effect
  // (which would trigger a cascading render).
  useEffect(() => {
    if (screen !== 'joining') return;
    const id = window.setTimeout(() => void loadPublicLobbies(), 0);
    return () => window.clearTimeout(id);
  }, [screen]);

  // ── JOIN: pick a public game from the list ────────────────────────────────
  function openPublicLobby(row: LobbyRow) {
    AudioManager.play('click');
    setErrorMsg(null);
    setFoundLobby(row);
    setScreen('picking');
  }

  // ── JOIN: claim a slot and enter waiting room ─────────────────────────────
  async function joinRoom() {
    if (!foundLobby || !guestCandidate || !displayName) return;
    setLoading(true);
    setErrorMsg(null);

    const guestId = randomId();
    const hostPlayerId =
      (foundLobby.game_state as WaitingLobbyState)?.hostPlayerId ?? '';
    const guestPlayer: WaitingPlayer = {
      id: guestId,
      candidateId: guestCandidate.id,
      name: sanitizeName(displayName),
      isHost: false,
    };

    try {
      await rpcJoinLobbyPlayer(foundLobby.id, guestPlayer);
    } catch (e) {
      setLoading(false);
      setErrorMsg(`Could not join: ${(e as Error).message}`);
      track('online_match_failed', { reason: 'join_lobby', visibility: foundLobby.is_public ? 'public' : 'private' });
      return;
    }

    setLoading(false);
    AudioManager.play('confirm');
    track('lobby_joined', {
      visibility: foundLobby.is_public ? 'public' : 'private',
      candidate_id: guestCandidate.id,
      occupied_seats: ((foundLobby.game_state as WaitingLobbyState)?.players?.length ?? 0) + 1,
      player_count: (foundLobby.game_state as WaitingLobbyState)?.playerCount ?? 0,
    });

    setMyPlayerId(guestId);
    setLobby(foundLobby);
    const existing = (foundLobby.game_state as WaitingLobbyState)?.players ?? [];
    setPlayerCount((foundLobby.game_state as WaitingLobbyState)?.playerCount ?? playerCount);
    setWaitingPlayers([...existing, guestPlayer]);
    setMultiplayerMeta({ lobbyId: foundLobby.id, localPlayerId: guestId, hostPlayerId });
    setScreen('waiting-guest');
  }

  async function replaceBots(nextBots: WaitingPlayer[]) {
    if (!lobby) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const row = await rpcSetLobbyBots(lobby.id, nextBots);
      const gs = row.game_state as WaitingLobbyState;
      setLobby(row);
      setWaitingPlayers(gs.players ?? []);
      AudioManager.play('confirm');
    } catch (e) {
      setErrorMsg(`Could not update bots: ${(e as Error).message}`);
      track('online_match_failed', { reason: 'set_lobby_bots' });
    } finally {
      setLoading(false);
    }
  }

  function addBotSeat() {
    const existing = waitingPlayers;
    if (existing.length >= playerCount) return;
    const taken = new Set(existing.map((p) => p.candidateId));
    const candidate = CANDIDATES.find((c) => !taken.has(c.id));
    if (!candidate) return;
    const bots = existing.filter((p) => p.isBot);
    void replaceBots([
      ...bots,
      {
        id: randomId(),
        candidateId: candidate.id,
        name: `AI_${bots.length + 1}`,
        isHost: false,
        isBot: true,
        botDifficulty,
      },
    ]);
  }

  function removeBotSeat(botId: string) {
    void replaceBots(waitingPlayers.filter((p) => p.isBot && p.id !== botId));
  }

  // ── Candidate IDs already claimed in the found lobby ─────────────────────
  const claimedCandidateIds = new Set(
    (foundLobby?.game_state as WaitingLobbyState)?.players?.map((p) => p.candidateId) ?? [],
  );

  const statsCandidate = statsModalId ? CANDIDATE_MAP[statsModalId] ?? null : null;

  // Stats popup shared by the host (creating) and guest (picking) pickers — same
  // CandidateStatsModal the Solo / Daily / local pickers use, so the action is
  // "Choose" (or "Taken" for a candidate another player already claimed).
  function renderStatsModal() {
    if (!statsCandidate) return null;
    const close = () => setStatsModalId(null);
    if (screen === 'picking') {
      const taken = claimedCandidateIds.has(statsCandidate.id);
      const chosen = guestCandidate?.id === statsCandidate.id;
      return (
        <CandidateStatsModal
          candidate={statsCandidate}
          actionLabel={taken ? 'Taken' : chosen ? 'Your pick ✓' : 'Choose'}
          actionDisabled={taken || chosen}
          onAction={() => { AudioManager.play('confirm'); setGuestCandidate(statsCandidate); close(); }}
          onClose={close}
          subtext={taken ? 'Another player has already claimed this candidate.' : undefined}
        />
      );
    }
    const chosen = myCandidate?.id === statsCandidate.id;
    return (
      <CandidateStatsModal
        candidate={statsCandidate}
        actionLabel={chosen ? 'Your pick ✓' : 'Choose'}
        actionDisabled={chosen}
        onAction={() => { AudioManager.play('confirm'); setMyCandidate(statsCandidate); close(); }}
        onClose={close}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // Gate: online play requires a signed-in account with a claimed username.
  if (guest || !displayName) {
    return (
      <div className="setup native-screen mp-screen mp-screen--gate">
        <div className="setup__header">
          <h1 className="setup__title">Play Online</h1>
        </div>
        <div className="mp-wait">
          <p className="mp-wait__hint">
            {guest
              ? 'Sign in to host or join online games. Your account also keeps your Campaign Funds, unlocks, and record synced across devices.'
              : 'Choose your permanent username to play online.'}
          </p>
          <button type="button" className="setup__start" style={{ marginTop: '1rem' }} onClick={onOpenAccount}>
            {guest ? 'Sign In' : 'Choose Username'}
          </button>
          <button type="button" className="mp-back" onClick={onBack}>← Back</button>
        </div>
      </div>
    );
  }

  if (screen === 'main') {
    return (
      <div className="setup native-screen mp-screen mp-screen--main">
        <div className="setup__header">
          <h1 className="setup__title">Play Online</h1>
        </div>
        <div className="mp-choice">
          <button type="button" className="setup__start" onClick={() => setScreen('creating')}>
            Host a Game
          </button>
          <button
            type="button"
            className="setup__start"
            style={{ opacity: 0.85 }}
            onClick={() => setScreen('joining')}
          >
            Join a Game
          </button>
        </div>
        <div className="setup__foot"><button type="button" className="mp-back" onClick={onBack}>← Back</button></div>
      </div>
    );
  }

  if (screen === 'creating') {
    return (
      <div className="setup native-screen mp-screen mp-screen--creating">
        <div className="setup__header">
          <h1 className="setup__title">Host a Game</h1>
          <div className="mp-host-controls">
            <div className="setup__count">
              <span>Players</span>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`setup__count-btn${playerCount === n ? ' is-active' : ''}`}
                  onClick={() => { AudioManager.play('click'); setPlayerCount(n); }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="setup__count setup__timelimit">
              <span>Turn Time</span>
              {TIME_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={`setup__count-btn${turnTimeLimit === o.value ? ' is-active' : ''}`}
                  onClick={() => { AudioManager.play('click'); setTurnTimeLimit(o.value); }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="cand-select-body">
          <p className="shop__sub cand-select-body__hint">Tap a candidate to review their bonuses, then choose.</p>
          <div className="shop__grid shop-rail">
            {availableCandidates.map((c) => {
              const chosen = myCandidate?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`shop-card${chosen ? ' is-owned' : ''}`}
                  style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                  onClick={() => { AudioManager.play('click'); setStatsModalId(c.id); }}
                >
                  <div className="shop-card__top">
                    <Portrait className="shop-card__portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                    <div>
                      <span className="shop-card__name">{c.name}</span>
                      <span className="shop-card__tag">{c.tagline}</span>
                    </div>
                  </div>
                  <div className="shop-card__foot">
                    {chosen && <div className="shop-card__owned">Your pick ✓</div>}
                    <span className="shop-card__stats-hint">View stats ›</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mp-hint">Playing as <strong>@{displayName}</strong></p>

        {errorMsg && <p className="mp-error">{errorMsg}</p>}

        <div className="setup__foot">
          <button
            type="button"
            className="setup__start"
            disabled={!myCandidate || loading}
            onClick={() => createRoom(false)}
          >
            {loading ? 'Creating…' : 'Create Private Game'}
          </button>
          <button
            type="button"
            className="setup__start"
            style={{ opacity: 0.8, marginTop: '0.5rem' }}
            disabled={!myCandidate || loading}
            onClick={() => createRoom(true)}
          >
            Create Public Game
          </button>
          <button type="button" className="mp-back" onClick={() => setScreen('main')}>← Back</button>
        </div>
        {renderStatsModal()}
      </div>
    );
  }

  if (screen === 'waiting-host' && lobby) {
    const hostId   = (lobby.game_state as WaitingLobbyState)?.hostPlayerId ?? '';
    const canStart = waitingPlayers.length >= playerCount;
    const canAddBot = waitingPlayers.length < playerCount;
    const botSeats = waitingPlayers.filter((p) => p.isBot);

    return (
      <div className="setup native-screen mp-screen mp-screen--waiting">
        <div className="setup__header">
          <h1 className="setup__title">Waiting for players to join…</h1>
        </div>
        <div className="mp-wait">
          <div className="mp-wait__code-label">Your room code</div>
          <div className="mp-wait__code">{lobby.room_code}</div>
          <p className="mp-wait__hint">Share this code with friends — they each join on their own device.</p>
          <WaitingRoomPlayerList hostId={hostId} waitingPlayers={waitingPlayers} playerCount={playerCount} />
          <div className="mp-bot-panel">
            <div className="mp-bot-panel__head">
              <span>Computer Seats</span>
              <strong>{botSeats.length}/{Math.max(0, playerCount - 1)}</strong>
            </div>
            <div className="mp-bot-panel__controls">
              <div className="mp-bot-difficulty" role="radiogroup" aria-label="Bot difficulty">
                {BOT_DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`mp-bot-difficulty__btn${botDifficulty === d.id ? ' is-active' : ''}`}
                    onClick={() => { AudioManager.play('click'); setBotDifficulty(d.id); }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mp-bot-add"
                disabled={!canAddBot || loading}
                onClick={addBotSeat}
              >
                {canAddBot ? 'Add Computer' : 'Lobby Full'}
              </button>
            </div>
            {botSeats.length > 0 && (
              <div className="mp-bot-list">
                {botSeats.map((b) => {
                  const cand = CANDIDATE_MAP[b.candidateId];
                  return (
                    <div key={b.id} className="mp-bot-chip">
                      <span className="mp-bot-chip__avatar">
                        <Avatar
                          src={cand?.portraitUrl ?? ''}
                          initials="AI"
                          name={cand?.name ?? b.candidateId}
                          className="cand-token"
                        />
                      </span>
                      <span className="mp-bot-chip__text">
                        <strong>{cand?.name ?? b.candidateId}</strong>
                        <em>{b.botDifficulty ?? 'medium'}</em>
                      </span>
                      <button
                        type="button"
                        className="mp-bot-chip__remove"
                        aria-label={`Remove ${cand?.name ?? 'computer seat'}`}
                        onClick={() => removeBotSeat(b.id)}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {errorMsg && <p className="mp-error">{errorMsg}</p>}
          <button
            type="button"
            className="setup__start"
            style={{ marginTop: '1.5rem' }}
            disabled={!canStart || loading}
            onClick={startGame}
          >
            {loading
              ? 'Starting…'
              : canStart
              ? 'Start the Game'
              : `Waiting for ${playerCount - waitingPlayers.length} more player(s)…`}
          </button>
          <button type="button" className="mp-back" onClick={onBack}>← Leave</button>
        </div>
      </div>
    );
  }

  if (screen === 'joining') {
    return (
      <div className="setup native-screen mp-screen mp-screen--joining">
        <div className="setup__header">
          <h1 className="setup__title">Join a Game</h1>
        </div>
        <div className="mp-join">
          <p className="mp-join__hint">Got a code? Enter it below</p>
          <div className="mp-join__row">
            <input
              className="mp-join__input"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1234"
              maxLength={4}
              inputMode="numeric"
              onKeyDown={(e) => { if (e.key === 'Enter') void findRoom(); }}
            />
            <button
              type="button"
              className="setup__start"
              disabled={codeInput.length !== 4 || loading}
              onClick={() => void findRoom()}
            >
              {loading ? 'Looking…' : 'Join Game'}
            </button>
          </div>
          {errorMsg && <p className="mp-error">{errorMsg}</p>}

          <div className="mp-public">
            <div className="mp-public__head">
              <span className="mp-public__title">Open public games</span>
              <button
                type="button"
                className="mp-public__refresh"
                onClick={() => { AudioManager.play('click'); void loadPublicLobbies(); }}
                disabled={loadingPublic}
              >
                {loadingPublic ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>

            {publicLobbies.length === 0 ? (
              <p className="mp-join__hint">
                {loadingPublic ? 'Looking for games…' : 'No public games right now — host one or join with a code.'}
              </p>
            ) : (
              <ul className="mp-public__list">
                {publicLobbies.map((row) => {
                  const gs = row.game_state as WaitingLobbyState | null;
                  const here = gs?.players?.length ?? 0;
                  const max  = gs?.playerCount ?? 0;
                  const full = max > 0 && here >= max;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="mp-public__row"
                        disabled={full}
                        onClick={() => openPublicLobby(row)}
                      >
                        <span className="mp-public__code">Room {row.room_code}</span>
                        <span className="mp-public__count">{here}/{max} players</span>
                        <span className="mp-public__cta">{full ? 'Full' : 'Join →'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <button type="button" className="mp-back" onClick={() => setScreen('main')}>← Back</button>
        </div>
      </div>
    );
  }

  if (screen === 'picking' && foundLobby) {
    const existingPlayers =
      (foundLobby.game_state as WaitingLobbyState)?.players ?? [];

    return (
      <div className="setup native-screen mp-screen mp-screen--picking">
        <div className="setup__header">
          <h1 className="setup__title">Room {foundLobby.room_code}</h1>
        </div>
        <div className="cand-select-body">
        {existingPlayers.length > 0 && (
          <div className="mp-existing-players" aria-label="Players already in this room">
            <span className="mp-existing-players__label">Already here</span>
            {existingPlayers.map((p) => {
              const c = CANDIDATE_MAP[p.candidateId];
              return (
                <div key={p.id} className="mp-player-row">
                  {c?.portraitUrl && (
                    <img src={c.portraitUrl} className="cand-token mp-player-token" alt={c.name} loading="lazy" decoding="async" />
                  )}
                  <span className="mp-player-name">{p.name}</span>
                  <span className="mp-player-cand">{c?.name ?? p.candidateId}</span>
                  {p.isHost && <span className="mp-player-badge">Host</span>}
                </div>
              );
            })}
          </div>
        )}

        <p className="shop__sub cand-select-body__hint">Tap a candidate to review their bonuses, then choose. Greyed-out candidates are already taken.</p>
        <div className="shop__grid shop-rail">
          {availableCandidates.map((c) => {
            const taken  = claimedCandidateIds.has(c.id);
            const chosen = guestCandidate?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`shop-card${chosen ? ' is-owned' : ''}${taken ? ' is-locked' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                onClick={() => { AudioManager.play('click'); setStatsModalId(c.id); }}
              >
                <div className="shop-card__top">
                  <Portrait className="shop-card__portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                  <div>
                    <span className="shop-card__name">{c.name}</span>
                    <span className="shop-card__tag">{taken ? 'Taken' : c.tagline}</span>
                  </div>
                </div>
                <div className="shop-card__foot">
                  {taken
                    ? <span className="shop-card__price">Taken</span>
                    : chosen ? <div className="shop-card__owned">Your pick ✓</div> : null}
                  <span className="shop-card__stats-hint">View stats ›</span>
                </div>
              </button>
            );
          })}
        </div>
        </div>

        <p className="mp-hint">Playing as <strong>@{displayName}</strong></p>

        {errorMsg && <p className="mp-error">{errorMsg}</p>}

        <div className="setup__foot">
          <button
            type="button"
            className="setup__start"
            disabled={!guestCandidate || loading}
            onClick={() => void joinRoom()}
          >
            {loading ? 'Joining…' : 'Join Game'}
          </button>
          <button
            type="button"
            className="mp-back"
            onClick={() => {
              setScreen('joining');
              setFoundLobby(null);
              setGuestCandidate(null);
            }}
          >
            ← Use a different code
          </button>
        </div>
        {renderStatsModal()}
      </div>
    );
  }

  if (screen === 'waiting-guest' && lobby) {
    const hostId = (lobby.game_state as WaitingLobbyState)?.hostPlayerId ?? '';
    return (
      <div className="setup native-screen mp-screen mp-screen--waiting">
        <div className="setup__header">
          <h1 className="setup__title">Waiting for the host…</h1>
        </div>
        <div className="mp-wait">
          <div className="mp-wait__code-label">Your room code</div>
          <div className="mp-wait__code">{lobby.room_code}</div>
          <p className="mp-wait__hint">Sit tight — the game starts when the host is ready.</p>
          <WaitingRoomPlayerList hostId={hostId} waitingPlayers={waitingPlayers} playerCount={playerCount} />
          <button type="button" className="mp-back" style={{ marginTop: '1.5rem' }} onClick={onBack}>
            ← Leave
          </button>
        </div>
      </div>
    );
  }

  return null;
}
