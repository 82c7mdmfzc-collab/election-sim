import type { ElectoralResult, PlayerId, RungMap, StateId, US_State } from './types';

export type TallyHighlightReason =
  | 'tipping_point'
  | 'top_prize'
  | 'runner_up_hold'
  | 'close_battleground'
  | 'map_anchor';

export interface TallyHighlight {
  state: US_State;
  winnerId: PlayerId | null;
  margin: number;
  reason: TallyHighlightReason;
}

const MAX_HIGHLIGHTS = 7;

function rungMargin(stateId: StateId, rungs: RungMap): number {
  const scores = Object.values(rungs[stateId] ?? {}).sort((a, b) => b - a);
  if (scores.length === 0) return 0;
  return scores[0] - (scores[1] ?? 0);
}

function makeHighlight(
  state: US_State,
  result: ElectoralResult,
  rungs: RungMap,
  reason: TallyHighlightReason,
): TallyHighlight {
  return {
    state,
    winnerId: result.stateLeaders[state.id] ?? null,
    margin: rungMargin(state.id, rungs),
    reason,
  };
}

function addUnique(
  highlights: TallyHighlight[],
  next: TallyHighlight | null | undefined,
) {
  if (!next || highlights.some((h) => h.state.id === next.state.id)) return;
  highlights.push(next);
}

function topByEv(states: US_State[]): US_State[] {
  return [...states].sort((a, b) => b.electoralVotes - a.electoralVotes || a.name.localeCompare(b.name));
}

function closestStates(states: US_State[], rungs: RungMap): US_State[] {
  return [...states].sort((a, b) => {
    const marginA = rungMargin(a.id, rungs);
    const marginB = rungMargin(b.id, rungs);
    return marginA - marginB || b.electoralVotes - a.electoralVotes || a.name.localeCompare(b.name);
  });
}

function tippingPointState(states: readonly US_State[], result: ElectoralResult): US_State | null {
  const winnerId = result.winner;
  if (!winnerId) return null;

  let running = 0;
  for (const state of topByEv(states.filter((s) => result.stateLeaders[s.id] === winnerId))) {
    running += state.electoralVotes;
    if (running >= 270) return state;
  }
  return null;
}

export function buildTallyHighlights(
  states: readonly US_State[],
  result: ElectoralResult | null,
  rungs: RungMap,
): TallyHighlight[] {
  if (!result) return [];

  const highlights: TallyHighlight[] = [];
  const stateList = [...states];
  const winnerId = result.winner;
  const rankedPlayers = Object.entries(result.evByPlayer).sort((a, b) => b[1] - a[1]);
  const runnerUpId = rankedPlayers.find(([id]) => id !== winnerId)?.[0] ?? null;
  const tipping = tippingPointState(stateList, result);
  const winnerStates = winnerId ? stateList.filter((s) => result.stateLeaders[s.id] === winnerId) : [];
  const runnerStates = runnerUpId ? stateList.filter((s) => result.stateLeaders[s.id] === runnerUpId) : [];
  const contestedStates = stateList.filter((s) => result.stateLeaders[s.id] != null);

  for (const state of closestStates(winnerStates, rungs).slice(0, 2)) {
    addUnique(highlights, makeHighlight(state, result, rungs, 'close_battleground'));
  }

  for (const state of topByEv(contestedStates).slice(0, 2)) {
    addUnique(highlights, makeHighlight(state, result, rungs, 'top_prize'));
  }

  addUnique(highlights, runnerStates.length > 0
    ? makeHighlight(topByEv(runnerStates)[0], result, rungs, 'runner_up_hold')
    : null);

  for (const state of closestStates(contestedStates, rungs)) {
    if (highlights.length >= MAX_HIGHLIGHTS - (tipping ? 1 : 0)) break;
    addUnique(highlights, makeHighlight(state, result, rungs, 'close_battleground'));
  }

  for (const state of topByEv(contestedStates)) {
    if (highlights.length >= MAX_HIGHLIGHTS - (tipping ? 1 : 0)) break;
    addUnique(highlights, makeHighlight(state, result, rungs, 'map_anchor'));
  }

  if (tipping) {
    const withoutTipping = highlights.filter((h) => h.state.id !== tipping.id).slice(0, MAX_HIGHLIGHTS - 1);
    return [...withoutTipping, makeHighlight(tipping, result, rungs, 'tipping_point')];
  }

  return highlights.slice(0, MAX_HIGHLIGHTS);
}

export function buildFinalTallySnapshot(
  states: readonly US_State[],
  result: ElectoralResult | null,
): {
  revealedIds: Set<StateId>;
  evTotals: Record<PlayerId, number>;
} {
  return {
    revealedIds: new Set(states.map((s) => s.id)),
    evTotals: result ? { ...result.evByPlayer } : {},
  };
}

export function tallyHighlightLabel(reason: TallyHighlightReason): string {
  switch (reason) {
    case 'tipping_point':
      return 'Path to 270';
    case 'top_prize':
      return 'Major Prize';
    case 'runner_up_hold':
      return 'Runner-Up Hold';
    case 'close_battleground':
      return 'Battleground';
    case 'map_anchor':
      return 'Map Anchor';
  }
}
