/**
 * turnSummary.ts — plain-language "what just happened" lines for the resolution
 * recap (pure, testable). Turns the authoritative TurnReport + the dominance diff
 * into short human sentences explaining clashes, secures, and coalition flips —
 * the mechanics new players most often miss.
 *
 * `ownerId` personalizes the owner seat as "You" (null → everyone by name, e.g.
 * multi-human hot-seat). No engine or store coupling beyond the shared types.
 */

import { ALL_STATES } from './statesData';
import type { PlayerState, TurnReport } from './types';

const STATE_NAME: Record<string, string> = Object.fromEntries(
  ALL_STATES.map((s) => [s.id, s.name]),
);

export interface TurnSummaryInput {
  report: TurnReport;
  prevDominance: Record<string, string | null>;
  dominance: Record<string, string | null>;
  players: PlayerState[];
  /** Local/owner seat to personalize as "You" (null = name everyone). */
  ownerId: string | null;
}

export function turnSummaryLines({
  report,
  prevDominance,
  dominance,
  players,
  ownerId,
}: TurnSummaryInput): string[] {
  const nameOf = (pid: string | null): string => {
    if (!pid) return 'No one';
    if (pid === ownerId) return 'You';
    return players.find((p) => p.id === pid)?.name ?? 'A rival';
  };
  const targetName = (kind: 'state' | 'national', id: string) =>
    kind === 'state' ? (STATE_NAME[id] ?? id) : id;

  const lines: string[] = [];

  // Newly secured (permanent locks) — the strongest beat, list first.
  for (const ev of report.newlySecured) {
    lines.push(`🔒 ${nameOf(ev.playerId)} called ${targetName(ev.kind, ev.targetId)} — Called for good.`);
  }

  // Coalition dominance flips. Surface the owner's perspective first (a steal that
  // costs the owner a coalition should read as their wallet evaporating, not just
  // the rival's gain), then fall back to whichever side is the news.
  for (const gid of Object.keys(dominance)) {
    const before = prevDominance[gid] ?? null;
    const after = dominance[gid] ?? null;
    if (before === after) continue;
    if (after === ownerId) {
      lines.push(`🏛 You now lead the ${gid} Coalition — backing paid every turn.`);
    } else if (before === ownerId) {
      lines.push(`📉 You lost the ${gid} Coalition — its Reserve collapsed to $0.`);
    } else if (after) {
      lines.push(`🏛 ${nameOf(after)} now leads the ${gid} Coalition — backing paid every turn.`);
    } else if (before) {
      lines.push(`📉 ${nameOf(before)} lost the ${gid} Coalition — its Reserve collapsed to $0.`);
    }
  }

  // Clashes (rungs + cash forfeited by everyone who tied).
  const clashed = [
    ...report.clashedStates.map((s) => STATE_NAME[s] ?? s),
    ...report.clashedNational,
  ];
  if (clashed.length > 0) {
    const shown = clashed.slice(0, 3).join(', ');
    lines.push(`⚠ Campaign Collision in ${shown}${clashed.length > 3 ? '…' : ''} — Campaign Influence and spend burned.`);
  }

  return lines;
}
