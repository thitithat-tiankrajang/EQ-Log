import {
  type EndGameDetail,
  formatSeconds,
  type ExchangeDetail,
  type GameState,
  type PlaceEquationDetail,
  type TileInstance,
  type TurnLog,
} from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { ACTION_LABELS } from "../../uiText";
import { Tile } from "../board/Tile";

// Everything about a turn is derivable from the logs:
//  • the rack at turn start (log.rackBefore = the 8 after refilling),
//  • which tiles were drawn = rackBefore minus what the side kept last turn,
//  • time used this turn = (side's clock at turn start) − (clock at submit),
//    where clock at turn start = the side's previous log's timerAfter.
function turnInsights(game: GameState, log: TurnLog) {
  if (log.action === "end_game") {
    return {
      startClock: log.timerAfter[log.side],
      submitClock: log.timerAfter[log.side],
      timeUsed: 0,
      leftover: [],
      drew: [],
    };
  }
  const priorSame = game.logs
    .filter((entry) => entry.side === log.side && entry.turnNumber < log.turnNumber)
    .sort((a, b) => a.turnNumber - b.turnNumber)
    .at(-1);
  const startClock = priorSame
    ? priorSame.timerAfter[log.side]
    : (game.timers.initialSecondsBySide?.[log.side] ?? game.timers.initialSeconds);
  const submitClock = log.timerAfter[log.side];
  const timeUsed = Math.max(0, startClock - submitClock);
  const leftover = priorSame ? priorSame.rackAfter : [];
  const leftoverIds = new Set(leftover.map((tile) => tile.id));
  const drew = (log.rackBefore ?? []).filter((tile) => !leftoverIds.has(tile.id));
  return { startClock, submitClock, timeUsed, leftover, drew };
}

function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

export function TurnDetail({ game, log }: { game: GameState; log: TurnLog }) {
  const { timeUsed, submitClock, drew } = turnInsights(game, log);
  const drewIds = new Set(drew.map((tile) => tile.id));

  return (
    <div className="turn-detail">
      <div className="td-head">
        <div className="td-head-main">
          <span className="td-turn">Turn {log.turnNumber}</span>
          <span className="td-player">{game.players[log.side]}</span>
          <span className={`td-action td-action-${log.action}`}>{ACTION_LABELS[log.action]}</span>
        </div>
        <div className="td-time">
          <span>Used {formatDuration(timeUsed)}</span>
          <span>submit @ {formatSeconds(submitClock)}</span>
        </div>
      </div>

      <TileChips
        label="Rack"
        note={drew.length ? `drew ${drew.length}` : "no draw"}
        tiles={log.rackBefore ?? []}
        highlightIds={drewIds}
      />

      {log.action === "place_equation" && <PlaceBody log={log} />}
      {log.action === "exchange" && <ExchangeBody log={log} />}
      {log.action === "pass" && <p className="td-pass">Passed — board and rack unchanged.</p>}
      {log.action === "end_game" && <EndGameBody game={game} log={log} />}

      {(log.action === "place_equation" || log.action === "exchange") && (
        <TileChips label="Rack after" muted tiles={log.rackAfter} />
      )}
    </div>
  );
}

function PlaceBody({ log }: { log: TurnLog }) {
  const detail = log.actionDetail as PlaceEquationDetail;
  return (
    <>
      <div className="td-row placed-row">
        <span className="td-label">Placed</span>
        <div className="td-chips">
          {detail.placedTiles.length === 0 ? (
            <span className="td-empty">—</span>
          ) : (
            detail.placedTiles.map((placed) => (
              <span className="td-chip" key={placed.tileId}>
                <Tile
                  tile={{ id: placed.tileId, token: placed.token, assignedToken: placed.assignedToken }}
                />
                <small>
                  R{placed.row + 1}·C{placed.col + 1}
                </small>
              </span>
            ))
          )}
        </div>
      </div>

      {detail.equationsDetected.length > 0 && (
        <div className="td-equations">
          {detail.equationsDetected.map((equation, index) => (
            <div className={`td-eq ${equation.isValid ? "" : "bad"}`} key={index}>
              <span className="td-eq-text">{equation.expressionText}</span>
              <strong>
                {equation.isValid
                  ? `${equation.score} pts${equation.multiplier > 1 ? ` ·×${equation.multiplier}` : ""}`
                  : equation.error ?? "invalid"}
              </strong>
            </div>
          ))}
        </div>
      )}

      <div className="td-score">
        <span>Turn score</span>
        <strong>{log.finalScore} pts</strong>
        {log.manualScore != null && <em>(manual)</em>}
      </div>
    </>
  );
}

function ExchangeBody({ log }: { log: TurnLog }) {
  const detail = log.actionDetail as ExchangeDetail;
  return (
    <>
      <TileChips label="Returned" tiles={detail.outgoingTiles} />
      <TileChips
        label="Received"
        tiles={detail.incomingTiles}
        highlightIds={new Set(detail.incomingTiles.map((tile) => tile.id))}
      />
    </>
  );
}

function EndGameBody({ game, log }: { game: GameState; log: TurnLog }) {
  const detail = log.actionDetail as EndGameDetail;
  return (
    <>
      <p className="td-pass">{detail.description}</p>
      {detail.rackPoints && (
        <div className="td-eq">
          <span className="td-eq-text">
            Rack totals: {game.players.A} {detail.rackPoints.A} · {game.players.B} {detail.rackPoints.B}
          </span>
          <strong>{detail.noScoreStreak ?? 0} no-score turns</strong>
        </div>
      )}
      {detail.reason === "no_score_streak" && !detail.rackPoints && (
        <div className="td-eq">
          <span className="td-eq-text">Solo no-score limit reached</span>
          <strong>{detail.noScoreStreak ?? 0} no-score turns</strong>
        </div>
      )}
      {detail.opponentRackPoints != null && (
        <div className="td-eq">
          <span className="td-eq-text">
            Opponent rack {detail.opponentRackPoints} · Tilebag {detail.tilebagPoints ?? 0}
          </span>
          <strong>×2 bonus</strong>
        </div>
      )}
      <div className="td-score">
        <span>End-game bonus</span>
        <strong>{detail.bonusPoints} pts</strong>
        {detail.bonusSide && <em>to {game.players[detail.bonusSide]}</em>}
      </div>
    </>
  );
}

function TileChips({
  label,
  tiles,
  note,
  muted,
  highlightIds,
}: {
  label: string;
  tiles: TileInstance[];
  note?: string;
  muted?: boolean;
  highlightIds?: Set<string>;
}) {
  return (
    <div className={`td-row ${tiles.length >= RACK_SIZE ? "full-rack" : ""} ${muted ? "muted" : ""}`}>
      <span className="td-label">
        {label}
        {note && <em> · {note}</em>}
      </span>
      <div className="td-chips">
        {tiles.length === 0 ? (
          <span className="td-empty">—</span>
        ) : (
          tiles.map((tile) => (
            <span className={`td-chip ${highlightIds?.has(tile.id) ? "drew" : ""}`} key={tile.id}>
              <Tile tile={tile} />
            </span>
          ))
        )}
      </div>
    </div>
  );
}
