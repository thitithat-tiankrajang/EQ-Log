import { Pause, Play } from "lucide-react";
import { formatSeconds, type GameState, type Side } from "../game";

type ScoreboardProps = {
  game: GameState;
  readOnly: boolean;
  onToggleTimer: () => void;
};

// Score + timer column placed at the top of the log rail. Combined width
// matches the log rail. Stop Time sits to the right of the timers.
export function Scoreboard({ game, readOnly, onToggleTimer }: ScoreboardProps) {
  const sides: Side[] = ["A", "B"];
  return (
    <section className="scoreboard">
      <div className="scoreboard-panels">
        {sides.map((side) => (
          <SidePanel game={game} key={side} side={side} />
        ))}
      </div>
      {!game.timers.untimed && (
        <button
          className={`scoreboard-stop ${game.timers.paused ? "paused" : "running"}`}
          disabled={readOnly || game.status !== "playing"}
          title={readOnly ? "Only the room owner can control the clock." : undefined}
          type="button"
          onClick={onToggleTimer}
        >
          {game.timers.paused ? <Play size={14} /> : <Pause size={14} />}
          <span>{game.timers.paused ? "Resume" : "Stop"}</span>
        </button>
      )}
    </section>
  );
}

function SidePanel({ game, side }: { game: GameState; side: Side }) {
  const isActive = game.activeSide === side && game.status === "playing";
  const isNegative = !game.timers.untimed && game.timers[side] < 0;
  return (
    <div
      className={`scoreboard-side side-${side.toLowerCase()} ${isActive ? "active" : ""} ${
        isNegative ? "negative" : ""
      }`}
    >
      <span className="ss-label">{game.players[side]}</span>
      <strong className="ss-clock">{game.timers.untimed ? "∞" : formatSeconds(game.timers[side])}</strong>
      <small className="ss-score">{game.scores[side]} pts</small>
    </div>
  );
}
