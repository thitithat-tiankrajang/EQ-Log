import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { GameState, TurnLog } from "../../game";
import { TurnDetail } from "./TurnDetail";

// Embedded replay/live-view panel. The board area shows the selected replay
// board, while this panel replaces action controls that should not be usable.
export function ReplayDock({
  game,
  log,
  index,
  total,
  onPrev,
  onNext,
  onExit,
  mode = "replay",
}: {
  game: GameState;
  log: TurnLog | null;
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  onExit?: () => void;
  mode?: "replay" | "live";
}) {
  const isLive = mode === "live";
  return (
    <div className={`replay-dock ${isLive ? "live" : ""}`}>
      <div className="replay-dock-bar">
        <strong>{isLive ? "Live View" : "Replay"}</strong>
        <span>
          {isLive
            ? total > 0
              ? `Latest turn · ${total}`
              : `Turn ${game.turnNumber}`
            : `${Math.max(1, index + 1)} / ${total}`}
        </span>
        {!isLive && (
          <div className="replay-dock-controls">
            <button type="button" disabled={index <= 0} onClick={onPrev}>
              <ChevronLeft size={16} />
              Prev
            </button>
            <button type="button" onClick={onNext}>
              {index >= total - 1 ? "Live" : "Next"}
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={onExit}>
              <X size={16} />
              Exit
            </button>
          </div>
        )}
      </div>
      {log ? (
        <TurnDetail game={game} log={log} />
      ) : (
        <p className="replay-empty">
          {isLive ? "Waiting for the first submitted turn. The board updates live." : "Select a turn to replay."}
        </p>
      )}
    </div>
  );
}
