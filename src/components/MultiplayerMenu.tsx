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
import { playerFromCandidate } from '../game/statesData';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { sanitizeName } from '../utils/sanitize';
import { Portrait } from './Portrait';
import { Avatar } from './Avatar';
import { PartyBadge } from './PartyBadge';
import {
  supabase,
  rpcJoinLobbyPlayer,
  rpcCreateLobby,
  rpcStartGame,
  type LobbyRow,
} from '../utils/supabaseClient';
import { ModifierSheet } from './ModifierSheet';
import type { LobbyGameState, WaitingLobbyState, WaitingPlayer } from '../game/types';

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
                src={cand?.tokenUrl ?? ''}
                initials={p.name.slice(0, 2).toUpperCase()}
                name={cand?.name ?? p.name}
                className="cand-token"
              />
            </span>
            <span className="mp-player-name">{p.name}</span>
            <span className="mp-player-cand">{cand?.name ?? p.candidateId}</span>
            {p.id === hostId && <span className="mp-player-badge">Host</span>}
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
  const initOnlineGame     = useGameStore((s) => s.initOnlineGame);

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
          if (gs?.players) setWaitingPlayers(gs.players);

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

    const hostId = crypto.randomUUID();
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
      return;
    }

    setLoading(false);

    AudioManager.play('confirm');
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

    // Build PlayerState[] from the confirmed waiting room player list
    const players = waitingPlayers.map((wp) => {
      const cand = CANDIDATE_MAP[wp.candidateId];
      if (!cand) throw new Error(`Unknown candidateId: ${wp.candidateId}`);
      return playerFromCandidate(cand, { id: wp.id, name: wp.name });
    });

    // Initialize game in the store — sets phase='PLANNING' which routes to GameShell
    initOnlineGame(players);

    // Snapshot the freshly-initialized state to push to Supabase
    const snap = useGameStore.getState();
    const gameState: LobbyGameState = {
      turn: snap.turn,
      seqCounter: snap.seqCounter,
      players: snap.players,
      rungs: snap.rungs,
      natRungs: snap.natRungs,
      reachSeq: snap.reachSeq,
      natReachSeq: snap.natReachSeq,
      securedBy: snap.securedBy,
      natSecuredBy: snap.natSecuredBy,
      stateGroupDominance: snap.stateGroupDominance,
      hungColleges: snap.hungColleges,
      phase: 'PLANNING',
      activePlayerIndex: 0,
      electionResult: null,
      lastIncome: Object.fromEntries(snap.players.map((p) => [p.id, 0])),
      lastTurnReport: null,
      prevDominance: snap.stateGroupDominance,
      electionTallyProgress: 0,
      hostPlayerId: myPlayerId,
      submittedPlayers: [],
      pendingSubmissions: {},
      turnDeadlineUtc: snap.turnDeadline,
      turnTimeLimitSec: snap.turnTimeLimit,
    };

    try {
      await rpcStartGame(lobby.id, gameState);
    } catch (e) {
      setLoading(false);
      setErrorMsg(`Could not start game: ${(e as Error).message}`);
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

    const { data, error } = await supabase
      .from('lobbies')
      .select('*')
      .eq('room_code', code)
      .eq('status', 'waiting')
      .single();

    setLoading(false);

    if (error || !data) {
      setErrorMsg('Room not found or game already started.');
      return;
    }

    AudioManager.play('click');
    setFoundLobby(data as LobbyRow);
    setScreen('picking');
  }

  // ── JOIN: list open public games ──────────────────────────────────────────
  async function loadPublicLobbies() {
    setLoadingPublic(true);
    const { data, error } = await supabase
      .from('lobbies')
      .select('*')
      .eq('status', 'waiting')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(20);
    setLoadingPublic(false);
    if (!error && data) setPublicLobbies(data as LobbyRow[]);
  }

  // Auto-load the public list whenever the join screen opens.
  useEffect(() => {
    if (screen === 'joining') void loadPublicLobbies();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const guestId = crypto.randomUUID();
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
      return;
    }

    setLoading(false);
    AudioManager.play('confirm');

    setMyPlayerId(guestId);
    setLobby(foundLobby);
    const existing = (foundLobby.game_state as WaitingLobbyState)?.players ?? [];
    setWaitingPlayers([...existing, guestPlayer]);
    setMultiplayerMeta({ lobbyId: foundLobby.id, localPlayerId: guestId, hostPlayerId });
    setScreen('waiting-guest');
  }

  // ── Candidate IDs already claimed in the found lobby ─────────────────────
  const claimedCandidateIds = new Set(
    (foundLobby?.game_state as WaitingLobbyState)?.players?.map((p) => p.candidateId) ?? [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // Gate: online play requires a signed-in account with a claimed username.
  if (guest || !displayName) {
    return (
      <div className="setup">
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
      <div className="setup">
        <div className="setup__header">
          <h1 className="setup__title">Play Online</h1>
        </div>
        <div
          className="setup__foot"
          style={{ gap: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
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
          <button type="button" className="mp-back" onClick={onBack}>← Back</button>
        </div>
      </div>
    );
  }

  if (screen === 'creating') {
    return (
      <div className="setup">
        <div className="setup__header">
          <h1 className="setup__title">Host a Game</h1>
          <div className="setup__count">
            <span>How many players?</span>
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
        </div>

        <p className="mp-hint">Choose your candidate</p>

        <div className="setup__roster">
          {availableCandidates.map((c) => {
            const chosen = myCandidate?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`cand-card${chosen ? ' is-assigned' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                onClick={() => { AudioManager.play('click'); setMyCandidate(c); }}
              >
                <div className="cand-card__top">
                  <div className="cand-portrait-wrap">
                    <Portrait className="cand-portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                  </div>
                  <div className="cand-card__id">
                    <span className="cand-card__name">{c.name}</span>
                    <span className="cand-card__tag">{c.tagline}</span>
                    <PartyBadge party={c.party} className="cand-card__party" />
                  </div>
                  {chosen && <span className="cand-card__seat">You</span>}
                </div>
                <div className="cand-card__cash">${c.startingCash}k starting cash</div>
                <ModifierSheet affinities={c.affinities} payoutModifiers={c.payoutModifiers} compact />
              </button>
            );
          })}
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
      </div>
    );
  }

  if (screen === 'waiting-host' && lobby) {
    const hostId   = (lobby.game_state as WaitingLobbyState)?.hostPlayerId ?? '';
    const canStart = waitingPlayers.length >= playerCount;

    return (
      <div className="setup">
        <div className="setup__header">
          <h1 className="setup__title">Waiting for players to join…</h1>
        </div>
        <div className="mp-wait">
          <div className="mp-wait__code-label">Your room code</div>
          <div className="mp-wait__code">{lobby.room_code}</div>
          <p className="mp-wait__hint">Share this code with friends — they each join on their own device.</p>
          <WaitingRoomPlayerList hostId={hostId} waitingPlayers={waitingPlayers} playerCount={playerCount} />
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
      <div className="setup">
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
      <div className="setup">
        <div className="setup__header">
          <h1 className="setup__title">Room {foundLobby.room_code}</h1>
        </div>
        {existingPlayers.length > 0 && (
          <div className="mp-wait" style={{ marginBottom: '1rem' }}>
            <p className="mp-wait__hint" style={{ marginBottom: '0.5rem' }}>Already here:</p>
            {existingPlayers.map((p) => {
              const c = CANDIDATE_MAP[p.candidateId];
              return (
                <div key={p.id} className="mp-player-row">
                  {c?.tokenUrl && (
                    <img src={c.tokenUrl} className="cand-token mp-player-token" alt={c.name} loading="lazy" decoding="async" />
                  )}
                  <span className="mp-player-name">{p.name}</span>
                  <span className="mp-player-cand">{c?.name ?? p.candidateId}</span>
                  {p.isHost && <span className="mp-player-badge">Host</span>}
                </div>
              );
            })}
          </div>
        )}

        <p className="mp-hint">Choose your candidate</p>
        <div className="setup__roster">
          {availableCandidates.map((c) => {
            const taken  = claimedCandidateIds.has(c.id);
            const chosen = guestCandidate?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`cand-card${chosen ? ' is-assigned' : ''}${taken ? ' is-disabled' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                disabled={taken}
                onClick={() => { if (!taken) { AudioManager.play('click'); setGuestCandidate(c); } }}
              >
                <div className="cand-card__top">
                  <div className="cand-portrait-wrap">
                    <Portrait className="cand-portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                  </div>
                  <div className="cand-card__id">
                    <span className="cand-card__name">{c.name}</span>
                    <span className="cand-card__tag">{taken ? 'Taken' : c.tagline}</span>
                    <PartyBadge party={c.party} className="cand-card__party" />
                  </div>
                  {chosen && <span className="cand-card__seat">You</span>}
                </div>
                <div className="cand-card__cash">${c.startingCash}k starting cash</div>
                <ModifierSheet affinities={c.affinities} payoutModifiers={c.payoutModifiers} compact />
              </button>
            );
          })}
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
      </div>
    );
  }

  if (screen === 'waiting-guest' && lobby) {
    const hostId = (lobby.game_state as WaitingLobbyState)?.hostPlayerId ?? '';
    return (
      <div className="setup">
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
