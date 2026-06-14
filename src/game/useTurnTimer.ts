/**
 * useTurnTimer — drives the per-turn countdown during the PLANNING phase.
 *
 * The authoritative value is an absolute deadline timestamp (`turnDeadline`,
 * epoch ms) held in the store. This hook ticks a local clock, derives the
 * remaining time, and when it hits 0 auto-fires `submitTurn()` for the active
 * player — committing whatever allocations they currently have pending.
 *
 * Pausing for the hot-seat HandoffCurtain is coordinated through the shared
 * `handoffAckKey`: while the curtain is up the deadline is cleared, and the
 * "Ready" button (acknowledgeHandoff) re-arms a fresh full-duration deadline.
 *
 * Server-authority seam: the only time source is `turnDeadline - Date.now()`.
 * To go server-authoritative later, have the server set `turnDeadline`; the
 * tick, the MM:SS display, the urgency pulse, and the expiry auto-submit below
 * all keep working unchanged.
 *
 * IMPORTANT: mount exactly one instance (in GameShell) so the auto-submit fires
 * once. Do not call this hook in more than one live component.
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from './store';
import { AudioManager } from '../utils/audioManager';

const URGENT_THRESHOLD_SEC = 10;
const TICK_MS = 250;

export interface TurnTimerState {
  /** Whole seconds remaining, clamped >= 0; null when no active timer. */
  remainingSec: number | null;
  /** "MM:SS" or null. */
  display: string | null;
  /** remainingSec != null && remainingSec < 10 — drives the red pulse. */
  isUrgent: boolean;
  /** true while paused by the HandoffCurtain. */
  isPaused: boolean;
  /** true when a finite limit is configured and we're in PLANNING. */
  isActive: boolean;
}

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function useTurnTimer(): TurnTimerState {
  const phase = useGameStore((s) => s.phase);
  const turn = useGameStore((s) => s.turn);
  const activePlayerIndex = useGameStore((s) => s.activePlayerIndex);
  const turnTimeLimit = useGameStore((s) => s.turnTimeLimit);
  const turnDeadline = useGameStore((s) => s.turnDeadline);
  const handoffAckKey = useGameStore((s) => s.handoffAckKey);
  const armTurnDeadline = useGameStore((s) => s.armTurnDeadline);
  const pauseTurnDeadline = useGameStore((s) => s.pauseTurnDeadline);
  const submitTurn = useGameStore((s) => s.submitTurn);

  const [now, setNow] = useState(() => Date.now());

  // Mirror of HandoffCurtain's needCurtain so the two agree exactly on pause.
  const curtainShowing =
    phase === 'PLANNING' &&
    activePlayerIndex > 0 &&
    handoffAckKey !== `${turn}:${activePlayerIndex}`;

  // ── Arm / pause the deadline as the turn state changes ──────────────────────
  useEffect(() => {
    if (phase !== 'PLANNING' || turnTimeLimit == null) {
      // Non-PLANNING or Unlimited: ensure no stale deadline lingers.
      if (turnDeadline !== null) pauseTurnDeadline();
      return;
    }
    if (curtainShowing) {
      if (turnDeadline !== null) pauseTurnDeadline();
      return;
    }
    // PLANNING, finite limit, curtain down: arm if not already armed. (After a
    // "Ready" ack the deadline is already set, so this guard leaves it alone.)
    if (turnDeadline == null) armTurnDeadline();
  }, [
    phase,
    turn,
    activePlayerIndex,
    turnTimeLimit,
    curtainShowing,
    turnDeadline,
    armTurnDeadline,
    pauseTurnDeadline,
  ]);

  // ── Tick while a deadline is live ───────────────────────────────────────────
  // The deferred (timeout 0) update snaps `now` to the present the moment a fresh
  // deadline is armed — without it the display could briefly reflect a stale
  // `now` from a previous turn. setState happens in callbacks, never synchronously
  // in the effect body.
  useEffect(() => {
    if (turnDeadline == null) return;
    const immediate = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearTimeout(immediate);
      clearInterval(id);
    };
  }, [turnDeadline]);

  // ── Auto-submit on expiry (fire once per turn/player) ───────────────────────
  const firedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'PLANNING' || turnDeadline == null) return;
    if (Date.now() < turnDeadline) return;
    const key = `${turn}:${activePlayerIndex}`;
    if (firedForRef.current === key) return;
    firedForRef.current = key;
    submitTurn();
  }, [now, phase, turn, activePlayerIndex, turnDeadline, submitTurn]);

  // ── Derive the public state ─────────────────────────────────────────────────
  const isActive = phase === 'PLANNING' && turnTimeLimit != null;
  const remainingMs = turnDeadline == null ? null : Math.max(0, turnDeadline - now);
  const remainingSec = remainingMs == null ? null : Math.ceil(remainingMs / 1000);

  // ── Tick sound: fire once when urgency kicks in (exactly 10s remaining) ─────
  const tickFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (remainingSec !== URGENT_THRESHOLD_SEC) return;
    const key = `${turn}:${activePlayerIndex}`;
    if (tickFiredRef.current === key) return;
    tickFiredRef.current = key;
    AudioManager.play('tick', true);
  }, [remainingSec, turn, activePlayerIndex]);

  // ── Stop tick on pause, expiry, or phase change ───────────────────────────
  useEffect(() => {
    if (!isActive || curtainShowing || remainingSec === 0) AudioManager.stop('tick');
  }, [isActive, curtainShowing, remainingSec]);

  // ── Stop tick on unmount (component removed from tree) ────────────────────
  useEffect(() => () => AudioManager.stop('tick'), []);

  return {
    remainingSec,
    display: remainingSec == null ? null : formatClock(remainingSec),
    isUrgent: remainingSec != null && remainingSec < URGENT_THRESHOLD_SEC,
    isPaused: isActive && curtainShowing,
    isActive,
  };
}
