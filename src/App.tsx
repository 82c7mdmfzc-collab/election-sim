/**
 * Prototype wire-up: the candidate bar + one row per mock state. All game logic
 * lives in the store/engine; this component is purely presentational layout.
 */

import './App.css';
import { CandidateBar } from './components/CandidateBar';
import { StateRow } from './components/StateRow';
import { MOCK_STATES } from './game/mockData';
import { useGameStore } from './game/store';

function App() {
  const reset = useGameStore((s) => s.reset);

  return (
    <div className="app">
      <h1 className="app__title">270 — Election Simulator (Prototype)</h1>
      <CandidateBar />

      <main className="state-list">
        {MOCK_STATES.map((state) => (
          <StateRow key={state.id} state={state} />
        ))}
      </main>

      <button type="button" className="app__reset" onClick={reset}>
        Reset game
      </button>
    </div>
  );
}

export default App;
