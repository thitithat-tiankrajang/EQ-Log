import { formatSeconds, getGameMode, type GameState, type Side } from "../../game";

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
  const isSolo = getGameMode(game) === "solo";
  const sides: Side[] = isSolo ? ["A"] : ["A", "B"];
  const allUntimed = game.timers.untimed || (game.timers.sideUntimed?.A && game.timers.sideUntimed?.B);
  return (
    <section className={`scoreboard ${allUntimed ? "untimed" : "timed"} ${isSolo ? "solo" : ""}`}>
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
  const isUntimed = game.timers.untimed || game.timers.sideUntimed?.[side] === true;
  const isNegative = !isUntimed && timer < 0;
  return (
    <div
      className={`scoreboard-side side-${side.toLowerCase()} ${isActive ? "active" : ""} ${
        isNegative ? "negative" : ""
      }`}
    >
      <div className="ss-head">
        <span className="ss-label">{game.players[side]}</span>
        {!isUntimed && <span className="ss-clock">{formatSeconds(timer)}</span>}
      </div>
      <div className="ss-score">
        <strong>{score}</strong>
        <span>pts</span>
      </div>
    </div>
  );
}
