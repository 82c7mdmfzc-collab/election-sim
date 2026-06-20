/**
 * useBotDriver — drives computer-controlled seats in Solo mode.
 *
 * Mounted once in GameShell. When it's a bot seat's turn during PLANNING, it
 * waits a short "thinking" beat, asks bot.ts for a plan, and applies it through
 * the SAME store actions a human uses (allocate → submitTurn). No special
 * resolution path — computer opponents play by the identical rules.
 *
 * The per-seat key (`turn:index`) plus setting the guard inside the timeout makes
 * this fire exactly once per bot turn, even under React StrictMode double-invoke.
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import { planBotTurn } from '../game/bot';

export function useBotDriver(): void {
  const phase = useGameStore((s) => s.phase);
  const activePlayerIndex = useGameStore((s) => s.activePlayerIndex);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const turn = useGameStore((s) => s.turn);
  const players = useGameStore((s) => s.players);
  const playedRef = useRef<string>('');

  useEffect(() => {
    if (multiplayerMode !== 'single' || phase !== 'PLANNING') return;
    const active = players.filter((p) => !p.eliminated)[activePlayerIndex];
    if (!active?.isBot) return;

    const key = `${turn}:${activePlayerIndex}`;
    if (playedRef.current === key) return;

    // A brief, slightly random delay so the bot's turn reads as deliberate.
    const delay = 700 + Math.random() * 600;
    const timer = window.setTimeout(() => {
      const store = useGameStore.getState();
      const cur = store.players.filter((p) => !p.eliminated)[store.activePlayerIndex];
      // Re-verify it's still this exact bot's turn before acting.
      if (store.phase !== 'PLANNING' || !cur?.isBot || cur.id !== active.id) return;
      playedRef.current = key;

      const moves = planBotTurn(store, active.id, active.botDifficulty ?? 'medium');
      for (const m of moves) store.allocate(m.kind, m.targetId, m.rungs);
      store.submitTurn();
    }, delay);

    return () => clearTimeout(timer);
  }, [phase, activePlayerIndex, multiplayerMode, turn, players]);
}
