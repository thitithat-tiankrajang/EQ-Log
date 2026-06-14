import { useEffect, useRef } from "react";
import {
  displayToken,
  getRack,
  type EndGameDetail,
  type ExchangeDetail,
  type GameState,
  type PlaceEquationDetail,
  type TileInstance,
  type TurnLog,
} from "../../game";
import { ACTION_LABELS } from "../../uiText";
import { Tile } from "../board/Tile";

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
  const showCurrentRack = game.status === "playing" && (activeRack.length >= 8 || game.tilebag.length === 0);

  // Smooth-scroll to the newest row (which now sits at the bottom) whenever the
  // list grows. We scroll the *nearest scrollable ancestor*, not the list itself,
  // because the rail panel is the overflow:auto container.
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastCountRef = useRef(0);
  useEffect(() => {
    const newCount = game.logs.length + (showCurrentRack ? 1 : 0);
    if (newCount > lastCountRef.current) {
      const el = listRef.current;
      if (el) {
        const scroller = findScrollableAncestor(el);
        (scroller ?? el).scrollTo({ top: (scroller ?? el).scrollHeight, behavior: "smooth" });
      }
    }
    lastCountRef.current = newCount;
  }, [game.logs.length, showCurrentRack]);

  return (
    <div className="turn-record-list" ref={listRef}>
      {game.logs.map((log) => (
        <CompletedTurnRecord
          game={game}
          key={log.id}
          log={log}
          selected={selectedLogId === log.id}
          onSelect={() => onSelectLog(toggleSelection && selectedLogId === log.id ? null : log.id)}
        />
      ))}

      {showCurrentRack && (
        <section className={`turn-record-group live side-${game.activeSide.toLowerCase()}`}>
          <div className="turn-record-summary">
            <span className="trs-turn">T{game.turnNumber}</span>
            <span className={`trs-side side-${game.activeSide.toLowerCase()}`}>{game.players[game.activeSide]}</span>
            <span className="trs-action">Ready · {activeRack.length}/8</span>
            <span className="trs-live">Live</span>
          </div>
        </section>
      )}
    </div>
  );
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
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
  const isPlace = log.action === "place_equation";
  const placedTiles = isPlace ? (log.actionDetail as PlaceEquationDetail).placedTiles : [];
  const placedAll = isPlace && placedTiles.length >= 8;
  const sideClass = `side-${log.side.toLowerCase()}`;
  return (
    <section className={`turn-record-group ${sideClass} ${selected ? "selected" : ""} ${placedAll ? "bingo" : ""}`}>
      <button className="turn-record-summary" type="button" onClick={onSelect}>
        <span className="trs-turn">T{log.turnNumber}</span>
        <span className={`trs-side ${sideClass}`}>{game.players[log.side]}</span>
        <span className="trs-action">{summaryText(log)}</span>
        <span className="trs-score">{log.finalScore} pts</span>
      </button>
      {selected && (
        <div className="turn-record-detail">
          <div className="trd-tiles">
            <span>Before</span>
            <TileStrip tiles={log.rackBefore} />
          </div>
          <div className="trd-tiles">
            <span>After</span>
            <TileStrip muted tiles={log.rackAfter} />
          </div>
        </div>
      )}
    </section>
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

function summaryText(log: TurnLog): string {
  const label = ACTION_LABELS[log.action];
  if (log.action === "place_equation") {
    const detail = log.actionDetail as PlaceEquationDetail;
    const equation = detail.equationsDetected[0]?.expressionText;
    const placed = detail.placedTiles.length;
    if (equation) return `${label} · ${equation}`;
    return `${label} · ${placed} tiles`;
  }
  if (log.action === "exchange") {
    const detail = log.actionDetail as ExchangeDetail;
    const list = detail.outgoingTiles.map((tile) => displayToken(tile)).join(" ");
    return `${label} · ${list || "0 tiles"}`;
  }
  if (log.action === "end_game") {
    const detail = log.actionDetail as EndGameDetail;
    return `${label} · ${detail.bonusPoints} pts`;
  }
  return label;
}
