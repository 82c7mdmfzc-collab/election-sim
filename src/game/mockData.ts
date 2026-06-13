/**
 * Compatibility re-export layer.
 *
 * All components and the Zustand store import { MOCK_CANDIDATES, MOCK_STATES,
 * createInitialGameState } from this file. Those names are preserved here so
 * nothing else needs to change. The actual data now lives in statesData.ts.
 *
 * To remove the "mock" naming entirely, update the imports in:
 *   src/components/CandidateBar.tsx  (MOCK_CANDIDATES)
 *   src/components/StateRow.tsx      (MOCK_CANDIDATES)
 *   src/App.tsx                      (MOCK_STATES)
 *   src/game/store.ts                (createInitialGameState)
 * then delete this file.
 */

export {
  ALL_CANDIDATES as MOCK_CANDIDATES,
  ALL_STATES as MOCK_STATES,
  createInitialGameState,
} from './statesData';
