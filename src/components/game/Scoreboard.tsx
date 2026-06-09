import { formatSeconds, type GameState, type Side } from "../../game";

type ScoreboardProps = {
  game: GameState;
};

// Two-side scoreboard. Score is the focal element (large, bold). The clock is
// a subdued secondary line — and disappears entirely in untimed rooms (no
// infinity glyph). Stop Time control lives in the top navbar, not here.
export function Scoreboard({ game }: ScoreboardProps) {
  const sides: Side[] = ["A", "B"];
  return (
    <section className={`scoreboard ${game.timers.untimed ? "untimed" : "timed"}`}>
      <div className="scoreboard-panels">
        {sides.map((side) => (
          <SidePanel game={game} key={side} side={side} />
        ))}
      </div>
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
      <div className="ss-head">
        <span className="ss-label">{game.players[side]}</span>
        {!game.timers.untimed && (
          <span className="ss-clock">{formatSeconds(game.timers[side])}</span>
        )}
      </div>
      <div className="ss-score">
        <strong>{game.scores[side]}</strong>
        <span>pts</span>
      </div>
    </div>
  );
}
