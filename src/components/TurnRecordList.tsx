import type { ReactNode } from "react";
import {
  displayToken,
  getRack,
  type ExchangeDetail,
  type GameState,
  type PlaceEquationDetail,
  type TileInstance,
  type TurnLog,
} from "../game";
import { ACTION_LABELS } from "../uiText";
import { Tile } from "./Tile";

type TurnRecordListProps = {
  game: GameState;
  selectedLogId: string | null;
  currentTurnRack?: TileInstance[];
  toggleSelection?: boolean;
  onSelectLog: (logId: string | null) => void;
};

export function TurnRecordList({
  game,
  selectedLogId,
  currentTurnRack,
  toggleSelection = true,
  onSelectLog,
}: TurnRecordListProps) {
  const activeRack = currentTurnRack ?? getRack(game, game.activeSide);
  const showCurrentRack = game.status === "playing" && activeRack.length >= 8;

  return (
    <div className="turn-record-list">
      {showCurrentRack && (
        <section className={`turn-record-group live side-${game.activeSide.toLowerCase()}`}>
          <div className="turn-record-heading">
            <span>
              T{game.turnNumber} · {game.players[game.activeSide]}
            </span>
            <strong>Live</strong>
          </div>
          <div className="turn-record">
            <span className="turn-record-index">1</span>
            <div className="turn-record-body">
              <span className="turn-record-title">
                Rack ready <em>{activeRack.length}/8</em>
              </span>
              <TileStrip tiles={activeRack} />
            </div>
          </div>
        </section>
      )}

      {game.logs
        .slice()
        .reverse()
        .map((log) => (
          <CompletedTurnRecord
            game={game}
            key={log.id}
            log={log}
            selected={selectedLogId === log.id}
            onSelect={() => onSelectLog(toggleSelection && selectedLogId === log.id ? null : log.id)}
          />
        ))}
    </div>
  );
}

function CompletedTurnRecord({
  game,
  log,
  selected,
  onSelect,
}: {
  game: GameState;
  log: TurnLog;
  selected: boolean;
  onSelect: () => void;
}) {
  const isBingo = log.rackBefore.length >= 8;
  const isPlace = log.action === "place_equation";
  const placedAll = isPlace && (log.actionDetail as PlaceEquationDetail).placedTiles.length >= 8;
  return (
    <section className={`turn-record-group side-${log.side.toLowerCase()} ${selected ? "selected" : ""}`}>
      <button className="turn-record-heading" type="button" onClick={onSelect}>
        <span>
          T{log.turnNumber} · {game.players[log.side]}
        </span>
        <strong>{log.finalScore} pts</strong>
      </button>

      <TurnRecordButton
        index="1"
        title="Rack filled"
        meta={`${log.rackBefore.length}/8`}
        bingo={isBingo}
        onClick={onSelect}
      >
        <TileStrip tiles={log.rackBefore} />
      </TurnRecordButton>

      <TurnRecordButton
        description={actionDescription(log)}
        index="2"
        title={ACTION_LABELS[log.action]}
        meta="Action"
        bingo={placedAll}
        onClick={onSelect}
      />

      <TurnRecordButton
        index="3"
        title="Rack after action"
        meta={`${log.rackAfter.length}/8`}
        onClick={onSelect}
      >
        <TileStrip muted tiles={log.rackAfter} />
      </TurnRecordButton>
    </section>
  );
}

function TurnRecordButton({
  index,
  title,
  meta,
  description,
  bingo = false,
  children,
  onClick,
}: {
  index: string;
  title: string;
  meta?: string;
  description?: string;
  bingo?: boolean;
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`turn-record ${bingo ? "bingo" : ""}`} type="button" onClick={onClick}>
      <span className="turn-record-index">{index}</span>
      <div className="turn-record-body">
        <span className="turn-record-title">
          {title}
          {meta && <em>{meta}</em>}
        </span>
        {description && <span className="turn-record-desc">{description}</span>}
        {children}
      </div>
    </button>
  );
}

function TileStrip({ tiles, muted = false }: { tiles: TileInstance[]; muted?: boolean }) {
  return (
    <div className={`turn-record-tiles ${muted ? "muted" : ""}`}>
      {Array.from({ length: 8 }).map((_, index) => {
        const tile = tiles[index];
        if (!tile) return <span className="turn-record-empty-tile" key={`empty-${index}`} />;
        return (
          <span className="turn-record-tile" key={tile.id}>
            <Tile compact showPoint tile={tile} />
          </span>
        );
      })}
    </div>
  );
}

function actionDescription(log: TurnLog): string {
  if (log.action === "place_equation") {
    const detail = log.actionDetail as PlaceEquationDetail;
    const equations = detail.equationsDetected.map((equation) => equation.expressionText).join(" / ");
    const status = detail.isMoveValid ? "Valid" : "Invalid";
    return `${detail.placedTiles.length} placed · ${equations || "No equation"} · ${status}`;
  }

  if (log.action === "exchange") {
    const detail = log.actionDetail as ExchangeDetail;
    return `${tileText(detail.outgoingTiles)} out`;
  }

  return "Passed without changing the board";
}

function tileText(tiles: TileInstance[]): string {
  if (tiles.length === 0) return "None";
  return tiles.map((tile) => displayToken(tile)).join(" ");
}
