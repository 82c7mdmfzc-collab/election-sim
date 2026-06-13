import './App.css';
import { CandidateBar } from './components/CandidateBar';
import { ElectionMap, ElectionOverlay } from './components/ElectionMap';
import { GameOver } from './components/GameOver';
import { useGameStore } from './game/store';

function App() {
  const phase = useGameStore((s) => s.phase);
  const reset = useGameStore((s) => s.reset);

  if (phase === 'GAME_OVER') return <GameOver />;

  return (
    <div className="app">
      <h1 className="app__title">270 — Election Simulator</h1>
      <CandidateBar />
      {phase === 'ELECTION' ? <ElectionOverlay /> : <ElectionMap />}
      {phase !== 'ELECTION' && (
        <button type="button" className="app__reset" onClick={reset}>
          Reset game
        </button>
      )}
    </div>
  );
}

export default App;
