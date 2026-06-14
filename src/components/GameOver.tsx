import { useGameStore } from '../game/store';
import { ALL_STATES } from '../game/statesData';

export function GameOver() {
  const electionResult = useGameStore((s) => s.electionResult);
  const players = useGameStore((s) => s.players);
  const turn = useGameStore((s) => s.turn);
  const securedBy = useGameStore((s) => s.securedBy);
  const reset = useGameStore((s) => s.reset);

  const winner = electionResult?.winner
    ? players.find((p) => p.id === electionResult.winner)
    : null;
  const winnerEVs = winner ? (electionResult?.evByPlayer[winner.id] ?? 0) : 0;

  return (
    <div className="game-over">
      <div className="game-over__inner">
        <div className="game-over__label">FINAL RESULTS</div>

        {winner ? (
          <>
            <h1 className="game-over__winner-name">{winner.name}</h1>
            <div className="game-over__ev-count">{winnerEVs} Electoral Votes</div>
          </>
        ) : (
          <h1 className="game-over__winner-name">Election Complete</h1>
        )}

        <div className="game-over__turn">Decided in {turn} turns</div>

        <div className="game-over__breakdown">
          {players.map((p) => {
            const evs = electionResult?.evByPlayer[p.id] ?? 0;
            const secured = ALL_STATES.filter((st) => securedBy[st.id] === p.id);
            const securedEVs = secured.reduce((s, st) => s + st.electoralVotes, 0);

            return (
              <div
                key={p.id}
                className={`game-over__candidate${p.eliminated ? ' game-over__candidate--eliminated' : p.id === winner?.id ? ' game-over__candidate--winner' : ''}`}
              >
                <div className="game-over__cname">
                  {p.name}
                  {p.eliminated && <span className="game-over__elim-badge"> (eliminated)</span>}
                </div>
                <div className="game-over__cevs">{evs} EV total</div>
                <div className="game-over__csecured">
                  {securedEVs > 0
                    ? `${securedEVs} EV secured (${secured.map((s) => s.id).join(', ')})`
                    : 'No states secured'}
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" className="game-over__btn" onClick={reset}>
          Play Again
        </button>
      </div>
    </div>
  );
}
