import { formatSeconds, type GameState, type Side } from "../../game";

type ScoreboardProps = {
  game: GameState;
  scoresOverride?: Record<Side, number>;
  timersOverride?: Record<Side, number>;
};

// Two-side scoreboard. Score is the focal element (large, bold). The clock is
// a subdued secondary line — and disappears entirely in untimed rooms (no
// infinity glyph). Stop Time control lives in the top navbar, not here.
//
// During replay we can override scores/timers so the values reflect the state
// at the replayed half-step, not the live state.
export function Scoreboard({ game, scoresOverride, timersOverride }: ScoreboardProps) {
  const sides: Side[] = ["A", "B"];
  return (
    <section className={`scoreboard ${game.timers.untimed ? "untimed" : "timed"}`}>
      <div className="scoreboard-panels">
        {sides.map((side) => (
          <SidePanel
            game={game}
            key={side}
            scoresOverride={scoresOverride}
            side={side}
            timersOverride={timersOverride}
          />
        ))}
      </div>
    </section>
  );
}

function SidePanel({
  game,
  side,
  scoresOverride,
  timersOverride,
}: {
  game: GameState;
  side: Side;
  scoresOverride?: Record<Side, number>;
  timersOverride?: Record<Side, number>;
}) {
  const isActive = !scoresOverride && game.activeSide === side && game.status === "playing";
  const score = scoresOverride ? scoresOverride[side] : game.scores[side];
  const timer = timersOverride ? timersOverride[side] : game.timers[side];
  const isNegative = !game.timers.untimed && timer < 0;
  return (
    <div
      className={`scoreboard-side side-${side.toLowerCase()} ${isActive ? "active" : ""} ${
        isNegative ? "negative" : ""
      }`}
    >
      <div className="ss-head">
        <span className="ss-label">{game.players[side]}</span>
        {!game.timers.untimed && <span className="ss-clock">{formatSeconds(timer)}</span>}
      </div>
      <div className="ss-score">
        <strong>{score}</strong>
        <span>pts</span>
      </div>
    </div>
  );
}
