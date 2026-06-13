import { useGameStore } from '../game/store';

export function GameOver() {
  const electionResult = useGameStore((s) => s.electionResult);
  const candidates = useGameStore((s) => s.candidates);
  const turn = useGameStore((s) => s.turn);
  const securedBy = useGameStore((s) => s.securedBy);
  const states = useGameStore((s) => s.states);
  const eliminatedCandidates = useGameStore((s) => s.eliminatedCandidates);
  const reset = useGameStore((s) => s.reset);

  const winner = electionResult?.winner
    ? candidates.find((c) => c.id === electionResult.winner)
    : null;
  const winnerEVs = winner ? (electionResult?.evByCandidate[winner.id] ?? 0) : 0;

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
          {candidates.map((c) => {
            const evs = electionResult?.evByCandidate[c.id] ?? 0;
            const isEliminated = eliminatedCandidates.includes(c.id);
            const secured = states.filter((st) => securedBy[st.id] === c.id);
            const securedEVs = secured.reduce((s, st) => s + st.electoralVotes, 0);

            return (
              <div
                key={c.id}
                className={`game-over__candidate${isEliminated ? ' game-over__candidate--eliminated' : c.id === winner?.id ? ' game-over__candidate--winner' : ''}`}
              >
                <div className="game-over__cname">
                  {c.name}
                  {isEliminated && (
                    <span className="game-over__elim-badge"> (eliminated)</span>
                  )}
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
