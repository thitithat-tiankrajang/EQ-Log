import { LayoutGrid, Play, Trophy, X } from "lucide-react";
import { useId } from "react";
import { getGameMode, otherSide, type EndGameDetail, type GameState } from "../../game";
import { useDialogBehavior } from "../ui/useDialogBehavior";

export function ResultModal({
  game,
  onClose,
  onReplay,
}: {
  game: GameState;
  onClose: () => void;
  onReplay: () => void;
}) {
  const isSolo = getGameMode(game) === "solo";
  const { A, B } = game.scores;
  const endDetail = [...game.logs]
    .reverse()
    .find((log) => log.action === "end_game")?.actionDetail as EndGameDetail | undefined;
  const surrenderedSide = game.matchControl?.surrenderedSide ?? endDetail?.surrenderedSide;
  const winner = isSolo
    ? null
    : surrenderedSide
      ? otherSide(surrenderedSide)
      : A === B
        ? null
        : A > B
          ? "A"
          : "B";
  const winnerName = winner ? game.players[winner] : null;
  const scoreMargin = Math.abs(A - B);
  const turnCount = Math.max(0, game.turnNumber - 1);
  const perfectGame = isSolo && endDetail?.reason === "perfect_game";
  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLElement>({ onClose });
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="result-modal"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head result-modal-head">
          <div>
            <span className="eyebrow">Final Result</span>
            <h2 id={titleId}>{game.name}</h2>
          </div>
          <button className="result-close" type="button" aria-label="Close final result" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={`result-outcome ${isSolo ? "solo" : winner ? `side-${winner.toLowerCase()}` : "draw"}`}>
          <span className="result-outcome-icon" aria-hidden="true">
            <Trophy size={22} />
          </span>
          <div>
            <span>{isSolo ? (perfectGame ? "Perfect Game" : "Solo complete") : winner ? "Match winner" : "Match complete"}</span>
            <strong>{isSolo ? game.players.A : winnerName ?? "Draw"}</strong>
          </div>
          <em>{isSolo ? `${A} pts` : surrenderedSide ? "By surrender" : winner ? `+${scoreMargin} pts` : "Scores tied"}</em>
        </div>

        <div className={`result-body ${isSolo ? "solo" : ""}`}>
          <div className={`result-side side-a ${winner === "A" ? "win" : ""}`}>
            <span className="result-side-label">{isSolo ? "Solo score" : "Side A"}</span>
            <strong>{A}</strong>
            <span className="result-player-name">{game.players.A}</span>
            {winner === "A" && <em>Winner</em>}
            {perfectGame && <em>Perfect Game +100</em>}
          </div>
          {!isSolo && <div className="result-vs">
            <strong>{winner === null ? "=" : "–"}</strong>
            <span>Final</span>
          </div>}
          {!isSolo && <div className={`result-side side-b ${winner === "B" ? "win" : ""}`}>
            <span className="result-side-label">Side B</span>
            <strong>{B}</strong>
            <span className="result-player-name">{game.players.B}</span>
            {winner === "B" && <em>Winner</em>}
          </div>}
        </div>

        <div className="result-meta">
          <span><strong>{turnCount}</strong> turns</span>
          <span><strong>{game.logs.length}</strong> actions</span>
        </div>

        <div className="result-actions">
          <button
            className="primary-action"
            type="button"
            disabled={game.logs.length === 0}
            onClick={onReplay}
          >
            <Play size={18} />
            Start Replay
          </button>
          <button className="result-view-board" type="button" onClick={onClose}>
            <LayoutGrid size={17} />
            View Board
          </button>
        </div>
      </section>
    </div>
  );
}
