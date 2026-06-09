import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { GameState, TurnLog } from "../../game";
import { TurnDetail } from "./TurnDetail";

// Embedded replay/live-view panel. The board area shows the selected replay
// board, while this panel replaces action controls that should not be usable.
//
// Replay has 2 half-steps per turn:
//   "before" → rack just refilled to 8, waiting for action (board = boardBefore)
//   "after"  → action applied                              (board = boardAfter)
//
// The Next button is disabled at the last step (no auto-exit). The user must
// click Exit explicitly — that keeps undo available while reviewing the final
// state.
export function ReplayDock({
  game,
  log,
  index,
  total,
  phase = "after",
  onPrev,
  onNext,
  onExit,
  mode = "replay",
}: {
  game: GameState;
  log: TurnLog | null;
  index: number;
  total: number;
  phase?: "before" | "after";
  onPrev?: () => void;
  onNext?: () => void;
  onExit?: () => void;
  mode?: "replay" | "live";
}) {
  const isLive = mode === "live";
  const atStart = index <= 0;
  const atEnd = total > 0 && index >= total - 1;
  return (
    <div className={`replay-dock ${isLive ? "live" : ""}`}>
      <div className="replay-dock-bar">
        <strong>{isLive ? "Live View" : "Replay"}</strong>
        <span>
          {isLive
            ? total > 0
              ? `Latest turn · ${total}`
              : `Turn ${game.turnNumber}`
            : meta({ game, log, index, total, phase })}
        </span>
        {!isLive && (
          <div className="replay-dock-controls">
            <button disabled={atStart} title="Previous step" type="button" onClick={onPrev}>
              <ChevronLeft size={16} />
              Prev
            </button>
            <button disabled={atEnd} title={atEnd ? "End of replay" : "Next step"} type="button" onClick={onNext}>
              Next
              <ChevronRight size={16} />
            </button>
            <button title="Exit replay" type="button" onClick={onExit}>
              <X size={16} />
              Exit
            </button>
          </div>
        )}
      </div>
      {log ? (
        <ReplayBody game={game} isLive={isLive} log={log} phase={phase} />
      ) : (
        <p className="replay-empty">
          {isLive ? "Waiting for the first submitted turn. The board updates live." : "Select a turn to replay."}
        </p>
      )}
    </div>
  );
}

function meta({
  game,
  log,
  index,
  total,
  phase,
}: {
  game: GameState;
  log: TurnLog | null;
  index: number;
  total: number;
  phase: "before" | "after";
}): string {
  if (total === 0) return "No turns";
  const turnLabel = log ? `T${log.turnNumber} · ${game.players[log.side]}` : `Step ${index + 1}`;
  const phaseLabel = phase === "before" ? "Rack ready" : "Action";
  return `${index + 1}/${total} · ${turnLabel} · ${phaseLabel}`;
}

function ReplayBody({
  game,
  log,
  phase,
  isLive,
}: {
  game: GameState;
  log: TurnLog;
  phase: "before" | "after";
  isLive: boolean;
}) {
  if (isLive) return <TurnDetail game={game} log={log} />;
  if (phase === "before") {
    // Pre-action half-step: highlight that the rack is full and an action
    // is pending. We don't reuse TurnDetail (it shows the resolved action);
    // instead we show a compact "waiting for action" preview.
    return (
      <div className="replay-before">
        <div className="rb-head">
          <span className="rb-eyebrow">Turn {log.turnNumber}</span>
          <strong className="rb-player">{game.players[log.side]}</strong>
          <span className="rb-status">Rack ready · waiting for action</span>
        </div>
        <div className="rb-rack">
          <span>Rack</span>
          <div className="rb-rack-tiles">
            {log.rackBefore.map((tile) => (
              <span className="rb-tile" key={tile.id}>
                <b>{tile.assignedToken ?? tile.token}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <TurnDetail game={game} log={log} />;
}
